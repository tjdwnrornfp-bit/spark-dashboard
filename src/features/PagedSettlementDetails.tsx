import { useState } from 'react'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import type { User } from '../domain/types'
import { useRemoteRead } from '../hooks/useRemoteRead'
import { fetchOrderPage, fetchOutgoingSettlementPage } from '../lib/performance'
import { formatDate } from '../lib/date'
import { formatWon } from '../lib/money'
import { currentGroupNameForOrder } from '../lib/order'
import { unitLabelForProgram } from '../lib/program'

export function PagedOutgoingSettlements({ userId, revision }: { userId: string; revision: number }) {
  const [page, setPage] = useState(1)
  const read = useRemoteRead(`outgoing:${userId}:${revision}:${page}`, () => fetchOutgoingSettlementPage(page))
  return <section className="panel compact-panel fill-panel settlement-outgoing-panel">
    <div className="panel-header"><div><h2>작업 정산 내역</h2><p>내 작업과 하위 작업을 합산한 정산 내역입니다.</p></div></div>
    {read.error && <p role="alert">{read.error} <button className="secondary-button small" onClick={read.reload}>다시 조회</button></p>}
    {read.loading ? <p role="status">정산 내역을 조회하고 있습니다.</p> : read.data && <>
      {read.data.rows.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="simple-table-wrap"><table className="simple-table settlement-table settlement-outgoing-table"><thead><tr><th>작업</th><th>단가</th><th>정산액</th><th>상태</th></tr></thead><tbody>
        {read.data.rows.map((step) => <tr key={step.id}><td><strong>{step.storeName}</strong></td><td>{formatWon(step.unitPrice)} / {unitLabelForProgram(step.programType ?? 'spark')}</td><td><strong>{formatWon(step.totalAmount)}</strong></td><td>{step.confirmedAt ? <span className="payment-confirmed-text">입금확인 완료</span> : <span className="payment-waiting-text">확인 대기</span>}</td></tr>)}
      </tbody></table></div>}
      <Pagination page={read.data.page} total={read.data.totalCount} onChange={setPage} />
    </>}
  </section>
}

export function PagedOrderPaymentStates({ user, revision }: { user: User; revision: number }) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const read = useRemoteRead(`payment-states:${user.id}:${revision}:${page}`, () => fetchOrderPage({ p_page: page }), expanded)
  return <section className="panel compact-panel settlement-orders-panel">
    <div className="panel-header"><div><h2>{user.role === 'admin' ? '전체 작업 결제 상태' : '내 작업 결제 상태'}</h2><p>필요한 입금 확인이 모두 끝나면 작업이 입금완료로 변경됩니다.</p></div><button className="secondary-button small" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '펼쳐서 조회'}</button></div>
    {expanded && <>
      {read.error && <p role="alert">{read.error} <button className="secondary-button small" onClick={read.reload}>다시 조회</button></p>}
      {read.loading ? <p role="status">결제 상태를 조회하고 있습니다.</p> : read.data && <>
        {read.data.rows.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="simple-table-wrap"><table className="simple-table settlement-table settlement-orders-table"><thead><tr>{user.role === 'admin' && <th>등록 그룹</th>}<th>상호명</th><th>{user.role === 'admin' ? '관리자 정산액' : '접수금액'}</th><th>시작일</th><th>상태</th></tr></thead><tbody>
          {read.data.rows.map((order) => <tr key={order.id}>{user.role === 'admin' && <td>{currentGroupNameForOrder(order) || '미지정 그룹'}</td>}<td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td><strong>{formatWon(read.data!.settlementAmounts[order.dbId ?? order.id] ?? 0)}</strong></td><td>{formatDate(order.startDate)}</td><td><StatusBadge status={order.status} /></td></tr>)}
        </tbody></table></div>}
        <Pagination page={read.data.page} total={read.data.totalCount} onChange={setPage} />
      </>}
    </>}
  </section>
}
