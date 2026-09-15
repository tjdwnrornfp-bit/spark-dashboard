import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AgencyFolder, AgencyFoldersResult, AgencyFolderSort, ManagedOrderFilters, ManagedOrderRow, ManagedOrdersPageResult, ManagedOrdersPreset, Order, PaymentStep, User } from '../domain/types'
import { fetchAgencyFoldersV109, fetchAgencyOrdersV109, fetchAllAgencyOrdersV109, fetchAllManagedOrdersV108 } from '../lib/backend'
import { EMPTY_FILTERS, excelDateSuffix, filterLocalRows, localManagedRows, localPage } from '../lib/managedOrdersLocal'
import { selectRowRange } from '../lib/rowSelection'
import { downloadManagedOrdersExcel } from '../lib/managedOrdersExcel'
import { formatWon } from '../lib/money'
import { ManagedOrdersTable } from '../components/ManagedOrdersTable'
import { PageHeader } from './DashboardPage'

type Selection = Map<string, ManagedOrderRow>
type SetSelection = Dispatch<SetStateAction<Selection>>
const statuses = ['all', 'in_progress', '입금대기', '입금완료', '구동중', '정지', '만료'] as const
const statusLabel = (s: ManagedOrderFilters['orderStatus']) => s === 'all' ? '전체' : s === 'in_progress' ? '진행중(입금대기+입금완료)' : s
const errorMessage = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : '조회하지 못했습니다. 다시 시도해 주세요.'

function StatusFilters({ value, onChange }: { value: ManagedOrderFilters['orderStatus']; onChange: (s: ManagedOrderFilters['orderStatus']) => void }) {
  return <div className="managed-status-chips" aria-label="작업상태 빠른 필터">{statuses.map(s => <button key={s} className="secondary-button small" aria-pressed={value === s} onClick={() => onChange(s)}>{statusLabel(s)}</button>)}</div>
}
function OrderSort({ value, onChange }: { value: ManagedOrderFilters['sort']; onChange: (s: ManagedOrderFilters['sort']) => void }) {
  return <label>작업 정렬<select value={value} onChange={e => onChange(e.target.value as ManagedOrderFilters['sort'])}><option value="priority">업무 우선순위</option><option value="newest">최신 접수순</option><option value="oldest">오래된 접수순</option><option value="start_date">시작일 빠른순</option></select></label>
}
function Pagination({ page, totalPages, loading, onChange, label }: { page: number; totalPages: number; loading: boolean; onChange: (n: number) => void; label: string }) {
  return <nav className="managed-orders-pagination" aria-label={label}><button className="secondary-button small" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>이전</button><span>{page} / {totalPages} 페이지</span><button className="secondary-button small" disabled={loading || page >= totalPages} onClick={() => onChange(page + 1)}>다음</button></nav>
}

// Scoped to one folder: collapsing keeps its page/cache/anchor; each filter change resets the anchor.
function AgencyFolderPanel({ agency, open, toggle, globalFilters, selected, setSelected, serverMode, localRows }: {
  agency: AgencyFolder; open: boolean; toggle: () => void; globalFilters: ManagedOrderFilters;
  selected: Selection; setSelected: SetSelection; serverMode: boolean; localRows: ManagedOrderRow[];
}) {
  const [status, setStatus] = useState(globalFilters.orderStatus)
  const [sort, setSort] = useState(globalFilters.sort)
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<ManagedOrdersPageResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const anchor = useRef<string | null>(null)
  const actionVersion = useRef(0)
  const filters = useMemo(() => ({ ...globalFilters, agencyId: agency.agencyId, orderStatus: status, sort }), [globalFilters, agency.agencyId, status, sort])
  const cache = useRef<{ key: string; value: ManagedOrdersPageResult } | null>(null)
  const requestKey = JSON.stringify([filters, page, retry])
  useEffect(() => { actionVersion.current += 1; setBusy(false); return () => { actionVersion.current += 1 } }, [filters])
  useEffect(() => {
    if (!open) return
    anchor.current = null
    if (cache.current?.key === requestKey) { setResult(cache.current.value); setLoading(false); return }
    let active = true
    setLoading(true); setError(''); setResult(null)
    void (serverMode ? fetchAgencyOrdersV109(filters, page, 50) : Promise.resolve(localPage(localRows, filters, page))).then(next => {
      if (!active) return
      cache.current = { key: requestKey, value: next }
      setResult(next)
      if (next.page !== page) setPage(next.page)
      setSelected(current => { const updated = new Map(current); next.rows.forEach(row => { if (updated.has(row.orderId)) updated.set(row.orderId, row) }); return updated })
    }).catch(e => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, requestKey, filters, page, serverMode, localRows, setSelected])
  const rows = result?.rows ?? []
  const toggleRow = (row: ManagedOrderRow, shift = false) => {
    if (loading) return
    const previous = anchor.current
    setSelected(current => {
      const ids = selectRowRange(new Set(current.keys()), rows.map(r => r.orderId), previous, row.orderId, shift)
      const next = new Map(current)
      rows.forEach(r => { if (ids.has(r.orderId)) next.set(r.orderId, r); else next.delete(r.orderId) })
      return next
    })
    if (!shift || !previous || !rows.some(r => r.orderId === previous)) anchor.current = row.orderId
  }
  const togglePage = () => setSelected(current => {
    const all = rows.length > 0 && rows.every(r => current.has(r.orderId))
    const next = new Map(current)
    rows.forEach(r => { if (all) next.delete(r.orderId); else next.set(r.orderId, r) })
    return next
  })
  const agencyAction = async (action: 'select' | 'export') => {
    const version = ++actionVersion.current
    setBusy(true); setError('')
    try {
      const all = serverMode ? await fetchAllAgencyOrdersV109(filters) : filterLocalRows(localRows, filters)
      if (version !== actionVersion.current) return
      if (action === 'select') setSelected(current => { const next = new Map(current); all.forEach(r => next.set(r.orderId, r)); return next })
      else if (all.length) downloadManagedOrdersExcel(all, `관리작업_${agency.username}_${excelDateSuffix()}.xlsx`)
      else setError('현재 조건에 맞는 작업이 없습니다.')
    } catch (e) { if (version === actionVersion.current) setError(errorMessage(e)) }
    finally { if (version === actionVersion.current) setBusy(false) }
  }
  const selectedCount = [...selected.values()].filter(r => r.registrantId === agency.agencyId).length
  return <section className="panel agency-folder">
    <h2 className="agency-folder-title"><button className="agency-folder-toggle" aria-expanded={open} aria-controls={`folder-${agency.agencyId}`} onClick={toggle}>
      <span className="agency-folder-name"><span aria-hidden="true">{open ? '▾' : '▸'}</span><strong title={agency.username}>{agency.username}</strong>{selectedCount > 0 && <small>{selectedCount}개 선택</small>}</span>
      <span className="agency-folder-counts"><span>전체 <b>{agency.totalOrderCount}</b></span><span>진행중 <b>{agency.inProgressCount}</b></span><span>구동중 <b>{agency.runningCount}</b></span><span>만료 <b>{agency.expiredCount}</b></span><span>정지 <b>{agency.stoppedCount}</b></span></span>
      <span className="agency-folder-money"><span>정산대기 <b>{formatWon(agency.settlementWaitingAmount)}</b></span><span>정산완료 {formatWon(agency.settlementCompletedAmount)}</span></span>
      <small className="agency-folder-match">조건 일치 {agency.matchedOrderCount}건</small>
    </button></h2>
    <div id={`folder-${agency.agencyId}`} hidden={!open} className="agency-folder-body" aria-busy={loading}>
      <StatusFilters value={status} onChange={s => { setStatus(s); setPage(1) }} />
      <div className="agency-folder-actions"><OrderSort value={sort} onChange={s => { setSort(s); setPage(1) }} /><button className="secondary-button small" disabled={busy || loading} onClick={() => void agencyAction('select')}>이 대행사 전체 선택</button><button className="secondary-button small" disabled={busy || !selectedCount} onClick={() => setSelected(current => new Map([...current].filter(([, r]) => r.registrantId !== agency.agencyId)))}>이 대행사 선택 해제</button><button className="secondary-button small" disabled={busy || loading} onClick={() => void agencyAction('export')}>이 대행사 엑셀</button>{busy && <span role="status">전체 페이지 조회 중…</span>}</div>
      <p className="agency-folder-help">전체 선택·엑셀은 이 폴더의 현재 검색·필터 조건에 맞는 모든 페이지에 적용됩니다. Shift 선택은 이 폴더의 현재 페이지에 적용됩니다.</p>
      {error && <div className="server-error-banner" role="alert"><span>{error}</span><button onClick={() => { cache.current = null; setRetry(n => n + 1) }}>다시 불러오기</button></div>}
      {loading ? <p role="status">작업을 불러오는 중…</p> : !error && !rows.length ? <div className="empty-state">조건에 맞는 작업이 없습니다.</div> : <ManagedOrdersTable rows={rows} selected={selected} loading={loading} toggleRow={toggleRow} toggleCurrentPage={togglePage} />}
      <Pagination page={result?.page ?? page} totalPages={result?.totalPages ?? 1} loading={loading} onChange={setPage} label={`${agency.username} 작업 페이지`} />
    </div>
  </section>
}

function demoFolders(user: User, members: User[], rows: ManagedOrderRow[], steps: PaymentStep[], filters: ManagedOrderFilters, page: number, sort: AgencyFolderSort): AgencyFoldersResult {
  const matching = filterLocalRows(rows, filters)
  const query = filters.query.trim().toLocaleLowerCase('ko-KR')
  const hasOrderFilter = filters.programType !== 'all' || filters.orderStatus !== 'all' || filters.settlementStatus !== 'all' || filters.startDateFrom || filters.startDateTo
  const agencies: AgencyFolder[] = members.filter(m => m.managerId === user.id && (!filters.agencyId || m.id === filters.agencyId)).map(m => {
    const own = rows.filter(r => r.registrantId === m.id)
    let waiting = 0, completed = 0
    own.forEach(r => {
      const direct = steps.filter(s => (s.orderDbId === r.orderId || s.orderDbId === r.orderNumber) && s.payerId === m.id)
      if (!direct.length) waiting += r.totalAmount
      direct.forEach(s => { if (s.confirmedAt) completed += s.totalAmount; else waiting += s.totalAmount })
    })
    return { agencyId: m.id, username: m.username, totalOrderCount: own.length, matchedOrderCount: matching.filter(r => r.registrantId === m.id).length,
      inProgressCount: own.filter(r => ['입금대기', '입금완료'].includes(r.orderStatus)).length, runningCount: own.filter(r => r.orderStatus === '구동중').length,
      expiredCount: own.filter(r => r.orderStatus === '만료').length, stoppedCount: own.filter(r => r.orderStatus === '정지').length,
      settlementWaitingAmount: waiting, settlementCompletedAmount: completed, lastOrderAt: own.map(r => r.createdAt).sort().at(-1) ?? null }
  }).filter(a => a.matchedOrderCount > 0 || (!hasOrderFilter && (!query || a.username.toLocaleLowerCase('ko-KR').includes(query))))
  agencies.sort((a, b) => {
    if (sort === 'in_progress' && a.inProgressCount !== b.inProgressCount) return b.inProgressCount - a.inProgressCount
    if (['in_progress', 'settlement_waiting'].includes(sort) && a.settlementWaitingAmount !== b.settlementWaitingAmount) return b.settlementWaitingAmount - a.settlementWaitingAmount
    if (sort !== 'username') { const d = (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? ''); if (d) return d }
    return a.username.localeCompare(b.username, 'ko-KR') || a.agencyId.localeCompare(b.agencyId)
  })
  const totalPages = Math.max(1, Math.ceil(agencies.length / 20)), safePage = Math.min(page, totalPages)
  return { page: safePage, pageSize: 20, totalPages, agencyCount: agencies.length, agencies: agencies.slice((safePage - 1) * 20, safePage * 20) }
}

export function AgencyFoldersPage({ user, members, orders, paymentSteps, serverMode, refreshKey, initialFilters }: {
  user: User; members: User[]; orders: Order[]; paymentSteps: PaymentStep[]; serverMode: boolean; refreshKey: number; initialFilters?: ManagedOrdersPreset | null;
}) {
  const [filters, setFilters] = useState<ManagedOrderFilters>(() => ({ ...EMPTY_FILTERS, ...initialFilters, agencyId: initialFilters?.agencyId ?? '', settlementStatus: initialFilters?.settlementStatus ?? 'all' }))
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AgencyFolderSort>('in_progress')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<AgencyFoldersResult | null>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialFilters?.agencyId ? [initialFilters.agencyId] : []))
  const [selected, setSelected] = useState<Selection>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const exportVersion = useRef(0)
  const localRows = useMemo(() => serverMode ? [] : localManagedRows(user, members, orders, paymentSteps), [serverMode, user, members, orders, paymentSteps])
  // Realtime revisions clear old selections as well as folder caches, including reassigned agencies.
  useEffect(() => { setSelected(new Map()); exportVersion.current += 1; setExporting(false) }, [refreshKey, user.id])
  useEffect(() => { exportVersion.current += 1; setExporting(false); return () => { exportVersion.current += 1 } }, [filters])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setResult(null)
    void (serverMode ? fetchAgencyFoldersV109(filters, page, sort) : Promise.resolve(demoFolders(user, members, localRows, paymentSteps, filters, page, sort))).then(next => {
      if (!active) return
      setResult(next); if (next.page !== page) setPage(next.page)
    }).catch(e => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, page, sort, serverMode, refreshKey, retry, user, members, localRows, paymentSteps])
  const update = <K extends keyof ManagedOrderFilters>(key: K, value: ManagedOrderFilters[K]) => { setFilters(f => ({ ...f, [key]: value })); setPage(1) }
  const exportFiltered = async () => {
    const version = ++exportVersion.current
    setExporting(true); setError('')
    try {
      const all = serverMode ? await fetchAllManagedOrdersV108(filters) : filterLocalRows(localRows, filters)
      if (version !== exportVersion.current) return
      if (all.length) downloadManagedOrdersExcel(all, `관리작업_필터전체_${excelDateSuffix()}.xlsx`)
      else setError('현재 조건에 맞는 작업이 없습니다.')
    } catch (e) { if (version === exportVersion.current) setError(errorMessage(e)) }
    finally { if (version === exportVersion.current) setExporting(false) }
  }
  const cacheKey = JSON.stringify([filters, refreshKey, user.id])
  return <div className="page-stack managed-orders-page-stack">
    <PageHeader title="관리 작업" subtitle="대행사 폴더를 열어 작업을 확인하세요. 중간관리자는 읽기 전용입니다." action={<div className="page-header-actions"><button className="secondary-button" disabled={!selected.size || exporting || loading} onClick={() => downloadManagedOrdersExcel([...selected.values()], `관리작업_선택_${excelDateSuffix()}.xlsx`)}>선택 엑셀 ({selected.size})</button><button className="primary-button" disabled={exporting || loading || !result?.agencyCount} onClick={() => void exportFiltered()}>{exporting ? '전체 조회 중…' : '필터 전체 엑셀'}</button></div>} />
    <section className="panel compact-panel managed-orders-filter-panel">
      <StatusFilters value={filters.orderStatus} onChange={s => update('orderStatus', s)} />
      <div className="managed-orders-filter-grid">
        <label>폴더 정렬<select value={sort} onChange={e => { setSort(e.target.value as AgencyFolderSort); setPage(1) }}><option value="in_progress">진행중 많은 순</option><option value="settlement_waiting">정산대기 금액순</option><option value="recent">최근 작업순</option><option value="username">아이디순</option></select></label>
        <OrderSort value={filters.sort} onChange={s => update('sort', s)} />
        <label>프로그램<select value={filters.programType} onChange={e => update('programType', e.target.value as ManagedOrderFilters['programType'])}><option value="all">전체</option><option value="spark">스파크</option><option value="spark_plus">스파크+</option><option value="spark_s">스파크s</option><option value="spark_s_plus">스파크s+</option></select></label>
        <label>정산상태<select value={filters.settlementStatus} onChange={e => update('settlementStatus', e.target.value as ManagedOrderFilters['settlementStatus'])}><option value="all">전체</option><option value="정산대기">정산대기</option><option value="부분완료">부분완료</option><option value="정산완료">정산완료</option></select></label>
        <label>시작일 시작<input type="date" value={filters.startDateFrom} max={filters.startDateTo || undefined} onChange={e => update('startDateFrom', e.target.value)} /></label>
        <label>시작일 종료<input type="date" value={filters.startDateTo} min={filters.startDateFrom || undefined} onChange={e => update('startDateTo', e.target.value)} /></label>
        <form className="managed-orders-search" onSubmit={e => { e.preventDefault(); update('query', query) }}><label>검색<div><input value={query} onChange={e => setQuery(e.target.value)} placeholder="대행사 아이디, 상호명, 키워드, MID" /><button className="secondary-button small" type="submit">검색</button></div></label></form>
        <button className="text-button" onClick={() => { setFilters(EMPTY_FILTERS); setQuery(''); setPage(1) }}>필터 초기화</button>
      </div>
      {filters.agencyId && <button className="text-button" onClick={() => update('agencyId', '')}>선택 대행사만 표시 중 · 모든 대행사 보기</button>}
    </section>
    <div className="selection-summary"><span>{selected.size}개 선택됨 · 폴더를 닫아도 선택은 유지됩니다.</span><button className="text-button" disabled={!selected.size} onClick={() => setSelected(new Map())}>선택 해제</button></div>
    <p className="agency-folder-help">폴더 요약은 보관 제외 전체 작업 기준입니다. 진행중 = 입금대기 + 입금완료. ‘조건 일치’는 상단 필터 기준이며 필터 전체 엑셀도 같은 기준입니다.</p>
    {error && <div className="server-error-banner" role="alert"><span>{error}</span><button onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></div>}
    {loading && <p role="status">대행사 목록을 불러오는 중…</p>}
    {!loading && !error && !result?.agencies.length && <div className="panel empty-state">조건에 맞는 대행사가 없습니다.</div>}
    {result?.agencies.map(agency => <AgencyFolderPanel key={`${cacheKey}:${agency.agencyId}`} agency={agency} open={open.has(agency.agencyId)} toggle={() => setOpen(current => { const next = new Set(current); if (next.has(agency.agencyId)) next.delete(agency.agencyId); else next.add(agency.agencyId); return next })} globalFilters={filters} selected={selected} setSelected={setSelected} serverMode={serverMode} localRows={localRows} />)}
    <div className="panel"><div className="managed-orders-result-head">대행사 {result?.agencyCount ?? 0}개 · 페이지당 20개</div><Pagination page={result?.page ?? page} totalPages={result?.totalPages ?? 1} loading={loading} onChange={setPage} label="대행사 폴더 페이지" /></div>
  </div>
}
