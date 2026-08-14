import { useMemo, useState } from 'react'
import { ApprovalBadge } from '../components/StatusBadge'
import type { MemberReviewInput, MemberRole, ProgramPriceMap, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { getProgramPriceMap } from '../lib/program'
import { formatPhoneNumber } from '../lib/auth'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '회원 정보를 저장하지 못했습니다.'
}

function emptyPrices(member: User): ProgramPriceMap {
  return getProgramPriceMap(member)
}

function memberTypeLabel(member: User): string {
  if (member.isOperationsManager) return '중간관리자'
  if (member.role === 'distributor') return '총판'
  if (member.role === 'agency') return '대행사'
  return '-'
}

function managementLabel(member: User): string {
  if (member.isOperationsManager) return '관리자 지정 중간관리자'
  if (member.managerId) return `${member.managerUsername || '중간관리자'} 관리 · 관리자 직결`
  if (member.sponsorId) return `${member.sponsorUsername || '상위회원'} 추천`
  return '관리자 직속'
}

export function MembersPage({ user, members, onReview }: {
  user: User
  members: User[]
  onReview: (params: MemberReviewInput) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [role, setRole] = useState<MemberRole>('agency')
  const [prices, setPrices] = useState<ProgramPriceMap>({ spark: '', spark_plus: '', spark_s: '' } as unknown as ProgramPriceMap)
  const [groupName, setGroupName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isAdmin = user.role === 'admin'
  const isManager = user.isOperationsManager
  const users = useMemo(
    () => members.filter((member) => {
      if (member.role === 'admin') return false
      if (isAdmin) return true
      if (isManager) return member.managerId === user.id
      return member.sponsorId === user.id
    }),
    [isAdmin, isManager, members, user.id],
  )
  const visible = useMemo(() => users.filter((member) => filter === 'all' || member.approvalStatus === filter), [filter, users])
  const selected = members.find((member) => member.id === selectedId) ?? null
  const sponsorPending = Boolean(isAdmin && selected?.approvalStatus === 'pending' && selected.sponsorId)
  const adminManagedMember = Boolean(isAdmin && selected?.managerId)
  const parentPrices = getProgramPriceMap(user)
  const forcedAgency = Boolean(selected?.sponsorId || selected?.managerId)
  const selectedManagerAccount = Boolean(selected && !forcedAgency && role === 'manager')

  const open = (member: User) => {
    setSelectedId(member.id)
    setRole(member.isOperationsManager ? 'manager' : member.sponsorId || member.managerId ? 'agency' : member.role === 'distributor' ? 'distributor' : 'agency')
    setPrices(emptyPrices(member))
    setGroupName(member.groupName)
    setError('')
  }

  const numericPrices = {
    spark: Number(prices.spark),
    spark_plus: Number(prices.spark_plus),
    spark_s: Number(prices.spark_s),
  }

  const save = async (approvalStatus: 'approved' | 'rejected') => {
    if (!selected || saving) return
    const accountType: MemberRole = forcedAgency ? 'agency' : role
    if (approvalStatus === 'approved' && accountType !== 'manager') {
      const invalid = Object.values(numericPrices).some((value) => !Number.isInteger(value) || value < 1)
      if (invalid) {
        setError('세 프로그램 단가를 모두 1원 이상의 정수로 입력해 주세요.')
        return
      }
      if (!isAdmin && !isManager) {
        if (numericPrices.spark <= parentPrices.spark || numericPrices.spark_plus <= parentPrices.spark_plus || numericPrices.spark_s <= parentPrices.spark_s) {
          setError('하위 회원 단가는 각 프로그램마다 내 단가보다 높아야 합니다.')
          return
        }
      }
    }
    if (isAdmin && selected.sponsorId === null && selected.managerId === null && approvalStatus === 'approved' && !groupName.trim()) {
      setError('관리자용 그룹명을 입력해 주세요.')
      return
    }
    setSaving(true)
    try {
      await onReview({
        member: selected,
        role: accountType,
        prices: approvalStatus === 'approved' && accountType !== 'manager' ? numericPrices : emptyPrices(selected),
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

  const minFor = (program: keyof ProgramPriceMap) => isAdmin || isManager ? 1 : parentPrices[program] + 1

  return (
    <div className="page-stack members-page-stack">
      <PageHeader
        title="회원관리"
        subtitle={isAdmin
          ? '전체 회원의 관리 관계, 유형과 프로그램별 단가를 관리합니다.'
          : isManager
            ? '내 관리 코드로 가입한 대행사를 승인하고 단가를 지정합니다. 정산은 관리자와 직접 연결됩니다.'
            : '내 추천 코드로 가입한 하위 대행사를 승인하고 프로그램별 단가를 관리합니다.'}
      />

      {!isAdmin && (
        <section className="referral-summary panel">
          <div><span>{isManager ? '내 관리 코드' : '내 추천 코드'}</span><strong>{user.referralCode || user.username}</strong><small>회원가입 시 내 아이디 또는 이 코드를 입력할 수 있습니다.</small></div>
          {isManager ? (
            <>
              <div><span>관리 권한</span><strong>대행사 승인 · 단가 지정</strong><small>내 코드로 가입한 대행사만 관리할 수 있습니다.</small></div>
              <div><span>정산 연결</span><strong>관리자 직결</strong><small>관리 대행사의 입금 계좌와 정산은 중간관리자를 거치지 않습니다.</small></div>
            </>
          ) : (
            <>
              <div><span>하위 단가 기준</span><strong>프로그램별 +1원 이상</strong><small>스파크 {formatWon(parentPrices.spark + 1)} · 스파크+ {formatWon(parentPrices.spark_plus + 1)} · 스파크S {formatWon(parentPrices.spark_s + 1)}</small></div>
              <div><span>입금 계좌</span><strong>{user.bank && user.accountNumber ? `${user.bank} ${user.accountNumber}` : '미등록'}</strong><small>{user.accountHolder || '내 정보에서 계좌를 등록해야 승인할 수 있습니다.'}</small></div>
            </>
          )}
        </section>
      )}

      <section className="panel members-panel fill-panel">
        <div className="filter-tabs member-tabs">
          {([['all', '전체'], ['pending', '승인대기'], ['approved', '승인'], ['rejected', '반려']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}
        </div>
        <div className="desktop-table"><table className="members-table"><thead><tr><th>아이디</th>{isAdmin && <th>전화번호</th>}{isAdmin && <th>그룹명</th>}{isAdmin && <th>관리 관계</th>}<th>회원유형</th><th>스파크</th><th>스파크 +</th><th>스파크S</th><th>승인상태</th><th>가입 신청일</th><th>관리</th></tr></thead><tbody>{visible.map((member) => { const memberPrices = getProgramPriceMap(member); return <tr key={member.id} className={selectedId === member.id ? 'selected-row' : ''}><td><strong>{member.username}</strong><small className="table-subtext">코드 {member.referralCode || '-'}</small></td>{isAdmin && <td><strong className="member-phone-cell">{formatPhoneNumber(member.phoneNumber)}</strong></td>}{isAdmin && <td>{member.groupName || '-'}</td>}{isAdmin && <td>{managementLabel(member)}</td>}<td>{memberTypeLabel(member)}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark > 0 ? formatWon(memberPrices.spark) : '-'}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark_plus > 0 ? formatWon(memberPrices.spark_plus) : '-'}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark_s > 0 ? formatWon(memberPrices.spark_s) : '-'}</td><td><ApprovalBadge status={member.approvalStatus} /></td><td>{formatDateTime(member.requestedAt)}</td><td><button className="dark-small-button" onClick={() => open(member)}>{member.approvalStatus === 'approved' ? '수정' : '검토'}</button></td></tr>})}</tbody></table></div>
        <div className="mobile-member-list">{visible.map((member) => { const memberPrices = getProgramPriceMap(member); return <article key={member.id}><div><strong>{member.username}</strong><ApprovalBadge status={member.approvalStatus} /></div><p>{isAdmin ? `${managementLabel(member)} · ` : ''}{memberTypeLabel(member)}</p>{!member.isOperationsManager && <p>스파크 {memberPrices.spark > 0 ? formatWon(memberPrices.spark) : '-'} · 스파크+ {memberPrices.spark_plus > 0 ? formatWon(memberPrices.spark_plus) : '-'} · 스파크S {memberPrices.spark_s > 0 ? formatWon(memberPrices.spark_s) : '-'}</p>}{isAdmin && <p>전화번호 {formatPhoneNumber(member.phoneNumber)}</p>}{isAdmin && <p>그룹 {member.groupName || '-'}</p>}<button className="secondary-button small" onClick={() => open(member)}>회원 검토</button></article>})}</div>

        {visible.length === 0 && <div className="empty-state fill-empty-state">조건에 맞는 회원이 없습니다.</div>}

        {selected && <div className="member-editor">
          <div className="member-editor-title"><div><span>선택 회원</span><strong>{selected.username}</strong></div><button className="icon-button" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="member-editor-grid">
            {isAdmin && !forcedAgency ? <label><span>회원 유형</span><select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}><option value="agency">대행사</option><option value="distributor">총판</option><option value="manager">중간관리자</option></select></label> : <label><span>회원 유형</span><input value="대행사" disabled /></label>}
            {!selectedManagerAccount && <>
              <label><span>스파크 단가</span><div className="input-unit"><input type="number" min={minFor('spark')} step="1" value={prices.spark || ''} onChange={(event) => setPrices((current) => ({ ...current, spark: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
              <label><span>스파크 + 단가</span><div className="input-unit"><input type="number" min={minFor('spark_plus')} step="1" value={prices.spark_plus || ''} onChange={(event) => setPrices((current) => ({ ...current, spark_plus: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
              <label><span>스파크S 단가</span><div className="input-unit"><input type="number" min={minFor('spark_s')} step="1" value={prices.spark_s || ''} onChange={(event) => setPrices((current) => ({ ...current, spark_s: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
            </>}
            {selectedManagerAccount && <div className="member-static-info manager-account-info"><span>중간관리자 권한</span><strong>하위 대행사 승인 · 단가 지정</strong><small>작업 접수·정산·운영기록 권한은 부여되지 않습니다.</small></div>}
            {isAdmin && <div className="member-static-info"><span>가입 전화번호</span><strong>{formatPhoneNumber(selected.phoneNumber)}</strong><small>회원가입 시 입력한 연락처입니다.</small></div>}
            {isAdmin && <label><span>관리자용 그룹명</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="업체 식별용 그룹명" /></label>}
            {isAdmin && <div className="member-static-info"><span>연결 상태</span><strong>{managementLabel(selected)}</strong></div>}
          </div>
          {sponsorPending && <p className="inline-message">이 회원은 직접 추천 회원인 <strong>{selected.sponsorUsername}</strong> 계정에서 승인합니다.</p>}
          {adminManagedMember && <p className="inline-message">관리 담당은 <strong>{selected.managerUsername || '지정된 중간관리자'}</strong>이며, 입금 계좌와 정산은 관리자에게 직접 연결됩니다. 관리자는 필요 시 직접 승인·수정할 수 있습니다.</p>}
          {isManager && <p className="inline-message">승인한 대행사의 입금 계좌와 정산은 관리자에게 직접 연결됩니다.</p>}
          {!isAdmin && !isManager && (!user.bank || !user.accountNumber || !user.accountHolder) && <p className="inline-message error">내 정보에서 입금 계좌를 먼저 등록해야 회원을 승인할 수 있습니다.</p>}
          {error && <p className="inline-message error">{error}</p>}
          <div className="member-editor-actions"><button className="secondary-button danger-outline" disabled={saving || sponsorPending} onClick={() => void save('rejected')}>반려</button><button className="primary-button" disabled={saving || sponsorPending || (!isAdmin && !isManager && (!user.bank || !user.accountNumber || !user.accountHolder))} onClick={() => void save('approved')}>{saving ? '저장 중...' : selected.approvalStatus === 'approved' ? '수정 저장' : '승인'}</button></div>
        </div>}
      </section>
    </div>
  )
}
