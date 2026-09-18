import { selectRowRange } from '../lib/rowSelection'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ManagedOrdersTable } from '../components/ManagedOrdersTable'
import { AgencyFoldersPage } from './AgencyFoldersPage'
import { EMPTY_FILTERS, localManagedRows, localPage, filterLocalRows, excelDateSuffix } from '../lib/managedOrdersLocal'
import type {
  ManagedOrderFilterOption,
  ManagedOrderFilters,
  ManagedOrderRow,
  ManagedOrdersPageResult,
  ManagedOrdersPreset,
  Order,
  PaymentStep,
  User,
} from '../domain/types'
import {
  fetchAllManagedOrdersV1010,
  fetchManagedOrderFilterOptionsV102,
  fetchManagedOrdersV1010,
} from '../lib/backend'
import { downloadManagedOrdersExcel } from '../lib/managedOrdersExcel'
import { PageHeader } from './DashboardPage'

function AllManagedOrdersPage({ user, members, orders, paymentSteps, serverMode, refreshKey, initialFilters }: {
  user: User
  members: User[]
  orders: Order[]
  paymentSteps: PaymentStep[]
  serverMode: boolean
  refreshKey: number
  initialFilters?: ManagedOrdersPreset | null
}) {
  const anchor = useRef<string | null>(null)
  const loadVersion = useRef(0)
  const [filters, setFilters] = useState<ManagedOrderFilters>(() => ({
    ...EMPTY_FILTERS,
    agencyId: initialFilters?.agencyId ?? '',
    settlementStatus: initialFilters?.settlementStatus ?? 'all',
  }))
  const [queryDraft, setQueryDraft] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<ManagedOrdersPageResult | null>(null)
  const [agencyOptions, setAgencyOptions] = useState<ManagedOrderFilterOption[]>([])
  const [selected, setSelected] = useState<Map<string, ManagedOrderRow>>(new Map())
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const localRows = useMemo(() => serverMode ? [] : localManagedRows(user, members, orders, paymentSteps), [members, orders, paymentSteps, serverMode, user])

  useEffect(() => {
    if (!serverMode) {
      setAgencyOptions(members.filter((member) => member.managerId === user.id).map((member) => ({ id: member.id, username: member.username })).sort((a, b) => a.username.localeCompare(b.username, 'ko-KR')))
      return
    }
    let active = true
    void fetchManagedOrderFilterOptionsV102().then((options) => {
      if (active) setAgencyOptions(options)
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : '대행사 목록을 불러오지 못했습니다.')
    })
    return () => { active = false }
  }, [members, refreshKey, serverMode, user.id])

  const load = useCallback(async () => {
    const version = ++loadVersion.current
    setLoading(true)
    setError('')
    try {
      const next = serverMode ? await fetchManagedOrdersV1010(filters, page, 50) : localPage(localRows, filters, page)
      if (version !== loadVersion.current) return
      setSelected((current) => new Map(next.rows.filter((row) => current.has(row.orderId)).map((row) => [row.orderId, row])))
      setResult(next)
      if (next.page !== page) setPage(next.page)
    } catch (caught) {
      if (version === loadVersion.current) { setResult(null); setSelected(new Map()); setError(caught instanceof Error ? caught.message : '관리 작업을 불러오지 못했습니다.') }
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [filters, localRows, page, refreshKey, serverMode])

  useEffect(() => { anchor.current = null; setSelected(new Map()); setResult(null) }, [filters, page])
  useEffect(() => { void load(); return () => { loadVersion.current += 1 } }, [load])

  const updateFilter = <K extends keyof ManagedOrderFilters>(key: K, value: ManagedOrderFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
    setSelected(new Map())
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    updateFilter('query', queryDraft)
  }

  const rows = result?.rows ?? []
  const allCurrentSelected = rows.length > 0 && rows.every((row) => selected.has(row.orderId))
  const toggleRow = (row: ManagedOrderRow, shift = false) => {
    if (loading) return
    const previousAnchor = anchor.current
    setSelected((current) => {
      const ids = selectRowRange(new Set(current.keys()), rows.map((item) => item.orderId), previousAnchor, row.orderId, shift)
      return new Map(rows.filter((item) => ids.has(item.orderId)).map((item) => [item.orderId, item]))
    })
    if (!shift || !previousAnchor || !rows.some((item) => item.orderId === previousAnchor)) anchor.current = row.orderId
  }
  const toggleCurrentPage = () => setSelected((current) => {
    const next = new Map(current)
    rows.forEach((row) => { if (allCurrentSelected) next.delete(row.orderId); else next.set(row.orderId, row) })
    return next
  })

  const exportSelected = () => downloadManagedOrdersExcel([...selected.values()], `관리작업_선택_${excelDateSuffix()}.xlsx`)
  const exportAllFiltered = async () => {
    setExporting(true)
    setError('')
    try {
      const exportRows = serverMode ? await fetchAllManagedOrdersV1010(filters) : filterLocalRows(localRows, filters)
      if (exportRows.length === 0) throw new Error('현재 필터 조건에 맞는 작업이 없습니다.')
      downloadManagedOrdersExcel(exportRows, `관리작업_필터전체_${excelDateSuffix()}.xlsx`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '엑셀을 만들지 못했습니다.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page-stack managed-orders-page-stack">
      <PageHeader title="관리 작업" subtitle="현재 내 관리 담당으로 배정된 대행사의 과거·현재 작업과 정산 상태를 읽기 전용으로 확인합니다." action={<div className="page-header-actions"><button className="secondary-button" disabled={selected.size === 0 || exporting || loading} onClick={exportSelected}><Icon name="download" />선택 엑셀 ({selected.size.toLocaleString('ko-KR')})</button><button className="primary-button" disabled={!result?.totalCount || exporting || loading} onClick={() => void exportAllFiltered()}><Icon name="download" />{exporting ? '전체 조회 중' : '필터 전체 엑셀'}</button></div>} />
      <section className="panel compact-panel managed-orders-filter-panel">
        <div className="managed-status-chips" aria-label="작업상태 빠른 필터">{(['all', 'in_progress', '입금대기', '입금완료', '구동중', '정지', '만료'] as const).map((status) => <button key={status} className="secondary-button small" aria-pressed={filters.orderStatus === status} onClick={() => updateFilter('orderStatus', status)}>{status === 'all' ? '전체' : status === 'in_progress' ? '진행중(입금대기+입금완료)' : status}</button>)}</div>
        <div className="managed-orders-filter-grid">
          <label><span>정렬</span><select value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value as ManagedOrderFilters['sort'])}><option value="priority">업무 우선순위</option><option value="newest">최신 접수순</option><option value="oldest">오래된 접수순</option><option value="start_date">시작일 빠른순</option></select></label>
          <label><span>대행사</span><select value={filters.agencyId} onChange={(event) => updateFilter('agencyId', event.target.value)}><option value="">전체</option>{agencyOptions.map((option) => <option key={option.id} value={option.id}>{option.username}</option>)}</select></label>
          <label><span>프로그램</span><select value={filters.programType} onChange={(event) => updateFilter('programType', event.target.value as ManagedOrderFilters['programType'])}><option value="all">전체</option><option value="spark">스파크</option><option value="spark_plus">스파크+</option><option value="spark_s">스파크s</option><option value="spark_s_plus">스파크s+</option></select></label>
          <label><span>작업상태</span><select value={filters.orderStatus} onChange={(event) => updateFilter('orderStatus', event.target.value as ManagedOrderFilters['orderStatus'])}><option value="all">전체</option><option value="in_progress">진행중(입금대기+입금완료)</option>{['입금대기', '입금완료', '구동중', '정지', '만료'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label><span>정산상태</span><select value={filters.settlementStatus} onChange={(event) => updateFilter('settlementStatus', event.target.value as ManagedOrderFilters['settlementStatus'])}><option value="all">전체</option><option value="정산대기">정산대기</option><option value="부분완료">부분완료</option><option value="정산완료">정산완료</option></select></label>
          <label><span>시작일 시작</span><input type="date" value={filters.startDateFrom} max={filters.startDateTo || undefined} onChange={(event) => updateFilter('startDateFrom', event.target.value)} /></label>
          <label><span>시작일 종료</span><input type="date" value={filters.startDateTo} min={filters.startDateFrom || undefined} onChange={(event) => updateFilter('startDateTo', event.target.value)} /></label>
          <form className="managed-orders-search" onSubmit={submitSearch}><label><span>검색</span><div><input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="상호명, 키워드, MID, 대행사, 그룹명" /><button className="secondary-button small" type="submit"><Icon name="search" />검색</button></div></label></form>
          <button className="text-button managed-orders-reset" onClick={() => { setFilters(EMPTY_FILTERS); setQueryDraft(''); setPage(1); setSelected(new Map()) }}>필터 초기화</button>
        </div>
      </section>
      {error && <div className="server-error-banner"><span>{error}</span><button onClick={() => void load()}>다시 불러오기</button></div>}
      <div className="selection-summary"><span>{selected.size}개 선택됨 · Shift 범위 선택은 현재 페이지 내에서 적용됩니다.</span><button className="text-button" disabled={!selected.size} onClick={() => { setSelected(new Map()); anchor.current = null }}>선택 해제</button></div>
      <section className="panel managed-orders-panel">
        <div className="managed-orders-result-head"><div><strong>{(result?.totalCount ?? 0).toLocaleString('ko-KR')}건</strong><span>읽기 전용 · 상태 변경 및 입금확인은 관리자만 가능</span></div>{loading && <span>불러오는 중...</span>}</div>
        {rows.length === 0 && !loading ? <div className="empty-state fill-empty-state">조건에 맞는 관리 작업이 없습니다.</div> : <ManagedOrdersTable rows={rows} selected={selected} loading={loading} toggleRow={toggleRow} toggleCurrentPage={toggleCurrentPage} />}
        <div className="managed-orders-pagination"><button className="secondary-button small" disabled={loading || (result?.page ?? 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button><span>{(result?.page ?? 1).toLocaleString('ko-KR')} / {(result?.totalPages ?? 1).toLocaleString('ko-KR')} 페이지</span><button className="secondary-button small" disabled={loading || (result?.page ?? 1) >= (result?.totalPages ?? 1)} onClick={() => setPage((current) => current + 1)}>다음</button></div>
      </section>
    </div>
  )
}

export function ManagedOrdersPage(props: Parameters<typeof AllManagedOrdersPage>[0]) {
 const [viewMode,setViewMode]=useState<'agencyFolders'|'allOrders'>('agencyFolders')
 return <div className="page-stack"><div className="managed-view-toggle" role="group" aria-label="관리 작업 보기 방식">
   <button className="secondary-button" aria-pressed={viewMode==='agencyFolders'} onClick={()=>setViewMode('agencyFolders')}>대행사별 보기</button>
   <button className="secondary-button" aria-pressed={viewMode==='allOrders'} onClick={()=>setViewMode('allOrders')}>전체 작업 보기</button>
 </div>{viewMode==='agencyFolders'?<AgencyFoldersPage {...props}/>:<AllManagedOrdersPage {...props}/>}</div>
}
