import { useEffect, useRef, useState } from 'react'
import { Modal } from '../components/Modal'
import { PROGRAMS, labelForProgram } from '../lib/program'
import { formatWon } from '../lib/money'
import { STATUS_ORDER } from '../lib/order'
import { applyLifecycle, lifecycleError, lifecycleRequest, LIFECYCLE_LABELS, previewLifecycle } from '../lib/orderLifecycle'
import type { LifecycleAction, LifecycleFilters, LifecycleItem, LifecycleRequest, LifecycleResult } from '../lib/orderLifecycle'

export type LifecycleModalConfig = { action: LifecycleAction; filters: LifecycleFilters; orderIds: string[] | null; integrated?: boolean }

export function AdminOrderLifecycleModal({ config, onClose, onFinished }: { config: LifecycleModalConfig; onClose: () => void; onFinished: () => Promise<void> }) {
  const [action, setAction] = useState(config.action)
  const [filters, setFilters] = useState(config.filters)
  const [items, setItems] = useState<LifecycleItem[] | null>(null)
  const [reason, setReason] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState<LifecycleRequest | null>(null)
  const [result, setResult] = useState<LifecycleResult | null>(null)
  const [page, setPage] = useState(1)
  const eligible = items?.filter(item => item.eligible) ?? []
  const waiting = eligible.reduce((sum, item) => sum + item.waitingAmount, 0)
  const running = eligible.filter(item => item.status === '구동중').length
  const locked = busy || request !== null
  const label = LIFECYCLE_LABELS[action]
  const resultMap = new Map(result?.results.map(row => [row.id, row]))
  const successes = result?.results.filter(row => row.success).length ?? 0
  const failures = result?.results.filter(row => !row.success).length ?? 0

  useEffect(() => {
    if (!request || result) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [request, result])

  const preview = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setItems(null); setAccepted(false); setConfirmation(''); setPage(1)
    try { setItems(await previewLifecycle(action, filters, config.orderIds)) }
    catch (err) { setError(lifecycleError(err)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const execute = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      // Freeze the exact request on the first click. A lost response is retried
      // with the same id, including after deletion, rather than reapplying it.
      const next = request ?? lifecycleRequest(action, items ?? [], reason, action === 'delete' ? confirmation : accepted ? '확인' : '')
      setRequest(next)
      const response = await applyLifecycle(next)
      setResult(response)
      try { await onFinished() } catch { setError('처리는 완료됐지만 목록을 갱신하지 못했습니다. 창을 닫은 뒤 새로고침해 주세요.') }
    } catch (err) { setError(lifecycleError(err)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const resetPreview = () => { setItems(null); setAccepted(false); setConfirmation(''); setError(''); setPage(1) }
  const close = () => { if (!busy) onClose() }
  return <Modal title={config.integrated ? '통합 작업 정리' : `작업 일괄 ${label}`} description="대상을 확인한 뒤 처리합니다. 한 번에 최대 500건까지 가능합니다." className="lifecycle-modal" onClose={close}
    footer={<><button className="secondary-button" disabled={busy} onClick={close}>{result ? '닫기' : request ? '닫기' : '취소'}</button>{!result && <button className={action === 'delete' ? 'danger-button' : 'primary-button'} disabled={busy || (!request && (!eligible.length || reason.trim().length < 2 || !accepted || (action === 'delete' && confirmation !== '영구 삭제')))} onClick={() => void execute()}>{busy ? '확인 중…' : request ? '같은 요청으로 결과 다시 확인' : `${eligible.length}건 ${label}`}</button>}</> }>
    <div className="lifecycle-content">
      <fieldset disabled={locked} className="lifecycle-filters">
        <label>처리 방식<select value={action} onChange={event => { setAction(event.target.value as LifecycleAction); resetPreview() }}>
          {(config.integrated ? ['archive', 'restore', 'delete'] as const : config.action === 'archive' ? ['archive'] as const : ['restore', 'delete'] as const).map(value => <option key={value} value={value}>{LIFECYCLE_LABELS[value]}</option>)}
        </select></label>
        {config.integrated && <>
          <div className="lifecycle-programs" role="group" aria-label="프로그램">{PROGRAMS.map(program => <label key={program.type}><input type="checkbox" checked={filters.programs.includes(program.type)} onChange={event => { setFilters({ ...filters, programs: event.target.checked ? [...filters.programs, program.type] : filters.programs.filter(p => p !== program.type) }); resetPreview() }} />{program.label}</label>)}</div>
          <label>상태<select value={filters.status ?? ''} onChange={event => { setFilters({ ...filters, status: event.target.value as LifecycleFilters['status'] }); resetPreview() }}><option value="">전체</option>{STATUS_ORDER.map(status => <option key={status}>{status}</option>)}</select></label>
          <label>검색<input value={filters.query ?? ''} placeholder="작업번호, 상호명, 등록자, 그룹명" onChange={event => { setFilters({ ...filters, query: event.target.value }); resetPreview() }} /></label>
          <label>접수일 시작<input type="date" value={filters.from ?? ''} onChange={event => { setFilters({ ...filters, from: event.target.value }); resetPreview() }} /></label>
          <label>접수일 종료<input type="date" value={filters.to ?? ''} onChange={event => { setFilters({ ...filters, to: event.target.value }); resetPreview() }} /></label>
        </>}
        <p className="muted lifecycle-full">{config.orderIds ? `직접 선택한 ${config.orderIds.length}건` : '검색 조건에 해당하는 모든 페이지의 작업'} · {action === 'archive' ? '운영 작업' : '보관함'}</p>
        {!config.integrated && <p className="muted lifecycle-full">{filters.programs.map(labelForProgram).join(', ')} · {filters.status || '모든 상태'} · {filters.from || '처음'} ~ {filters.to || '현재'}{filters.query ? ` · 검색: ${filters.query}` : ''}</p>}
        <button className="secondary-button lifecycle-full" disabled={!filters.programs.length} onClick={() => void preview()}>대상 확인</button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {request && !result && !busy && <p className="lifecycle-warning">응답을 받지 못해 일부 또는 전체 작업이 처리되었을 수 있습니다. 위 조건은 고정되어 있습니다. ‘같은 요청으로 결과 다시 확인’을 누르면 중복 처리 없이 결과를 확인합니다.</p>}
      {items && <>
        <div className="lifecycle-summary" aria-live="polite"><strong>전체 {items.length}건 · 처리 가능 {eligible.length}건 · 제외 {items.length - eligible.length}건</strong><span>처리 가능 대상: 구동중 {running}건 · 미정산 {formatWon(waiting)}</span><small>미정산 금액은 등록자가 지급할 미확인 금액입니다. 각 단계 금액을 중복 합산하지 않습니다.</small></div>
        {result && <p className="lifecycle-result" role="status">{label} 완료 {successes}건 · 실패 {failures}건 · 사전 제외 {items.length - eligible.length}건. 실패·제외 사유는 아래 목록에서 확인하세요.</p>}
        <div className="lifecycle-list">{items.slice((page - 1) * 50, page * 50).map(item => {
          const outcome = resultMap.get(item.id)
          return <article key={item.id}><div><strong>{item.orderNumber} · {item.storeName}</strong><small>{labelForProgram(item.programType)} · {item.status} · 미정산 {formatWon(item.waitingAmount)}</small></div><span className={!item.eligible || outcome?.success === false ? 'form-error' : ''}>{outcome ? outcome.success ? `${label} 완료` : outcome.reason : item.eligible ? '처리 가능' : item.reason}</span></article>
        })}{!items.length && <p>해당하는 작업이 없습니다.</p>}</div>
        {items.length > 50 && <nav className="lifecycle-pagination" aria-label="처리 대상 페이지"><button className="secondary-button small" disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button><span>{page} / {Math.ceil(items.length / 50)}</span><button className="secondary-button small" disabled={page * 50 >= items.length} onClick={() => setPage(page + 1)}>다음</button></nav>}
        {!result && <fieldset disabled={locked} className="lifecycle-confirm">
          <label>공통 처리 사유<textarea maxLength={500} value={reason} placeholder={action === 'delete' ? '오접수·테스트 작업인 이유를 입력해 주세요 (2자 이상)' : '정리 사유를 입력해 주세요 (2자 이상)'} onChange={event => setReason(event.target.value)} /></label>
          <p className="lifecycle-warning">{action === 'archive' ? '보관하면 운영 목록과 정산 대상에서 제외됩니다. 구동·입금 이력은 보존되며, 취소나 환불 처리가 되지는 않습니다.' : action === 'restore' ? '복원하면 기존 상태 그대로 운영 목록과 정산 대상에 다시 포함됩니다.' : '입금확인·정산·구동·수정·프로그램 변경·관리자 부여 이력이 없는 보관 작업만 삭제합니다. 오접수·테스트 작업인지 확인해 주세요. 삭제 후 복원할 수 없으며, 삭제 사유와 처리자 기록은 보존됩니다.'}</p>
          <label className="lifecycle-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />대상 {eligible.length}건과 처리 영향을 확인했습니다.</label>
          {action === 'delete' && <label>확인을 위해 ‘영구 삭제’를 입력해 주세요<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>}
        </fieldset>}
      </>}
    </div>
  </Modal>
}
