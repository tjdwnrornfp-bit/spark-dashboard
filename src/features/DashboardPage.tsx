import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { ProgressGauge } from '../components/ProgressGauge'
import { StatusBadge } from '../components/StatusBadge'
import type { Notice, Order, Page, PaymentStep, User } from '../domain/types'
import { formatDate, daysRemaining } from '../lib/date'
import { formatWon } from '../lib/money'

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
  const visible = user.role === 'admin' ? orders : orders.filter((order) => order.createdBy === user.id)
  const running = visible.filter((order) => order.status === '구동중')
  const paidWaitingStart = visible.filter((order) => order.status === '입금완료')
  const totalRunningShots = running.reduce((sum, order) => sum + order.dailyShots, 0)
  const totalContractShots = visible.reduce((sum, order) => sum + order.dailyShots * order.operationDays, 0)

  // 정산 금액은 주문의 최종 판매가가 아니라 현재 사용자가 실제로 정산하는 단계 금액을 기준으로 계산합니다.
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

  if (user.role !== 'admin') {
    return (
      <div className="page-stack dashboard-page-stack">
        <PageHeader title="대시보드" subtitle={`${user.username}님, 안녕하세요. 오늘 현황을 확인하세요.`} />
        {pinnedNotice && <button className="notice-strip" onClick={() => onNavigate('notices')}><Icon name="notice" /><span>{pinnedNotice.title}</span><Icon name="chevron" /></button>}
        <section className="daily-summary-card">
          <div><span>오늘 구동 타수</span><strong>{totalRunningShots.toLocaleString('ko-KR')}<small>타</small></strong><p>구동중 {running.length}건 · 시작대기 {paidWaitingStart.length}건</p></div>
          <div className="daily-summary-right"><span>전체 타수</span><strong>{totalContractShots.toLocaleString('ko-KR')}</strong><small>내가 직접 접수한 전체 구동 수량</small></div>
        </section>
        <section className="mini-stat-grid payment-stat-grid agency-payment-grid">
          <MiniStat label="입금 대기 금액" value={formatWon(waitingAmount)} />
          <MiniStat label="입금 완료 금액" value={formatWon(confirmedAmount)} />
          <MiniStat label="총 접수 금액" value={formatWon(totalAmount)} />
          <MiniStat label="입금 받은 금액" value={formatWon(receivedAmount)} />
        </section>
        <section className="panel compact-panel dashboard-progress-panel">
          <div className="panel-header"><div><h2>접수 현황</h2><p>구동중인 작업을 한눈에 확인합니다.</p></div></div>
          {running.length === 0 ? <EmptyState text="현재 구동중인 작업이 없습니다." /> : (
            <div className="dashboard-running-list compact-running-grid">
              {running.map((order) => (
                <article key={order.id} className="dashboard-running-item compact-running-card">
                  <div className="compact-running-title"><strong>{order.storeName}</strong><span>{order.keyword}</span></div>
                  <ProgressGauge order={order} now={now} compact />
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
        <div><span>전체 타수</span><strong>{totalContractShots.toLocaleString('ko-KR')}<small>타</small></strong><p>전체 접수의 일일수량 × 구동일수 합계</p></div>
        <div className="admin-kpi-side"><span>오늘 구동 타수</span><strong>{totalRunningShots.toLocaleString('ko-KR')}</strong><small>구동중 {running.length}건</small></div>
      </section>
      <section className="mini-stat-grid payment-stat-grid">
        <MiniStat label="입금 대기 금액" value={formatWon(waitingAmount)} />
        <MiniStat label="입금 완료 금액" value={formatWon(confirmedAmount)} />
        <MiniStat label="총 정산 금액" value={formatWon(totalAmount)} />
      </section>
      <section className="dashboard-lower-grid">
        <section className="panel compact-panel">
          <div className="panel-header"><div><h2>작업 상태 분포</h2><p>전체 작업 기준</p></div></div>
          <div className="status-distribution"><div className="distribution-bar">{statusCounts.map((item) => <i key={item.label} className={`bar-${item.label}`} style={{ width: `${item.value / total * 100}%` }} />)}</div><div className="distribution-legend">{statusCounts.map((item) => <span key={item.label}><i className={`dot-${item.label}`} />{item.label} <b>{item.value}</b></span>)}</div></div>
        </section>
        <section className="panel compact-panel recent-orders-panel">
          <div className="panel-header"><div><h2>최근 접수</h2><p>최근 등록된 작업입니다.</p></div><button className="text-button" onClick={() => onNavigate('orders')}>전체 보기 <Icon name="chevron" /></button></div>
          {recent.length === 0 ? <EmptyState text="접수된 작업이 없습니다." /> : <div className="simple-table-wrap"><table className="simple-table"><thead><tr><th>등록 그룹</th><th>상호명</th><th>시작일</th><th>남은기간</th><th>상태</th></tr></thead><tbody>{recent.map((order) => <tr key={order.id}><td>{adminRegistrantLabel(order)}</td><td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td>{formatDate(order.startDate)}</td><td>{String(daysRemaining(order.startDate, order.endDate, now))}</td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>}
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
