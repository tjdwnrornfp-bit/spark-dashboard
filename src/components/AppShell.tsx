import { useState, type ReactNode } from 'react'
import type { Page, User } from '../domain/types'
import { Icon, type IconName } from './Icon'
import { Logo } from './Logo'

const NAV_ITEMS: Array<{ page: Page; label: string; icon: IconName }> = [
  { page: 'dashboard', label: '대시보드', icon: 'dashboard' },
  { page: 'notifications', label: '알림센터', icon: 'bell' },
  { page: 'orders', label: '작업접수', icon: 'orders' },
  { page: 'settlement', label: '정산', icon: 'wallet' },
  { page: 'members', label: '회원관리', icon: 'users' },
  { page: 'myinfo', label: '내 정보', icon: 'user' },
  { page: 'notices', label: '공지사항', icon: 'notice' },
]

export function AppShell({ user, page, unreadCount, serverMode, children, onNavigate, onLogout }: {
  user: User
  page: Page
  unreadCount: number
  serverMode: boolean
  children: ReactNode
  onNavigate: (page: Page) => void
  onLogout: () => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const roleLabel = user.role === 'admin' ? '관리자' : user.role === 'distributor' ? '총판' : '대행사'

  const navigate = (next: Page) => {
    onNavigate(next)
    setMobileOpen(false)
  }

  return (
    <div className="app-layout">
      <header className="mobile-header"><button className="icon-button" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><Logo /><span /></header>
      {mobileOpen && <button className="mobile-overlay" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo"><Logo /></div>
        <nav>
          {NAV_ITEMS.map((item) => {
            const badge = item.page === 'notifications' ? unreadCount : 0
            return (
              <button key={item.page} className={page === item.page ? 'nav-active' : ''} onClick={() => navigate(item.page)}>
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
                {badge > 0 && <b>{badge > 99 ? '99+' : badge}</b>}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-account">
          <div><strong>{user.username}</strong><span>{roleLabel}</span>{serverMode && <em>실시간</em>}</div>
          <button onClick={onLogout}><Icon name="logout" size={14} /> 로그아웃</button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  )
}
