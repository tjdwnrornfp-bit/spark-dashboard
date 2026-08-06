import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { ProgressGauge } from '../components/ProgressGauge'
import { StatusBadge } from '../components/StatusBadge'
import type { Notice, Order, Page, PaymentStep, User } from '../domain/types'
import { formatDate, daysRemaining } from '../lib/date'
import { formatWon } from '../lib/money'
import { PROGRAMS, programOrders } from '../lib/program'

function adminRegistrantLabel(order: Order): string {
  const group = order.creatorGroupName.trim() || '미지정 그룹'
  return order.sponsorId ? `${group} 하위` : group
}

export function DashboardPage({ user, orders, paymentSteps, notices, now, onNavigate }: {
  user: User
  orders: Order[]
  paymentSteps: PaymentStep[]
  notices: Notice[]
  now: Date
  onNavigate: (page: Page) => void
}) {
  const activeOrders = orders.filter((order) => !order.archivedAt)
  const visible = user.role === 'admin' ? activeOrders : activeOrders.filter((order) => order.createdBy === user.id)
  const running = visible.filter((order) => order.status === '구동중')
  const paidWaitingStart = visible.filter((order) => order.status === '입금완료')
  const runningShots = running.filter((order) => order.programType !== 'spark_s').reduce((sum, order) => sum + order.dailyShots, 0)
  const runningCases = running.filter((order) => order.programType === 'spark_s').reduce((sum, order) => sum + order.dailyShots, 0)
  const totalContractShots = visible.filter((order) => order.programType !== 'spark_s').reduce((sum, order) => sum + order.dailyShots * order.operationDays, 0)
  const totalContractCases = visible.filter((order) => order.programType === 'spark_s').reduce((sum, order) => sum + order.dailyShots * order.operationDays, 0)

  const settlementSteps = user.role === 'admin'
    ? paymentSteps.filter((step) => step.payeeId === user.id)
    : paymentSteps.filter((step) => step.payerId === user.id)
  const waitingAmount = settlementSteps.filter((step) => !step.confirmedAt).reduce((sum, step) => sum + step.totalAmount, 0)
  const confirmedAmount = settlementSteps.filter((step) => step.confirmedAt).reduce((sum, step) => sum + step.totalAmount, 0)
  const totalAmount = waitingAmount + confirmedAmount
  const receivedAmount = user.role === 'admin' ? 0 : paymentSteps
    .filter((step) => step.payeeId === user.id && step.confirmedAt)
    .reduce((sum, step) => sum + step.totalAmount, 0)

  const recent = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 7)
  const pinnedNotice = notices.find((notice) => notice.pinned)
  const programSummaries = PROGRAMS.map((program) => {
    const list = programOrders(visible, program.type)
    return {
      ...program,
      total: list.length,
      waiting: list.filter((order) => order.status === '입금대기').length,
      paid: list.filter((order) => order.status === '입금완료').length,
      running: list.filter((order) => order.status === '구동중').length,
      expired: list.filter((order) => order.status === '만료').length,
    }
  })

  if (user.role !== 'admin') {
    return (
      <div className="page-stack dashboard-page-stack">
        <PageHeader title="대시보드" subtitle={`${user.username}님, 안녕하세요. 오늘 현황을 확인하세요.`} />
        {pinnedNotice && <button className="notice-strip" onClick={() => onNavigate('notices')}><Icon name="notice" /><span>{pinnedNotice.title}</span><Icon name="chevron" /></button>}
        <section className="daily-summary-card">
          <div><span>오늘 구동 타수</span><strong>{runningShots.toLocaleString('ko-KR')}<small>타</small></strong><p>구동중 {running.length}건 · 스파크S {runningCases.toLocaleString('ko-KR')}건</p></div>
          <div className="daily-summary-right"><span>전체 타수</span><strong>{totalContractShots.toLocaleString('ko-KR')}</strong><small>스파크S 전체 {totalContractCases.toLocaleString('ko-KR')}건</small></div>
        </section>
        <section className="mini-stat-grid payment-stat-grid agency-payment-grid">
          <MiniStat label="입금 대기 금액" value={formatWon(waitingAmount)} />
          <MiniStat label="입금 완료 금액" value={formatWon(confirmedAmount)} />
          <MiniStat label="총 접수 금액" value={formatWon(totalAmount)} />
          <MiniStat label="입금 받은 금액" value={formatWon(receivedAmount)} />
        </section>
        <section className="panel compact-panel dashboard-progress-panel program-summary-panel">
          <div className="panel-header"><div><h2>프로그램별 접수 현황</h2><p>세 프로그램의 진행 상태를 한눈에 확인합니다.</p></div></div>
          <div className="program-dashboard-grid">
            {programSummaries.map((summary) => <button key={summary.type} className="program-summary-card" onClick={() => onNavigate(summary.page)}><div className="program-summary-head"><strong>{summary.label}</strong></div><div className="program-summary-body"><span>전체 {summary.total}건</span><span>입금대기 {summary.waiting}건</span><span>입금완료 {summary.paid}건</span><span>구동중 {summary.running}건</span></div></button>)}
          </div>
        </section>
        <section className="panel compact-panel dashboard-progress-panel">
          <div className="panel-header"><div><h2>구동중 작업</h2><p>현재 구동중인 작업을 한눈에 확인합니다.</p></div></div>
          {running.length === 0 ? <EmptyState text="현재 구동중인 작업이 없습니다." /> : (
            <div className="dashboard-running-list compact-running-grid">
              {running.map((order) => (
                <article key={order.id} className="dashboard-running-item compact-running-card">
                  <div className="compact-running-title"><strong>[{PROGRAMS.find((program) => program.type === order.programType)?.label}] {order.storeName}</strong><span>{order.keyword}</span></div>
                  {order.programType === 'spark_s' ? <span className="spark-s-running-status">구동중 · {order.dailyShots.toLocaleString('ko-KR')}건</span> : <ProgressGauge order={order} now={now} compact />}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  const waiting = visible.filter((order) => order.status === '입금대기')
  const statusCounts = [
    { label: '입금대기', value: waiting.length },
    { label: '입금완료', value: paidWaitingStart.length },
    { label: '구동중', value: running.length },
    { label: '정지', value: visible.filter((order) => order.status === '정지').length },
    { label: '만료', value: visible.filter((order) => order.status === '만료').length },
  ]
  const total = Math.max(1, visible.length)

  return (
    <div className="page-stack dashboard-page-stack">
      <PageHeader title="대시보드" subtitle="전체 작업 수량과 관리자 정산 현황을 확인합니다." />
      <section className="admin-kpi-card">
        <div><span>전체 타수</span><strong>{totalContractShots.toLocaleString('ko-KR')}<small>타</small></strong><p>스파크S 전체 {totalContractCases.toLocaleString('ko-KR')}건</p></div>
        <div className="admin-kpi-side"><span>오늘 구동 타수</span><strong>{runningShots.toLocaleString('ko-KR')}</strong><small>스파크S {runningCases.toLocaleString('ko-KR')}건 · 구동중 {running.length}건</small></div>
      </section>
      <section className="mini-stat-grid payment-stat-grid">
        <MiniStat label="입금 대기 금액" value={formatWon(waitingAmount)} />
        <MiniStat label="입금 완료 금액" value={formatWon(confirmedAmount)} />
        <MiniStat label="총 정산 금액" value={formatWon(totalAmount)} />
      </section>
      <section className="panel compact-panel dashboard-progress-panel program-summary-panel">
        <div className="panel-header"><div><h2>프로그램별 접수 현황</h2><p>스파크, 스파크 +, 스파크S를 분리해 관리합니다.</p></div></div>
        <div className="program-dashboard-grid">
          {programSummaries.map((summary) => <button key={summary.type} className="program-summary-card" onClick={() => onNavigate(summary.page)}><div className="program-summary-head"><strong>{summary.label}</strong></div><div className="program-summary-body"><span>전체 {summary.total}건</span><span>입금대기 {summary.waiting}건</span><span>입금완료 {summary.paid}건</span><span>구동중 {summary.running}건</span><span>만료 {summary.expired}건</span></div></button>)}
        </div>
      </section>
      <section className="dashboard-lower-grid">
        <section className="panel compact-panel">
          <div className="panel-header"><div><h2>작업 상태 분포</h2><p>전체 작업 기준</p></div></div>
          <div className="status-distribution"><div className="distribution-bar">{statusCounts.map((item) => <i key={item.label} className={`bar-${item.label}`} style={{ width: `${item.value / total * 100}%` }} />)}</div><div className="distribution-legend">{statusCounts.map((item) => <span key={item.label}><i className={`dot-${item.label}`} />{item.label} <b>{item.value}</b></span>)}</div></div>
        </section>
        <section className="panel compact-panel recent-orders-panel">
          <div className="panel-header"><div><h2>최근 접수</h2><p>최근 등록된 작업입니다.</p></div><button className="text-button" onClick={() => onNavigate('sparkOrders')}>접수 보기 <Icon name="chevron" /></button></div>
          {recent.length === 0 ? <EmptyState text="접수된 작업이 없습니다." /> : <div className="simple-table-wrap"><table className="simple-table"><thead><tr><th>프로그램</th><th>등록 그룹</th><th>상호명</th><th>시작일</th><th>남은기간</th><th>상태</th></tr></thead><tbody>{recent.map((order) => <tr key={order.id}><td>{PROGRAMS.find((program) => program.type === order.programType)?.label}</td><td>{adminRegistrantLabel(order)}</td><td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td>{formatDate(order.startDate)}</td><td>{String(daysRemaining(order.startDate, order.endDate, now))}</td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>}
        </section>
      </section>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <article className="mini-stat"><span>{label}</span><strong>{value}</strong></article>
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}
