import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import type { BulkProgramTransferPreview, BulkProgramTransferResult, Order, ProgramType } from '../domain/types'
import { formatWon } from '../lib/money'
import { labelForProgram, PROGRAMS } from '../lib/program'

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '일괄 프로그램 변경 정보를 불러오지 못했습니다.'
}

function statusLabel(status: BulkProgramTransferResult['items'][number]['status']): string {
  if (status === 'succeeded') return '변경 완료'
  if (status === 'excluded') return '자동 제외'
  return '변경 실패'
}

export function AdminBulkProgramTransferModal({ orders, onClose, onPreview, onTransfer, onFinished }: {
  orders: Order[]
  onClose: () => void
  onPreview: (orders: Order[], targetProgram: ProgramType) => Promise<BulkProgramTransferPreview>
  onTransfer: (orders: Order[], targetProgram: ProgramType, reason: string) => Promise<BulkProgramTransferResult>
  onFinished: (result: BulkProgramTransferResult) => void
}) {
  const firstDifferentTarget = useMemo(
    () => PROGRAMS.find((program) => program.type !== orders[0]?.programType)?.type ?? 'spark',
    [orders],
  )
  const [targetProgram, setTargetProgram] = useState<ProgramType>(firstDifferentTarget)
  const [preview, setPreview] = useState<BulkProgramTransferPreview | null>(null)
  const [result, setResult] = useState<BulkProgramTransferResult | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setPreview(null)
    setResult(null)
    void onPreview(orders, targetProgram)
      .then((nextPreview) => { if (active) setPreview(nextPreview) })
      .catch((nextError) => { if (active) setError(errorMessage(nextError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onPreview, orders, targetProgram])

  const submit = async () => {
    if (!preview || preview.readyCount === 0 || reason.trim().length < 2 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const nextResult = await onTransfer(orders, targetProgram, reason.trim())
      setResult(nextResult)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setSubmitting(false)
    }
  }

  const blockedItems = preview?.items.filter((item) => item.status === 'blocked') ?? []
  const excludedItems = preview?.items.filter((item) => item.status === 'excluded') ?? []
  const closeModal = () => {
    if (result) onFinished(result)
    onClose()
  }

  return <Modal
    title={result ? '일괄 프로그램 변경 결과' : '일괄 프로그램 변경'}
    description={result ? '주문별 결과를 확인해 주세요. 실패한 작업은 변경 전 상태로 유지됩니다.' : '선택 작업을 서버에서 주문별로 재검증한 뒤 안전하게 변경합니다.'}
    className="bulk-program-transfer-modal"
    onClose={closeModal}
    footer={result
      ? <button className="primary-button" onClick={closeModal}>확인</button>
      : <>
        <button className="secondary-button" disabled={submitting} onClick={onClose}>취소</button>
        <button className="primary-button" disabled={loading || submitting || !preview || preview.readyCount === 0 || reason.trim().length < 2} onClick={() => void submit()}>
          {submitting ? '주문별 변경 중...' : `${preview?.readyCount ?? 0}건 프로그램 변경`}
        </button>
      </>}
  >
    {!result && <>
      <fieldset className="bulk-transfer-targets" disabled={submitting}>
        <legend>변경 후 프로그램</legend>
        {PROGRAMS.map((program) => <label key={program.type} className={targetProgram === program.type ? 'active' : ''}>
          <input type="radio" name="bulk-transfer-target" value={program.type} checked={targetProgram === program.type} onChange={() => setTargetProgram(program.type)} />
          <span><strong>{program.label}</strong><small>선택 작업을 {program.label}(으)로 변경</small></span>
        </label>)}
      </fieldset>

      {loading && <div className="transfer-loading">등록자별 대상 단가와 정산 상태를 주문별로 확인하고 있습니다.</div>}
      {error && <div className="transfer-blocked"><strong>확인 필요</strong><p>{error}</p></div>}

      {preview && <>
        <div className="bulk-transfer-summary">
          <div><span>선택 작업</span><strong>{preview.selectedCount.toLocaleString('ko-KR')}건</strong><small>변경 가능 {preview.readyCount.toLocaleString('ko-KR')}건</small></div>
          <div><span>현재 프로그램</span><strong>{preview.programCounts.spark.toLocaleString('ko-KR')} / {preview.programCounts.spark_plus.toLocaleString('ko-KR')} / {preview.programCounts.spark_s.toLocaleString('ko-KR')}</strong><small>스파크 / 스파크+ / 스파크s</small></div>
          <div><span>변경 후 프로그램</span><strong>{labelForProgram(preview.targetProgram)}</strong><small>등록자별 현재 승인 단가 적용</small></div>
          <div className="positive"><span>예상 추가금 총액</span><strong>+{formatWon(preview.expectedAdditionalAmount)}</strong><small>변경 가능한 주문의 양수 차액 합계</small></div>
          <div className="negative"><span>예상 차감 총액</span><strong>-{formatWon(preview.expectedDeductionAmount)}</strong><small>미입금 주문 중 자동 재구성 가능한 차감</small></div>
          <div><span>자동 제외 / 변경 불가</span><strong>{preview.excludedCount.toLocaleString('ko-KR')} / {preview.blockedCount.toLocaleString('ko-KR')}건</strong><small>동일 프로그램은 제외, 실패 예상 건은 원상태 유지</small></div>
        </div>

        {(blockedItems.length > 0 || excludedItems.length > 0) && <div className="bulk-transfer-issues">
          <div className="bulk-transfer-issue-header"><strong>제외·변경 불가 사유</strong><span>자동 제외 {excludedItems.length}건 · 변경 불가 {blockedItems.length}건</span></div>
          <div className="bulk-transfer-issue-list">
            {[...blockedItems, ...excludedItems].slice(0, 30).map((item) => <div key={`${item.orderDbId}-${item.status}`} className={item.status}>
              <span>{item.status === 'blocked' ? '변경 불가' : '자동 제외'}</span>
              <strong>{item.orderNumber || '알 수 없는 작업'} · {item.storeName || '-'}</strong>
              <small>{item.blockedReason}</small>
            </div>)}
            {blockedItems.length + excludedItems.length > 30 && <p>외 {(blockedItems.length + excludedItems.length - 30).toLocaleString('ko-KR')}건</p>}
          </div>
        </div>}

        <div className="transfer-impact">
          <strong>주문별 안전 처리</strong>
          <p>미입금은 정산 단계를 재생성하고, 부분·완료 정산은 확인 이력을 보존한 채 차액 단계만 만듭니다. 환불·과납이 필요한 주문과 동시 수정된 주문은 해당 주문만 실패 처리합니다.</p>
        </div>

        <label className="field transfer-reason"><span>공통 변경 사유 <b>*</b></span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="업체 요청 내용, 추가 결제 협의 등 모든 변경 감사로그에 남길 사유를 입력해 주세요." /><small>{reason.trim().length < 2 ? '2자 이상 입력해야 실행할 수 있습니다.' : `${reason.length}/500 · 모든 성공 주문에 동일하게 기록됩니다.`}</small></label>
      </>}
    </>}

    {result && <>
      <div className="bulk-transfer-result-summary">
        <div className="succeeded"><span>변경 완료</span><strong>{result.succeededCount.toLocaleString('ko-KR')}건</strong></div>
        <div className="failed"><span>변경 실패</span><strong>{result.failedCount.toLocaleString('ko-KR')}건</strong></div>
        <div><span>자동 제외</span><strong>{result.excludedCount.toLocaleString('ko-KR')}건</strong></div>
      </div>
      <div className="bulk-transfer-result-list">
        {result.items.map((item) => <div key={`${item.orderDbId}-${item.status}`} className={item.status}>
          <span>{statusLabel(item.status)}</span>
          <strong>{item.orderNumber || '알 수 없는 작업'} · {item.storeName || '-'}</strong>
          <small>{item.message || (item.status === 'succeeded' ? `${labelForProgram(result.targetProgram)} 변경 완료` : '-')}</small>
        </div>)}
      </div>
    </>}
  </Modal>
}
