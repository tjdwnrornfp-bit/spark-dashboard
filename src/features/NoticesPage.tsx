import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import type { Notice, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '공지사항을 처리하지 못했습니다.'
}

export function NoticesPage({ user, notices, onCreate, onDelete }: {
  user: User
  notices: Notice[]
  onCreate: (input: Pick<Notice, 'title' | 'content' | 'pinned'>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pinned, setPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const sorted = [...notices].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))

  const create = async () => {
    if (!title.trim() || !content.trim() || saving) return
    setSaving(true)
    try {
      await onCreate({ title: title.trim(), content: content.trim(), pinned })
      setTitle('')
      setContent('')
      setPinned(false)
      setCreating(false)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('공지사항을 삭제할까요?')) return
    try {
      await onDelete(id)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  return (
    <div className="page-stack notices-page-stack">
      <PageHeader title="공지사항" subtitle="서비스 운영 공지와 안내사항을 확인합니다." action={user.role === 'admin' ? <button className="primary-button small" onClick={() => setCreating(true)}><Icon name="plus" />공지 등록</button> : undefined} />
      <section className="panel notices-panel fill-panel">
        {sorted.length === 0 ? <div className="empty-state fill-empty-state">등록된 공지사항이 없습니다.</div> : <div className="notice-list">{sorted.map((notice) => <article key={notice.id} className={openId === notice.id ? 'open' : ''}><button onClick={() => setOpenId((current) => current === notice.id ? null : notice.id)}><span>{notice.pinned && <b>공지</b>}<strong>{notice.title}</strong></span><span><time>{formatDateTime(notice.createdAt)}</time><Icon name="chevron" /></span></button>{openId === notice.id && <div className="notice-content"><p>{notice.content}</p>{user.role === 'admin' && <button className="danger-text-button" onClick={() => void remove(notice.id)}>삭제</button>}</div>}</article>)}</div>}
      </section>
      {creating && <Modal title="공지사항 등록" onClose={() => setCreating(false)} footer={<><button className="secondary-button" onClick={() => setCreating(false)}>취소</button><button className="primary-button" disabled={saving} onClick={() => void create()}>{saving ? '등록 중...' : '등록'}</button></>}><div className="modal-form"><label><span>제목</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></label><label><span>내용</span><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={6} maxLength={1000} /></label><label className="checkbox-label"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /><span>상단 고정 공지</span></label></div></Modal>}
    </div>
  )
}
