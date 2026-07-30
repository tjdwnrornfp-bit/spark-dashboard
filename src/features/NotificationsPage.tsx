import { useState } from 'react'
import { Icon } from '../components/Icon'
import type { NotificationItem, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '알림을 처리하지 못했습니다.'
}

export function NotificationsPage({ user, notifications, onRead, onReadAll, onDelete, onDeleteAll }: {
  user: User
  notifications: NotificationItem[]
  onRead: (id: string) => Promise<void>
  onReadAll: (ids: string[]) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDeleteAll: (ids: string[]) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [working, setWorking] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const allVisible = notifications.filter((item) => (item.role === 'all' || item.role === user.role) && (item.userId === null || item.userId === user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const unread = allVisible.filter((item) => !item.read).length
  const visible = filter === 'unread' ? allVisible.filter((item) => !item.read) : allVisible

  const markAll = async () => {
    if (working || unread === 0) return
    setWorking(true)
    try {
      await onReadAll(allVisible.filter((item) => !item.read).map((item) => item.id))
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  const deleteAll = async () => {
    if (working || allVisible.length === 0) return
    if (!window.confirm('현재 표시되는 모든 알림을 삭제할까요?')) return
    setWorking(true)
    try {
      await onDeleteAll(allVisible.map((item) => item.id))
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  const readOne = async (id: string) => {
    try {
      await onRead(id)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  const deleteOne = async (id: string) => {
    if (deletingId) return
    setDeletingId(id)
    try {
      await onDelete(id)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="page-stack notifications-page-stack">
      <PageHeader title="알림센터" subtitle="작업 상태 변경 알림을 확인하고 불필요한 알림을 삭제할 수 있습니다." action={<div className="page-header-actions"><button className="secondary-button small" disabled={working || unread === 0} onClick={() => void markAll()}><Icon name="check" />모두 읽음</button><button className="secondary-button small danger-outline" disabled={working || allVisible.length === 0} onClick={() => void deleteAll()}><Icon name="trash" />전체 삭제</button></div>} />
      <section className="panel notification-panel fill-panel">
        <div className="notification-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체 <span>{allVisible.length}</span></button><button className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>읽지 않음 <span>{unread}</span></button></div>
        {visible.length === 0 ? <div className="empty-state fill-empty-state">{filter === 'unread' ? '읽지 않은 알림이 없습니다.' : '알림이 없습니다.'}</div> : <div className="notification-list">{visible.map((item) => <article key={item.id} className={item.read ? '' : 'unread'}><button className="notification-main" onClick={() => { if (!item.read) void readOne(item.id) }}><span className="notification-icon"><Icon name={item.title.includes('회원') ? 'users' : item.title.includes('입금') ? 'wallet' : 'bell'} /></span><span><strong>{item.title}</strong><p>{item.message}</p><small>{formatDateTime(item.createdAt)}</small></span>{!item.read && <i />}</button><button className="notification-delete" disabled={deletingId === item.id} aria-label="알림 삭제" title="알림 삭제" onClick={() => void deleteOne(item.id)}><Icon name="trash" size={15} /></button></article>)}</div>}
      </section>
    </div>
  )
}
