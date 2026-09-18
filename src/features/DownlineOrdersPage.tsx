import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AgencyFoldersResult, AgencyFolderSort, DownlineGroup, DownlineGroupsResult, ManagedOrderFilters, ManagedOrderRow, ManagedOrdersPageResult, User } from '../domain/types'
import { fetchAllDownlineOrdersV1010, fetchDownlineOrdersV1010, fetchDownlineOverviewV1010 } from '../lib/backend'
import { EMPTY_FILTERS, excelDateSuffix } from '../lib/managedOrdersLocal'
import { downloadManagedOrdersExcel } from '../lib/managedOrdersExcel'
import { selectRowRange } from '../lib/rowSelection'
import { formatWon } from '../lib/money'
import { ManagedOrdersTable } from '../components/ManagedOrdersTable'
import { AgencyFolderPanel, OrderSort, Pagination, StatusFilters } from './AgencyFoldersPage'
import { PageHeader } from './DashboardPage'

type Selection = Map<string, ManagedOrderRow>
const emptyRows: ManagedOrderRow[] = []
const message = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : '조회하지 못했습니다. 다시 시도해 주세요.'

function GroupPanel({ group, open, toggle, filters, sort, selected, setSelected, exportGroup, busy, revision }: {
  group: DownlineGroup; open: boolean; toggle: () => void; filters: ManagedOrderFilters; sort: AgencyFolderSort;
  selected: Selection; setSelected: Dispatch<SetStateAction<Selection>>;
  exportGroup: (name: string) => void; busy: boolean; revision: number;
}) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<AgencyFoldersResult | null>(null)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const scoped = useMemo(() => ({ ...filters, groupName: group.groupName }), [filters, group.groupName])
  const cache = useRef('')
  const key = JSON.stringify([scoped, sort, page, group.revision, retry, revision])
  useEffect(() => {
    if (!open || cache.current === key) return
    let active = true
    setLoading(true); setError('')
    void fetchDownlineOverviewV1010(scoped, page, sort, true).then(data => {
      if (!active) return
      cache.current = key
      setResult(data as AgencyFoldersResult)
      if (data.page !== page) setPage(data.page)
    }).catch(e => { if (active) { setError(message(e)); setResult(null) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, key, scoped, page, sort])
  return <section className="panel downline-group agency-folder">
    <h2 className="agency-folder-title"><button className="agency-folder-toggle" aria-expanded={open} onClick={toggle}>
      <span className="agency-folder-name"><span aria-hidden="true">{open ? '▾' : '▸'}</span><strong title={group.groupName}>{group.groupName}</strong></span>
      <span className="agency-folder-counts"><span>대행사 <b>{group.agencyCount}</b></span><span>전체 <b>{group.totalOrderCount}</b></span><span>진행중 <b>{group.inProgressCount}</b></span><span>구동중 <b>{group.runningCount}</b></span></span>
      <span className="agency-folder-money">내 수령대기 <b>{formatWon(group.settlementWaitingAmount)}</b></span>
      <small className="agency-folder-match">조건 일치 {group.matchedOrderCount}건</small>
    </button></h2>
    <div hidden={!open} className="agency-folder-body">
      <div className="agency-folder-actions"><button className="secondary-button small" disabled={busy || loading} onClick={() => exportGroup(group.groupName)}>현재 그룹 필터 전체 엑셀</button></div>
      {loading && <p role="status">대행사 요약을 불러오는 중…</p>}
      {error && <div className="server-error-banner" role="alert">{error}<button onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></div>}
      {!loading && !error && !result?.agencies.length && <div className="empty-state">현재 조건에 맞는 하위 대행사가 없습니다.</div>}
      {result?.agencies.map(agency => <AgencyFolderPanel key={agency.agencyId} agency={agency} open={open && opened.has(agency.agencyId)} toggle={() => setOpened(current => { const next = new Set(current); if (next.has(agency.agencyId)) next.delete(agency.agencyId); else next.add(agency.agencyId); return next })} globalFilters={scoped} selected={selected} setSelected={setSelected} serverMode localRows={emptyRows} downline refreshKey={revision} loadPage={fetchDownlineOrdersV1010} loadAll={fetchAllDownlineOrdersV1010} />)}
      <Pagination page={result?.page ?? page} totalPages={result?.totalPages ?? 1} loading={loading} onChange={setPage} label={`${group.groupName} 대행사 페이지`} />
    </div>
  </section>
}

function FlatOrders({ filters, revision, selected, setSelected }: {
  filters: ManagedOrderFilters; revision: number; selected: Selection; setSelected: Dispatch<SetStateAction<Selection>>;
}) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<ManagedOrdersPageResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const anchor = useRef<string | null>(null)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setResult(null); anchor.current = null
    void fetchDownlineOrdersV1010(filters, page).then(next => {
      if (!active) return
      setResult(next); if (next.page !== page) setPage(next.page)
    }).catch(e => { if (active) setError(message(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, page, revision, retry])
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
  return <section className="panel managed-orders-panel">
    <div className="managed-orders-result-head">조건 일치 {result?.totalCount ?? 0}건 · 읽기 전용</div>
    {error && <div className="server-error-banner" role="alert">{error}<button onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></div>}
    {loading ? <p role="status">작업을 불러오는 중…</p> : !error && !rows.length ? <div className="empty-state">현재 조건에 맞는 하위 작업이 없습니다.</div> : <ManagedOrdersTable rows={rows} selected={selected} loading={loading} toggleRow={toggleRow} toggleCurrentPage={() => setSelected(current => {
      const all = rows.length > 0 && rows.every(r => current.has(r.orderId)), next = new Map(current)
      rows.forEach(r => { if (all) next.delete(r.orderId); else next.set(r.orderId, r) }); return next
    })} />}
    <Pagination page={result?.page ?? page} totalPages={result?.totalPages ?? 1} loading={loading} onChange={setPage} label="하위 작업 페이지" />
  </section>
}

export function DownlineOrdersPage({ user, serverMode, refreshKey }: { user: User; serverMode: boolean; refreshKey: number }) {
  const [view, setView] = useState<'groups' | 'all'>('groups')
  const [filters, setFilters] = useState<ManagedOrderFilters>({ ...EMPTY_FILTERS })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AgencyFolderSort>('in_progress')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<DownlineGroupsResult | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Selection>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [summaryTick, setSummaryTick] = useState(0)
  const exportVersion = useRef(0)
  const lastSummary = useRef({ key: '', signature: '' })
  // Deep descendants may be invisible to existing table RLS/realtime. Only poll paged summaries,
  // never hierarchy snapshots; changed agency revision keys invalidate affected open details.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setSummaryTick(n => n + 1) }
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    setSelected(new Map()); exportVersion.current += 1; setBusy(false)
    return () => { exportVersion.current += 1 }
  }, [filters, refreshKey, revision, user.id])
  useEffect(() => {
    if (!serverMode || view !== 'groups') return
    let active = true
    setLoading(true); setError('')
    void fetchDownlineOverviewV1010(filters, page, sort).then(data => {
      if (!active) return
      const next = data as DownlineGroupsResult
      const signature = JSON.stringify(next)
      const key = JSON.stringify([filters, page, sort])
      if (lastSummary.current.key === key && lastSummary.current.signature !== signature) { setSelected(new Map()); exportVersion.current += 1; setBusy(false) }
      lastSummary.current = { key, signature }
      setResult(next); if (next.page !== page) setPage(next.page)
    }).catch(e => { if (active) { setError(message(e)); setResult(null); setSelected(new Map()) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, page, sort, serverMode, refreshKey, revision, summaryTick, view])
  const update = <K extends keyof ManagedOrderFilters>(key: K, value: ManagedOrderFilters[K]) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); setResult(null) }
  const exportRows = useCallback(async (groupName?: string, selection = false) => {
    const version = ++exportVersion.current
    setBusy(true); setError('')
    try {
      // Revalidate selection on the server, including current hierarchy and group labels.
      let rows: ManagedOrderRow[]
      if (selection) {
        rows = []
        for (const agencyId of new Set([...selected.values()].map(r => r.registrantId))) {
          const current = await fetchAllDownlineOrdersV1010({ ...EMPTY_FILTERS, agencyId })
          rows.push(...current.filter(r => selected.has(r.orderId)))
        }
      } else rows = await fetchAllDownlineOrdersV1010({ ...filters, groupName })
      if (version !== exportVersion.current) return
      if (!rows.length) throw new Error('현재 조건에 맞는 작업이 없습니다.')
      downloadManagedOrdersExcel(rows, `하위작업_${selection ? '선택' : groupName ? '그룹' : '필터전체'}_${excelDateSuffix()}.xlsx`)
    } catch (e) { if (version === exportVersion.current) setError(message(e)) }
    finally { if (version === exportVersion.current) setBusy(false) }
  }, [filters, selected])
  if (!serverMode) return <div className="panel empty-state">하위 작업은 서버에 연결된 계정에서 조회할 수 있습니다.</div>
  return <div className="page-stack managed-orders-page-stack">
    <PageHeader title="하위 작업" subtitle="추천·정산 계층에 속한 하위 대행사의 작업을 읽기 전용으로 확인합니다. 내 작업은 기존 접수 메뉴에서 확인하세요." action={<div className="page-header-actions"><button className="secondary-button" disabled={busy || !selected.size} onClick={() => void exportRows(undefined, true)}>선택 엑셀 ({selected.size})</button><button className="primary-button" disabled={busy || loading} onClick={() => void exportRows()}>{busy ? '전체 페이지 조회 중…' : '필터 전체 엑셀'}</button></div>} />
    <div className="managed-view-toggle" role="group" aria-label="하위 작업 보기 방식"><button className="secondary-button" aria-pressed={view === 'groups'} onClick={() => setView('groups')}>그룹별 보기</button><button className="secondary-button" aria-pressed={view === 'all'} onClick={() => setView('all')}>전체 작업 보기</button><button className="text-button" onClick={() => setRevision(n => n + 1)}>새로고침</button></div>
    <section className="panel compact-panel managed-orders-filter-panel">
      <StatusFilters value={filters.orderStatus} onChange={s => update('orderStatus', s)} />
      <div className="managed-orders-filter-grid">
        <label>폴더 정렬<select value={sort} onChange={e => { setSort(e.target.value as AgencyFolderSort); setPage(1) }}><option value="in_progress">진행중 많은 순</option><option value="recent">최근 작업순</option><option value="username">이름순</option><option value="settlement_waiting">내 수령대기 금액순</option></select></label>
        <OrderSort value={filters.sort} onChange={s => update('sort', s)} />
        <label>프로그램<select value={filters.programType} onChange={e => update('programType', e.target.value as ManagedOrderFilters['programType'])}><option value="all">전체</option><option value="spark">스파크</option><option value="spark_plus">스파크+</option><option value="spark_s">스파크s</option><option value="spark_s_plus">스파크s+</option></select></label>
        <label>정산상태 (작업 전체 단계)<select value={filters.settlementStatus} onChange={e => update('settlementStatus', e.target.value as ManagedOrderFilters['settlementStatus'])}><option value="all">전체</option><option value="정산대기">정산대기</option><option value="부분완료">부분완료</option><option value="정산완료">정산완료</option></select></label>
        <label>시작일 시작<input type="date" value={filters.startDateFrom} max={filters.startDateTo || undefined} onChange={e => update('startDateFrom', e.target.value)} /></label>
        <label>시작일 종료<input type="date" value={filters.startDateTo} min={filters.startDateFrom || undefined} onChange={e => update('startDateTo', e.target.value)} /></label>
        <form className="managed-orders-search" onSubmit={e => { e.preventDefault(); update('query', query) }}><label>검색<div><input value={query} onChange={e => setQuery(e.target.value)} placeholder="그룹명, 대행사 아이디, 상호명, 키워드, MID" /><button className="secondary-button small" type="submit">검색</button></div></label></form>
        <button className="text-button" onClick={() => { setFilters({ ...EMPTY_FILTERS }); setQuery(''); setPage(1); setResult(null) }}>필터 초기화</button>
      </div>
    </section>
    <p className="agency-folder-help">폴더 요약은 조건에 맞는 대행사의 보관 제외 전체 작업 기준입니다. 내 수령대기는 내가 수령인인 미확인 정산 단계 금액이며, 선행 단계 대기도 포함합니다. 입금확인은 기존 정산 메뉴의 순차 정책을 따릅니다. 정산상태는 작업 전체 단계 기준입니다.</p>
    <div className="selection-summary"><span>{selected.size}개 선택됨 · Shift 선택은 현재 폴더의 현재 페이지 안에서 적용됩니다.</span><button className="text-button" onClick={() => setSelected(new Map())}>선택 해제</button></div>
    {error && <div className="server-error-banner" role="alert">{error}<button onClick={() => setRevision(n => n + 1)}>다시 불러오기</button></div>}
    {view === 'groups' ? <>
      {loading && <p role="status">그룹 요약을 불러오는 중…</p>}
      {!loading && !error && !result?.groups.length && <div className="panel empty-state">{JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS) ? '현재 하위 대행사가 없습니다.' : '현재 조건에 맞는 하위 대행사가 없습니다.'}</div>}
      {result?.groups.map(group => <GroupPanel key={`${group.groupName}:${JSON.stringify(filters)}`} group={group} open={open.has(group.groupName)} toggle={() => setOpen(current => { const next = new Set(current); if (next.has(group.groupName)) next.delete(group.groupName); else next.add(group.groupName); return next })} filters={filters} sort={sort} selected={selected} setSelected={setSelected} exportGroup={name => void exportRows(name)} busy={busy} revision={revision} />)}
      <Pagination page={result?.page ?? page} totalPages={result?.totalPages ?? 1} loading={loading} onChange={setPage} label="하위 그룹 페이지" />
    </> : <FlatOrders key={JSON.stringify(filters)} filters={filters} revision={revision + refreshKey + summaryTick} selected={selected} setSelected={setSelected} />}
  </div>
}
