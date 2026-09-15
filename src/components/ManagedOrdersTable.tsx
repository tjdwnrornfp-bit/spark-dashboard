import type { ManagedOrderRow } from '../domain/types'
import { StatusBadge } from './StatusBadge'
import { isRowInteractive } from '../lib/rowSelection'
import { formatDate } from '../lib/date'
import { formatWon } from '../lib/money'
import { labelForProgram, unitLabelForProgram } from '../lib/program'
export function ManagedOrdersTable({rows,selected,loading,toggleRow,toggleCurrentPage}: {
 rows: ManagedOrderRow[]; selected: Map<string,ManagedOrderRow>; loading: boolean;
 toggleRow: (row:ManagedOrderRow,shift?:boolean)=>void; toggleCurrentPage:()=>void
}) {
 const allCurrentSelected=rows.length>0 && rows.every(row=>selected.has(row.orderId))
 return (<div className="desktop-table"><table className="managed-orders-table"><thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allCurrentSelected} disabled={loading} onChange={toggleCurrentPage} /></th><th>대행사</th><th>프로그램</th><th>상호명</th><th>대표키워드</th><th>시작일</th><th>종료일</th><th>일일수량</th><th>적용단가</th><th>총금액</th><th>작업상태</th><th>정산상태</th></tr></thead><tbody>{rows.map((row) => <tr key={row.orderId} onClick={(event) => { if (!isRowInteractive(event.target)) toggleRow(row, event.shiftKey) }} className={selected.has(row.orderId) ? 'selected-row' : ''}><td className="checkbox-cell"><input type="checkbox" aria-label={`${row.storeName} 선택`} checked={selected.has(row.orderId)} disabled={loading} onClick={(event) => toggleRow(row, event.shiftKey)} onChange={() => {}} /></td><td><strong>{row.registrantUsername}</strong><small>{row.orderNumber}</small></td><td>{labelForProgram(row.programType).replace(' +', '+')}</td><td><strong>{row.storeName}</strong></td><td>{row.keyword}</td><td>{formatDate(row.startDate)}</td><td>{formatDate(row.endDate)}</td><td>{row.dailyShots.toLocaleString('ko-KR')}{unitLabelForProgram(row.programType)}</td><td>{formatWon(row.pricePerShot)}</td><td><strong>{formatWon(row.totalAmount)}</strong></td><td><StatusBadge status={row.orderStatus} /></td><td><span className={`managed-settlement-badge managed-settlement-${row.settlementStatus}`}>{row.settlementStatus}</span><small>{row.settlementDetail}</small></td></tr>)}</tbody></table></div>)
}
