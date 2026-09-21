import { useRef, useState } from 'react'
import type { User } from '../domain/types'
import { useRemoteRead } from '../hooks/useRemoteRead'
import { fetchNotificationPage } from '../lib/performance'
import type { NotificationPageResult } from '../lib/performance'
import { NotificationsPage } from './NotificationsPage'

export function RemoteNotificationsPage({ user, revision, onRead, onReadAll, onDelete, onDeleteAll }: {
  user: User; revision: number
  onRead: (id: string) => Promise<void>; onReadAll: (ids: string[]) => Promise<void>
  onDelete: (id: string) => Promise<void>; onDeleteAll: (ids: string[]) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const key = `notifications:${user.id}:${revision}:${filter}`
  const currentKey = useRef(key)
  currentKey.current = key
  const first = useRemoteRead(key, () => fetchNotificationPage(filter === 'unread'))
  const [extra, setExtra] = useState<{ key: string; data: NotificationPageResult } | null>(null)
  const [loadingKey, setLoadingKey] = useState('')
  const inFlight = useRef('')
  const [moreError, setMoreError] = useState<{ key: string; message: string } | null>(null)
  const data = extra?.key === key ? extra.data : first.data
  const loadMore = async () => {
    if (!data?.hasMore || !data.cursor || inFlight.current === key) return
    inFlight.current = key
    setLoadingKey(key); setMoreError(null)
    try {
      const next = await fetchNotificationPage(filter === 'unread', data.cursor)
      if (currentKey.current !== key) return
      const seen = new Set(data.rows.map((row) => row.id))
      setExtra({ key, data: { ...next, rows: [...data.rows, ...next.rows.filter((row) => !seen.has(row.id))] } })
    } catch (error) {
      if (currentKey.current === key) setMoreError({ key, message: String((error as { message?: string })?.message ?? '알림을 불러오지 못했습니다.') })
    } finally {
      if (inFlight.current === key) { inFlight.current = ''; setLoadingKey('') }
    }
  }
  const error = first.error ?? (moreError?.key === key ? moreError.message : undefined)
  return <>
    {first.loading && <p role="status">알림을 조회하고 있습니다.</p>}
    {error && <p className="performance-read-error" role="alert">{error} <button className="secondary-button small" onClick={() => { setExtra(null); setMoreError(null); first.reload() }}>다시 조회</button></p>}
    <NotificationsPage user={user} notifications={data?.rows ?? []} hasMore={data?.hasMore ?? false} loadingMore={loadingKey === key || first.loading}
      filterValue={filter} onFilterChange={setFilter} unreadTotal={data?.unreadCount} notificationTotal={data?.totalCount}
      onLoadMore={loadMore} onRead={onRead} onReadAll={onReadAll} onDelete={onDelete} onDeleteAll={onDeleteAll} />
  </>
}
