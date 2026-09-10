import { useState } from 'react'
import { Modal } from '../components/Modal'
import type { Order, OrderDraft, ProgramType } from '../domain/types'
import type { CorrectionPreview } from '../lib/orderCorrection'
import { intakeWarning } from '../lib/orderCorrection'
import { labelForProgram } from '../lib/program'
import { formatWon } from '../lib/money'

export function MemberOrderEditModal({ order, programOnly, onPreview, onApply, onClose }: {
  order: Order
  programOnly: boolean
  onPreview: (order: Order, draft: OrderDraft, reason: string) => Promise<CorrectionPreview>
  onApply: (order: Order, draft: OrderDraft, reason: string) => Promise<Order>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<OrderDraft>({ programType: order.programType, storeName: order.storeName, keyword: order.keyword, placeUrl: order.placeUrl, dailyShots: String(order.dailyShots), operationDays: String(order.operationDays), startDate: order.startDate, memo: order.memo })
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<CorrectionPreview | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const warning = intakeWarning(draft)
  const change = (key: keyof OrderDraft, value: string) => { setDraft({ ...draft, [key]: value }); setPreview(null); setAccepted(false); setError('') }
  const run = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (preview?.allowed) { await onApply(order, draft, reason); onClose() }
      else setPreview(await onPreview(order, draft, reason))
    } catch (e) { setPreview(null); setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : '수정하지 못했습니다.') }
    finally { setBusy(false) }
  }
  const fields = [['storeName', '상호명'], ['keyword', '대표키워드'], ['placeUrl', '플레이스 URL'], ['dailyShots', '일일수량'], ['operationDays', '구동일수'], ['startDate', '시작일'], ['memo', '메모']] as const
  return <Modal title={programOnly ? '프로그램 변경' : '내 작업 수정'} description="입금 확인 전 작업만 수정할 수 있습니다. 프로그램 유지 시 기존 단가, 프로그램 변경 시 대상 프로그램의 현재 승인 단가를 적용합니다." onClose={() => { if (!busy) onClose() }} footer={<><button className="secondary-button" disabled={busy} onClick={onClose}>취소</button><button className="primary-button" disabled={busy || reason.trim().length < 2 || Boolean(preview && !preview.allowed) || Boolean(preview && warning && !accepted)} onClick={() => void run()}>{busy ? '확인 중…' : preview?.allowed ? '수정 적용' : '변경 영향 확인'}</button></>}>
    <fieldset disabled={busy} className="assignment-fields">
      <label className="field"><span>프로그램</span><select value={draft.programType} onChange={(e) => change('programType', e.target.value)}>{(['spark', 'spark_plus', 'spark_s', 'spark_s_plus'] as ProgramType[]).map((p) => <option key={p} value={p}>{labelForProgram(p)}</option>)}</select></label>
      {!programOnly && fields.map(([key, label]) => <label className="field" key={key}><span>{label}</span><input value={draft[key]} type={key === 'startDate' ? 'date' : ['dailyShots', 'operationDays'].includes(key) ? 'number' : 'text'} min={1} step={1} maxLength={key === 'memo' ? 300 : ['storeName', 'keyword'].includes(key) ? 50 : undefined} onChange={(e) => change(key, e.target.value)} /></label>)}
      <label className="field"><span>수정 사유 (2자 이상)</span><textarea minLength={2} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null) }} /></label>
    </fieldset>
    {warning && <div className="intake-warning" role="alert"><p>{warning}</p><label><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />입력한 수량과 기간을 확인했습니다.</label></div>}
    {preview && <div className="correction-impact" role="status"><p>프로그램 {labelForProgram(order.programType)} → {labelForProgram(String(preview.after.program_type) as ProgramType)}</p><p>단가 {formatWon(Number(preview.before.price_per_shot))} → {formatWon(Number(preview.after.price_per_shot))}</p><p>총액 {formatWon(Number(preview.before.total_amount))} → {formatWon(Number(preview.after.total_amount))}</p><p>종료일 {String(preview.before.end_date)} → {String(preview.after.end_date)}</p>{preview.blockReason && <p className="form-error">{preview.blockReason}</p>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>
}
