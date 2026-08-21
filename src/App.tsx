import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from './components/AppShell'
import { DEFAULT_SETTINGS, DEMO_NOTICES, DEMO_NOTIFICATIONS, DEMO_USERS, makeDemoOrders, makeDemoPaymentSteps } from './data/demo'
import type { AccountDraft, AppSettings, MemberDeletionCheck, MemberReviewInput, Notice, NotificationItem, Order, OrderDraft, OrderStatus, Page, PaymentAccount, PaymentStep, ProgramTransferPreview, ProgramType, SettlementBatchResult, SettlementConfirmationInput, SignupDraft, User } from './domain/types'
import { AuthPage } from './features/AuthPage'
import { DashboardPage } from './features/DashboardPage'
import { MembersPage } from './features/MembersPage'
import { MyInfoPage } from './features/MyInfoPage'
import { NoticesPage } from './features/NoticesPage'
import { NotificationsPage } from './features/NotificationsPage'
import { OperationsPage } from './features/OperationsPage'
import { OrdersPage } from './features/OrdersPage'
import { SettlementPage } from './features/SettlementPage'
import { useLocalStorage } from './hooks/useLocalStorage'
import {
  archiveRemoteOrder,
  confirmRemotePaymentStep,
  confirmSettlementQuoteV92,
  createRemoteNotice,
  createRemoteOrder,
  createRemoteOrdersBulk,
  checkRemoteMemberDeletion,
  deleteRemoteMemberAccount,
  deleteAllRemoteNotifications,
  deleteRemoteNotice,
  deleteRemoteNotification,
  fetchProfile,
  fetchRemoteSnapshot,
  markAllRemoteNotificationsRead,
  markRemoteNotificationRead,
  previewRemoteOrderProgramTransfer,
  resetRemoteMemberPassword,
  restoreRemoteOrder,
  reviewRemoteMember,
  saveRemoteAccount,
  saveRemoteSettings,
  setRemoteOrderStatus,
  transferRemoteOrderProgram,
} from './lib/backend'
import { hashPassword, normalizePhoneNumber, normalizeUsername, passwordToAuthSecret, usernameToAuthEmail, validatePassword } from './lib/auth'
import { calculateAmount } from './lib/money'
import { applyScheduledTransitions, createOrder, extractMid, transitionOrder } from './lib/order'
import { applyProgramPrices, getProgramPriceMap, getUserProgramPrice, PROGRAM_PAGE_MAP } from './lib/program'
import { isSupabaseConfigured, supabase } from './lib/supabase'

function errorMessage(error: unknown, fallback: string): string {
  const values: string[] = []
  if (typeof error === 'string') values.push(error)
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'error_description', 'details', 'hint', 'code']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) values.push(value.trim())
      if (typeof value === 'number') values.push(String(value))
    }
  }

  const message = values.join(' · ').trim()
  if (/invalid login credentials/i.test(message)) return '아이디 또는 비밀번호가 올바르지 않습니다.'
  if (/user already registered|duplicate key|profiles_username_key_key|이미 사용 중/i.test(message)) return '이미 사용 중이거나 가입 신청된 아이디입니다.'
  if (/password/i.test(message) && /short|weak|length/i.test(message)) return '서버 비밀번호 정책에 맞지 않습니다. Supabase 비밀번호 최소 길이 설정을 확인해 주세요.'
  if (/database error saving new user|unexpected_failure|handle_new_auth_user/i.test(message)) {
    return '회원가입 데이터베이스 연결에 문제가 있습니다. Supabase에서 supabase/update_v9_3_operations_manager.sql 적용 여부를 확인해 주세요.'
  }
  if (!message || message === '{}' || message === '[object Object]') return fallback
  return message
}

function makeReferralCode(id: string): string {
  return `SP${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`
}

function localPaymentAccount(user: User | null, members: User[], settings: AppSettings): PaymentAccount {
  if (!user || user.role === 'admin' || !user.sponsorId) {
    return { payeeId: null, payeeUsername: 'admin', bank: settings.bank, accountNumber: settings.accountNumber, accountHolder: settings.accountHolder, source: 'admin' }
  }
  const sponsor = members.find((member) => member.id === user.sponsorId)
  return { payeeId: sponsor?.id ?? null, payeeUsername: sponsor?.username ?? user.sponsorUsername ?? '', bank: sponsor?.bank ?? '', accountNumber: sponsor?.accountNumber ?? '', accountHolder: sponsor?.accountHolder ?? '', source: 'sponsor' }
}

function buildLocalPaymentSteps(order: Order, members: User[]): PaymentStep[] {
  const admin = members.find((member) => member.role === 'admin' && member.active)
  let payer = members.find((member) => member.id === order.createdBy)
  const steps: PaymentStep[] = []
  let stepOrder = 1
  while (payer && payer.role !== 'admin' && admin) {
    const payee = payer.sponsorId ? members.find((member) => member.id === payer?.sponsorId) : admin
    if (!payee) break
    const unitPrice = getUserProgramPrice(payer, order.programType)
    const amount = calculateAmount(order.dailyShots, order.operationDays, unitPrice)
    steps.push({ id: crypto.randomUUID(), programType: order.programType, orderDbId: order.dbId ?? order.id, orderNumber: order.id, storeName: order.storeName, stepOrder, payerId: payer.id, payerUsername: payer.username, payeeId: payee.id, payeeUsername: payee.username, unitPrice, ...amount, confirmedAt: null, canConfirm: stepOrder === 1, previousPendingCount: stepOrder - 1, createdAt: order.createdAt })
    if (payee.role === 'admin') break
    payer = payee
    stepOrder += 1
  }
  return steps
}

function localProgramTransferPreview(order: Order, targetProgram: ProgramType, members: User[], paymentSteps: PaymentStep[]): ProgramTransferPreview {
  const creator = members.find((member) => member.id === order.createdBy)
  const targetPrice = creator ? getUserProgramPrice(creator, targetProgram) : 0
  const nextAmount = calculateAmount(order.dailyShots, order.operationDays, targetPrice)
  const orderSteps = paymentSteps.filter((step) => step.orderDbId === (order.dbId ?? order.id))
  const confirmedSteps = orderSteps.filter((step) => step.confirmedAt)
  const targetOrder = { ...order, programType: targetProgram, pricePerShot: targetPrice, ...nextAmount }
  const targetSteps = creator && targetPrice > 0 ? buildLocalPaymentSteps(targetOrder, members) : []
  let blockedReason = ''

  if (order.archivedAt) blockedReason = '보관된 작업은 복원한 뒤 프로그램을 변경해 주세요.'
  else if (order.programType === targetProgram) blockedReason = '현재 프로그램과 변경 대상이 같습니다.'
  else if (!creator || creator.approvalStatus !== 'approved' || !creator.active || targetPrice <= 0) blockedReason = '등록자의 변경 대상 프로그램 현재 승인 단가가 0원이거나 설정되지 않았습니다.'
  else if (orderSteps.length === 0 || targetSteps.length === 0) blockedReason = '안전하게 재구성할 정산 체인을 찾을 수 없습니다.'
  else if (confirmedSteps.length > 0 && nextAmount.totalAmount < order.totalAmount) blockedReason = '확인된 정산이 있어 차감 또는 환불이 필요한 하향 변경은 자동 처리할 수 없습니다.'
  else if (confirmedSteps.length > 0 && targetSteps.some((targetStep) => {
    const paid = confirmedSteps.filter((step) => step.payerId === targetStep.payerId && step.payeeId === targetStep.payeeId)
    return paid.reduce((sum, step) => sum + step.supplyAmount, 0) > targetStep.supplyAmount
      || paid.reduce((sum, step) => sum + step.vatAmount, 0) > targetStep.vatAmount
  })) blockedReason = '정산 참여자 중 과납이 발생해 차감 또는 환불을 별도로 처리해야 합니다.'

  const needsPayment = confirmedSteps.length === 0 || targetSteps.some((targetStep) => {
    const paidTotal = confirmedSteps
      .filter((step) => step.payerId === targetStep.payerId && step.payeeId === targetStep.payeeId)
      .reduce((sum, step) => sum + step.totalAmount, 0)
    return targetStep.totalAmount > paidTotal
  })
  const afterStatus = order.status === '입금완료' && needsPayment ? '입금대기' : order.status
  const settlementMode = confirmedSteps.length > 0 ? 'adjustment' : 'rebuild'

  return {
    orderDbId: order.dbId ?? order.id,
    orderNumber: order.id,
    currentStatus: order.status,
    afterStatus,
    beforeProgram: order.programType,
    afterProgram: targetProgram,
    beforeUnitPrice: order.pricePerShot,
    afterUnitPrice: targetPrice,
    beforeSupplyAmount: order.supplyAmount,
    afterSupplyAmount: nextAmount.supplyAmount,
    beforeVatAmount: order.vatAmount,
    afterVatAmount: nextAmount.vatAmount,
    beforeTotalAmount: order.totalAmount,
    afterTotalAmount: nextAmount.totalAmount,
    difference: nextAmount.totalAmount - order.totalAmount,
    confirmedPaymentCount: confirmedSteps.length,
    pendingPaymentCount: orderSteps.length - confirmedSteps.length,
    settlementMode,
    settlementImpact: settlementMode === 'rebuild'
      ? '확인된 입금이 없어 기존 미확인 단계를 대상 프로그램 현재 단가 기준으로 모두 다시 만듭니다.'
      : '확인된 금액과 배치 이력은 유지하고, 참여자별 새 목표 금액에서 확인액을 뺀 잔액만 보정 단계로 추가합니다.',
    keepsOperationRunning: order.status === '구동중',
    expectedVersion: order.lockVersion,
    canTransfer: !blockedReason,
    blockedReason,
  }
}

export default function App() {
  const initialDemoOrders = useMemo(() => makeDemoOrders(), [])
  const [localSessionUserId, setLocalSessionUserId] = useLocalStorage<string | null>('spark-session-v8', null)
  const [localMembers, setLocalMembers] = useLocalStorage<User[]>('spark-members-v8', DEMO_USERS)
  const [localOrders, setLocalOrders] = useLocalStorage<Order[]>('spark-orders-v8', initialDemoOrders)
  const [localPaymentSteps, setLocalPaymentSteps] = useLocalStorage<PaymentStep[]>('spark-payment-steps-v8', makeDemoPaymentSteps())
  const [localNotifications, setLocalNotifications] = useLocalStorage<NotificationItem[]>('spark-notifications-v8', DEMO_NOTIFICATIONS)
  const [localNotices, setLocalNotices] = useLocalStorage<Notice[]>('spark-notices-v8', DEMO_NOTICES)
  const [localSettings, setLocalSettings] = useLocalStorage<AppSettings>('spark-settings-v8', DEFAULT_SETTINGS)

  const [remoteUser, setRemoteUser] = useState<User | null>(null)
  const [remoteMembers, setRemoteMembers] = useState<User[]>([])
  const [remoteOrders, setRemoteOrders] = useState<Order[]>([])
  const [remotePaymentSteps, setRemotePaymentSteps] = useState<PaymentStep[]>([])
  const [remotePaymentAccount, setRemotePaymentAccount] = useState<PaymentAccount>({ payeeId: null, payeeUsername: '', bank: '', accountNumber: '', accountHolder: '', source: 'admin' })
  const [remoteNotifications, setRemoteNotifications] = useState<NotificationItem[]>([])
  const [remoteNotices, setRemoteNotices] = useState<Notice[]>([])
  const [remoteSettings, setRemoteSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [remoteError, setRemoteError] = useState('')
  const [page, setPage] = useState<Page>('dashboard')
  const [now, setNow] = useState(() => new Date())

  const localUser = useMemo(() => localMembers.find((member) => member.id === localSessionUserId && member.approvalStatus === 'approved' && member.active && member.role !== null) ?? null, [localMembers, localSessionUserId])
  const user = isSupabaseConfigured ? remoteUser : localUser
  const members = isSupabaseConfigured ? remoteMembers : localMembers
  const orders = isSupabaseConfigured ? remoteOrders : localOrders
  const paymentSteps = isSupabaseConfigured ? remotePaymentSteps : localPaymentSteps
  const notifications = isSupabaseConfigured ? remoteNotifications : localNotifications
  const notices = isSupabaseConfigured ? remoteNotices : localNotices
  const settings = isSupabaseConfigured ? remoteSettings : localSettings
  const paymentAccount = isSupabaseConfigured ? remotePaymentAccount : localPaymentAccount(user, localMembers, localSettings)

  const refreshRemote = useCallback(async () => {
    if (!isSupabaseConfigured || !remoteUser) return
    try {
      const snapshot = await fetchRemoteSnapshot(remoteUser.role === 'admin')
      setRemoteMembers(snapshot.members)
      setRemoteOrders(snapshot.orders)
      setRemotePaymentSteps(snapshot.paymentSteps)
      setRemotePaymentAccount(snapshot.paymentAccount)
      setRemoteNotifications(snapshot.notifications)
      setRemoteNotices(snapshot.notices)
      setRemoteSettings(snapshot.settings)
      const refreshedSelf = snapshot.members.find((member) => member.id === remoteUser.id)
      if (refreshedSelf && refreshedSelf.updatedAt !== remoteUser.updatedAt) setRemoteUser(refreshedSelf)
      setRemoteError('')
    } catch (error) {
      setRemoteError(errorMessage(error, '서버 데이터를 불러오지 못했습니다. update_v9_stability.sql 적용 여부를 확인해 주세요.'))
    }
  }, [remoteUser])

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 5_000); return () => window.clearInterval(timer) }, [])

  useEffect(() => {
    if (user?.isOperationsManager && !(['dashboard', 'notifications', 'members', 'myinfo', 'notices'] as Page[]).includes(page)) setPage('dashboard')
  }, [page, user?.isOperationsManager])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    const client = supabase
    let active = true
    const restoreSession = async () => {
      try {
        const { data, error } = await client.auth.getSession()
        if (error) throw error
        const authUserId = data.session?.user?.id
        if (!authUserId) { if (active) setRemoteUser(null); return }
        const profile = await fetchProfile(authUserId)
        if (!profile || profile.approvalStatus !== 'approved' || !profile.active || profile.role === null) { await client.auth.signOut(); if (active) setRemoteUser(null); return }
        if (active) setRemoteUser(profile)
      } catch (error) {
        if (active) setRemoteError(errorMessage(error, '로그인 세션을 확인하지 못했습니다.'))
      } finally {
        if (active) setAuthReady(true)
      }
    }
    void restoreSession()
    const { data } = client.auth.onAuthStateChange((event: string, session: { user?: { id?: string } } | null) => {
      if (event === 'SIGNED_OUT' || !session?.user?.id) { setRemoteUser(null); setRemoteMembers([]); setRemoteOrders([]); setRemotePaymentSteps([]); setRemoteNotifications([]); setRemoteNotices([]); return }
      window.setTimeout(() => void fetchProfile(session.user?.id ?? '').then((profile) => { if (profile?.approvalStatus === 'approved' && profile.active && profile.role !== null) setRemoteUser(profile) }).catch(() => undefined), 0)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !remoteUser) return
    const client = supabase
    void refreshRemote()
    let refreshTimer: number | null = null
    const scheduleRefresh = () => { if (refreshTimer !== null) window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => void refreshRemote(), 180) }
    const channel = client.channel(`spark-dashboard-v8-${remoteUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_steps' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlement_batches' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, scheduleRefresh)
      .subscribe()
    return () => { if (refreshTimer !== null) window.clearTimeout(refreshTimer); void client.removeChannel(channel) }
  }, [refreshRemote, remoteUser])

  useEffect(() => {
    if (isSupabaseConfigured) return
    const result = applyScheduledTransitions(localOrders, localMembers, localSettings, now)
    if (result.orders === localOrders) return
    setLocalOrders(result.orders)
    setLocalNotifications((current) => {
      const existingIds = new Set(current.map((item) => item.id))
      const generated = result.transitions.map((transition): NotificationItem => ({ id: `auto-${transition.orderId}-${transition.nextStatus}`, createdAt: now.toISOString(), userId: transition.userId, role: 'all', title: transition.nextStatus === '구동중' ? '구동 자동 시작' : '작업 기간 만료', message: transition.nextStatus === '구동중' ? `${transition.orderId} 작업이 시작일 자정에 구동중으로 변경되었습니다.` : `${transition.orderId} 작업이 종료일 경과로 만료 처리되었습니다.`, read: false, orderId: transition.orderId })).filter((item) => !existingIds.has(item.id))
      return generated.length ? [...generated, ...current] : current
    })
  }, [localMembers, localOrders, localSettings, now, setLocalNotifications, setLocalOrders])

  const login = async (username: string, password: string) => {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: await usernameToAuthEmail(username), password: await passwordToAuthSecret(password) })
        if (error) throw error
        const profile = data.user?.id ? await fetchProfile(data.user.id) : null
        if (!profile) throw new Error('회원 정보를 찾을 수 없습니다.')
        if (profile.approvalStatus === 'pending') { await supabase.auth.signOut(); return { ok: false, message: '가입 승인 대기 중입니다.' } }
        if (profile.approvalStatus === 'rejected') { await supabase.auth.signOut(); return { ok: false, message: '가입 신청이 반려된 계정입니다.' } }
        if (!profile.active || profile.role === null) { await supabase.auth.signOut(); return { ok: false, message: '사용이 중지되었거나 회원 유형이 지정되지 않았습니다.' } }
        setRemoteUser(profile)
        setPage('dashboard')
        return { ok: true, message: '' }
      } catch (error) { return { ok: false, message: errorMessage(error, '로그인하지 못했습니다.') } }
    }
    const member = localMembers.find((item) => normalizeUsername(item.username) === normalizeUsername(username))
    if (!member || member.passwordHash !== await hashPassword(password)) return { ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' }
    if (member.approvalStatus === 'pending') return { ok: false, message: '가입 승인 대기 중입니다.' }
    if (member.approvalStatus === 'rejected') return { ok: false, message: '가입 신청이 반려된 계정입니다.' }
    if (!member.active || member.role === null) return { ok: false, message: '사용이 중지되었거나 회원 유형이 지정되지 않았습니다.' }
    setLocalSessionUserId(member.id)
    setPage('dashboard')
    return { ok: true, message: '' }
  }

  const register = async (draft: SignupDraft) => {
    const username = draft.username.normalize('NFKC').trim()
    const referral = draft.referralCode.normalize('NFKC').trim()
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.auth.signUp({
          email: await usernameToAuthEmail(username),
          password: await passwordToAuthSecret(draft.password),
          options: {
            data: {
              username,
              username_key: normalizeUsername(username),
              phone_number: normalizePhoneNumber(draft.phoneNumber),
              referral_code: referral,
            },
          },
        })
        if (error) throw error
        await supabase.auth.signOut()
        return { ok: true, message: '가입 신청이 완료되었습니다. 승인 후 로그인할 수 있습니다.' }
      } catch (error) { return { ok: false, message: errorMessage(error, '가입 신청을 처리하지 못했습니다.') } }
    }
    if (localMembers.some((member) => normalizeUsername(member.username) === normalizeUsername(username))) return { ok: false, message: '이미 사용 중이거나 가입 신청된 아이디입니다.' }
    const referralOwner = referral ? localMembers.find((member) => member.active && member.approvalStatus === 'approved' && member.role !== 'admin' && [normalizeUsername(member.username), normalizeUsername(member.referralCode)].includes(normalizeUsername(referral))) : null
    if (referral && !referralOwner) return { ok: false, message: '유효한 추천 또는 관리 코드를 찾을 수 없습니다.' }
    const manager = referralOwner?.isOperationsManager ? referralOwner : null
    const sponsor = referralOwner && !referralOwner.isOperationsManager ? referralOwner : null
    const nowIso = new Date().toISOString()
    const id = crypto.randomUUID()
    const member: User = {
      id,
      username,
      phoneNumber: normalizePhoneNumber(draft.phoneNumber),
      passwordHash: await hashPassword(draft.password),
      role: referralOwner ? 'agency' : null,
      approvalStatus: 'pending',
      pricePerShot: 0,
      sparkPricePerShot: 0,
      sparkPlusPricePerShot: 0,
      sparkSPricePerShot: 0,
      active: false,
      requestedAt: nowIso,
      approvedAt: null,
      updatedAt: nowIso,
      sponsorId: sponsor?.id ?? null,
      sponsorUsername: sponsor?.username ?? null,
      isOperationsManager: false,
      managerId: manager?.id ?? null,
      managerUsername: manager?.username ?? null,
      referralCode: makeReferralCode(id),
      groupName: referralOwner?.groupName ?? '',
      hierarchyDepth: sponsor ? sponsor.hierarchyDepth + 1 : 0,
      bank: '',
      accountNumber: '',
      accountHolder: '',
    }
    setLocalMembers((current) => [member, ...current])
    const admin = localMembers.find((item) => item.role === 'admin')
    setLocalNotifications((current) => [
      ...(referralOwner ? [{ id: crypto.randomUUID(), createdAt: nowIso, userId: referralOwner.id, role: referralOwner.role ?? 'agency', title: manager ? '관리 대행사 승인 요청' : '하위 대행사 승인 요청', message: `${username} 회원의 가입 승인이 필요합니다.`, read: false } as NotificationItem] : []),
      ...(admin ? [{ id: crypto.randomUUID(), createdAt: nowIso, userId: admin.id, role: 'admin', title: manager ? '중간관리자 배정 가입' : '회원가입 신청', message: manager ? `${username} 회원이 ${manager.username} 중간관리자 코드로 가입했습니다.` : sponsor ? `${username} 회원이 ${sponsor.username} 추천으로 가입했습니다.` : `${username} 회원의 가입 승인이 필요합니다.`, read: false } as NotificationItem] : []),
      ...current,
    ])
    return { ok: true, message: '가입 신청이 완료되었습니다. 승인 후 로그인할 수 있습니다.' }
  }

  const handleCreateOrder = async (draft: OrderDraft): Promise<Order> => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (user.isOperationsManager) throw new Error('중간관리자 계정은 작업을 접수할 수 없습니다.')
    if (isSupabaseConfigured) {
      const order = await createRemoteOrder({ programType: draft.programType, placeUrl: draft.placeUrl.trim(), mid: extractMid(draft.placeUrl), storeName: draft.storeName.trim(), keyword: draft.keyword.trim(), dailyShots: Number(draft.dailyShots), operationDays: Number(draft.operationDays), startDate: draft.startDate, memo: draft.memo.trim() })
      setRemoteOrders((current) => [...current.filter((item) => item.dbId !== order.dbId), order])
      void refreshRemote()
      return order
    }
    const order = createOrder(user, draft, localSettings, localOrders, new Date())
    setLocalOrders((current) => [...current, order])
    setLocalPaymentSteps((current) => [...current, ...buildLocalPaymentSteps(order, localMembers)])
    const admin = localMembers.find((member) => member.role === 'admin')
    setLocalNotifications((current) => [
      { id: crypto.randomUUID(), createdAt: new Date().toISOString(), userId: user.id, role: 'all', title: '작업 접수 완료', message: `${order.storeName} 작업이 입금대기 상태로 접수되었습니다.`, read: false, orderId: order.id },
      ...(admin ? [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), userId: admin.id, role: 'admin', title: '새 작업 접수', message: `${user.username} 회원이 ${order.storeName} 작업을 접수했습니다.`, read: false, orderId: order.id } as NotificationItem] : []),
      ...current,
    ])
    return order
  }

  const handleCreateOrdersBulk = async (drafts: OrderDraft[]): Promise<Order[]> => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (user.isOperationsManager) throw new Error('중간관리자 계정은 작업을 접수할 수 없습니다.')
    if (isSupabaseConfigured) {
      const created = await createRemoteOrdersBulk(drafts)
      setRemoteOrders((current) => {
        const dedup = new Map(current.map((order) => [order.dbId ?? order.id, order]))
        created.forEach((order) => dedup.set(order.dbId ?? order.id, order))
        return Array.from(dedup.values())
      })
      void refreshRemote()
      return created
    }
    const existing = [...localOrders]
    const created: Order[] = []
    for (const draft of drafts) {
      const order = createOrder(user, draft, localSettings, existing, new Date())
      existing.push(order)
      created.push(order)
    }
    setLocalOrders(existing)
    setLocalPaymentSteps((current) => [...current, ...created.flatMap((order) => buildLocalPaymentSteps(order, localMembers))])
    const admin = localMembers.find((member) => member.role === 'admin')
    if (admin) setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), userId: admin.id, role: 'admin', title: '대량 작업 접수', message: `${user.username} 회원이 ${created.length}건의 작업을 접수했습니다.`, read: false }, ...current])
    return created
  }

  const handleOrderStatusChange = async (order: Order, status: OrderStatus, reason: string) => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 상태를 변경할 수 있습니다.')
    if (isSupabaseConfigured) {
      const updated = await setRemoteOrderStatus(order, status, reason)
      setRemoteOrders((current) => current.map((item) => item.dbId === updated.dbId ? updated : item))
      return
    }
    const updated = transitionOrder(order, status)
    setLocalOrders((current) => current.map((item) => item.id === order.id ? updated : item))
    setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), userId: order.createdBy, role: 'all', title: status === '입금완료' ? '입금 확인 완료' : '작업 상태 변경', message: status === '입금완료' ? `관리자가 ${order.storeName} 작업 입금을 확인했습니다.` : `${order.storeName} 작업 상태가 ${status}(으)로 변경되었습니다.`, read: false, orderId: order.id }, ...current])
  }

  const handleProgramTransferPreview = useCallback(async (order: Order, targetProgram: ProgramType): Promise<ProgramTransferPreview> => {
    if (isSupabaseConfigured) return previewRemoteOrderProgramTransfer(order, targetProgram)
    return localProgramTransferPreview(order, targetProgram, localMembers, localPaymentSteps)
  }, [localMembers, localPaymentSteps])

  const handleProgramTransfer = async (order: Order, targetProgram: ProgramType, reason: string) => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 작업 프로그램을 변경할 수 있습니다.')
    if (isSupabaseConfigured) {
      const result = await transferRemoteOrderProgram(order, targetProgram, reason)
      setRemoteOrders((current) => current.map((item) => (item.dbId ?? item.id) === (result.order.dbId ?? result.order.id) ? result.order : item))
      await refreshRemote()
      return
    }

    const preview = localProgramTransferPreview(order, targetProgram, localMembers, localPaymentSteps)
    if (!preview.canTransfer) throw new Error(preview.blockedReason)
    if (order.lockVersion !== preview.expectedVersion) throw new Error('다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.')

    const orderKey = order.dbId ?? order.id
    const confirmed = localPaymentSteps.filter((step) => step.orderDbId === orderKey && step.confirmedAt)
    const baseOrder: Order = {
      ...order,
      programType: targetProgram,
      pricePerShot: preview.afterUnitPrice,
      supplyAmount: preview.afterSupplyAmount,
      vatAmount: preview.afterVatAmount,
      totalAmount: preview.afterTotalAmount,
      status: preview.afterStatus,
      paymentNotifiedAt: order.status === '입금완료' && preview.afterStatus === '입금대기' ? null : order.paymentNotifiedAt,
      lastProgramTransferAt: new Date().toISOString(),
      lockVersion: order.lockVersion + 1,
      updatedAt: new Date().toISOString(),
    }
    const targetSteps = buildLocalPaymentSteps(baseOrder, localMembers)
    let nextOrder = Math.max(0, ...confirmed.map((step) => step.stepOrder))
    const rebuilt = confirmed.length === 0
      ? targetSteps
      : targetSteps.flatMap((targetStep) => {
        const paid = confirmed.filter((step) => step.payerId === targetStep.payerId && step.payeeId === targetStep.payeeId)
        const supplyAmount = targetStep.supplyAmount - paid.reduce((sum, step) => sum + step.supplyAmount, 0)
        const vatAmount = targetStep.vatAmount - paid.reduce((sum, step) => sum + step.vatAmount, 0)
        if (supplyAmount === 0 && vatAmount === 0) return []
        nextOrder += 1
        return [{ ...targetStep, id: crypto.randomUUID(), stepOrder: nextOrder, supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount, canConfirm: nextOrder === Math.max(0, ...confirmed.map((step) => step.stepOrder)) + 1, previousPendingCount: nextOrder - Math.max(0, ...confirmed.map((step) => step.stepOrder)) - 1 }]
      })
    const hasPendingTransfer = rebuilt.length > 0
    const updatedOrder = {
      ...baseOrder,
      programTransferState: hasPendingTransfer ? 'payment_pending' as const : 'none' as const,
      programTransferDifference: hasPendingTransfer ? preview.difference : 0,
    }

    setLocalOrders((current) => current.map((item) => item.id === order.id ? updatedOrder : item))
    setLocalPaymentSteps((current) => [
      ...current.filter((step) => step.orderDbId !== orderKey),
      ...confirmed,
      ...rebuilt,
    ])
    setLocalNotifications((current) => [{
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      userId: order.createdBy,
      role: 'all',
      title: '작업 프로그램 변경',
      message: `${order.storeName} 작업이 ${targetProgram === 'spark' ? '스파크' : targetProgram === 'spark_plus' ? '스파크 +' : '스파크S'}(으)로 변경되었습니다.`,
      read: false,
      orderId: order.id,
    }, ...current])
  }

  const handleArchiveOrder = async (order: Order, reason: string) => {
    if (!user) throw new Error('로그인이 필요합니다.')
    const canArchive = user.role === 'admin' || (order.createdBy === user.id && ['입금대기', '정지', '만료'].includes(order.status))
    if (!canArchive) throw new Error('보관 권한이 없습니다.')
    if (isSupabaseConfigured) {
      const updated = await archiveRemoteOrder(order, reason)
      const orderKey = updated.dbId ?? updated.id
      setRemoteOrders((current) => current.map((item) => (item.dbId ?? item.id) === orderKey ? updated : item))
      setRemotePaymentSteps((current) => current.filter((step) => step.orderDbId !== orderKey))
      void refreshRemote()
      return
    }
    const nowIso = new Date().toISOString()
    setLocalOrders((current) => current.map((item) => item.id === order.id ? { ...item, archivedAt: nowIso, archivedBy: user.id, archiveReason: reason, lockVersion: item.lockVersion + 1, updatedAt: nowIso } : item))
  }

  const handleRestoreOrder = async (order: Order, reason: string) => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 작업을 복원할 수 있습니다.')
    if (isSupabaseConfigured) {
      const updated = await restoreRemoteOrder(order, reason)
      setRemoteOrders((current) => current.map((item) => (item.dbId ?? item.id) === (updated.dbId ?? updated.id) ? updated : item))
      await refreshRemote()
      return
    }
    const nowIso = new Date().toISOString()
    setLocalOrders((current) => current.map((item) => item.id === order.id ? { ...item, archivedAt: null, archivedBy: null, archiveReason: '', lockVersion: item.lockVersion + 1, updatedAt: nowIso } : item))
  }

  const handleMemberDeletionCheck = async (member: User): Promise<MemberDeletionCheck> => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 계정을 삭제할 수 있습니다.')
    if (member.role === 'admin') throw new Error('관리자 계정은 삭제할 수 없습니다.')
    if (member.id === user.id) throw new Error('현재 로그인한 관리자 계정은 삭제할 수 없습니다.')
    if (isSupabaseConfigured) return checkRemoteMemberDeletion(member.id)

    const orderCount = localOrders.filter((order) => order.createdBy === member.id).length
    const sponsoredOrderCount = localOrders.filter((order) => order.sponsorId === member.id).length
    const paymentStepCount = localPaymentSteps.filter((step) => step.payerId === member.id || step.payeeId === member.id).length
    const childCount = localMembers.filter((candidate) => candidate.sponsorId === member.id || candidate.managerId === member.id).length
    const noticeCount = localNotices.filter((notice) => (notice as Notice & { createdBy?: string }).createdBy === member.id).length
    const reasons: string[] = []
    if (orderCount > 0) reasons.push(`직접 접수한 작업 ${orderCount}건`)
    if (sponsoredOrderCount > 0) reasons.push(`추천 관계로 연결된 작업 ${sponsoredOrderCount}건`)
    if (paymentStepCount > 0) reasons.push(`정산 참여 이력 ${paymentStepCount}건`)
    if (childCount > 0) reasons.push(`연결된 하위 회원 ${childCount}명`)
    if (noticeCount > 0) reasons.push(`작성한 공지 ${noticeCount}건`)
    return {
      memberId: member.id,
      username: member.username,
      canDelete: reasons.length === 0,
      isAdminAccount: false,
      isCurrentUser: false,
      orderCount,
      sponsoredOrderCount,
      paymentStepCount,
      childCount,
      noticeCount,
      settlementQuoteCount: 0,
      settlementBatchCount: 0,
      reasons,
    }
  }

  const handleMemberDelete = async (member: User): Promise<void> => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 계정을 삭제할 수 있습니다.')
    if (isSupabaseConfigured) {
      await deleteRemoteMemberAccount(member.id)
      setRemoteMembers((current) => current.filter((candidate) => candidate.id !== member.id))
      setRemoteNotifications((current) => current.filter((item) => item.userId !== member.id))
      await refreshRemote()
      return
    }
    const check = await handleMemberDeletionCheck(member)
    if (!check.canDelete) throw new Error(check.reasons.join(' · ') || '운영 이력이 있어 삭제할 수 없습니다.')
    setLocalMembers((current) => current.filter((candidate) => candidate.id !== member.id))
    setLocalNotifications((current) => current.filter((item) => item.userId !== member.id))
  }

  const handleMemberPasswordReset = async (member: User, newPassword: string): Promise<void> => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 회원 비밀번호를 재설정할 수 있습니다.')
    if (member.role === 'admin') throw new Error('관리자 계정은 내 정보에서 현재 비밀번호를 확인한 뒤 변경해 주세요.')
    const validation = validatePassword(newPassword)
    if (validation) throw new Error(validation)
    if (isSupabaseConfigured) {
      await resetRemoteMemberPassword(member.id, newPassword)
      return
    }
    const passwordHash = await hashPassword(newPassword)
    setLocalMembers((current) => current.map((candidate) => candidate.id === member.id
      ? { ...candidate, passwordHash, updatedAt: new Date().toISOString() }
      : candidate))
  }

  const handleMemberReview = async (params: MemberReviewInput) => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (isSupabaseConfigured) {
      const updated = await reviewRemoteMember({ memberId: params.member.id, role: params.role, prices: params.prices, approvalStatus: params.approvalStatus, groupName: params.groupName, memberUpdatedAt: params.member.updatedAt })
      setRemoteMembers((current) => current.map((member) => member.id === updated.id ? updated : member))
      return
    }
    const target = params.member
    const actorIsAdmin = user.role === 'admin'
    const actorIsManager = user.isOperationsManager
    if (!actorIsAdmin) {
      const allowed = actorIsManager ? target.managerId === user.id : target.sponsorId === user.id
      if (!allowed) throw new Error(actorIsManager ? '내 관리 코드로 가입한 대행사만 관리할 수 있습니다.' : '직접 추천한 회원만 관리할 수 있습니다.')
    }
    if (!actorIsAdmin && !actorIsManager && params.approvalStatus === 'approved') {
      const myPrices = getProgramPriceMap(user)
      if (params.prices.spark <= myPrices.spark || params.prices.spark_plus <= myPrices.spark_plus || params.prices.spark_s <= myPrices.spark_s) throw new Error('하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.')
    }
    const makeManager = actorIsAdmin && !target.sponsorId && !target.managerId && params.role === 'manager'
    const nowIso = new Date().toISOString()
    const nextPrices = makeManager ? { spark: 1, spark_plus: 1, spark_s: 1 } : params.approvalStatus === 'approved' ? params.prices : getProgramPriceMap(target)
    const updated: User = applyProgramPrices({
      ...target,
      role: target.sponsorId || target.managerId ? 'agency' : makeManager ? 'agency' : params.role === 'manager' ? 'agency' : params.role,
      isOperationsManager: makeManager,
      groupName: target.sponsorId ? (localMembers.find((member) => member.id === target.sponsorId)?.groupName ?? target.groupName) : actorIsManager ? target.groupName : params.groupName,
      approvalStatus: params.approvalStatus,
      active: params.approvalStatus === 'approved',
      approvedAt: params.approvalStatus === 'approved' ? target.approvedAt ?? nowIso : target.approvedAt,
      updatedAt: nowIso,
    }, nextPrices)
    setLocalMembers((current) => current.map((member) => member.id === target.id ? updated : member))
    setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: nowIso, userId: target.id, role: 'all', title: params.approvalStatus === 'approved' ? '회원가입 승인 완료' : '회원가입 반려', message: params.approvalStatus !== 'approved' ? '회원가입 신청이 반려되었습니다.' : makeManager ? '중간관리자 계정으로 승인되었습니다. 관리 코드로 가입한 대행사를 승인하고 단가를 지정할 수 있습니다.' : `승인되었습니다. 스파크 ${params.prices.spark}원 / 스파크+ ${params.prices.spark_plus}원 / 스파크S ${params.prices.spark_s}원입니다.`, read: false }, ...current])
  }

  const handleAccountChange = async (account: AccountDraft) => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (user.isOperationsManager) throw new Error('중간관리자 계정은 별도 정산 계좌를 사용하지 않습니다.')
    if (isSupabaseConfigured) {
      const updated = await saveRemoteAccount(account)
      setRemoteUser(updated)
      setRemoteMembers((current) => current.map((member) => member.id === updated.id ? updated : member))
      return
    }
    setLocalMembers((current) => current.map((member) => member.id === user.id ? { ...member, ...account, updatedAt: new Date().toISOString() } : member))
  }

  const handleConfirmPayment = async (step: PaymentStep) => {
    if (!user || step.payeeId !== user.id) throw new Error('입금 확인 권한이 없습니다.')
    if (isSupabaseConfigured) {
      const updated = await confirmRemotePaymentStep(step.id)
      setRemotePaymentSteps((current) => current.map((item) => item.id === updated.id ? { ...item, confirmedAt: updated.confirmedAt, canConfirm: false } : item))
      void refreshRemote()
      return
    }
    const confirmedAt = new Date().toISOString()
    const confirmedSteps = localPaymentSteps.map((item) => item.id === step.id ? { ...item, confirmedAt, canConfirm: false } : item)
    const updatedSteps = confirmedSteps.map((item) => {
      const previousPendingCount = confirmedSteps.filter((candidate) => candidate.orderDbId === item.orderDbId && candidate.stepOrder < item.stepOrder && !candidate.confirmedAt).length
      return { ...item, previousPendingCount, canConfirm: !item.confirmedAt && previousPendingCount === 0 }
    })
    setLocalPaymentSteps(updatedSteps)
    const orderSteps = updatedSteps.filter((item) => item.orderDbId === step.orderDbId)
    if (orderSteps.length > 0 && orderSteps.every((item) => item.confirmedAt)) {
      setLocalOrders((current) => current.map((order) => {
        if ((order.dbId ?? order.id) !== step.orderDbId) return order
        const settled = order.status === '입금대기' ? transitionOrder(order, '입금완료') : order
        return { ...settled, programTransferState: 'none', programTransferDifference: 0 }
      }))
      const target = localOrders.find((order) => (order.dbId ?? order.id) === step.orderDbId)
      if (target) setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: confirmedAt, userId: target.createdBy, role: 'all', title: '전체 입금 확인 완료', message: `${target.storeName} 작업의 입금 확인이 완료되었습니다.`, read: false, orderId: target.id }, ...current])
    }
  }

  const handleConfirmSettlementQuote = async (quoteId: string, confirmations: SettlementConfirmationInput[], memo: string): Promise<SettlementBatchResult> => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (!isSupabaseConfigured) throw new Error('로컬 모드에서는 정산 묶음 서버 기록을 사용할 수 없습니다.')
    const result = await confirmSettlementQuoteV92(quoteId, confirmations, memo)
    await refreshRemote()
    return result
  }

  const handleSettingsChange = async (next: AppSettings) => { if (isSupabaseConfigured) setRemoteSettings(await saveRemoteSettings(next)); else setLocalSettings(next) }
  const handleNotificationRead = async (id: string) => { if (isSupabaseConfigured) await markRemoteNotificationRead(id); (isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications)((current) => current.map((item) => item.id === id ? { ...item, read: true } : item)) }
  const handleNotificationsReadAll = async (ids: string[]) => { if (isSupabaseConfigured) await markAllRemoteNotificationsRead(ids); const set = new Set(ids); (isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications)((current) => current.map((item) => set.has(item.id) ? { ...item, read: true } : item)) }
  const handleNotificationDelete = async (id: string) => { if (isSupabaseConfigured) await deleteRemoteNotification(id); (isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications)((current) => current.filter((item) => item.id !== id)) }
  const handleNotificationsDeleteAll = async (ids: string[]) => { if (isSupabaseConfigured) await deleteAllRemoteNotifications(ids); const set = new Set(ids); (isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications)((current) => current.filter((item) => !set.has(item.id))) }
  const handleNoticeCreate = async (input: Pick<Notice, 'title' | 'content' | 'pinned'>) => {
    if (isSupabaseConfigured) {
      const notice = await createRemoteNotice(input)
      setRemoteNotices((current) => [notice, ...current])
    } else {
      setLocalNotices((current) => [{ id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() }, ...current])
    }
  }
  const handleNoticeDelete = async (id: string) => { if (isSupabaseConfigured) await deleteRemoteNotice(id); (isSupabaseConfigured ? setRemoteNotices : setLocalNotices)((current) => current.filter((item) => item.id !== id)) }
  const handlePasswordChange = async (currentPassword: string, nextPassword: string) => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.updateUser({ password: await passwordToAuthSecret(nextPassword), current_password: await passwordToAuthSecret(currentPassword) })
      if (error) throw error
      return
    }
    if (await hashPassword(currentPassword) !== user.passwordHash) throw new Error('현재 비밀번호가 올바르지 않습니다.')
    const nextHash = await hashPassword(nextPassword)
    setLocalMembers((current) => current.map((member) => member.id === user.id ? { ...member, passwordHash: nextHash, updatedAt: new Date().toISOString() } : member))
  }

  if (!authReady) return <main className="auth-page"><section className="auth-card auth-loading"><strong>서버 연결 확인 중</strong><p>로그인 세션과 회원 정보를 불러오고 있습니다.</p></section></main>
  if (!user) return <AuthPage onLogin={login} onRegister={register} serverMode={isSupabaseConfigured} />

  const visibleNotifications = notifications.filter((item) => (item.role === 'all' || item.role === user.role) && (item.userId === null || item.userId === user.id))
  const unreadCount = visibleNotifications.filter((item) => !item.read).length
  const activeProgram = PROGRAM_PAGE_MAP[page]

  return <AppShell user={user} page={page} unreadCount={unreadCount} serverMode={isSupabaseConfigured} onNavigate={setPage} onLogout={() => { setPage('dashboard'); if (isSupabaseConfigured && supabase) void supabase.auth.signOut(); else setLocalSessionUserId(null) }}>
    {remoteError && <div className="server-error-banner">{remoteError}<button onClick={() => void refreshRemote()}>다시 불러오기</button></div>}
    {page === 'dashboard' && <DashboardPage user={user} members={members} orders={orders} paymentSteps={paymentSteps} notices={notices} now={now} onNavigate={setPage} />}
    {page === 'notifications' && <NotificationsPage user={user} notifications={notifications} onRead={handleNotificationRead} onReadAll={handleNotificationsReadAll} onDelete={handleNotificationDelete} onDeleteAll={handleNotificationsDeleteAll} />}
    {activeProgram && !user.isOperationsManager && <OrdersPage user={user} orders={orders} settings={settings} now={now} programType={activeProgram} onCreateOrder={handleCreateOrder} onCreateOrdersBulk={handleCreateOrdersBulk} onStatusChange={handleOrderStatusChange} onProgramTransferPreview={handleProgramTransferPreview} onProgramTransfer={handleProgramTransfer} onArchiveOrder={handleArchiveOrder} onRestoreOrder={handleRestoreOrder} />}
    {page === 'settlement' && !user.isOperationsManager && <SettlementPage user={user} members={members} orders={orders} paymentSteps={paymentSteps} paymentAccount={paymentAccount} settings={settings} onSettingsChange={handleSettingsChange} onConfirmPayment={handleConfirmPayment} onConfirmSettlementQuote={handleConfirmSettlementQuote} />}
    {page === 'members' && <MembersPage user={user} members={members} onReview={handleMemberReview} onCheckDeletion={handleMemberDeletionCheck} onDeleteMember={handleMemberDelete} onResetPassword={handleMemberPasswordReset} />}
    {page === 'operations' && user.role === 'admin' && <OperationsPage user={user} />}
    {page === 'myinfo' && <MyInfoPage user={user} onPasswordChange={handlePasswordChange} onAccountChange={handleAccountChange} />}
    {page === 'notices' && <NoticesPage user={user} notices={notices} onCreate={handleNoticeCreate} onDelete={handleNoticeDelete} />}
  </AppShell>
}
