import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import type { Order, OrderStatus, ProgramType } from '../domain/types'
import { ADMIN_EXCEL_PROGRAM_LABELS, downloadAdminOrdersExcel } from '../lib/adminExcel'
import { todayInSeoul } from '../lib/date'
import { STATUS_ORDER } from '../lib/order'

const PROGRAM_TYPES: ProgramType[] = ['spark', 'spark_plus', 'spark_s']

function orderKey(order: Order): string {
  return order.dbId ?? order.id
}

function includesText(value: string, query: string): boolean {
  return value.toLocaleLowerCase('ko-KR').includes(query.toLocaleLowerCase('ko-KR'))
}

export function AdminOrdersExportModal({ orders, now, onClose }: { orders: Order[]; now: Date; onClose: () => void }) {
  const [programs, setPrograms] = useState<Set<ProgramType>>(() => new Set(PROGRAM_TYPES))
  const [statuses, setStatuses] = useState<Set<OrderStatus>>(() => new Set(STATUS_ORDER))
  const [groupQuery, setGroupQuery] = useState('')
  const [registrantQuery, setRegistrantQuery] = useState('')
  const [mode, setMode] = useState<'filtered' | 'selected'>('filtered')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const normalizedGroup = groupQuery.trim()
    const normalizedRegistrant = registrantQuery.trim()
    return orders
      .filter((order) => !order.archivedAt)
      .filter((order) => programs.has(order.programType ?? 'spark'))
      .filter((order) => statuses.has(order.status))
      .filter((order) => !normalizedGroup || includesText(order.creatorGroupName || '', normalizedGroup))
      .filter((order) => !normalizedRegistrant || includesText(order.creatorUsername, normalizedRegistrant))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [groupQuery, orders, programs, registrantQuery, statuses])

  const selected = useMemo(() => filtered.filter((order) => selectedIds.has(orderKey(order))), [filtered, selectedIds])
  const target = mode === 'filtered' ? filtered : selected
  const allVisibleSelected = filtered.length > 0 && filtered.every((order) => selectedIds.has(orderKey(order)))

  const toggleProgram = (programType: ProgramType) => {
    setPrograms((current) => {
      const next = new Set(current)
      next.has(programType) ? next.delete(programType) : next.add(programType)
      return next
    })
  }

  const toggleStatus = (status: OrderStatus) => {
    setStatuses((current) => {
      const next = new Set(current)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }

  const toggleOrder = (order: Order) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const key = orderKey(order)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) filtered.forEach((order) => next.delete(orderKey(order)))
      else filtered.forEach((order) => next.add(orderKey(order)))
      return next
    })
  }

  const download = () => {
    if (target.length === 0) {
      window.alert(mode === 'filtered' ? '조건에 맞는 작업이 없습니다.' : '다운로드할 작업을 선택해 주세요.')
      return
    }
    downloadAdminOrdersExcel({
      orders: target,
      fileName: `spark-integrated-orders-${todayInSeoul(now)}.xlsx`,
      sheetName: '통합작업',
    })
  }

  return <Modal
    className="integrated-export-modal"
    title="통합 엑셀 다운로드"
    description="프로그램과 상태를 복수 선택한 뒤 조건 전체 또는 필요한 작업만 내려받습니다. 보관 작업은 제외됩니다."
    onClose={onClose}
    footer={<>
      <span className="export-footer-count">다운로드 {target.length.toLocaleString('ko-KR')}건</span>
      <button className="secondary-button" onClick={onClose}>취소</button>
      <button className="primary-button" disabled={target.length === 0} onClick={download}><Icon name="download" />엑셀 다운로드</button>
    </>}
  >
    <div className="integrated-export-form">
      <fieldset className="export-filter-group">
        <legend>프로그램</legend>
        <div className="export-checkbox-grid program-options">{PROGRAM_TYPES.map((programType) => <label key={programType}><input type="checkbox" checked={programs.has(programType)} onChange={() => toggleProgram(programType)} /><span>{ADMIN_EXCEL_PROGRAM_LABELS[programType]}</span></label>)}</div>
      </fieldset>

      <fieldset className="export-filter-group">
        <legend>상태</legend>
        <div className="export-checkbox-grid status-options">{STATUS_ORDER.map((status) => <label key={status}><input type="checkbox" checked={statuses.has(status)} onChange={() => toggleStatus(status)} /><span>{status}</span></label>)}</div>
      </fieldset>

      <div className="export-search-grid">
        <label><span>그룹명 검색</span><input value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} placeholder="그룹명 일부 입력" /></label>
        <label><span>등록자 검색</span><input value={registrantQuery} onChange={(event) => setRegistrantQuery(event.target.value)} placeholder="등록자 아이디 일부 입력" /></label>
      </div>

      <fieldset className="export-filter-group export-mode-group">
        <legend>다운로드 범위</legend>
        <label className={mode === 'filtered' ? 'active' : ''}><input type="radio" name="export-mode" checked={mode === 'filtered'} onChange={() => setMode('filtered')} /><span><strong>조건에 맞는 전체 작업</strong><small>{filtered.length.toLocaleString('ko-KR')}건을 하나의 시트로 합산</small></span></label>
        <label className={mode === 'selected' ? 'active' : ''}><input type="radio" name="export-mode" checked={mode === 'selected'} onChange={() => setMode('selected')} /><span><strong>작업을 직접 선택</strong><small>아래 목록에서 선택한 {selected.length.toLocaleString('ko-KR')}건만 다운로드</small></span></label>
      </fieldset>

      <div className="export-result-header">
        <div><strong>검색 결과 {filtered.length.toLocaleString('ko-KR')}건</strong><small>현재 운영 작업 기준</small></div>
        {mode === 'selected' && <button className="secondary-button small" disabled={filtered.length === 0} onClick={toggleAllVisible}>{allVisibleSelected ? '전체 해제' : '전체 선택'}</button>}
      </div>

      {mode === 'selected' && (filtered.length === 0
        ? <div className="empty-state export-empty-state">조건에 맞는 작업이 없습니다.</div>
        : <div className="export-selection-list">
          {filtered.map((order) => <label key={orderKey(order)} className={selectedIds.has(orderKey(order)) ? 'selected' : ''}>
            <input type="checkbox" checked={selectedIds.has(orderKey(order))} onChange={() => toggleOrder(order)} />
            <span className="export-order-program">{ADMIN_EXCEL_PROGRAM_LABELS[order.programType ?? 'spark']}</span>
            <span><strong>{order.storeName}</strong><small>{order.creatorUsername} · {order.creatorGroupName || '-'} · {order.keyword}</small></span>
            <span className="export-order-status">{order.status}</span>
          </label>)}
        </div>)}
    </div>
  </Modal>
}
