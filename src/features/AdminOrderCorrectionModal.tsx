import { useState } from 'react'
import { Modal } from '../components/Modal'
import type { Order } from '../domain/types'
import type { CorrectionDraft, CorrectionPreview } from '../lib/orderCorrection'
import { formatWon } from '../lib/money'

export function AdminOrderCorrectionModal({ order, onPreview, onApply, onClose }: {
  order: Order
  onPreview: (order: Order, draft: CorrectionDraft, reason: string) => Promise<CorrectionPreview>
  onApply: (order: Order, draft: CorrectionDraft, reason: string) => Promise<Order>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CorrectionDraft>({ storeName: order.storeName, keyword: order.keyword, placeUrl: order.placeUrl, dailyShots: String(order.dailyShots), operationDays: String(order.operationDays), startDate: order.startDate, memo: order.memo })
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<CorrectionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fields = [['storeName', '상호명'], ['keyword', '대표 키워드'], ['placeUrl', '플레이스 URL'], ['dailyShots', '일일수량'], ['operationDays', '구동일수'], ['startDate', '시작일'], ['memo', '메모']] as const
  const canStart = ['입금대기', '입금완료'].includes(order.status) && !order.activatedAt
  const run = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (preview?.allowed) { await onApply(order, draft, reason); onClose() }
      else setPreview(await onPreview(order, draft, reason))
    } catch (e) { setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : '수정에 실패했습니다.'); setPreview(null) }
    finally { setBusy(false) }
  }
  return <Modal title="작업 수정" description={`${order.id} · 기존 단가 ${formatWon(order.pricePerShot)} 적용 · 프로그램 변경은 기존 프로그램 변경 메뉴를 이용하세요.`} className="order-correction-modal" onClose={() => { if (!busy) onClose() }} footer={<><button className="secondary-button" disabled={busy} onClick={onClose}>닫기</button><button className="primary-button" disabled={busy || reason.trim().length < 2 || Boolean(preview && !preview.allowed)} onClick={() => void run()}>{busy ? '확인 중…' : preview?.allowed ? '수정 적용' : '변경 영향 확인'}</button></>}>
    <div className="correction-columns"><strong>항목</strong><strong>변경 전</strong><strong>변경 후</strong></div>
    <fieldset disabled={busy} className="assignment-fields">
      {fields.map(([key, label]) => <label className="correction-columns" key={key}><span>{label}</span><span className="correction-before">{String(order[key]) || '-'}</span><input aria-label={`변경 후 ${label}`} type={key === 'startDate' ? 'date' : ['dailyShots', 'operationDays'].includes(key) ? 'number' : 'text'} min={['dailyShots', 'operationDays'].includes(key) ? 1 : undefined} step={1} maxLength={key === 'memo' ? 300 : ['storeName', 'keyword'].includes(key) ? 50 : undefined} disabled={key === 'startDate' && !canStart} value={draft[key]} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setPreview(null); setError('') }} /></label>)}
      <label className="field"><span>수정 사유 (2자 이상)</span><textarea value={reason} minLength={2} maxLength={500} onChange={(e) => { setReason(e.target.value); setPreview(null) }} /></label>
    </fieldset>
    <p className="muted">시작일은 아직 시작하지 않은 입금대기·입금완료 작업만 변경할 수 있습니다. 서버에서 상태와 최신 버전을 다시 확인합니다.</p>
    {preview && <div className={`correction-impact ${preview.allowed ? '' : 'form-error'}`} role="status"><strong>{preview.financialImpact === 'financial_neutral' ? '정산 영향 없음' : preview.financialImpact === 'increase' ? `추가 정산 +${formatWon(preview.differenceAmount)}` : `환불/차감 필요 -${formatWon(Math.abs(preview.differenceAmount))}${preview.allowed ? ' (입금 전 금액 재계산)' : ' (자동 수정 불가)'}`}</strong><p>총액 {formatWon(Number(preview.before.total_amount))} → {formatWon(Number(preview.after.total_amount))}</p><p>종료일 {String(preview.before.end_date)} → {String(preview.after.end_date)}</p><p>상태 {String(preview.before.status)} → {String(preview.after.status)}</p>{preview.blockReason && <p>{preview.blockReason}</p>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>
}
