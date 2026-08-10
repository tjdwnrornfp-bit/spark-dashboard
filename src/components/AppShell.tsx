import { useState, type ReactNode } from 'react'
import type { Page, User } from '../domain/types'
import { Icon, type IconName } from './Icon'
import { Logo } from './Logo'
import { ProgramIcon } from './ProgramIcon'

const NAV_ITEMS: Array<{ page: Page; label: string; icon?: IconName; programType?: 'spark' | 'spark_plus' | 'spark_s' }> = [
  { page: 'dashboard', label: '대시보드', icon: 'dashboard' },
  { page: 'notifications', label: '알림센터', icon: 'bell' },
  { page: 'sparkOrders', label: '스파크 접수', programType: 'spark' },
  { page: 'sparkPlusOrders', label: '스파크 + 접수', programType: 'spark_plus' },
  { page: 'sparkSOrders', label: '스파크S 접수', programType: 'spark_s' },
  { page: 'settlement', label: '정산', icon: 'wallet' },
  { page: 'members', label: '회원관리', icon: 'users' },
  { page: 'operations', label: '운영기록', icon: 'shield' },
  { page: 'myinfo', label: '내 정보', icon: 'user' },
  { page: 'notices', label: '공지사항', icon: 'notice' },
]

const MANAGER_PAGES = new Set<Page>(['dashboard', 'notifications', 'members', 'myinfo', 'notices'])

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
  const roleLabel = user.isOperationsManager ? '중간관리자' : user.role === 'admin' ? '관리자' : user.role === 'distributor' ? '총판' : '대행사'

  const navigate = (next: Page) => {
    onNavigate(next)
    setMobileOpen(false)
  }

  const navItems = NAV_ITEMS.filter((item) => {
    if (user.isOperationsManager) return MANAGER_PAGES.has(item.page)
    if (item.page === 'operations') return user.role === 'admin'
    return true
  })

  return (
    <div className="app-layout">
      <header className="mobile-header"><button className="icon-button" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><Logo /><span /></header>
      {mobileOpen && <button className="mobile-overlay" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo"><Logo /></div>
        <nav>
          {navItems.map((item) => {
            const badge = item.page === 'notifications' ? unreadCount : 0
            return (
              <button key={item.page} className={page === item.page ? 'nav-active' : ''} onClick={() => navigate(item.page)}>
                {item.programType ? <ProgramIcon programType={item.programType} size={34} className="nav-program-icon" /> : <Icon name={item.icon!} size={15} />}
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
