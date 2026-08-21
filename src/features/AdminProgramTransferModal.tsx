import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import type { Order, ProgramTransferPreview, ProgramType } from '../domain/types'
import { formatWon } from '../lib/money'
import { labelForProgram, PROGRAMS, unitLabelForProgram, unitPriceLabelForProgram } from '../lib/program'

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '프로그램 변경 정보를 불러오지 못했습니다.'
}

function signedWon(value: number): string {
  if (value === 0) return formatWon(0)
  return `${value > 0 ? '+' : '-'}${formatWon(Math.abs(value))}`
}

export function AdminProgramTransferModal({ order, onClose, onPreview, onTransfer }: {
  order: Order
  onClose: () => void
  onPreview: (order: Order, targetProgram: ProgramType) => Promise<ProgramTransferPreview>
  onTransfer: (order: Order, targetProgram: ProgramType, reason: string) => Promise<void>
}) {
  const targets = useMemo(() => PROGRAMS.filter((program) => program.type !== order.programType), [order.programType])
  const [targetProgram, setTargetProgram] = useState<ProgramType>(targets[0]?.type ?? 'spark')
  const [preview, setPreview] = useState<ProgramTransferPreview | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setPreview(null)
    void onPreview(order, targetProgram)
      .then((result) => { if (active) setPreview(result) })
      .catch((nextError) => { if (active) setError(errorMessage(nextError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onPreview, order, targetProgram])

  const submit = async () => {
    if (!preview?.canTransfer || submitting || reason.trim().length < 2) return
    setSubmitting(true)
    setError('')
    try {
      await onTransfer(order, targetProgram, reason.trim())
      onClose()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setSubmitting(false)
    }
  }

  const differenceLabel = preview && preview.difference > 0
    ? '추가 입금'
    : preview && preview.difference < 0
      ? preview.confirmedPaymentCount > 0 ? '차감/환불' : '결제금액 감소'
      : '차액 없음'

  return <Modal
    title="작업 프로그램 변경"
    description="서버에서 등록자의 현재 승인 단가와 정산 이력을 다시 확인한 뒤 반영합니다."
    className="program-transfer-modal"
    onClose={onClose}
    footer={<>
      <button className="secondary-button" disabled={submitting} onClick={onClose}>취소</button>
      <button className="primary-button" disabled={loading || submitting || !preview?.canTransfer || reason.trim().length < 2} onClick={() => void submit()}>
        {submitting ? '변경 중...' : '프로그램 변경 실행'}
      </button>
    </>}
  >
    <div className="program-transfer-selector">
      <label><span>기존 프로그램</span><strong>{labelForProgram(order.programType)}</strong></label>
      <label><span>변경 프로그램</span><select value={targetProgram} disabled={submitting} onChange={(event) => setTargetProgram(event.target.value as ProgramType)}>{targets.map((program) => <option key={program.type} value={program.type}>{program.label}</option>)}</select></label>
    </div>

    {loading && <div className="transfer-loading">현재 단가와 정산 상태를 확인하고 있습니다.</div>}
    {error && <div className="transfer-blocked"><strong>확인 필요</strong><p>{error}</p></div>}

    {preview && <>
      <div className="program-transfer-summary">
        <div><span>기존 단가</span><strong>{formatWon(preview.beforeUnitPrice)}</strong><small>{unitPriceLabelForProgram(preview.beforeProgram)}</small></div>
        <div><span>새 단가</span><strong>{formatWon(preview.afterUnitPrice)}</strong><small>{unitPriceLabelForProgram(preview.afterProgram)}</small></div>
        <div><span>기존 총액</span><strong>{formatWon(preview.beforeTotalAmount)}</strong><small>공급가 {formatWon(preview.beforeSupplyAmount)} · VAT {formatWon(preview.beforeVatAmount)}</small></div>
        <div><span>새 총액</span><strong>{formatWon(preview.afterTotalAmount)}</strong><small>공급가 {formatWon(preview.afterSupplyAmount)} · VAT {formatWon(preview.afterVatAmount)}</small></div>
        <div className={`transfer-difference ${preview.difference > 0 ? 'positive' : preview.difference < 0 ? 'negative' : ''}`}><span>{differenceLabel}</span><strong>{signedWon(preview.difference)}</strong><small>{unitLabelForProgram(preview.beforeProgram)} → {unitLabelForProgram(preview.afterProgram)} 단위로 변경</small></div>
        <div><span>정산 확인 이력</span><strong>{preview.confirmedPaymentCount.toLocaleString('ko-KR')}건</strong><small>현재 미확인 {preview.pendingPaymentCount.toLocaleString('ko-KR')}건</small></div>
      </div>

      <div className="transfer-impact">
        <strong>{preview.settlementMode === 'rebuild' ? '전체 정산 단계 재구성' : '확인 이력 보존 + 보정 정산'}</strong>
        <p>{preview.settlementImpact}</p>
        <p>상태: {preview.currentStatus} → {preview.afterStatus}{preview.keepsOperationRunning ? ' · 구동은 중단하지 않음' : ''}</p>
      </div>

      {!preview.canTransfer && <div className="transfer-blocked"><strong>자동 변경 차단</strong><p>{preview.blockedReason}</p></div>}

      <label className="field transfer-reason"><span>변경 사유 <b>*</b></span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="업체 요청 내용, 추가 결제 협의 등 변경 사유를 입력해 주세요." /><small>{reason.trim().length < 2 ? '2자 이상 입력해야 실행할 수 있습니다.' : `${reason.length}/500`}</small></label>
    </>}
  </Modal>
}
