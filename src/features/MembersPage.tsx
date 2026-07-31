import { useMemo, useState } from 'react'
import { ApprovalBadge } from '../components/StatusBadge'
import type { MemberReviewInput, MemberRole, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '회원 정보를 저장하지 못했습니다.'
}

export function MembersPage({ user, members, onReview }: {
  user: User
  members: User[]
  onReview: (params: MemberReviewInput) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [role, setRole] = useState<MemberRole>('agency')
  const [price, setPrice] = useState('')
  const [groupName, setGroupName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isAdmin = user.role === 'admin'
  const users = useMemo(
    () => members.filter((member) => member.role !== 'admin' && (isAdmin || member.sponsorId === user.id)),
    [isAdmin, members, user.id],
  )
  const visible = useMemo(() => users.filter((member) => filter === 'all' || member.approvalStatus === filter), [filter, users])
  const selected = members.find((member) => member.id === selectedId) ?? null
  const adminCannotReviewReferralPending = Boolean(isAdmin && selected?.sponsorId && selected.approvalStatus === 'pending')

  const open = (member: User) => {
    setSelectedId(member.id)
    setRole(member.sponsorId ? 'agency' : member.role === 'distributor' ? 'distributor' : 'agency')
    setPrice(member.pricePerShot > 0 ? String(member.pricePerShot) : '')
    setGroupName(member.groupName)
    setError('')
  }

  const save = async (approvalStatus: 'approved' | 'rejected') => {
    if (!selected || saving) return
    const pricePerShot = Number(price)
    if (approvalStatus === 'approved' && (!Number.isInteger(pricePerShot) || pricePerShot < 1)) {
      setError('1타당 단가는 1원 이상의 정수로 입력해 주세요.')
      return
    }
    if (!isAdmin && approvalStatus === 'approved' && pricePerShot <= user.pricePerShot) {
      setError(`하위 대행사 단가는 내 단가 ${formatWon(user.pricePerShot)}보다 높아야 합니다.`)
      return
    }
    if (isAdmin && selected.sponsorId === null && approvalStatus === 'approved' && !groupName.trim()) {
      setError('관리자용 그룹명을 입력해 주세요.')
      return
    }
    setSaving(true)
    try {
      await onReview({
        member: selected,
        role: selected.sponsorId ? 'agency' : role,
        pricePerShot: approvalStatus === 'approved' ? pricePerShot : Math.max(0, pricePerShot || 0),
        approvalStatus,
        groupName: isAdmin ? groupName.trim() : selected.groupName,
      })
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
      <PageHeader
        title="회원관리"
        subtitle={isAdmin ? '전체 회원의 그룹, 추천 관계, 유형과 단가를 관리합니다.' : '내 추천 코드로 가입한 하위 대행사를 승인하고 단가를 관리합니다.'}
      />

      {!isAdmin && (
        <section className="referral-summary panel">
          <div><span>내 추천 코드</span><strong>{user.referralCode || user.username}</strong><small>회원가입 시 내 아이디 또는 이 코드를 입력할 수 있습니다.</small></div>
          <div><span>하위 단가 기준</span><strong>{formatWon(user.pricePerShot + 1)} 이상</strong><small>기존 주문에는 접수 당시 단가가 유지됩니다.</small></div>
          <div><span>입금 계좌</span><strong>{user.bank && user.accountNumber ? `${user.bank} ${user.accountNumber}` : '미등록'}</strong><small>{user.accountHolder || '내 정보에서 계좌를 등록해야 승인할 수 있습니다.'}</small></div>
        </section>
      )}

      <section className="panel members-panel fill-panel">
        <div className="filter-tabs member-tabs">
          {([['all', '전체'], ['pending', '승인대기'], ['approved', '승인'], ['rejected', '반려']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}
        </div>
        <div className="desktop-table"><table className="members-table"><thead><tr><th>아이디</th>{isAdmin && <th>그룹명</th>}{isAdmin && <th>추천인</th>}<th>회원유형</th><th>1타당 단가</th><th>승인상태</th><th>가입 신청일</th><th>관리</th></tr></thead><tbody>{visible.map((member) => <tr key={member.id} className={selectedId === member.id ? 'selected-row' : ''}><td><strong>{member.username}</strong><small className="table-subtext">코드 {member.referralCode || '-'}</small></td>{isAdmin && <td>{member.groupName || '-'}</td>}{isAdmin && <td>{member.sponsorUsername || '관리자 직속'}</td>}<td>{member.role === 'distributor' ? '총판' : member.role === 'agency' ? '대행사' : '-'}</td><td>{member.pricePerShot > 0 ? `${formatWon(member.pricePerShot)} / 타` : '-'}</td><td><ApprovalBadge status={member.approvalStatus} /></td><td>{formatDateTime(member.requestedAt)}</td><td><button className="dark-small-button" onClick={() => open(member)}>{member.approvalStatus === 'approved' ? '수정' : '검토'}</button></td></tr>)}</tbody></table></div>
        <div className="mobile-member-list">{visible.map((member) => <article key={member.id}><div><strong>{member.username}</strong><ApprovalBadge status={member.approvalStatus} /></div><p>{isAdmin ? `${member.sponsorUsername ? `추천인 ${member.sponsorUsername}` : '관리자 직속'} · ` : ''}{member.role === 'distributor' ? '총판' : '대행사'} · {member.pricePerShot > 0 ? `${formatWon(member.pricePerShot)}/타` : '단가 미지정'}</p>{isAdmin && <p>그룹 {member.groupName || '-'}</p>}<button className="secondary-button small" onClick={() => open(member)}>회원 검토</button></article>)}</div>

        {visible.length === 0 && <div className="empty-state fill-empty-state">조건에 맞는 회원이 없습니다.</div>}

        {selected && <div className="member-editor">
          <div className="member-editor-title"><div><span>선택 회원</span><strong>{selected.username}</strong></div><button className="icon-button" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="member-editor-grid">
            {isAdmin && selected.sponsorId === null ? <label><span>회원 유형</span><select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}><option value="agency">대행사</option><option value="distributor">총판</option></select></label> : <label><span>회원 유형</span><input value="대행사" disabled /></label>}
            <label><span>1타당 단가</span><div className="input-unit"><input type="number" min={isAdmin ? 1 : user.pricePerShot + 1} step="1" value={price} onChange={(event) => setPrice(event.target.value)} /><span>원</span></div></label>
            {isAdmin && <label><span>관리자용 그룹명</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={selected.sponsorId ? '기존 그룹명 유지' : '업체 식별용 그룹명'} /></label>}
            {isAdmin && <div className="member-static-info"><span>추천인</span><strong>{selected.sponsorUsername || '관리자 직속'}</strong></div>}
          </div>
          {adminCannotReviewReferralPending && <p className="inline-message">이 회원은 직접 추천 회원인 <strong>{selected.sponsorUsername}</strong> 회원이 승인합니다.</p>}
          {!isAdmin && (!user.bank || !user.accountNumber || !user.accountHolder) && <p className="inline-message error">내 정보에서 입금 계좌를 먼저 등록해야 회원을 승인할 수 있습니다.</p>}
          {error && <p className="inline-message error">{error}</p>}
          <div className="member-editor-actions"><button className="secondary-button danger-outline" disabled={saving || adminCannotReviewReferralPending} onClick={() => void save('rejected')}>반려</button><button className="primary-button" disabled={saving || adminCannotReviewReferralPending || (!isAdmin && (!user.bank || !user.accountNumber || !user.accountHolder))} onClick={() => void save('approved')}>{saving ? '저장 중...' : selected.approvalStatus === 'approved' ? '수정 저장' : '승인'}</button></div>
        </div>}
      </section>
    </div>
  )
}
