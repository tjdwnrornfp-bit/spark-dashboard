import type { ManagedOrderRow } from '../domain/types'
import { StatusBadge } from './StatusBadge'
import { isRowInteractive } from '../lib/rowSelection'
import { formatDate } from '../lib/date'
import { formatWon } from '../lib/money'
import { labelForProgram, unitLabelForProgram } from '../lib/program'

export function ManagedOrdersTable({ rows, selected, loading, toggleRow, toggleCurrentPage }: {
  rows: ManagedOrderRow[]; selected: Map<string, ManagedOrderRow>; loading: boolean;
  toggleRow: (row: ManagedOrderRow, shift?: boolean) => void; toggleCurrentPage: () => void;
}) {
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.orderId))
  const checkbox = (row: ManagedOrderRow) => <input type="checkbox" aria-label={`${row.storeName} 선택`} checked={selected.has(row.orderId)} disabled={loading} onClick={event => toggleRow(row, event.shiftKey)} onChange={() => {}} />
  const settlement = (row: ManagedOrderRow) => <><span className={`managed-settlement-badge managed-settlement-${row.settlementStatus}`}>{row.settlementStatus}</span><small>{row.settlementDetail}</small></>
  return <div className="managed-work-results">
    <div className="desktop-table"><table className="managed-orders-table"><thead><tr>
      <th className="checkbox-cell"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allSelected} disabled={loading} onChange={toggleCurrentPage} /></th>
      <th>대행사 / 현재 그룹</th><th>프로그램</th><th>상호명</th><th>대표키워드</th><th>시작일</th><th>종료일</th><th>일일수량</th><th>적용단가</th><th>총금액</th><th>작업상태</th><th>정산상태</th>
    </tr></thead><tbody>{rows.map(row => <tr key={row.orderId} onClick={event => { if (!isRowInteractive(event.target)) toggleRow(row, event.shiftKey) }} className={selected.has(row.orderId) ? 'selected-row' : ''}>
      <td className="checkbox-cell">{checkbox(row)}</td><td><strong title={row.registrantUsername}>{row.registrantUsername}</strong><small title={row.currentGroupName}>{row.currentGroupName || '미지정 그룹'}</small><small>{row.orderNumber}</small></td>
      <td>{labelForProgram(row.programType).replace(' +', '+')}</td><td><strong title={row.storeName}>{row.storeName}</strong></td><td title={row.keyword}>{row.keyword}</td><td>{formatDate(row.startDate)}</td><td>{formatDate(row.endDate)}</td><td>{row.dailyShots.toLocaleString('ko-KR')}{unitLabelForProgram(row.programType)}</td><td>{formatWon(row.pricePerShot)}</td><td><strong>{formatWon(row.totalAmount)}</strong></td><td><StatusBadge status={row.orderStatus} /></td><td>{settlement(row)}</td>
    </tr>)}</tbody></table></div>
    <div className="managed-work-mobile">
      <label className="managed-mobile-select"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allSelected} disabled={loading} onChange={toggleCurrentPage} />현재 페이지 전체 선택</label>
      {rows.map(row => <article key={row.orderId} className={`mobile-order-card ${selected.has(row.orderId) ? 'selected-row' : ''}`} onClick={event => { if (!isRowInteractive(event.target)) toggleRow(row, event.shiftKey) }}>
        <div className="managed-mobile-title">{checkbox(row)}<strong title={row.storeName}>{row.storeName}</strong><StatusBadge status={row.orderStatus} /></div>
        <p title={`${row.currentGroupName} / ${row.registrantUsername}`}>{row.currentGroupName || '미지정 그룹'} / {row.registrantUsername}</p>
        <dl><div><dt>프로그램</dt><dd>{labelForProgram(row.programType)}</dd></div><div><dt>키워드</dt><dd title={row.keyword}>{row.keyword}</dd></div><div><dt>기간</dt><dd>{formatDate(row.startDate)} ~ {formatDate(row.endDate)}</dd></div><div><dt>일일수량 / 단가</dt><dd>{row.dailyShots.toLocaleString('ko-KR')}{unitLabelForProgram(row.programType)} / {formatWon(row.pricePerShot)}</dd></div><div><dt>총금액</dt><dd>{formatWon(row.totalAmount)}</dd></div><div><dt>정산상태</dt><dd>{settlement(row)}</dd></div></dl>
      </article>)}
    </div>
  </div>
}
