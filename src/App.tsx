import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from './components/AppShell'
import { DEFAULT_SETTINGS, DEMO_NOTICES, DEMO_NOTIFICATIONS, DEMO_USERS, makeDemoOrders } from './data/demo'
import type { AppSettings, Notice, NotificationItem, Order, OrderDraft, OrderStatus, Page, SignupDraft, User } from './domain/types'
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
  createRemoteNotice,
  createRemoteOrder,
  deleteAllRemoteNotifications,
  deleteRemoteNotice,
  deleteRemoteNotification,
  fetchProfile,
  fetchRemoteSnapshot,
  markAllRemoteNotificationsRead,
  markRemoteNotificationRead,
  reviewRemoteMember,
  saveRemoteSettings,
  setRemoteOrderStatus,
} from './lib/backend'
import { hashPassword, normalizeUsername, passwordToAuthSecret, usernameToAuthEmail } from './lib/auth'
import { createOrder, extractMid, applyScheduledTransitions, transitionOrder } from './lib/order'
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

export default function App() {
  const [localSessionUserId, setLocalSessionUserId] = useLocalStorage<string | null>('spark-session-v5', null)
  const [localMembers, setLocalMembers] = useLocalStorage<User[]>('spark-members-v5', DEMO_USERS)
  const [localOrders, setLocalOrders] = useLocalStorage<Order[]>('spark-orders-v5', makeDemoOrders())
  const [localNotifications, setLocalNotifications] = useLocalStorage<NotificationItem[]>('spark-notifications-v5', DEMO_NOTIFICATIONS)
  const [localNotices, setLocalNotices] = useLocalStorage<Notice[]>('spark-notices-v5', DEMO_NOTICES)
  const [localSettings, setLocalSettings] = useLocalStorage<AppSettings>('spark-settings-v5', DEFAULT_SETTINGS)

  const [remoteUser, setRemoteUser] = useState<User | null>(null)
  const [remoteMembers, setRemoteMembers] = useState<User[]>([])
  const [remoteOrders, setRemoteOrders] = useState<Order[]>([])
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
  const notifications = isSupabaseConfigured ? remoteNotifications : localNotifications
  const notices = isSupabaseConfigured ? remoteNotices : localNotices
  const settings = isSupabaseConfigured ? remoteSettings : localSettings

  const refreshRemote = useCallback(async () => {
    if (!isSupabaseConfigured || !remoteUser) return
    try {
      const snapshot = await fetchRemoteSnapshot()
      setRemoteMembers(snapshot.members)
      setRemoteOrders(snapshot.orders)
      setRemoteNotifications(snapshot.notifications)
      setRemoteNotices(snapshot.notices)
      setRemoteSettings(snapshot.settings)
      setRemoteError('')
    } catch (error) {
      setRemoteError(errorMessage(error, '서버 데이터를 불러오지 못했습니다.'))
    }
  }, [remoteUser])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    let active = true

    const restoreSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        const authUserId = data.session?.user?.id
        if (!authUserId) {
          if (active) setRemoteUser(null)
          return
        }
        const profile = await fetchProfile(authUserId)
        if (!profile || profile.approvalStatus !== 'approved' || !profile.active || profile.role === null) {
          await supabase.auth.signOut()
          if (active) setRemoteUser(null)
          return
        }
        if (active) setRemoteUser(profile)
      } catch (error) {
        if (active) setRemoteError(errorMessage(error, '로그인 세션을 확인하지 못했습니다.'))
      } finally {
        if (active) setAuthReady(true)
      }
    }

    void restoreSession()
    const { data } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id?: string } } | null) => {
      if (event === 'SIGNED_OUT' || !session?.user?.id) {
        setRemoteUser(null)
        setRemoteMembers([])
        setRemoteOrders([])
        setRemoteNotifications([])
        setRemoteNotices([])
        return
      }
      window.setTimeout(() => {
        void fetchProfile(session.user?.id ?? '').then((profile) => {
          if (profile?.approvalStatus === 'approved' && profile.active && profile.role !== null) setRemoteUser(profile)
        }).catch(() => undefined)
      }, 0)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !remoteUser) return
    void refreshRemote()
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void refreshRemote(), 180)
    }
    const channel = supabase
      .channel(`spark-dashboard-${remoteUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [refreshRemote, remoteUser])

  useEffect(() => {
    if (isSupabaseConfigured) return
    const result = applyScheduledTransitions(localOrders, localMembers, localSettings, now)
    if (result.orders === localOrders) return
    setLocalOrders(result.orders)
    setLocalNotifications((current) => {
      const existingIds = new Set(current.map((item) => item.id))
      const generated: NotificationItem[] = result.transitions.map((transition) => ({
        id: `auto-${transition.orderId}-${transition.nextStatus}`,
        createdAt: now.toISOString(),
        userId: transition.userId,
        role: 'all' as const,
        title: transition.nextStatus === '구동중' ? '구동 자동 시작' : '작업 기간 만료',
        message: transition.nextStatus === '구동중'
          ? `${transition.orderId} 작업이 시작일 오전 ${localSettings.autoStartHour}시에 구동중으로 변경되었습니다.`
          : `${transition.orderId} 작업이 종료일 경과로 만료 처리되었습니다.`,
        read: false,
        orderId: transition.orderId,
      })).filter((item) => !existingIds.has(item.id))
      return generated.length > 0 ? [...generated, ...current] : current
    })
  }, [localMembers, localOrders, localSettings, now, setLocalNotifications, setLocalOrders])

  const login = async (username: string, password: string) => {
    if (isSupabaseConfigured && supabase) {
      try {
        const email = await usernameToAuthEmail(username)
        const authPassword = await passwordToAuthSecret(password)
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: authPassword })
        if (error) throw error
        const authUserId = data.user?.id
        if (!authUserId) throw new Error('로그인 사용자 정보를 확인하지 못했습니다.')
        const profile = await fetchProfile(authUserId)
        if (!profile) throw new Error('회원 정보를 찾을 수 없습니다.')
        if (profile.approvalStatus === 'pending') {
          await supabase.auth.signOut()
          return { ok: false, message: '관리자 승인 대기 중입니다.' }
        }
        if (profile.approvalStatus === 'rejected') {
          await supabase.auth.signOut()
          return { ok: false, message: '가입 신청이 반려된 계정입니다.' }
        }
        if (!profile.active || profile.role === null) {
          await supabase.auth.signOut()
          return { ok: false, message: '사용이 중지되었거나 회원 유형이 지정되지 않았습니다.' }
        }
        setRemoteUser(profile)
        setPage('dashboard')
        return { ok: true, message: '' }
      } catch (error) {
        return { ok: false, message: errorMessage(error, '로그인하지 못했습니다.') }
      }
    }

    const normalized = normalizeUsername(username)
    const member = localMembers.find((item) => normalizeUsername(item.username) === normalized)
    if (!member) return { ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' }
    const passwordHash = await hashPassword(password)
    if (member.passwordHash !== passwordHash) return { ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' }
    if (member.approvalStatus === 'pending') return { ok: false, message: '관리자 승인 대기 중입니다.' }
    if (member.approvalStatus === 'rejected') return { ok: false, message: '가입 신청이 반려된 계정입니다.' }
    if (!member.active || member.role === null) return { ok: false, message: '사용이 중지되었거나 회원 유형이 지정되지 않았습니다.' }
    setLocalSessionUserId(member.id)
    setPage('dashboard')
    return { ok: true, message: '' }
  }

  const register = async (draft: SignupDraft) => {
    const username = draft.username.normalize('NFKC').trim()
    if (isSupabaseConfigured && supabase) {
      try {
        const email = await usernameToAuthEmail(username)
        const { error } = await supabase.auth.signUp({
          email,
          password: await passwordToAuthSecret(draft.password),
          options: { data: { username, username_key: normalizeUsername(username) } },
        })
        if (error) throw error
        await supabase.auth.signOut()
        return { ok: true, message: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' }
      } catch (error) {
        return { ok: false, message: errorMessage(error, '가입 신청을 처리하지 못했습니다.') }
      }
    }

    if (localMembers.some((member) => normalizeUsername(member.username) === normalizeUsername(username))) {
      return { ok: false, message: '이미 사용 중이거나 가입 신청된 아이디입니다.' }
    }
    const nowIso = new Date().toISOString()
    const member: User = {
      id: crypto.randomUUID(),
      username,
      passwordHash: await hashPassword(draft.password),
      role: null,
      approvalStatus: 'pending',
      pricePerShot: 0,
      active: false,
      requestedAt: nowIso,
      approvedAt: null,
      updatedAt: nowIso,
    }
    setLocalMembers((current) => [member, ...current])
    return { ok: true, message: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' }
  }

  const handleCreateOrder = async (draft: OrderDraft): Promise<Order> => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (isSupabaseConfigured) {
      const order = await createRemoteOrder({
        placeUrl: draft.placeUrl.trim(),
        mid: extractMid(draft.placeUrl),
        storeName: draft.storeName.trim(),
        keyword: draft.keyword.trim(),
        dailyShots: Number(draft.dailyShots),
        operationDays: Number(draft.operationDays),
        memo: draft.memo.trim(),
      })
      setRemoteOrders((current) => [...current.filter((item) => item.dbId !== order.dbId), order])
      return order
    }
    const order = createOrder(user, draft, localSettings, localOrders, new Date())
    setLocalOrders((current) => [...current, order])
    setLocalNotifications((current) => [{
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      userId: user.id,
      role: 'all',
      title: '작업 접수 완료',
      message: `${order.storeName} 작업이 입금대기 상태로 접수되었습니다.`,
      read: false,
      orderId: order.id,
    }, ...current])
    return order
  }

  const handleOrderStatusChange = async (order: Order, status: OrderStatus): Promise<void> => {
    if (!user || user.role !== 'admin') throw new Error('관리자만 상태를 변경할 수 있습니다.')
    if (isSupabaseConfigured) {
      const updated = await setRemoteOrderStatus(order, status)
      setRemoteOrders((current) => current.map((item) => item.dbId === updated.dbId ? updated : item))
      return
    }
    const updated = transitionOrder(order, status)
    setLocalOrders((current) => current.map((item) => item.id === order.id ? updated : item))
    setLocalNotifications((current) => [{
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      userId: order.createdBy,
      role: 'all',
      title: status === '입금완료' ? '입금 확인 완료' : '작업 상태 변경',
      message: `${order.storeName} 작업 상태가 ${status}(으)로 변경되었습니다.`,
      read: false,
      orderId: order.id,
    }, ...current])
  }

  const handleMemberReview = async (params: { member: User; role: 'agency' | 'distributor'; pricePerShot: number; approvalStatus: 'approved' | 'rejected' }): Promise<void> => {
    if (isSupabaseConfigured) {
      const updated = await reviewRemoteMember({ memberId: params.member.id, role: params.role, pricePerShot: params.pricePerShot, approvalStatus: params.approvalStatus })
      setRemoteMembers((current) => current.map((member) => member.id === updated.id ? updated : member))
      return
    }
    const nowIso = new Date().toISOString()
    setLocalMembers((current) => current.map((member) => member.id === params.member.id ? {
      ...member,
      role: params.approvalStatus === 'approved' ? params.role : member.role,
      pricePerShot: params.approvalStatus === 'approved' ? params.pricePerShot : member.pricePerShot,
      approvalStatus: params.approvalStatus,
      active: params.approvalStatus === 'approved',
      approvedAt: params.approvalStatus === 'approved' ? (member.approvedAt ?? nowIso) : member.approvedAt,
      updatedAt: nowIso,
    } : member))
    setLocalNotifications((current) => [{
      id: crypto.randomUUID(),
      createdAt: nowIso,
      userId: params.member.id,
      role: 'all',
      title: params.approvalStatus === 'approved' ? '회원가입 승인 완료' : '회원가입 반려',
      message: params.approvalStatus === 'approved' ? '회원가입이 승인되었습니다.' : '회원가입 신청이 반려되었습니다.',
      read: false,
    }, ...current])
  }

  const handleSettingsChange = async (next: AppSettings): Promise<void> => {
    if (isSupabaseConfigured) {
      const saved = await saveRemoteSettings(next)
      setRemoteSettings(saved)
      return
    }
    setLocalSettings(next)
  }

  const handleNotificationRead = async (id: string): Promise<void> => {
    if (isSupabaseConfigured) await markRemoteNotificationRead(id)
    const setter = isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications
    setter((current) => current.map((item) => item.id === id ? { ...item, read: true } : item))
  }

  const handleNotificationsReadAll = async (ids: string[]): Promise<void> => {
    if (isSupabaseConfigured) await markAllRemoteNotificationsRead(ids)
    const idSet = new Set(ids)
    const setter = isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications
    setter((current) => current.map((item) => idSet.has(item.id) ? { ...item, read: true } : item))
  }

  const handleNotificationDelete = async (id: string): Promise<void> => {
    if (isSupabaseConfigured) await deleteRemoteNotification(id)
    const setter = isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications
    setter((current) => current.filter((item) => item.id !== id))
  }

  const handleNotificationsDeleteAll = async (ids: string[]): Promise<void> => {
    if (isSupabaseConfigured) await deleteAllRemoteNotifications(ids)
    const idSet = new Set(ids)
    const setter = isSupabaseConfigured ? setRemoteNotifications : setLocalNotifications
    setter((current) => current.filter((item) => !idSet.has(item.id)))
  }

  const handleNoticeCreate = async (input: Pick<Notice, 'title' | 'content' | 'pinned'>): Promise<void> => {
    if (isSupabaseConfigured) {
      const notice = await createRemoteNotice(input)
      setRemoteNotices((current) => [notice, ...current])
      return
    }
    setLocalNotices((current) => [{ id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() }, ...current])
  }

  const handleNoticeDelete = async (id: string): Promise<void> => {
    if (isSupabaseConfigured) await deleteRemoteNotice(id)
    const setter = isSupabaseConfigured ? setRemoteNotices : setLocalNotices
    setter((current) => current.filter((item) => item.id !== id))
  }

  const handlePasswordChange = async (currentPassword: string, nextPassword: string): Promise<void> => {
    if (!user) throw new Error('로그인이 필요합니다.')
    if (isSupabaseConfigured && supabase) {
      const [authCurrentPassword, authNextPassword] = await Promise.all([passwordToAuthSecret(currentPassword), passwordToAuthSecret(nextPassword)])
      const { error } = await supabase.auth.updateUser({ password: authNextPassword, current_password: authCurrentPassword })
      if (error) throw error
      return
    }
    const currentHash = await hashPassword(currentPassword)
    if (currentHash !== user.passwordHash) throw new Error('현재 비밀번호가 올바르지 않습니다.')
    const nextHash = await hashPassword(nextPassword)
    setLocalMembers((current) => current.map((member) => member.id === user.id ? { ...member, passwordHash: nextHash, updatedAt: new Date().toISOString() } : member))
  }

  if (!authReady) {
    return <main className="auth-page"><section className="auth-card auth-loading"><strong>서버 연결 확인 중</strong><p>로그인 세션과 회원 정보를 불러오고 있습니다.</p></section></main>
  }

  if (!user) {
    return <AuthPage onLogin={login} onRegister={register} serverMode={isSupabaseConfigured} />
  }

  const visibleNotifications = notifications.filter((item) => (item.role === 'all' || item.role === user.role) && (item.userId === null || item.userId === user.id))
  const unreadCount = visibleNotifications.filter((item) => !item.read).length

  return (
    <AppShell
      user={user}
      page={page}
      unreadCount={unreadCount}
      serverMode={isSupabaseConfigured}
      onNavigate={(next) => {
        if (next === 'members' && user.role !== 'admin') return
        setPage(next)
      }}
      onLogout={() => {
        setPage('dashboard')
        if (isSupabaseConfigured && supabase) void supabase.auth.signOut()
        else setLocalSessionUserId(null)
      }}
    >
      {remoteError && <div className="server-error-banner">{remoteError}<button onClick={() => void refreshRemote()}>다시 불러오기</button></div>}
      {page === 'dashboard' && <DashboardPage user={user} orders={orders} notices={notices} now={now} onNavigate={setPage} />}
      {page === 'notifications' && <NotificationsPage user={user} notifications={notifications} onRead={handleNotificationRead} onReadAll={handleNotificationsReadAll} onDelete={handleNotificationDelete} onDeleteAll={handleNotificationsDeleteAll} />}
      {page === 'orders' && <OrdersPage user={user} orders={orders} settings={settings} now={now} onCreateOrder={handleCreateOrder} onStatusChange={handleOrderStatusChange} />}
      {page === 'settlement' && <SettlementPage user={user} orders={orders} settings={settings} onSettingsChange={handleSettingsChange} onStatusChange={handleOrderStatusChange} />}
      {page === 'members' && user.role === 'admin' && <MembersPage members={members} onReview={handleMemberReview} />}
      {page === 'myinfo' && <MyInfoPage user={user} onPasswordChange={handlePasswordChange} />}
      {page === 'notices' && <NoticesPage user={user} notices={notices} onCreate={handleNoticeCreate} onDelete={handleNoticeDelete} />}
    </AppShell>
  )
}
