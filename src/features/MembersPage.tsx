import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { ApprovalBadge } from '../components/StatusBadge'
import type { MemberDeletionCheck, MemberManagerBulkAssignmentResult, MemberReviewInput, MemberRole, ProgramPriceMap, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { getProgramPriceMap } from '../lib/program'
import { formatPhoneNumber, validatePassword } from '../lib/auth'
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
  if (member.isOperationsManager) return '배정 대상 아님'
  if (member.managerId) return member.managerUsername || '지정된 중간관리자'
  return '관리자 직속'
}

function canAssignManager(member: User): boolean {
  if (member.role !== 'agency' && member.role !== 'distributor') return false
  if (member.isOperationsManager || member.approvalStatus === 'rejected') return false
  return member.approvalStatus !== 'approved' || member.active
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const random = new Uint8Array(12)
  crypto.getRandomValues(random)
  return `Sp!${Array.from(random, (value) => alphabet[value % alphabet.length]).join('')}`
}

export function MembersPage({ user, members, onReview, onAssignManager, onBulkAssignManager, onCheckDeletion, onDeleteMember, onResetPassword }: {
  user: User
  members: User[]
  onReview: (params: MemberReviewInput) => Promise<void>
  onAssignManager: (member: User, managerId: string | null, reason: string) => Promise<User>
  onBulkAssignManager: (members: User[], managerId: string | null, reason: string) => Promise<MemberManagerBulkAssignmentResult>
  onCheckDeletion: (member: User) => Promise<MemberDeletionCheck>
  onDeleteMember: (member: User) => Promise<void>
  onResetPassword: (member: User, newPassword: string) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [role, setRole] = useState<MemberRole>('agency')
  const [prices, setPrices] = useState<ProgramPriceMap>({ spark: '', spark_plus: '', spark_s: '', spark_s_plus: 40 } as unknown as ProgramPriceMap)
  const [groupName, setGroupName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteChecking, setDeleteChecking] = useState(false)
  const [deleteCheck, setDeleteCheck] = useState<MemberDeletionCheck | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [passwordResetOpen, setPasswordResetOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [passwordResetting, setPasswordResetting] = useState(false)
  const [passwordResetComplete, setPasswordResetComplete] = useState(false)
  const [passwordResetError, setPasswordResetError] = useState('')
  const [passwordCopied, setPasswordCopied] = useState(false)
  const [checkedMemberIds, setCheckedMemberIds] = useState<Set<string>>(new Set())
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentMode, setAssignmentMode] = useState<'single' | 'bulk'>('single')
  const [assignmentMemberIds, setAssignmentMemberIds] = useState<string[]>([])
  const [assignmentTarget, setAssignmentTarget] = useState('')
  const [assignmentReason, setAssignmentReason] = useState('')
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')
  const [assignmentResult, setAssignmentResult] = useState<MemberManagerBulkAssignmentResult | null>(null)
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
  const managerCandidates = useMemo(
    () => members
      .filter((member) => member.isOperationsManager && member.approvalStatus === 'approved' && member.active)
      .sort((a, b) => a.username.localeCompare(b.username, 'ko-KR')),
    [members],
  )
  const checkedMembers = useMemo(() => members.filter((member) => checkedMemberIds.has(member.id) && canAssignManager(member)), [checkedMemberIds, members])
  const visibleAssignable = useMemo(() => visible.filter(canAssignManager), [visible])
  const allVisibleAssignableChecked = visibleAssignable.length > 0 && visibleAssignable.every((member) => checkedMemberIds.has(member.id))
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
    setDeleteOpen(false)
    setDeleteCheck(null)
    setDeleteError('')
    setPasswordResetOpen(false)
    setPasswordResetComplete(false)
    setPasswordResetError('')
  }

  const numericPrices = {
    spark: Number(prices.spark),
    spark_plus: Number(prices.spark_plus),
    spark_s: Number(prices.spark_s),
    spark_s_plus: Number(prices.spark_s_plus),
  }

  const save = async (approvalStatus: 'approved' | 'rejected') => {
    if (!selected || saving) return
    const accountType: MemberRole = forcedAgency ? 'agency' : role
    if (approvalStatus === 'approved' && accountType !== 'manager') {
      const invalid = Object.values(numericPrices).some((value) => !Number.isInteger(value) || value < 1)
      if (invalid) {
        setError('네 프로그램 단가를 모두 1원 이상의 정수로 입력해 주세요.')
        return
      }
      if (!isAdmin && !isManager) {
        if (numericPrices.spark <= parentPrices.spark || numericPrices.spark_plus <= parentPrices.spark_plus || numericPrices.spark_s <= parentPrices.spark_s || numericPrices.spark_s_plus <= parentPrices.spark_s_plus) {
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

  const openDelete = async () => {
    if (!selected || !isAdmin || deleting) return
    setDeleteOpen(true)
    setDeleteChecking(true)
    setDeleteCheck(null)
    setDeleteError('')
    try {
      setDeleteCheck(await onCheckDeletion(selected))
    } catch (caught) {
      setDeleteError(getErrorMessage(caught))
    } finally {
      setDeleteChecking(false)
    }
  }

  const confirmDelete = async () => {
    if (!selected || !deleteCheck?.canDelete || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDeleteMember(selected)
      setDeleteOpen(false)
      setDeleteCheck(null)
      setSelectedId(null)
    } catch (caught) {
      setDeleteError(getErrorMessage(caught))
      try {
        setDeleteCheck(await onCheckDeletion(selected))
      } catch {
        // Keep the delete error when the eligibility refresh also fails.
      }
    } finally {
      setDeleting(false)
    }
  }

  const openPasswordReset = () => {
    if (!selected || !isAdmin) return
    setNewPassword('')
    setNewPasswordConfirm('')
    setPasswordVisible(false)
    setPasswordResetComplete(false)
    setPasswordResetError('')
    setPasswordCopied(false)
    setPasswordResetOpen(true)
  }

  const closePasswordReset = () => {
    if (passwordResetting) return
    setPasswordResetOpen(false)
    setNewPassword('')
    setNewPasswordConfirm('')
    setPasswordVisible(false)
    setPasswordResetComplete(false)
    setPasswordResetError('')
    setPasswordCopied(false)
  }

  const makeTemporaryPassword = () => {
    const temporaryPassword = generateTemporaryPassword()
    setNewPassword(temporaryPassword)
    setNewPasswordConfirm(temporaryPassword)
    setPasswordVisible(true)
    setPasswordResetComplete(false)
    setPasswordResetError('')
    setPasswordCopied(false)
  }

  const resetPassword = async () => {
    if (!selected || passwordResetting) return
    const validation = validatePassword(newPassword)
    if (validation) {
      setPasswordResetError(validation)
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordResetError('새 비밀번호 확인이 일치하지 않습니다.')
      return
    }
    setPasswordResetting(true)
    setPasswordResetError('')
    try {
      await onResetPassword(selected, newPassword)
      setPasswordVisible(true)
      setPasswordResetComplete(true)
    } catch (caught) {
      setPasswordResetError(getErrorMessage(caught))
    } finally {
      setPasswordResetting(false)
    }
  }

  const copyResetPassword = async () => {
    try {
      await navigator.clipboard.writeText(newPassword)
      setPasswordCopied(true)
    } catch {
      setPasswordResetError('클립보드에 복사하지 못했습니다. 비밀번호를 직접 선택해 복사해 주세요.')
    }
  }

  const resetAssignmentDialog = () => {
    setAssignmentTarget('')
    setAssignmentReason('')
    setAssignmentError('')
    setAssignmentResult(null)
  }

  const openSingleAssignment = (member: User) => {
    if (!isAdmin || !canAssignManager(member)) return
    setAssignmentMode('single')
    setAssignmentMemberIds([member.id])
    resetAssignmentDialog()
    setAssignmentOpen(true)
  }

  const openBulkAssignment = () => {
    if (!isAdmin || checkedMembers.length === 0) return
    setAssignmentMode('bulk')
    setAssignmentMemberIds(checkedMembers.map((member) => member.id))
    resetAssignmentDialog()
    setAssignmentOpen(true)
  }

  const closeAssignment = () => {
    if (assignmentSaving) return
    setAssignmentOpen(false)
    setAssignmentMemberIds([])
    resetAssignmentDialog()
  }

  const toggleMemberChecked = (member: User) => {
    if (!canAssignManager(member)) return
    setCheckedMemberIds((current) => {
      const next = new Set(current)
      if (next.has(member.id)) next.delete(member.id)
      else next.add(member.id)
      return next
    })
  }

  const toggleVisibleAssignable = () => {
    setCheckedMemberIds((current) => {
      const next = new Set(current)
      visibleAssignable.forEach((member) => {
        if (allVisibleAssignableChecked) next.delete(member.id)
        else next.add(member.id)
      })
      return next
    })
  }

  const submitAssignment = async () => {
    if (assignmentSaving || assignmentResult) return
    const targets = assignmentMemberIds
      .map((memberId) => members.find((member) => member.id === memberId))
      .filter((member): member is User => Boolean(member && canAssignManager(member)))
    if (targets.length === 0) {
      setAssignmentError('변경할 수 있는 회원이 없습니다. 목록을 새로고침해 주세요.')
      return
    }
    if (!assignmentTarget) {
      setAssignmentError('변경할 중간관리자 또는 관리자 직속 해제를 선택해 주세요.')
      return
    }
    if (assignmentReason.trim().length < 2) {
      setAssignmentError('변경 사유를 2자 이상 입력해 주세요.')
      return
    }
    const managerId = assignmentTarget === 'direct' ? null : assignmentTarget
    setAssignmentSaving(true)
    setAssignmentError('')
    try {
      const result = assignmentMode === 'single'
        ? await onAssignManager(targets[0], managerId, assignmentReason).then((updated): MemberManagerBulkAssignmentResult => ({
          selectedCount: 1,
          succeededCount: 1,
          failedCount: 0,
          managerId,
          managerUsername: updated.managerUsername,
          items: [{ memberId: updated.id, username: updated.username, status: 'succeeded', message: '관리 담당이 변경되었습니다.', member: updated }],
        }))
        : await onBulkAssignManager(targets, managerId, assignmentReason)
      setAssignmentResult(result)
      setCheckedMemberIds((current) => {
        const next = new Set(current)
        result.items.filter((item) => item.status === 'succeeded').forEach((item) => next.delete(item.memberId))
        return next
      })
    } catch (caught) {
      setAssignmentError(getErrorMessage(caught))
    } finally {
      setAssignmentSaving(false)
    }
  }

  const counts = {
    all: users.length,
    pending: users.filter((member) => member.approvalStatus === 'pending').length,
    approved: users.filter((member) => member.approvalStatus === 'approved').length,
    rejected: users.filter((member) => member.approvalStatus === 'rejected').length,
  }

  const minFor = (program: keyof ProgramPriceMap) => isAdmin || isManager ? 1 : parentPrices[program] + 1
  const assignmentMembers = assignmentMemberIds
    .map((memberId) => members.find((member) => member.id === memberId))
    .filter((member): member is User => Boolean(member))
  const assignmentHasSponsor = assignmentMembers.some((member) => member.sponsorId)

  return (
    <div className="page-stack members-page-stack">
      <PageHeader
        title="회원관리"
        subtitle={isAdmin
          ? '전체 회원의 관리 관계, 유형과 프로그램별 단가를 관리합니다.'
          : isManager
            ? '내 관리 코드로 가입했거나 관리자가 배정한 대행사를 확인합니다. 추천·정산 관계는 별도로 유지됩니다.'
            : '내 추천 코드로 가입한 하위 대행사를 승인하고 프로그램별 단가를 관리합니다.'}
      />

      {!isAdmin && (
        <section className="referral-summary panel">
          <div><span>{isManager ? '내 관리 코드' : '내 추천 코드'}</span><strong>{user.referralCode || user.username}</strong><small>회원가입 시 내 아이디 또는 이 코드를 입력할 수 있습니다.</small></div>
          {isManager ? (
            <>
              <div><span>관리 권한</span><strong>대행사 승인 · 단가 지정</strong><small>내 코드 가입 회원과 관리자가 배정한 대행사를 확인할 수 있습니다.</small></div>
              <div><span>정산 연결</span><strong>관리자 직결</strong><small>관리 대행사의 입금 계좌와 정산은 중간관리자를 거치지 않습니다.</small></div>
            </>
          ) : (
            <>
              <div><span>하위 단가 기준</span><strong>프로그램별 +1원 이상</strong><small>스파크 {formatWon(parentPrices.spark + 1)} · 스파크+ {formatWon(parentPrices.spark_plus + 1)} · 스파크S {formatWon(parentPrices.spark_s + 1)} · 스파크S+ {formatWon(parentPrices.spark_s_plus + 1)}</small></div>
              <div><span>입금 계좌</span><strong>{user.bank && user.accountNumber ? `${user.bank} ${user.accountNumber}` : '미등록'}</strong><small>{user.accountHolder || '내 정보에서 계좌를 등록해야 승인할 수 있습니다.'}</small></div>
            </>
          )}
        </section>
      )}

      <section className="panel members-panel fill-panel">
        <div className="members-toolbar">
          <div className="filter-tabs member-tabs">
            {([['all', '전체'], ['pending', '승인대기'], ['approved', '승인'], ['rejected', '반려']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}
          </div>
          {isAdmin && <button className="primary-button member-bulk-manager-button" disabled={checkedMembers.length === 0} onClick={openBulkAssignment}><Icon name="users" />중간관리자 배정 ({checkedMembers.length})</button>}
        </div>
        <div className="desktop-table"><table className="members-table"><thead><tr>{isAdmin && <th className="checkbox-cell"><input type="checkbox" aria-label="현재 목록의 배정 가능 회원 전체 선택" checked={allVisibleAssignableChecked} disabled={visibleAssignable.length === 0} onChange={toggleVisibleAssignable} /></th>}<th>아이디</th>{isAdmin && <th>전화번호</th>}{isAdmin && <th>그룹명</th>}{isAdmin && <th>관리 담당</th>}<th>회원유형</th><th>스파크</th><th>스파크 +</th><th>스파크S</th><th>스파크S+</th><th>승인상태</th><th>가입 신청일</th><th>관리</th></tr></thead><tbody>{visible.map((member) => { const memberPrices = getProgramPriceMap(member); const assignable = canAssignManager(member); return <tr key={member.id} className={selectedId === member.id || checkedMemberIds.has(member.id) ? 'selected-row' : ''}>{isAdmin && <td className="checkbox-cell"><input type="checkbox" aria-label={`${member.username} 배정 선택`} checked={checkedMemberIds.has(member.id)} disabled={!assignable} onChange={() => toggleMemberChecked(member)} /></td>}<td><strong>{member.username}</strong><small className="table-subtext">코드 {member.referralCode || '-'}</small></td>{isAdmin && <td><strong className="member-phone-cell">{formatPhoneNumber(member.phoneNumber)}</strong></td>}{isAdmin && <td>{member.groupName || '-'}</td>}{isAdmin && <td><strong>{managementLabel(member)}</strong>{member.sponsorId && <small className="table-subtext">추천/정산: {member.sponsorUsername || '기존 상위회원'}</small>}</td>}<td>{memberTypeLabel(member)}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark > 0 ? formatWon(memberPrices.spark) : '-'}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark_plus > 0 ? formatWon(memberPrices.spark_plus) : '-'}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark_s > 0 ? formatWon(memberPrices.spark_s) : '-'}</td><td>{member.isOperationsManager ? '-' : memberPrices.spark_s_plus > 0 ? formatWon(memberPrices.spark_s_plus) : '-'}</td><td><ApprovalBadge status={member.approvalStatus} /></td><td>{formatDateTime(member.requestedAt)}</td><td><div className="member-row-actions"><button className="dark-small-button" onClick={() => open(member)}>{member.approvalStatus === 'approved' ? '수정' : '검토'}</button>{isAdmin && assignable && <button className="secondary-button small" onClick={() => openSingleAssignment(member)}>{member.managerId ? '관리 담당 변경' : '중간관리자 배정'}</button>}</div></td></tr>})}</tbody></table></div>
        <div className="mobile-member-list">{visible.map((member) => { const memberPrices = getProgramPriceMap(member); const assignable = canAssignManager(member); return <article key={member.id}>{isAdmin && assignable && <label className="mobile-member-select"><input type="checkbox" checked={checkedMemberIds.has(member.id)} onChange={() => toggleMemberChecked(member)} /><span>일괄 배정 선택</span></label>}<div><strong>{member.username}</strong><ApprovalBadge status={member.approvalStatus} /></div><p>{isAdmin ? `관리 담당 ${managementLabel(member)} · ` : ''}{memberTypeLabel(member)}</p>{isAdmin && member.sponsorId && <p>추천/정산 {member.sponsorUsername || '기존 상위회원'} 유지</p>}{!member.isOperationsManager && <p>스파크 {memberPrices.spark > 0 ? formatWon(memberPrices.spark) : '-'} · 스파크+ {memberPrices.spark_plus > 0 ? formatWon(memberPrices.spark_plus) : '-'} · 스파크S {memberPrices.spark_s > 0 ? formatWon(memberPrices.spark_s) : '-'} · 스파크S+ {memberPrices.spark_s_plus > 0 ? formatWon(memberPrices.spark_s_plus) : '-'}</p>}{isAdmin && <p>전화번호 {formatPhoneNumber(member.phoneNumber)}</p>}{isAdmin && <p>그룹 {member.groupName || '-'}</p>}<div className="mobile-member-actions"><button className="secondary-button small" onClick={() => open(member)}>회원 검토</button>{isAdmin && assignable && <button className="secondary-button small" onClick={() => openSingleAssignment(member)}>{member.managerId ? '관리 담당 변경' : '중간관리자 배정'}</button>}</div></article>})}</div>

        {visible.length === 0 && <div className="empty-state fill-empty-state">조건에 맞는 회원이 없습니다.</div>}

        {selected && <div className="member-editor">
          <div className="member-editor-title"><div><span>선택 회원</span><strong>{selected.username}</strong></div><button className="icon-button" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="member-editor-grid">
            {isAdmin && !forcedAgency ? <label><span>회원 유형</span><select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}><option value="agency">대행사</option><option value="distributor">총판</option><option value="manager">중간관리자</option></select></label> : <label><span>회원 유형</span><input value="대행사" disabled /></label>}
            {!selectedManagerAccount && <>
              <label><span>스파크 단가</span><div className="input-unit"><input type="number" min={minFor('spark')} step="1" value={prices.spark || ''} onChange={(event) => setPrices((current) => ({ ...current, spark: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
              <label><span>스파크 + 단가</span><div className="input-unit"><input type="number" min={minFor('spark_plus')} step="1" value={prices.spark_plus || ''} onChange={(event) => setPrices((current) => ({ ...current, spark_plus: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
              <label><span>스파크S 단가</span><div className="input-unit"><input type="number" min={minFor('spark_s')} step="1" value={prices.spark_s || ''} onChange={(event) => setPrices((current) => ({ ...current, spark_s: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
              <label><span>스파크S+ 단가</span><div className="input-unit"><input type="number" min={minFor('spark_s_plus')} step="1" value={prices.spark_s_plus || ''} onChange={(event) => setPrices((current) => ({ ...current, spark_s_plus: Number(event.target.value) || 0 }))} /><span>원</span></div></label>
            </>}
            {selectedManagerAccount && <div className="member-static-info manager-account-info"><span>중간관리자 권한</span><strong>하위 대행사 승인 · 단가 지정</strong><small>작업 접수·정산·운영기록 권한은 부여되지 않습니다.</small></div>}
            {isAdmin && <div className="member-static-info"><span>가입 전화번호</span><strong>{formatPhoneNumber(selected.phoneNumber)}</strong><small>회원가입 시 입력한 연락처입니다.</small></div>}
            {isAdmin && <label><span>관리자용 그룹명</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="업체 식별용 그룹명" /></label>}
            {isAdmin && <div className="member-static-info"><span>연결 상태</span><strong>{managementLabel(selected)}</strong></div>}
          </div>
          {sponsorPending && <p className="inline-message">이 회원은 직접 추천 회원인 <strong>{selected.sponsorUsername}</strong> 계정에서 승인합니다.</p>}
          {adminManagedMember && <p className="inline-message">관리 담당은 <strong>{selected.managerUsername || '지정된 중간관리자'}</strong>입니다. {selected.sponsorId ? `추천·정산 관계는 ${selected.sponsorUsername || '기존 상위회원'} 계정으로 그대로 유지됩니다.` : '추천·정산 관계는 관리자 직속입니다.'}</p>}
          {isManager && <p className="inline-message">승인한 대행사의 입금 계좌와 정산은 관리자에게 직접 연결됩니다.</p>}
          {!isAdmin && !isManager && (!user.bank || !user.accountNumber || !user.accountHolder) && <p className="inline-message error">내 정보에서 입금 계좌를 먼저 등록해야 회원을 승인할 수 있습니다.</p>}
          {isAdmin && <div className="member-security-zone"><div><span>로그인 보안</span><strong>회원 비밀번호 재설정</strong><small>현재 비밀번호는 확인할 수 없습니다. 새 비밀번호를 직접 입력하거나 임시 비밀번호를 생성해 전달하세요.</small></div><button className="secondary-button" disabled={saving || passwordResetting} onClick={openPasswordReset}><Icon name="lock" />비밀번호 재설정</button></div>}
          {isAdmin && <div className="member-danger-zone"><div><span>계정 정리</span><strong>미사용 계정 영구 삭제</strong><small>작업·정산·하위 회원 등 운영 이력이 없는 계정만 삭제할 수 있습니다. 삭제 후 같은 아이디로 다시 가입할 수 있습니다.</small></div><button className="secondary-button danger-outline" disabled={saving || deleting} onClick={() => void openDelete()}>계정 영구 삭제</button></div>}
          {error && <p className="inline-message error">{error}</p>}
          <div className="member-editor-actions"><button className="secondary-button danger-outline" disabled={saving || sponsorPending} onClick={() => void save('rejected')}>반려</button><button className="primary-button" disabled={saving || sponsorPending || (!isAdmin && !isManager && (!user.bank || !user.accountNumber || !user.accountHolder))} onClick={() => void save('approved')}>{saving ? '저장 중...' : selected.approvalStatus === 'approved' ? '수정 저장' : '승인'}</button></div>
        </div>}
      </section>

      {assignmentOpen && <Modal
        title={assignmentMode === 'bulk' ? '중간관리자 일괄 배정' : '관리 담당 변경'}
        description={assignmentMode === 'bulk' ? `${assignmentMembers.length}개 회원의 관리 담당을 한 번에 변경합니다.` : `${assignmentMembers[0]?.username || '선택 회원'}의 관리 담당을 변경합니다.`}
        onClose={closeAssignment}
        footer={assignmentResult
          ? <button className="primary-button" onClick={closeAssignment}>확인</button>
          : <><button className="secondary-button" disabled={assignmentSaving} onClick={closeAssignment}>취소</button><button className="primary-button" disabled={assignmentSaving} onClick={() => void submitAssignment()}>{assignmentSaving ? '변경 중...' : assignmentMode === 'bulk' ? `${assignmentMembers.length}명 적용` : '변경 적용'}</button></>}
      >
        <div className="member-manager-assignment-dialog">
          {!assignmentResult ? <>
            <div className="manager-assignment-target">
              <span>대상 회원</span>
              <strong>{assignmentMode === 'single' ? assignmentMembers[0]?.username : `${assignmentMembers.length}명 선택`}</strong>
              <small>{assignmentMode === 'single' ? `현재 관리 담당: ${assignmentMembers[0] ? managementLabel(assignmentMembers[0]) : '-'}` : assignmentMembers.slice(0, 5).map((member) => member.username).join(', ') + (assignmentMembers.length > 5 ? ` 외 ${assignmentMembers.length - 5}명` : '')}</small>
            </div>
            <label><span>변경할 관리 담당</span><select value={assignmentTarget} onChange={(event) => { setAssignmentTarget(event.target.value); setAssignmentError('') }}><option value="">선택해 주세요</option><option value="direct">관리자 직속으로 해제</option>{managerCandidates.map((manager) => <option key={manager.id} value={manager.id}>{manager.username}</option>)}</select></label>
            {managerCandidates.length === 0 && <p className="manager-assignment-note">현재 승인 완료된 활성 중간관리자가 없습니다. 관리자 직속 해제만 사용할 수 있습니다.</p>}
            {assignmentHasSponsor && <div className="manager-assignment-warning"><strong>기존 추천/정산 관계가 있는 회원이 포함되어 있습니다.</strong><p>중간관리자 배정은 관리 권한만 변경하며 기존 추천·정산 관계는 변경하지 않습니다.</p></div>}
            <label><span>변경 사유 <em>필수</em></span><textarea value={assignmentReason} maxLength={300} rows={4} placeholder="예: 기존 회원 관리 이관" onChange={(event) => { setAssignmentReason(event.target.value); setAssignmentError('') }} /></label>
            <p className="manager-assignment-note">대행사·총판만 배정할 수 있으며, admin·중간관리자 계정과 비활성·반려 계정은 제외됩니다. 변경 내용은 회원별 감사기록에 남습니다.</p>
          </> : <>
            <div className={`manager-assignment-result-summary ${assignmentResult.failedCount > 0 ? 'partial' : 'success'}`}><strong>{assignmentResult.succeededCount}명 변경 완료</strong><span>{assignmentResult.failedCount > 0 ? `${assignmentResult.failedCount}명 실패` : '모든 회원의 관리 담당이 변경되었습니다.'}</span></div>
            <div className="manager-assignment-result-list">{assignmentResult.items.map((item) => <div key={item.memberId || item.username} className={item.status}><strong>{item.username || item.memberId || '알 수 없는 회원'}</strong><span>{item.status === 'succeeded' ? '완료' : '실패'}</span><small>{item.message}</small></div>)}</div>
          </>}
          {assignmentError && <p className="inline-message error">{assignmentError}</p>}
        </div>
      </Modal>}

      {deleteOpen && selected && <Modal
        title="계정 영구 삭제"
        description={`${selected.username} 계정을 삭제하기 전에 운영 이력을 확인합니다.`}
        onClose={() => { if (!deleting) setDeleteOpen(false) }}
        footer={<>
          <button className="secondary-button" disabled={deleting} onClick={() => setDeleteOpen(false)}>취소</button>
          <button className="primary-button delete-confirm-button" disabled={deleteChecking || deleting || !deleteCheck?.canDelete} onClick={() => void confirmDelete()}>{deleting ? '삭제 중...' : '영구 삭제'}</button>
        </>}
      >
        <div className="member-delete-dialog">
          {deleteChecking && <div className="delete-checking"><strong>삭제 가능 여부 확인 중</strong><p>작업, 정산, 하위 회원과 운영 이력을 확인하고 있습니다.</p></div>}
          {!deleteChecking && deleteCheck?.canDelete && <>
            <div className="delete-ready-card"><span>삭제 가능</span><strong>{deleteCheck.username}</strong><p>이 계정에는 보존해야 할 작업·정산·하위 회원 이력이 없습니다.</p></div>
            <div className="delete-warning-box"><strong>삭제 후 복구할 수 없습니다.</strong><p>로그인 계정과 회원정보가 영구 삭제되며, 이후 동일한 아이디로 새 회원가입이 가능합니다.</p></div>
          </>}
          {!deleteChecking && deleteCheck && !deleteCheck.canDelete && <>
            <div className="delete-blocked-card"><span>삭제 불가</span><strong>{deleteCheck.username}</strong><p>운영 기록 보존을 위해 아래 이력이 있는 계정은 영구 삭제하지 않습니다.</p></div>
            <div className="delete-reason-list">{deleteCheck.reasons.map((reason) => <div key={reason}><span>보존 필요</span><strong>{reason}</strong></div>)}</div>
          </>}
          {deleteError && <p className="inline-message error">{deleteError}</p>}
        </div>
      </Modal>}

      {passwordResetOpen && selected && <Modal
        title="비밀번호 재설정"
        description={`${selected.username} 계정의 기존 비밀번호는 조회하지 않고 새 비밀번호로 교체합니다.`}
        onClose={closePasswordReset}
        footer={passwordResetComplete
          ? <button className="primary-button" onClick={closePasswordReset}>확인</button>
          : <><button className="secondary-button" disabled={passwordResetting} onClick={closePasswordReset}>취소</button><button className="primary-button" disabled={passwordResetting} onClick={() => void resetPassword()}>{passwordResetting ? '재설정 중...' : '비밀번호 변경'}</button></>}
      >
        <div className="member-password-reset-dialog">
          {!passwordResetComplete ? <>
            <div className="password-reset-target"><span>대상 계정</span><strong>{selected.username}</strong></div>
            <button className="secondary-button temporary-password-button" type="button" onClick={makeTemporaryPassword}><Icon name="refresh" />임시 비밀번호 생성</button>
            <label><span>새 비밀번호</span><div className="password-reset-input"><input type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordResetError(''); setPasswordCopied(false) }} /><button type="button" onClick={() => setPasswordVisible((current) => !current)}>{passwordVisible ? '숨기기' : '보기'}</button></div></label>
            <label><span>새 비밀번호 확인</span><input type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" value={newPasswordConfirm} onChange={(event) => { setNewPasswordConfirm(event.target.value); setPasswordResetError('') }} /></label>
            <p className="password-reset-note">비밀번호는 4~72자로 입력합니다. 변경 작업만 감사기록에 남고 비밀번호 원문은 저장되지 않습니다.</p>
          </> : <>
            <div className="password-reset-success"><Icon name="check" size={24} /><div><strong>비밀번호가 변경되었습니다.</strong><p>아래 비밀번호는 이 창을 닫으면 다시 확인할 수 없습니다.</p></div></div>
            <div className="reset-password-result"><code>{newPassword}</code><button className="secondary-button small" onClick={() => void copyResetPassword()}><Icon name="copy" />{passwordCopied ? '복사됨' : '복사'}</button></div>
          </>}
          {passwordResetError && <p className="inline-message error">{passwordResetError}</p>}
        </div>
      </Modal>}
    </div>
  )
}
