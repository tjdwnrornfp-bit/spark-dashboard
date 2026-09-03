import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import type { Order, OrderDraft, ProgramType, User } from '../domain/types'
import { assignmentErrorMessage, assignmentErrors, emptyAssignmentDraft, isAssignmentTarget } from '../lib/adminAssignment'
import { earliestOrderStartDate } from '../lib/date'
import { calculateAmount, formatWon } from '../lib/money'
import { getUserProgramPrice, PROGRAMS } from '../lib/program'

export function AdminOrderAssignmentModal({ programType, onLoadMembers, onAssign, onClose }: {
  programType: ProgramType
  onLoadMembers: () => Promise<User[]>
  onAssign: (member: User, draft: OrderDraft, requestId: string) => Promise<Order>
  onClose: () => void
}) {
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState('')
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState('')
  const [draft, setDraft] = useState(() => emptyAssignmentDraft(programType))
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [uncertain, setUncertain] = useState(false)
  useEffect(() => { let active = true; onLoadMembers().then((value) => { if (active) setMembers(value) }).catch((error) => { if (active) setErrors([assignmentErrorMessage(error)]) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [onLoadMembers])
  const eligible = useMemo(() => members.filter(isAssignmentTarget), [members])
  const options = eligible.filter((member) => (!group || member.groupName === group) && member.username.includes(query.trim().toLowerCase()))
  const member = eligible.find((item) => item.id === targetId)
  const price = member ? getUserProgramPrice(member, draft.programType) : 0
  const amount = calculateAmount(Number(draft.dailyShots) || 0, Number(draft.operationDays) || 0, price)
  const edit = (field: keyof OrderDraft, value: string) => { setDraft((current) => ({ ...current, [field]: value })); setRequestId(crypto.randomUUID()); setErrors([]) }
  const submit = async () => {
    const nextErrors = assignmentErrors(member, draft)
    setErrors(nextErrors)
    if (!member || nextErrors.length || submitting) return
    setSubmitting(true)
    try {
      const order = await onAssign(member, draft, requestId)
      window.alert(`${member.username} 회원에게 ${order.id} 작업을 부여했습니다. 적용단가 ${formatWon(order.pricePerShot)}`)
      onClose()
    } catch (error) { setErrors([assignmentErrorMessage(error), '응답을 받지 못했다면 같은 내용으로 다시 확인할 수 있습니다. 이미 생성된 주문은 중복 생성되지 않습니다.']); setUncertain(true) }
    finally { setSubmitting(false) }
  }
  return <Modal title="작업 부여" description="선택한 회원의 승인 단가로 작업과 정산 내역을 생성합니다." className="admin-assignment-modal" onClose={() => { if (!submitting) onClose() }} footer={<><button className="secondary-button" disabled={submitting} onClick={onClose}>닫기</button><button className="primary-button" disabled={loading || submitting || !member || price <= 0} onClick={() => void submit()}>{submitting ? '부여 중…' : uncertain ? '동일 요청 결과 확인' : '작업 부여'}</button></>}>
    {loading && <p role="status">회원 정보를 불러오는 중입니다.</p>}
    <fieldset className="assignment-fields" disabled={loading || submitting || uncertain}>
      <div className="form-grid compact-form">
        <label className="field"><span>그룹명 필터</span><select value={group} onChange={(event) => { setGroup(event.target.value); setTargetId(''); setRequestId(crypto.randomUUID()) }}><option value="">전체 그룹</option>{[...new Set(eligible.map((item) => item.groupName).filter(Boolean))].sort().map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="field"><span>회원 아이디 검색</span><input value={query} onChange={(event) => { setQuery(event.target.value); setTargetId('') }} placeholder="회원 아이디 입력" /></label>
        <label className="field"><span>대상 회원 *</span><select value={targetId} onChange={(event) => { setTargetId(event.target.value); setRequestId(crypto.randomUUID()); setErrors([]) }}><option value="">회원을 선택해 주세요</option>{options.map((item) => <option key={item.id} value={item.id}>{item.username} · {item.groupName || '미지정 그룹'}</option>)}</select></label>
        <label className="field"><span>프로그램 *</span><select value={draft.programType} onChange={(event) => edit('programType', event.target.value)}>{PROGRAMS.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label>
        {member && <p className="assignment-member-info span-2">그룹: {member.groupName || '미지정'} · 유형: {member.role === 'agency' ? '대행사' : '총판'} · 관리담당: {member.managerUsername || '없음'} · 정산 상위: {member.sponsorUsername || '관리자 직결'}</p>}
        <label className="field"><span>상호명 *</span><input value={draft.storeName} maxLength={50} onChange={(event) => edit('storeName', event.target.value)} /></label>
        <label className="field"><span>대표 키워드 *</span><input value={draft.keyword} maxLength={50} onChange={(event) => edit('keyword', event.target.value)} /></label>
        <label className="field span-2"><span>플레이스 URL *</span><input value={draft.placeUrl} onChange={(event) => edit('placeUrl', event.target.value)} placeholder="https://m.place.naver.com/place/1234567890/home" /></label>
        <label className="field"><span>일일수량 *</span><input type="number" min="1" step="1" value={draft.dailyShots} onChange={(event) => edit('dailyShots', event.target.value)} /></label>
        <label className="field"><span>구동일수 *</span><input type="number" min="1" step="1" value={draft.operationDays} onChange={(event) => edit('operationDays', event.target.value)} /></label>
        <label className="field"><span>시작일 *</span><input type="date" min={earliestOrderStartDate()} value={draft.startDate} onChange={(event) => edit('startDate', event.target.value)} /></label>
        <label className="field span-2"><span>메모</span><textarea maxLength={300} value={draft.memo} onChange={(event) => edit('memo', event.target.value)} /></label>
      </div>
    </fieldset>
    <div className="assignment-amounts"><span>적용단가 <strong>{formatWon(price)}</strong></span><span>공급가 <strong>{formatWon(amount.supplyAmount)}</strong></span><span>부가세 <strong>{formatWon(amount.vatAmount)}</strong></span><span>총액 <strong>{formatWon(amount.totalAmount)}</strong></span></div>
    {member && price <= 0 && <p className="form-error">해당 회원의 프로그램 승인 단가가 설정되지 않았습니다.</p>}
    {errors.length > 0 && <div className="assignment-errors" role="alert">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
  </Modal>
}
