import { useMemo, useState } from 'react'
import { ApprovalBadge } from '../components/StatusBadge'
import type { MemberRole, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '회원 정보를 저장하지 못했습니다.'
}

export function MembersPage({ members, onReview }: {
  members: User[]
  onReview: (params: { member: User; role: MemberRole; pricePerShot: number; approvalStatus: 'approved' | 'rejected' }) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [role, setRole] = useState<MemberRole>('agency')
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const users = members.filter((member) => member.role !== 'admin')
  const visible = useMemo(() => users.filter((member) => filter === 'all' || member.approvalStatus === filter), [filter, users])
  const selected = members.find((member) => member.id === selectedId) ?? null

  const open = (member: User) => {
    setSelectedId(member.id)
    setRole(member.role === 'distributor' ? 'distributor' : 'agency')
    setPrice(member.pricePerShot > 0 ? String(member.pricePerShot) : '')
    setError('')
  }

  const save = async (approvalStatus: 'approved' | 'rejected') => {
    if (!selected || saving) return
    const pricePerShot = Number(price)
    if (approvalStatus === 'approved' && (!Number.isInteger(pricePerShot) || pricePerShot < 1)) {
      setError('1타당 단가는 1원 이상의 정수로 입력해 주세요.')
      return
    }
    setSaving(true)
    try {
      await onReview({ member: selected, role, pricePerShot: approvalStatus === 'approved' ? pricePerShot : Math.max(0, pricePerShot || 0), approvalStatus })
      setSelectedId(null)
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  const counts = {
    all: users.length,
    pending: users.filter((member) => member.approvalStatus === 'pending').length,
    approved: users.filter((member) => member.approvalStatus === 'approved').length,
    rejected: users.filter((member) => member.approvalStatus === 'rejected').length,
  }

  return (
    <div className="page-stack members-page-stack">
      <PageHeader title="회원관리" subtitle="가입 신청을 승인하고 회원 유형과 1타당 단가를 관리합니다." />
      <section className="panel members-panel fill-panel">
        <div className="filter-tabs member-tabs">
          {([['all', '전체'], ['pending', '승인대기'], ['approved', '승인'], ['rejected', '반려']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}
        </div>
        <div className="desktop-table"><table className="members-table"><thead><tr><th>아이디</th><th>회원유형</th><th>1타당 단가</th><th>승인상태</th><th>활성</th><th>가입 신청일</th><th>관리</th></tr></thead><tbody>{visible.map((member) => <tr key={member.id} className={selectedId === member.id ? 'selected-row' : ''}><td><strong>{member.username}</strong></td><td>{member.role === 'distributor' ? '총판' : member.role === 'agency' ? '대행사' : '-'}</td><td>{member.pricePerShot > 0 ? `${formatWon(member.pricePerShot)} / 타` : '-'}</td><td><ApprovalBadge status={member.approvalStatus} /></td><td><span className={`active-dot ${member.active ? 'on' : ''}`}>{member.active ? '활성' : '비활성'}</span></td><td>{formatDateTime(member.requestedAt)}</td><td><button className="dark-small-button" onClick={() => open(member)}>{member.approvalStatus === 'approved' ? '수정' : '검토'}</button></td></tr>)}</tbody></table></div>
        <div className="mobile-member-list">{visible.map((member) => <article key={member.id}><div><strong>{member.username}</strong><ApprovalBadge status={member.approvalStatus} /></div><p>{member.role === 'distributor' ? '총판' : member.role === 'agency' ? '대행사' : '유형 미지정'} · {member.pricePerShot > 0 ? `${formatWon(member.pricePerShot)}/타` : '단가 미지정'}</p><button className="secondary-button small" onClick={() => open(member)}>회원 검토</button></article>)}</div>

        {selected && <div className="member-editor">
          <div className="member-editor-title"><div><span>선택 회원</span><strong>{selected.username}</strong></div><ApprovalBadge status={selected.approvalStatus} /></div>
          <label><span>회원 유형</span><select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}><option value="agency">대행사</option><option value="distributor">총판</option></select></label>
          <label><span>1타당 단가</span><div className="input-unit"><input type="number" min="1" step="1" value={price} onChange={(event) => { setPrice(event.target.value); setError('') }} placeholder="100" /><span>원/타</span></div></label>
          <div className="member-editor-note">기존 주문은 접수 당시 단가를 유지합니다. 수정 단가는 새 주문부터 적용됩니다.</div>
          {error && <p className="field-error editor-error">{error}</p>}
          <div className="member-editor-actions"><button className="danger-text-button" disabled={saving} onClick={() => void save('rejected')}>가입 반려</button><span /><button className="secondary-button" disabled={saving} onClick={() => setSelectedId(null)}>취소</button><button className="primary-button" disabled={saving} onClick={() => void save('approved')}>{saving ? '저장 중...' : selected.approvalStatus === 'approved' ? '변경 저장' : '가입 승인'}</button></div>
        </div>}
      </section>
    </div>
  )
}
