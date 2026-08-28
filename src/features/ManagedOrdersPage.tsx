import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import type {
  ManagedOrderFilterOption,
  ManagedOrderFilters,
  ManagedOrderRow,
  ManagedOrdersPageResult,
  Order,
  PaymentStep,
  User,
} from '../domain/types'
import {
  fetchAllManagedOrdersV102,
  fetchManagedOrderFilterOptionsV102,
  fetchManagedOrdersV102,
} from '../lib/backend'
import { formatDate } from '../lib/date'
import { downloadManagedOrdersExcel } from '../lib/managedOrdersExcel'
import { formatWon } from '../lib/money'
import { labelForProgram, unitLabelForProgram } from '../lib/program'
import { PageHeader } from './DashboardPage'

const PAGE_SIZE = 50
const EMPTY_FILTERS: ManagedOrderFilters = {
  agencyId: '',
  programType: 'all',
  orderStatus: 'all',
  settlementStatus: 'all',
  query: '',
  startDateFrom: '',
  startDateTo: '',
}

function localManagedRows(user: User, members: User[], orders: Order[], paymentSteps: PaymentStep[]): ManagedOrderRow[] {
  const usernames = new Map(members.filter((member) => member.managerId === user.id).map((member) => [member.id, member.username]))
  return orders.filter((order) => !order.archivedAt && usernames.has(order.createdBy)).map((order) => {
    const orderKeys = new Set([order.dbId ?? order.id, order.id])
    const steps = paymentSteps.filter((step) => orderKeys.has(step.orderDbId))
    const confirmedSteps = steps.filter((step) => step.confirmedAt).length
    const specialPending = order.programTransferState === 'payment_pending' || order.settlementReversalPending
    const settlementStatus = specialPending || steps.length === 0 || confirmedSteps === 0
      ? '정산대기' as const
      : confirmedSteps === steps.length
        ? '정산완료' as const
        : '부분완료' as const
    const reason = order.settlementReversalPending
      ? '입금확인 취소 후 재확인 대기'
      : order.programTransferState === 'payment_pending'
        ? '프로그램 변경 추가금 입금대기'
        : steps.length === 0
          ? '정산 단계 생성 대기'
          : `${confirmedSteps}/${steps.length} 완료`
    return {
      orderId: order.dbId ?? order.id,
      orderNumber: order.id,
      registrantId: order.createdBy,
      registrantUsername: usernames.get(order.createdBy) ?? order.creatorUsername,
      programType: order.programType,
      storeName: order.storeName,
      keyword: order.keyword,
      mid: order.mid,
      placeUrl: order.placeUrl,
      dailyShots: order.dailyShots,
      operationDays: order.operationDays,
      pricePerShot: order.pricePerShot,
      supplyAmount: order.supplyAmount,
      vatAmount: order.vatAmount,
      totalAmount: order.totalAmount,
      startDate: order.startDate,
      endDate: order.endDate,
      orderStatus: order.status,
      settlementStatus,
      settlementDetail: `${reason}${specialPending && steps.length > 0 ? ` · ${confirmedSteps}/${steps.length} 완료` : ''}`,
      confirmedSteps,
      totalSteps: steps.length,
      programTransferState: order.programTransferState,
      settlementReversalPending: order.settlementReversalPending,
      createdAt: order.createdAt,
    }
  })
}

function filterLocalRows(rows: ManagedOrderRow[], filters: ManagedOrderFilters): ManagedOrderRow[] {
  const query = filters.query.trim().toLocaleLowerCase('ko-KR')
  return rows.filter((row) => {
    if (filters.agencyId && row.registrantId !== filters.agencyId) return false
    if (filters.programType !== 'all' && row.programType !== filters.programType) return false
    if (filters.orderStatus !== 'all' && row.orderStatus !== filters.orderStatus) return false
    if (filters.settlementStatus !== 'all' && row.settlementStatus !== filters.settlementStatus) return false
    if (filters.startDateFrom && row.startDate < filters.startDateFrom) return false
    if (filters.startDateTo && row.startDate > filters.startDateTo) return false
    if (query && ![row.storeName, row.keyword, row.mid, row.registrantUsername].some((value) => value.toLocaleLowerCase('ko-KR').includes(query))) return false
    return true
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function localPage(rows: ManagedOrderRow[], filters: ManagedOrderFilters, page: number): ManagedOrdersPageResult {
  const filtered = filterLocalRows(rows, filters)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  return {
    rows: filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages,
    totalCount: filtered.length,
  }
}

function excelDateSuffix(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function ManagedOrdersPage({ user, members, orders, paymentSteps, serverMode }: {
  user: User
  members: User[]
  orders: Order[]
  paymentSteps: PaymentStep[]
  serverMode: boolean
}) {
  const [filters, setFilters] = useState<ManagedOrderFilters>(EMPTY_FILTERS)
  const [queryDraft, setQueryDraft] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<ManagedOrdersPageResult | null>(null)
  const [agencyOptions, setAgencyOptions] = useState<ManagedOrderFilterOption[]>([])
  const [selected, setSelected] = useState<Map<string, ManagedOrderRow>>(new Map())
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const localRows = useMemo(() => localManagedRows(user, members, orders, paymentSteps), [members, orders, paymentSteps, user])

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
  }, [members, serverMode, user.id])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = serverMode ? await fetchManagedOrdersV102(filters, page, PAGE_SIZE) : localPage(localRows, filters, page)
      setResult(next)
      if (next.page !== page) setPage(next.page)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '관리 작업을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [filters, localRows, page, serverMode])

  useEffect(() => { void load() }, [load])

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
  const toggleRow = (row: ManagedOrderRow) => setSelected((current) => {
    const next = new Map(current)
    if (next.has(row.orderId)) next.delete(row.orderId)
    else next.set(row.orderId, row)
    return next
  })
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
      const exportRows = serverMode ? await fetchAllManagedOrdersV102(filters) : filterLocalRows(localRows, filters)
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
      <PageHeader title="관리 작업" subtitle="내 관리 코드로 가입한 대행사의 작업 및 정산 상태를 읽기 전용으로 확인합니다." action={<div className="page-header-actions"><button className="secondary-button" disabled={selected.size === 0 || exporting} onClick={exportSelected}><Icon name="download" />선택 엑셀 ({selected.size.toLocaleString('ko-KR')})</button><button className="primary-button" disabled={!result?.totalCount || exporting} onClick={() => void exportAllFiltered()}><Icon name="download" />{exporting ? '전체 조회 중' : '필터 전체 엑셀'}</button></div>} />
      <section className="panel compact-panel managed-orders-filter-panel">
        <div className="managed-orders-filter-grid">
          <label><span>대행사</span><select value={filters.agencyId} onChange={(event) => updateFilter('agencyId', event.target.value)}><option value="">전체</option>{agencyOptions.map((option) => <option key={option.id} value={option.id}>{option.username}</option>)}</select></label>
          <label><span>프로그램</span><select value={filters.programType} onChange={(event) => updateFilter('programType', event.target.value as ManagedOrderFilters['programType'])}><option value="all">전체</option><option value="spark">스파크</option><option value="spark_plus">스파크+</option><option value="spark_s">스파크s</option><option value="spark_s_plus">스파크s+</option></select></label>
          <label><span>작업상태</span><select value={filters.orderStatus} onChange={(event) => updateFilter('orderStatus', event.target.value as ManagedOrderFilters['orderStatus'])}><option value="all">전체</option>{['입금대기', '입금완료', '구동중', '정지', '만료'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label><span>정산상태</span><select value={filters.settlementStatus} onChange={(event) => updateFilter('settlementStatus', event.target.value as ManagedOrderFilters['settlementStatus'])}><option value="all">전체</option><option value="정산대기">정산대기</option><option value="부분완료">부분완료</option><option value="정산완료">정산완료</option></select></label>
          <label><span>시작일 시작</span><input type="date" value={filters.startDateFrom} max={filters.startDateTo || undefined} onChange={(event) => updateFilter('startDateFrom', event.target.value)} /></label>
          <label><span>시작일 종료</span><input type="date" value={filters.startDateTo} min={filters.startDateFrom || undefined} onChange={(event) => updateFilter('startDateTo', event.target.value)} /></label>
          <form className="managed-orders-search" onSubmit={submitSearch}><label><span>검색</span><div><input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="상호명, 키워드, MID, 대행사" /><button className="secondary-button small" type="submit"><Icon name="search" />검색</button></div></label></form>
          <button className="text-button managed-orders-reset" onClick={() => { setFilters(EMPTY_FILTERS); setQueryDraft(''); setPage(1); setSelected(new Map()) }}>필터 초기화</button>
        </div>
      </section>
      {error && <div className="server-error-banner"><span>{error}</span><button onClick={() => void load()}>다시 불러오기</button></div>}
      <section className="panel managed-orders-panel">
        <div className="managed-orders-result-head"><div><strong>{(result?.totalCount ?? 0).toLocaleString('ko-KR')}건</strong><span>읽기 전용 · 상태 변경 및 입금확인은 관리자만 가능</span></div>{loading && <span>불러오는 중...</span>}</div>
        {rows.length === 0 && !loading ? <div className="empty-state fill-empty-state">조건에 맞는 관리 작업이 없습니다.</div> : <div className="desktop-table"><table className="managed-orders-table"><thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allCurrentSelected} onChange={toggleCurrentPage} /></th><th>대행사</th><th>프로그램</th><th>상호명</th><th>대표키워드</th><th>시작일</th><th>종료일</th><th>일일수량</th><th>적용단가</th><th>총금액</th><th>작업상태</th><th>정산상태</th></tr></thead><tbody>{rows.map((row) => <tr key={row.orderId} className={selected.has(row.orderId) ? 'selected-row' : ''}><td className="checkbox-cell"><input type="checkbox" aria-label={`${row.storeName} 선택`} checked={selected.has(row.orderId)} onChange={() => toggleRow(row)} /></td><td><strong>{row.registrantUsername}</strong><small>{row.orderNumber}</small></td><td>{labelForProgram(row.programType).replace(' +', '+')}</td><td><strong>{row.storeName}</strong></td><td>{row.keyword}</td><td>{formatDate(row.startDate)}</td><td>{formatDate(row.endDate)}</td><td>{row.dailyShots.toLocaleString('ko-KR')}{unitLabelForProgram(row.programType)}</td><td>{formatWon(row.pricePerShot)}</td><td><strong>{formatWon(row.totalAmount)}</strong></td><td><StatusBadge status={row.orderStatus} /></td><td><span className={`managed-settlement-badge managed-settlement-${row.settlementStatus}`}>{row.settlementStatus}</span><small>{row.settlementDetail}</small></td></tr>)}</tbody></table></div>}
        <div className="managed-orders-pagination"><button className="secondary-button small" disabled={loading || (result?.page ?? 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button><span>{(result?.page ?? 1).toLocaleString('ko-KR')} / {(result?.totalPages ?? 1).toLocaleString('ko-KR')} 페이지</span><button className="secondary-button small" disabled={loading || (result?.page ?? 1) >= (result?.totalPages ?? 1)} onClick={() => setPage((current) => current + 1)}>다음</button></div>
      </section>
    </div>
  )
}
