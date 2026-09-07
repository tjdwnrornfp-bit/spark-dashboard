import { intakeWarning } from '../lib/orderCorrection'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../components/Modal'
import type { User } from '../domain/types'
import { assignmentErrorMessage, assignmentErrors, downloadAssignmentTemplate, readAssignmentWorkbook } from '../lib/adminAssignment'
import type { AdminAssignmentResult, AdminAssignmentRow } from '../lib/adminAssignment'
import { getUserProgramPrice } from '../lib/program'
import { formatWon } from '../lib/money'

export function AdminBulkOrderAssignmentModal({ onLoadMembers, onAssign, onClose }: {
  onLoadMembers: () => Promise<User[]>
  onAssign: (rows: AdminAssignmentRow[], requestId: string) => Promise<AdminAssignmentResult[]>
  onClose: () => void
}) {
  const [warningsAccepted, setWarningsAccepted] = useState(false)
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AdminAssignmentRow[]>([])
  const [results, setResults] = useState<AdminAssignmentResult[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [started, setStarted] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { let active = true; onLoadMembers().then((value) => { if (active) setMembers(value) }).catch((reason) => { if (active) setError(assignmentErrorMessage(reason)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [onLoadMembers])
  const memberMap = useMemo(() => new Map(members.map((member) => [member.username, member])), [members])
  const resultMap = new Map(results.map((result) => [result.rowNumber, result]))
  const preview = rows.map((row) => {
    const member = memberMap.get(row.targetUsername)
    return { row, member, errors: [...(row.parseError ? [row.parseError] : []), ...assignmentErrors(member, row.draft)] }
  })
  const valid = preview.filter((item) => !item.errors.length)
  const pending = valid.filter((item) => resultMap.get(item.row.rowNumber)?.status !== 'success')
  const upload = async (file?: File) => {
    if (!file) return
    try { const parsed = readAssignmentWorkbook(await file.arrayBuffer()); setWarningsAccepted(false); setRows(parsed); setResults([]); setError(''); setRequestId(crypto.randomUUID()); setStarted(false) }
    catch (reason) { setError(assignmentErrorMessage(reason)); setRows([]); setResults([]) }
  }
  const submit = async () => {
    if (submitting || !pending.length || (pending.some((item) => intakeWarning(item.row.draft)) && !warningsAccepted)) return
    setSubmitting(true); setStarted(true); setError('')
    try {
      // Bounded requests: completed rows remain visible if a later request loses its response.
      for (let offset = 0; offset < pending.length; offset += 50) {
        const next = await onAssign(pending.slice(offset, offset + 50).map((item) => item.row), requestId)
        setResults((current) => { const merged = new Map(current.map((item) => [item.rowNumber, item])); next.forEach((item) => merged.set(item.rowNumber, item)); return [...merged.values()] })
      }
    } catch (reason) { setError(`${assignmentErrorMessage(reason)} 동일 요청을 다시 실행하면 완료된 주문은 중복 생성되지 않습니다.`) }
    finally { setSubmitting(false) }
  }
  return <Modal title="엑셀 일괄 부여" description="관리자 전용 양식 · 최대 500건 · 정상 행만 실행하며 각 행의 결과를 확인할 수 있습니다." className="admin-assignment-modal assignment-bulk-modal" onClose={() => { if (!submitting) onClose() }} footer={<><button className="secondary-button" disabled={submitting} onClick={onClose}>닫기</button><button className="primary-button" disabled={loading || submitting || !pending.length || (pending.some((item) => intakeWarning(item.row.draft)) && !warningsAccepted)} onClick={() => void submit()}>{submitting ? '부여 중…' : `${started ? '미완료' : '정상'} ${pending.length}건 부여`}</button></>}>
    <div className="assignment-file-actions"><button className="secondary-button small" onClick={downloadAssignmentTemplate}>관리자 양식 다운로드</button><button className="primary-button small" disabled={loading || submitting || started} onClick={() => fileRef.current?.click()}>엑셀 선택</button><input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file) }} /></div>
    <p className="muted">프로그램: 스파크 / 스파크+ / 스파크S / 스파크S+ (s 소문자 허용). 시작일은 익일부터 지정하세요.</p>
    {loading && <p role="status">회원 정보를 불러오는 중입니다.</p>}
    {error && <p className="assignment-errors" role="alert">{error}</p>}
    {valid.some((item) => intakeWarning(item.row.draft)) && <div className="intake-warning"><p>확인 필요 경고 {valid.filter((item) => intakeWarning(item.row.draft)).length}건</p><label><input type="checkbox" disabled={submitting} checked={warningsAccepted} onChange={(e) => setWarningsAccepted(e.target.checked)} />경고 행의 수량·기간을 확인했으며 그대로 부여합니다.</label></div>}
    {rows.length > 0 && <><div className="assignment-counts" role="status"><strong>전체 {rows.length}건</strong><span>정상 {valid.length}건</span><span>오류 {rows.length - valid.length}건</span><span>성공 {results.filter((item) => item.status === 'success').length}건</span><span>실패 {results.filter((item) => item.status === 'failed').length}건</span></div>
      <div className="assignment-preview-scroll"><table className="simple-table"><thead><tr><th>행</th><th>등록자 / 현재 그룹</th><th>프로그램 / 단가</th><th>상호명 / 작업</th><th>검증 / 실행 결과</th></tr></thead><tbody>{preview.map(({ row, member, errors }) => { const result = resultMap.get(row.rowNumber); return <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.targetUsername || '-'}<small>{member?.groupName || '미지정 그룹'}</small></td><td>{row.programLabel}<small>{member && !row.parseError ? formatWon(getUserProgramPrice(member, row.draft.programType)) : '-'}</small></td><td>{row.draft.storeName}<small>{row.draft.keyword} · {row.draft.dailyShots} × {row.draft.operationDays}일</small><small>{row.draft.startDate}</small></td><td>{result?.status === 'success' ? <span className="assignment-success">성공 · {result.order?.id}</span> : result?.status === 'failed' ? <span className="form-error">실패: {result.message}</span> : errors.length ? <span className="form-error">{errors.join(' / ')}</span> : intakeWarning(row.draft) ? <span className="intake-warning">{row.rowNumber}행: {intakeWarning(row.draft)}</span> : '정상 · 실행 대기'}</td></tr> })}</tbody></table></div></>}
  </Modal>
}
