import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from './components/AppShell'
import { DEFAULT_SETTINGS, DEMO_NOTICES, DEMO_NOTIFICATIONS, DEMO_USERS, makeDemoOrders, makeDemoPaymentSteps } from './data/demo'
import type { AccountDraft, AppSettings, MemberReviewInput, Notice, NotificationItem, Order, OrderDraft, OrderStatus, Page, PaymentAccount, PaymentStep, SignupDraft, User } from './domain/types'
import { AuthPage } from './features/AuthPage'
import { DashboardPage } from './features/DashboardPage'
import { MembersPage } from './features/MembersPage'
import { MyInfoPage } from './features/MyInfoPage'
import { NoticesPage } from './features/NoticesPage'
import { NotificationsPage } from './features/NotificationsPage'
import { OrdersPage } from './features/OrdersPage'
import { SettlementPage } from './features/SettlementPage'
import { useLocalStorage } from './hooks/useLocalStorage'
import {
  confirmRemotePaymentStep,
  createRemoteNotice,
  createRemoteOrder,
  createRemoteOrdersBulk,
  deleteAllRemoteNotifications,
  deleteRemoteNotice,
  deleteRemoteNotification,
  deleteRemoteOrder,
  fetchProfile,
  fetchRemoteSnapshot,
  markAllRemoteNotificationsRead,
  markRemoteNotificationRead,
  reviewRemoteMember,
  saveRemoteAccount,
  saveRemoteSettings,
  setRemoteOrderStatus,
} from './lib/backend'
import { hashPassword, normalizeUsername, passwordToAuthSecret, usernameToAuthEmail } from './lib/auth'
import { calculateAmount } from './lib/money'
import { applyScheduledTransitions, createOrder, extractMid, transitionOrder } from './lib/order'
import { applyProgramPrices, getProgramPriceMap, getUserProgramPrice, PROGRAM_PAGE_MAP } from './lib/program'
import { isSupabaseConfigured, supabase } from './lib/supabase'

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const message = error.message
    if (/invalid login credentials/i.test(message)) return '아이디 또는 비밀번호가 올바르지 않습니다.'
    if (/user already registered|duplicate key|profiles_username_key_key/i.test(message)) return '이미 사용 중이거나 가입 신청된 아이디입니다.'
    if (/password/i.test(message) && /short|weak|length/i.test(message)) return '서버 비밀번호 정책에 맞지 않습니다. Supabase 비밀번호 최소 길이 설정을 확인해 주세요.'
    return message
  }
  return fallback
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
    steps.push({ id: crypto.randomUUID(), orderDbId: order.dbId ?? order.id, orderNumber: order.id, storeName: order.storeName, stepOrder, payerId: payer.id, payerUsername: payer.username, payeeId: payee.id, payeeUsername: payee.username, unitPrice, ...amount, confirmedAt: null, createdAt: order.createdAt })
    if (payee.role === 'admin') break
    payer = payee
    stepOrder += 1
  }
  return steps
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
      const snapshot = await fetchRemoteSnapshot()
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
      setRemoteError(errorMessage(error, '서버 데이터를 불러오지 못했습니다. update_v8.sql 적용 여부를 확인해 주세요.'))
    }
  }, [remoteUser])

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 5_000); return () => window.clearInterval(timer) }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    let active = true
    const restoreSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        const authUserId = data.session?.user?.id
        if (!authUserId) { if (active) setRemoteUser(null); return }
        const profile = await fetchProfile(authUserId)
        if (!profile || profile.approvalStatus !== 'approved' || !profile.active || profile.role === null) { await supabase.auth.signOut(); if (active) setRemoteUser(null); return }
        if (active) setRemoteUser(profile)
      } catch (error) {
        if (active) setRemoteError(errorMessage(error, '로그인 세션을 확인하지 못했습니다.'))
      } finally {
        if (active) setAuthReady(true)
      }
    }
    void restoreSession()
    const { data } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id?: string } } | null) => {
      if (event === 'SIGNED_OUT' || !session?.user?.id) { setRemoteUser(null); setRemoteMembers([]); setRemoteOrders([]); setRemotePaymentSteps([]); setRemoteNotifications([]); setRemoteNotices([]); return }
      window.setTimeout(() => void fetchProfile(session.user?.id ?? '').then((profile) => { if (profile?.approvalStatus === 'approved' && profile.active && profile.role !== null) setRemoteUser(profile) }).catch(() => undefined), 0)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !remoteUser) return
    void refreshRemote()
    let refreshTimer: number | null = null
    const scheduleRefresh = () => { if (refreshTimer !== null) window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => void refreshRemote(), 180) }
    const channel = supabase.channel(`spark-dashboard-v8-${remoteUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_steps' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, scheduleRefresh)
      .subscribe()
    return () => { if (refreshTimer !== null) window.clearTimeout(refreshTimer); void supabase.removeChannel(channel) }
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
        const { error } = await supabase.auth.signUp({ email: await usernameToAuthEmail(username), password: await passwordToAuthSecret(draft.password), options: { data: { username, username_key: normalizeUsername(username), referral_code: referral } } })
        if (error) throw error
        await supabase.auth.signOut()
        return { ok: true, message: '가입 신청이 완료되었습니다. 승인 후 로그인할 수 있습니다.' }
      } catch (error) { return { ok: false, message: errorMessage(error, '가입 신청을 처리하지 못했습니다.') } }
    }
    if (localMembers.some((member) => normalizeUsername(member.username) === normalizeUsername(username))) return { ok: false, message: '이미 사용 중이거나 가입 신청된 아이디입니다.' }
    const sponsor = referral ? localMembers.find((member) => member.active && member.approvalStatus === 'approved' && member.role !== 'admin' && [normalizeUsername(member.username), normalizeUsername(member.referralCode)].includes(normalizeUsername(referral))) : null
    if (referral && !sponsor) return { ok: false, message: '유효한 추천인 아이디 또는 코드를 찾을 수 없습니다.' }
    const nowIso = new Date().toISOString()
    const id = crypto.randomUUID()
    const member: User = {
      id,
      username,
      passwordHash: await hashPassword(draft.password),
      role: sponsor ? 'agency' : null,
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
      referralCode: makeReferralCode(id),
      groupName: sponsor?.groupName ?? '',
      hierarchyDepth: sponsor ? sponsor.hierarchyDepth + 1 : 0,
      bank: '',
      accountNumber: '',
      accountHolder: '',
    }
    setLocalMembers((current) => [member, ...current])
    const admin = localMembers.find((item) => item.role === 'admin')
    setLocalNotifications((current) => [
      ...(sponsor ? [{ id: crypto.randomUUID(), createdAt: nowIso, userId: sponsor.id, role: sponsor.role ?? 'agency', title: '하위 대행사 승인 요청', message: `${username} 회원이 추천 코드를 사용해 가입했습니다.`, read: false } as NotificationItem] : []),
      ...(admin ? [{ id: crypto.randomUUID(), createdAt: nowIso, userId: admin.id, role: 'admin', title: '회원가입 신청', message: sponsor ? `${username} 회원이 ${sponsor.username} 추천으로 가입했습니다.` : `${username} 회원의 가입 승인이 필요합니다.`, read: false } as NotificationItem] : []),
      ...current,
    ])
    return { ok: true, message: '가입 신청이 완료되었습니다. 승인 후 로그인할 수 있습니다.' }
  }

  const handleCreateOrder = async (draft: OrderDraft): Promise<Order> => {
    if (!user) throw new Error('로그인이 필요합니다.')
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

  const handleOrderStatusChange = async (order: Order, status: OrderStatus) => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 상태를 변경할 수 있습니다.')
    if (isSupabaseConfigured) {
      const updated = await setRemoteOrderStatus(order, status)
      setRemoteOrders((current) => current.map((item) => item.dbId === updated.dbId ? updated : item))
      return
    }
    const updated = transitionOrder(order, status)
    setLocalOrders((current) => current.map((item) => item.id === order.id ? updated : item))
    setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), userId: order.createdBy, role: 'all', title: status === '입금완료' ? '입금 확인 완료' : '작업 상태 변경', message: status === '입금완료' ? `관리자가 ${order.storeName} 작업 입금을 확인했습니다.` : `${order.storeName} 작업 상태가 ${status}(으)로 변경되었습니다.`, read: false, orderId: order.id }, ...current])
  }

  const handleDeleteOrder = async (order: Order) => {
    if (!user) throw new Error('로그인이 필요합니다.')
    const canDelete = user.role === 'admin' || (order.createdBy === user.id && ['입금대기', '정지', '만료'].includes(order.status))
    if (!canDelete) throw new Error('삭제 권한이 없습니다.')
    if (isSupabaseConfigured) {
      await deleteRemoteOrder(order)
      setRemoteOrders((current) => current.filter((item) => (item.dbId ?? item.id) !== (order.dbId ?? order.id)))
      setRemotePaymentSteps((current) => current.filter((item) => item.orderDbId !== (order.dbId ?? order.id)))
      setRemoteNotifications((current) => current.filter((item) => item.orderId !== order.id))
      return
    }
    setLocalOrders((current) => current.filter((item) => item.id !== order.id))
    setLocalPaymentSteps((current) => current.filter((item) => item.orderDbId !== (order.dbId ?? order.id) && item.orderNumber !== order.id))
    setLocalNotifications((current) => current.filter((item) => item.orderId !== order.id))
  }

  const handleMemberReview = async (params: MemberReviewInput) => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (isSupabaseConfigured) {
      const updated = await reviewRemoteMember({ memberId: params.member.id, role: params.role, prices: params.prices, approvalStatus: params.approvalStatus, groupName: params.groupName })
      setRemoteMembers((current) => current.map((member) => member.id === updated.id ? updated : member))
      return
    }
    const target = params.member
    if (user.role !== 'admin' && target.sponsorId !== user.id) throw new Error('직접 추천한 회원만 관리할 수 있습니다.')
    if (user.role !== 'admin' && params.approvalStatus === 'approved') {
      const myPrices = getProgramPriceMap(user)
      if (params.prices.spark <= myPrices.spark || params.prices.spark_plus <= myPrices.spark_plus || params.prices.spark_s <= myPrices.spark_s) throw new Error('하위 회원의 각 프로그램 단가는 내 단가보다 높아야 합니다.')
    }
    const nowIso = new Date().toISOString()
    const updated: User = applyProgramPrices({
      ...target,
      role: target.sponsorId ? 'agency' : params.role,
      groupName: target.sponsorId ? (localMembers.find((member) => member.id === target.sponsorId)?.groupName ?? target.groupName) : params.groupName,
      approvalStatus: params.approvalStatus,
      active: params.approvalStatus === 'approved',
      approvedAt: params.approvalStatus === 'approved' ? target.approvedAt ?? nowIso : target.approvedAt,
      updatedAt: nowIso,
    }, params.approvalStatus === 'approved' ? params.prices : getProgramPriceMap(target))
    setLocalMembers((current) => current.map((member) => member.id === target.id ? updated : member))
    setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: nowIso, userId: target.id, role: 'all', title: params.approvalStatus === 'approved' ? '회원가입 승인 완료' : '회원가입 반려', message: params.approvalStatus === 'approved' ? `승인되었습니다. 스파크 ${params.prices.spark}원 / 스파크+ ${params.prices.spark_plus}원 / 스파크S ${params.prices.spark_s}원입니다.` : '회원가입 신청이 반려되었습니다.', read: false }, ...current])
  }

  const handleAccountChange = async (account: AccountDraft) => {
    if (!user) throw new Error('로그인이 필요합니다.')
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
      setRemotePaymentSteps((current) => current.map((item) => item.id === updated.id ? updated : item))
      void refreshRemote()
      return
    }
    const confirmedAt = new Date().toISOString()
    const updatedSteps = localPaymentSteps.map((item) => item.id === step.id ? { ...item, confirmedAt } : item)
    setLocalPaymentSteps(updatedSteps)
    const orderSteps = updatedSteps.filter((item) => item.orderDbId === step.orderDbId)
    if (orderSteps.length > 0 && orderSteps.every((item) => item.confirmedAt)) {
      setLocalOrders((current) => current.map((order) => (order.dbId ?? order.id) === step.orderDbId && order.status === '입금대기' ? transitionOrder(order, '입금완료') : order))
      const target = localOrders.find((order) => (order.dbId ?? order.id) === step.orderDbId)
      if (target) setLocalNotifications((current) => [{ id: crypto.randomUUID(), createdAt: confirmedAt, userId: target.createdBy, role: 'all', title: '전체 입금 확인 완료', message: `${target.storeName} 작업의 입금 확인이 완료되었습니다.`, read: false, orderId: target.id }, ...current])
    }
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
    {page === 'dashboard' && <DashboardPage user={user} orders={orders} paymentSteps={paymentSteps} notices={notices} now={now} onNavigate={setPage} />}
    {page === 'notifications' && <NotificationsPage user={user} notifications={notifications} onRead={handleNotificationRead} onReadAll={handleNotificationsReadAll} onDelete={handleNotificationDelete} onDeleteAll={handleNotificationsDeleteAll} />}
    {activeProgram && <OrdersPage user={user} orders={orders} settings={settings} now={now} programType={activeProgram} onCreateOrder={handleCreateOrder} onCreateOrdersBulk={handleCreateOrdersBulk} onStatusChange={handleOrderStatusChange} onDeleteOrder={handleDeleteOrder} />}
    {page === 'settlement' && <SettlementPage user={user} members={members} orders={orders} paymentSteps={paymentSteps} paymentAccount={paymentAccount} settings={settings} onSettingsChange={handleSettingsChange} onConfirmPayment={handleConfirmPayment} />}
    {page === 'members' && <MembersPage user={user} members={members} onReview={handleMemberReview} />}
    {page === 'myinfo' && <MyInfoPage user={user} onPasswordChange={handlePasswordChange} onAccountChange={handleAccountChange} />}
    {page === 'notices' && <NoticesPage user={user} notices={notices} onCreate={handleNoticeCreate} onDelete={handleNoticeDelete} />}
  </AppShell>
}
