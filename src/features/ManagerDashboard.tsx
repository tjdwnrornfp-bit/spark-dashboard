import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import type {
  ManagedOrdersPreset,
  ManagerAgencyOverviewItem,
  ManagerAgencyOverviewResult,
  ManagerAgencyOverviewSort,
  ManagerDashboardSummary,
  Notice,
  Order,
  Page,
  PaymentStep,
  User,
} from '../domain/types'
import { fetchManagerAgencyOverviewV103, fetchManagerDashboardSummaryV103 } from '../lib/backend'
import { formatWon } from '../lib/money'

const PAGE_SIZE = 12

function directSettlement(order: Order, paymentSteps: PaymentStep[]) {
  const keys = new Set([order.dbId ?? order.id, order.id])
  const steps = paymentSteps.filter((step) => keys.has(step.orderDbId) && step.payerId === order.createdBy)
  if (steps.length === 0) {
    return { total: order.totalAmount, waiting: order.totalAmount, completed: 0 }
  }
  const waiting = steps.filter((step) => !step.confirmedAt).reduce((sum, step) => sum + step.totalAmount, 0)
  const completed = steps.filter((step) => step.confirmedAt).reduce((sum, step) => sum + step.totalAmount, 0)
  return { total: waiting + completed, waiting, completed }
}

function localDashboardData(user: User, members: User[], orders: Order[], paymentSteps: PaymentStep[]) {
  const managed = members.filter((member) => member.managerId === user.id)
  const managedIds = new Set(managed.map((member) => member.id))
  const activeOrders = orders.filter((order) => !order.archivedAt && managedIds.has(order.createdBy))
  const financials = new Map(activeOrders.map((order) => [order.dbId ?? order.id, directSettlement(order, paymentSteps)]))
  const amountFor = (order: Order) => financials.get(order.dbId ?? order.id) ?? { total: 0, waiting: 0, completed: 0 }
  const summary: ManagerDashboardSummary = {
    managedAgencyCount: managed.length,
    totalOrderCount: activeOrders.length,
    totalSettlementAmount: activeOrders.reduce((sum, order) => sum + amountFor(order).total, 0),
    settlementWaitingAmount: activeOrders.reduce((sum, order) => sum + amountFor(order).waiting, 0),
    settlementCompletedAmount: activeOrders.reduce((sum, order) => sum + amountFor(order).completed, 0),
    runningOrderCount: activeOrders.filter((order) => order.status === '구동중').length,
    paymentWaitingOrderCount: activeOrders.filter((order) => order.status === '입금대기').length,
    paymentCompletedOrderCount: activeOrders.filter((order) => order.status === '입금완료').length,
    expiredOrderCount: activeOrders.filter((order) => order.status === '만료').length,
    stoppedOrderCount: activeOrders.filter((order) => order.status === '정지').length,
  }
  const agencies: ManagerAgencyOverviewItem[] = managed.map((member) => {
    const agencyOrders = activeOrders.filter((order) => order.createdBy === member.id)
    return {
      agencyId: member.id,
      username: member.username,
      totalOrderCount: agencyOrders.length,
      runningOrderCount: agencyOrders.filter((order) => order.status === '구동중').length,
      paymentWaitingOrderCount: agencyOrders.filter((order) => order.status === '입금대기').length,
      paymentCompletedOrderCount: agencyOrders.filter((order) => order.status === '입금완료').length,
      expiredOrderCount: agencyOrders.filter((order) => order.status === '만료').length,
      stoppedOrderCount: agencyOrders.filter((order) => order.status === '정지').length,
      totalSettlementAmount: agencyOrders.reduce((sum, order) => sum + amountFor(order).total, 0),
      settlementWaitingAmount: agencyOrders.reduce((sum, order) => sum + amountFor(order).waiting, 0),
      settlementCompletedAmount: agencyOrders.reduce((sum, order) => sum + amountFor(order).completed, 0),
      lastOrderAt: agencyOrders.reduce((latest, order) => order.createdAt > latest ? order.createdAt : latest, ''),
    }
  })
  return { summary, agencies }
}

function sortAgencies(agencies: ManagerAgencyOverviewItem[], sort: ManagerAgencyOverviewSort) {
  return [...agencies].sort((a, b) => {
    if (sort === 'settlement_waiting' && a.settlementWaitingAmount !== b.settlementWaitingAmount) return b.settlementWaitingAmount - a.settlementWaitingAmount
    if (sort === 'orders' && a.totalOrderCount !== b.totalOrderCount) return b.totalOrderCount - a.totalOrderCount
    if (sort === 'running' && a.runningOrderCount !== b.runningOrderCount) return b.runningOrderCount - a.runningOrderCount
    return a.username.localeCompare(b.username, 'ko-KR')
  })
}

export function ManagerDashboard({ user, members, orders, paymentSteps, notices, serverMode, refreshKey, onNavigate, onOpenManagedOrders }: {
  user: User
  members: User[]
  orders: Order[]
  paymentSteps: PaymentStep[]
  notices: Notice[]
  serverMode: boolean
  refreshKey: number
  onNavigate: (page: Page) => void
  onOpenManagedOrders: (preset?: ManagedOrdersPreset) => void
}) {
  const local = useMemo(() => serverMode ? null : localDashboardData(user, members, orders, paymentSteps), [members, orders, paymentSteps, serverMode, user])
  const [serverSummary, setServerSummary] = useState<ManagerDashboardSummary | null>(null)
  const [serverOverview, setServerOverview] = useState<ManagerAgencyOverviewResult | null>(null)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ManagerAgencyOverviewSort>('settlement_waiting')
  const [page, setPage] = useState(1)
  const [summaryError, setSummaryError] = useState('')
  const [overviewError, setOverviewError] = useState('')
  const pinnedNotice = notices.find((notice) => notice.pinned)

  const localOverview = useMemo<ManagerAgencyOverviewResult | null>(() => {
    if (!local) return null
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR')
    const filtered = local.agencies.filter((agency) => !normalizedQuery || agency.username.toLocaleLowerCase('ko-KR').includes(normalizedQuery))
    const sorted = sortAgencies(filtered, sort)
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    const safePage = Math.min(page, totalPages)
    return {
      page: safePage,
      pageSize: PAGE_SIZE,
      totalPages,
      agencyCount: sorted.length,
      agencies: sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    }
  }, [local, page, query, sort])

  const summary = serverMode ? serverSummary : local?.summary ?? null
  const overview = serverMode ? serverOverview : localOverview

  useEffect(() => {
    if (!serverMode) return
    let active = true
    void fetchManagerDashboardSummaryV103().then((result) => {
      if (!active) return
      setServerSummary(result)
      setSummaryError('')
    }).catch(() => {
      if (active) setSummaryError('운영·정산 요약을 불러오지 못했습니다.')
    })
    return () => { active = false }
  }, [refreshKey, serverMode, user.id])

  useEffect(() => {
    if (!serverMode) return
    let active = true
    void fetchManagerAgencyOverviewV103({ page, pageSize: PAGE_SIZE, query, sort }).then((result) => {
      if (!active) return
      setServerOverview(result)
      setOverviewError('')
      if (result.page > result.totalPages) setPage(result.totalPages)
    }).catch(() => {
      if (active) setOverviewError('대행사별 현황을 불러오지 못했습니다.')
    })
    return () => { active = false }
  }, [page, query, refreshKey, serverMode, sort, user.id])

  const openAgency = (agencyId: string, settlementStatus?: ManagedOrdersPreset['settlementStatus']) => {
    onOpenManagedOrders({ agencyId, settlementStatus })
  }
  const onCardKeyDown = (event: React.KeyboardEvent<HTMLElement>, agencyId: string) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openAgency(agencyId)
  }
  const value = (amount: number | undefined) => summary ? formatWon(amount ?? 0) : '불러오는 중'
  const count = (amount: number | undefined, unit: string) => summary ? `${(amount ?? 0).toLocaleString('ko-KR')}${unit}` : '불러오는 중'

  return (
    <div className="page-stack dashboard-page-stack manager-dashboard-stack">
      <header className="page-header"><div><h1>대시보드</h1><p>{user.username} 중간관리자 계정의 운영 및 정산 현황입니다.</p></div><button className="primary-button" onClick={() => onOpenManagedOrders()}><Icon name="orders" />관리 작업 보기</button></header>
      {pinnedNotice && <button className="notice-strip" onClick={() => onNavigate('notices')}><Icon name="notice" /><span>{pinnedNotice.title}</span><Icon name="chevron" /></button>}

      <section className="manager-dashboard-kpis" aria-label="관리 운영 핵심 지표">
        <article><span>관리 대행사 수</span><strong>{count(summary?.managedAgencyCount, '명')}</strong></article>
        <article><span>전체 작업 수</span><strong>{count(summary?.totalOrderCount, '건')}</strong></article>
        <article><span>총 정산금액</span><strong>{value(summary?.totalSettlementAmount)}</strong></article>
        <article className="waiting"><span>정산대기 금액</span><strong>{value(summary?.settlementWaitingAmount)}</strong></article>
        <article className="completed"><span>정산완료 금액</span><strong>{value(summary?.settlementCompletedAmount)}</strong></article>
      </section>

      <section className="manager-operation-summary" aria-label="작업 상태 요약">
        <span><i className="dot-구동중" />구동중 <strong>{count(summary?.runningOrderCount, '건')}</strong></span>
        <span><i className="dot-입금대기" />입금대기 <strong>{count(summary?.paymentWaitingOrderCount, '건')}</strong></span>
        <span><i className="dot-입금완료" />입금완료 <strong>{count(summary?.paymentCompletedOrderCount, '건')}</strong></span>
        <span><i className="dot-만료" />만료 <strong>{count(summary?.expiredOrderCount, '건')}</strong></span>
        <span><i className="dot-정지" />정지 <strong>{count(summary?.stoppedOrderCount, '건')}</strong></span>
      </section>
      {summaryError && <p className="inline-message error">{summaryError} 잠시 후 다시 확인해 주세요.</p>}

      <section className="panel compact-panel manager-agency-overview">
        <div className="panel-header manager-agency-overview-header">
          <div><h2>관리 대행사별 현황</h2><p>대행사별 작업과 실제 payment step 기준 정산 금액입니다.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); setQuery(queryDraft.trim()); setPage(1) }}>
            <div className="manager-agency-search"><Icon name="search" /><input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="대행사 아이디 검색" aria-label="대행사 아이디 검색" /><button className="secondary-button small" type="submit">검색</button></div>
            <select value={sort} onChange={(event) => { setSort(event.target.value as ManagerAgencyOverviewSort); setPage(1) }} aria-label="대행사 정렬">
              <option value="settlement_waiting">정산대기금액순</option>
              <option value="orders">전체작업순</option>
              <option value="running">구동중순</option>
              <option value="username">아이디순</option>
            </select>
          </form>
        </div>
        {overviewError && <p className="inline-message error">{overviewError}</p>}
        {!overview && !overviewError ? <div className="empty-state">대행사 현황을 불러오는 중입니다.</div> : overview?.agencies.length === 0 ? <div className="empty-state">조건에 맞는 관리 대행사가 없습니다.</div> : (
          <div className="manager-agency-card-grid">
            {overview?.agencies.map((agency) => (
              <article key={agency.agencyId} className="manager-agency-card" role="button" tabIndex={0} onClick={() => openAgency(agency.agencyId)} onKeyDown={(event) => onCardKeyDown(event, agency.agencyId)}>
                <header><div><span>대행사</span><strong>{agency.username}</strong></div><b>전체 {agency.totalOrderCount.toLocaleString('ko-KR')}건</b></header>
                <div className="manager-agency-status-grid">
                  <span>구동중 <strong>{agency.runningOrderCount.toLocaleString('ko-KR')}</strong></span>
                  <span>입금대기 <strong>{agency.paymentWaitingOrderCount.toLocaleString('ko-KR')}</strong></span>
                  <span>입금완료 <strong>{agency.paymentCompletedOrderCount.toLocaleString('ko-KR')}</strong></span>
                  <span>만료 <strong>{agency.expiredOrderCount.toLocaleString('ko-KR')}</strong></span>
                </div>
                <div className="manager-agency-settlement">
                  <button onClick={(event) => { event.stopPropagation(); openAgency(agency.agencyId, '정산대기') }}><span>정산대기</span><strong>{formatWon(agency.settlementWaitingAmount)}</strong></button>
                  <button onClick={(event) => { event.stopPropagation(); openAgency(agency.agencyId, '정산완료') }}><span>정산완료</span><strong>{formatWon(agency.settlementCompletedAmount)}</strong></button>
                </div>
                <button className="manager-agency-open" onClick={(event) => { event.stopPropagation(); openAgency(agency.agencyId) }}>작업 보기 <Icon name="chevron" /></button>
              </article>
            ))}
          </div>
        )}
        <div className="manager-agency-pagination">
          <span>총 {(overview?.agencyCount ?? 0).toLocaleString('ko-KR')}개 대행사</span>
          <div><button className="secondary-button small" disabled={(overview?.page ?? 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button><span>{overview?.page ?? 1} / {overview?.totalPages ?? 1}</span><button className="secondary-button small" disabled={(overview?.page ?? 1) >= (overview?.totalPages ?? 1)} onClick={() => setPage((current) => current + 1)}>다음</button></div>
        </div>
      </section>
    </div>
  )
}
