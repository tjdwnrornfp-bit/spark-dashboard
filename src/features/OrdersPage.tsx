import { MemberOrderEditModal } from './MemberOrderEditModal'
import { fetchOwnOrderEditEligibility } from '../lib/backend'
import { isRowInteractive, selectRowRange } from '../lib/rowSelection'
import { AdminOrderCorrectionModal } from './AdminOrderCorrectionModal'
import { intakeWarning } from '../lib/orderCorrection'
import type { CorrectionDraft, CorrectionPreview } from '../lib/orderCorrection'
import { AdminOrderAssignmentModal } from './AdminOrderAssignmentModal'
import { AdminBulkOrderAssignmentModal } from './AdminBulkOrderAssignmentModal'
import type { AdminAssignmentResult, AdminAssignmentRow } from '../lib/adminAssignment'
import { currentGroupNameForOrder } from '../lib/order'
import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { read, utils, writeFileXLSX } from 'xlsx'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { ProgramIcon } from '../components/ProgramIcon'
import { ProgressGauge } from '../components/ProgressGauge'
import { StatusBadge } from '../components/StatusBadge'
import type { AppSettings, BulkProgramTransferPreview, BulkProgramTransferResult, Order, OrderDraft, OrderStatus, ProgramType, User } from '../domain/types'
import { downloadAdminOrdersExcel } from '../lib/adminExcel'
import { calculateOperationDates, daysRemaining, earliestOrderStartDate, formatDate, isIsoDate, todayInSeoul } from '../lib/date'
import { calculateAmount, formatWon } from '../lib/money'
import { allowedOrderStatuses, extractMid, STATUS_ORDER, validateDraft } from '../lib/order'
import { getUserProgramPrice, labelForProgram, programMeta, unitLabelForProgram, unitPriceLabelForProgram } from '../lib/program'
import { AdminOrdersExportModal } from './AdminOrdersExportModal'
import { AdminBulkProgramTransferModal } from './AdminBulkProgramTransferModal'
import { PageHeader } from './DashboardPage'

function emptyDraft(programType: ProgramType, now = new Date()): OrderDraft {
  return { programType, placeUrl: '', storeName: '', keyword: '', dailyShots: '', operationDays: '', startDate: earliestOrderStartDate(now), memo: '' }
}

const BULK_HEADERS = ['상호명', '대표키워드', '플레이스URL', '일일수량', '구동일수', '시작일', '메모']

interface Preview {
  draft: OrderDraft
  mid: string
  startDate: string
  endDate: string
  supplyAmount: number
  vatAmount: number
  totalAmount: number
}

type OrderSortDirection = 'desc' | 'asc'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '요청을 처리하지 못했습니다.'
}

function normalizeHeader(value: string): string {
  return value.normalize('NFKC').replaceAll(/\s+/g, '').toLocaleLowerCase('ko-KR')
}

function rawCell(row: Record<string, unknown>, ...names: string[]): unknown {
  const entries = Object.entries(row)
  for (const name of names) {
    const match = entries.find(([key]) => normalizeHeader(key) === normalizeHeader(name))
    if (match) return match[1]
  }
  return ''
}

function cell(row: Record<string, unknown>, ...names: string[]): string {
  return String(rawCell(row, ...names) ?? '').trim()
}

function pad(num: number): string {
  return String(num).padStart(2, '0')
}

function dateToLocalIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function excelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateToLocalIso(value)
  if (typeof value === 'number' && Number.isFinite(value)) {
    const utcDate = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())}`
  }
  const text = String(value ?? '').trim()
  if (!text) return ''
  const normalized = text.replace(/[./]/g, '-').replace(/\s.*$/, '')
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!match) return text
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function excelDisplayWidth(value: string | number | null | undefined): number {
  const text = String(value ?? '')
  return Array.from(text).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0)
}

function autoFitExcelColumns(rows: Array<Array<string | number>>, options?: {
  minWidths?: number[]
  maxWidths?: number[]
  padding?: number
}) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  const padding = options?.padding ?? 2
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const contentWidth = Math.max(0, ...rows.map((row) => excelDisplayWidth(row[columnIndex]))) + padding
    const minWidth = options?.minWidths?.[columnIndex] ?? 8
    const maxWidth = options?.maxWidths?.[columnIndex] ?? 32
    return { wch: Math.max(minWidth, Math.min(maxWidth, Math.ceil(contentWidth))) }
  })
}

export function OrdersPage({ memberEditRefreshKey, onMemberEditPreview, onMemberEditApply, onCorrectionPreview, onCorrectionApply, user, orders, settings, now, programType, onCreateOrder, onCreateOrdersBulk, onStatusChange, onBulkProgramTransferPreview, onBulkProgramTransfer, onArchiveOrder, onRestoreOrder, onLoadAssignmentMembers, onAdminAssign, onAdminBulkAssign }: {
  user: User
  memberEditRefreshKey: number
  onMemberEditPreview: (order: Order, draft: OrderDraft, reason: string) => Promise<CorrectionPreview>
  onMemberEditApply: (order: Order, draft: OrderDraft, reason: string) => Promise<Order>
  onLoadAssignmentMembers: () => Promise<User[]>
  onAdminAssign: (member: User, draft: OrderDraft, requestId: string) => Promise<Order>
  onCorrectionPreview: (order: Order, draft: CorrectionDraft, reason: string) => Promise<CorrectionPreview>
  onCorrectionApply: (order: Order, draft: CorrectionDraft, reason: string) => Promise<Order>
  onAdminBulkAssign: (rows: AdminAssignmentRow[], requestId: string) => Promise<AdminAssignmentResult[]>
  orders: Order[]
  settings: AppSettings
  now: Date
  programType: ProgramType
  onCreateOrder: (draft: OrderDraft) => Promise<Order>
  onCreateOrdersBulk: (drafts: OrderDraft[]) => Promise<Order[]>
  onStatusChange: (order: Order, status: OrderStatus, reason: string) => Promise<void>
  onBulkProgramTransferPreview: (orders: Order[], targetProgram: ProgramType) => Promise<BulkProgramTransferPreview>
  onBulkProgramTransfer: (orders: Order[], targetProgram: ProgramType, reason: string) => Promise<BulkProgramTransferResult>
  onArchiveOrder: (order: Order, reason: string) => Promise<void>
  onRestoreOrder: (order: Order, reason: string) => Promise<void>
}) {
  const [memberEdit, setMemberEdit] = useState<{ order: Order; programOnly: boolean } | null>(null)
  const [eligibility, setEligibility] = useState<Map<string, number>>(new Map())
  const [eligibilityError, setEligibilityError] = useState('')
  const selectionAnchor = useRef<string | null>(null)
  const [assignmentMode, setAssignmentMode] = useState<'manual' | 'excel' | null>(null)
  const [correctionOrder, setCorrectionOrder] = useState<Order | null>(null)
  const [bulkRowNumbers, setBulkRowNumbers] = useState<number[]>([])
  const [bulkWarningsAccepted, setBulkWarningsAccepted] = useState(false)
  const [filter, setFilter] = useState<'전체' | OrderStatus>('전체')
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>('active')
  const [query, setQuery] = useState('')
  const [sortDirection, setSortDirection] = useState<OrderSortDirection>('desc')
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<OrderDraft>(() => emptyDraft(programType, now))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [bulkDrafts, setBulkDrafts] = useState<OrderDraft[]>([])
  const [bulkErrors, setBulkErrors] = useState<string[]>([])
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [integratedExportOpen, setIntegratedExportOpen] = useState(false)
  const [bulkTransferOrders, setBulkTransferOrders] = useState<Order[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const minimumStartDate = earliestOrderStartDate(now)
  const programLabel = labelForProgram(programType)
  const unitPrice = getUserProgramPrice(user, programType)
  const quantityUnit = unitLabelForProgram(programType)
  const unitPriceLabel = unitPriceLabelForProgram(programType)
  const showProgress = user.role !== 'admin' && programType !== 'spark_s' && programType !== 'spark_s_plus'
  const meta = programMeta(programType)

  const sourceOrders = useMemo(() => orders.filter((order) => (order.programType ?? 'spark') === programType), [orders, programType])
  const selectedOrders = useMemo(() => orders.filter((order) => selectedIds.has(order.id)), [orders, selectedIds])

  const visible = useMemo(() => {
    const owned = user.role === 'admin' ? sourceOrders : sourceOrders.filter((order) => order.createdBy === user.id)
    const source = owned.filter((order) => archiveView === 'archived' ? Boolean(order.archivedAt) : !order.archivedAt)
    return source
      .filter((order) => filter === '전체' || order.status === filter)
      .filter((order) => {
        const keyword = query.trim().toLocaleLowerCase('ko-KR')
        return !keyword || [order.id, order.creatorUsername, order.sponsorUsername ?? '', currentGroupNameForOrder(order), order.storeName, order.keyword, order.mid].some((value) => value.toLocaleLowerCase('ko-KR').includes(keyword))
      })
      .sort((a, b) => {
        const comparison = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
        return sortDirection === 'asc' ? comparison : -comparison
      })
  }, [archiveView, filter, sourceOrders, query, sortDirection, user.id, user.role])

  useEffect(() => { selectionAnchor.current = null }, [filter, archiveView, query, sortDirection, programType])
  useEffect(() => {
    const ids = new Set(orders.map((order) => order.id))
    setSelectedIds((current) => new Set([...current].filter((id) => ids.has(id))))
  }, [orders])
  useEffect(() => {
    let active = true
    setEligibility(new Map()); setEligibilityError('')
    if (user.isOperationsManager || !['agency', 'distributor'].includes(user.role ?? '')) return
    const ids = sourceOrders.filter((o) => o.createdBy === user.id && o.status === '입금대기' && !o.archivedAt && o.dbId).map((o) => o.dbId!)
    void fetchOwnOrderEditEligibility(ids).then((result) => { if (active) setEligibility(result) }).catch(() => { if (active) setEligibilityError('수정 권한을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.') })
    return () => { active = false }
  }, [sourceOrders, user.id, user.role, user.isOperationsManager, memberEditRefreshKey])
  const toggleSelected = (order: Order, shift = false) => {
    const anchor = selectionAnchor.current
    setSelectedIds((current) => selectRowRange(current, visible.map((o) => o.id), anchor, order.id, shift))
    if (!shift || !anchor || !visible.some((o) => o.id === anchor)) selectionAnchor.current = order.id
  }
  const memberActions = (order: Order) => {
    if (user.isOperationsManager || !['agency', 'distributor'].includes(user.role ?? '') || order.createdBy !== user.id || order.status !== '입금대기' || order.archivedAt) return null
    const confirmed = order.dbId ? eligibility.get(order.dbId) : undefined
    if (confirmed && confirmed > 0) return <small>일부 정산이 이미 진행된 작업입니다. 관리자에게 수정을 요청해 주세요.</small>
    return <><button className="secondary-button small" disabled={confirmed !== 0} onClick={() => setMemberEdit({ order, programOnly: false })}>수정</button><button className="secondary-button small" disabled={confirmed !== 0} onClick={() => setMemberEdit({ order, programOnly: true })}>프로그램 변경</button></>
  }

  const counts = useMemo(() => {
    const owned = user.role === 'admin' ? sourceOrders : sourceOrders.filter((order) => order.createdBy === user.id)
    const source = owned.filter((order) => archiveView === 'archived' ? Boolean(order.archivedAt) : !order.archivedAt)
    return Object.fromEntries(['전체', ...STATUS_ORDER].map((status) => [status, status === '전체' ? source.length : source.filter((order) => order.status === status).length])) as Record<'전체' | OrderStatus, number>
  }, [archiveView, sourceOrders, user.id, user.role])

  const updateDraft = (field: keyof OrderDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const toggleForm = () => {
    setFormOpen((current) => {
      const next = !current
      if (next) setDraft((value) => ({ ...emptyDraft(programType, now), startDate: value.startDate >= minimumStartDate ? value.startDate : minimumStartDate }))
      return next
    })
  }

  const openPreview = () => {
    if (unitPrice <= 0) { window.alert(`${programLabel} 단가가 설정된 승인 회원만 접수할 수 있습니다.`); return }
    const nextErrors = validateDraft(draft, now)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const dailyShots = Number(draft.dailyShots)
    const operationDays = Number(draft.operationDays)
    const dates = calculateOperationDates(operationDays, settings.cutoffHour, now, draft.startDate)
    setPreview({ draft, mid: extractMid(draft.placeUrl), ...dates, ...calculateAmount(dailyShots, operationDays, unitPrice) })
  }

  const submitOrder = async () => {
    if (!preview || submitting) return
    setSubmitting(true)
    try {
      const order = await onCreateOrder(preview.draft)
      setCreatedOrder(order)
      setPreview(null)
      setDraft(emptyDraft(programType, now))
      setErrors({})
      setFormOpen(false)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const changeStatus = async (order: Order, status: OrderStatus) => {
    if (order.status === status || changingId || order.archivedAt) return
    const reason = window.prompt(`${order.storeName} 상태를 ${status}(으)로 변경하는 사유를 입력해 주세요.`)?.trim()
    if (!reason) return
    setChangingId(order.id)
    try { await onStatusChange(order, status, reason) } catch (error) { window.alert(getErrorMessage(error)) } finally { setChangingId(null) }
  }

  const archiveOrder = async (order: Order) => {
    if (changingId) return
    const reason = window.prompt(`${order.storeName} 작업을 보관하는 사유를 입력해 주세요. 데이터와 정산 기록은 삭제되지 않습니다.`)?.trim()
    if (!reason) return
    setChangingId(order.id)
    try { await onArchiveOrder(order, reason) } catch (error) { window.alert(getErrorMessage(error)) } finally { setChangingId(null) }
  }

  const restoreOrder = async (order: Order) => {
    if (changingId) return
    const reason = window.prompt(`${order.storeName} 작업을 복원하는 사유를 입력해 주세요.`)?.trim()
    if (!reason) return
    setChangingId(order.id)
    try { await onRestoreOrder(order, reason) } catch (error) { window.alert(getErrorMessage(error)) } finally { setChangingId(null) }
  }

  const toggleAll = () => {
    setSelectedIds((current) => {
      const allSelected = visible.length > 0 && visible.every((order) => current.has(order.id))
      return allSelected ? new Set() : new Set(visible.map((order) => order.id))
    })
  }

  const downloadExcel = () => {
    const target = sourceOrders.filter((order) => selectedIds.has(order.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (target.length === 0) return window.alert('다운로드할 작업을 선택해 주세요.')
    downloadAdminOrdersExcel({
      orders: target,
      fileName: `${meta.orderPrefix.toLowerCase()}-orders-${todayInSeoul(now)}.xlsx`,
      sheetName: meta.sheetName,
    })
  }

  const openBulkProgramTransfer = () => {
    if (selectedOrders.length === 0) {
      window.alert('프로그램을 변경할 작업을 선택해 주세요.')
      return
    }
    setBulkTransferOrders(selectedOrders)
  }

  const finishBulkProgramTransfer = (result: BulkProgramTransferResult) => {
    const finishedOrderNumbers = new Set(result.items.filter((item) => item.status !== 'failed').map((item) => item.orderNumber))
    setSelectedIds((current) => new Set(Array.from(current).filter((orderNumber) => !finishedOrderNumbers.has(orderNumber))))
  }

  const downloadBulkTemplate = () => {
    const templateRows: Array<Array<string | number>> = [BULK_HEADERS]
    const worksheet = utils.aoa_to_sheet(templateRows)
    worksheet['!cols'] = autoFitExcelColumns(templateRows, {
      minWidths: [16, 16, 28, 10, 10, 12, 20],
      maxWidths: [22, 24, 38, 12, 12, 14, 28],
    })
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, worksheet, '대량접수')
    writeFileXLSX(workbook, `${meta.orderPrefix.toLowerCase()}-bulk-order-template.xlsx`, { compression: true })
  }

  const readBulkFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const workbook = read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: true })
      if (rows.length === 0) throw new Error('입력된 작업이 없습니다.')
      if (rows.length > 500) throw new Error('한 번에 최대 500건까지 접수할 수 있습니다.')

      const rowNumbers = rows.map((row, index) => typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : index + 2)
      setBulkRowNumbers(rowNumbers)
      const drafts = rows.map((row) => ({
        programType,
        storeName: cell(row, '상호명'),
        keyword: cell(row, '대표키워드', '대표 키워드', '키워드'),
        placeUrl: cell(row, '플레이스URL', '플레이스 URL', 'URL'),
        dailyShots: cell(row, '일일수량', '일일 수량', '일일구동수량'),
        operationDays: cell(row, '구동일수', '구동 일수'),
        startDate: excelDate(rawCell(row, '시작일', '시작 날짜', '시작날짜')),
        memo: cell(row, '메모'),
      }))
      const rowErrors = drafts.flatMap((item, index) => {
        const result = validateDraft(item, now)
        return Object.values(result).map((message) => `${rowNumbers[index]}행: ${message}`)
      })
      setBulkWarningsAccepted(false)
      setBulkDrafts(drafts)
      setBulkErrors(rowErrors)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  const submitBulk = async () => {
    if (bulkDrafts.some((item) => intakeWarning(item)) && !bulkWarningsAccepted) return
    if (bulkSubmitting || bulkDrafts.length === 0 || bulkErrors.length > 0) return
    if (unitPrice <= 0) { window.alert(`${programLabel} 단가가 설정된 승인 회원만 접수할 수 있습니다.`); return }
    setBulkSubmitting(true)
    try {
      const created = await onCreateOrdersBulk(bulkDrafts)
      setBulkDrafts([])
      setBulkErrors([])
      window.alert(`${created.length.toLocaleString('ko-KR')}건의 작업이 접수되었습니다.`)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setBulkSubmitting(false)
    }
  }

  const bulkAmount = bulkDrafts.reduce((sum, item) => sum + calculateAmount(Number(item.dailyShots) || 0, Number(item.operationDays) || 0, unitPrice).totalAmount, 0)

  return (
    <div className="page-stack orders-page-stack">
      <PageHeader
        title={user.role === 'admin' ? `${programLabel} 접수` : `${programLabel} 접수`}
        subtitle={user.role === 'admin' ? `${programLabel} 접수 작업과 상태를 관리합니다.` : `${programLabel} 작업을 개별 또는 엑셀로 대량 접수합니다.`}
        action={user.role !== 'admin' ? <div className="page-header-actions"><button className="secondary-button small" onClick={downloadBulkTemplate}><Icon name="download" />대량접수 양식</button><button className="secondary-button small" onClick={() => fileInputRef.current?.click()}><Icon name="upload" />대량작업접수</button><button className="primary-button small" onClick={toggleForm}><Icon name={formOpen ? 'close' : 'plus'} />{formOpen ? '접수 닫기' : '접수 신청'}</button><input ref={fileInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => void readBulkFile(event)} /></div> : <div className="page-header-actions"><button className="primary-button small" onClick={() => setAssignmentMode('manual')}><Icon name="plus" />작업 부여</button><button className="secondary-button small" onClick={() => setAssignmentMode('excel')}><Icon name="upload" />엑셀 일괄 부여</button><button className="secondary-button small" onClick={downloadExcel}><Icon name="download" />선택 엑셀</button><button className="secondary-button small" onClick={() => setIntegratedExportOpen(true)}><Icon name="download" />통합 엑셀</button></div>}
      />
      {user.role === 'admin' && !user.isOperationsManager && assignmentMode === 'manual' && <AdminOrderAssignmentModal programType={programType} onLoadMembers={onLoadAssignmentMembers} onAssign={onAdminAssign} onClose={() => setAssignmentMode(null)} />}
      {user.role === 'admin' && !user.isOperationsManager && assignmentMode === 'excel' && <AdminBulkOrderAssignmentModal onLoadMembers={onLoadAssignmentMembers} onAssign={onAdminBulkAssign} onClose={() => setAssignmentMode(null)} />}

      {user.role !== 'admin' && formOpen && <section className="panel intake-form-panel">
        <div className="panel-header"><div><h2 className="program-heading"><ProgramIcon programType={programType} size={24} />{programLabel} 접수 신청</h2><p>회원 단가 {formatWon(unitPrice)} / {quantityUnit} · 시작일은 익일부터 직접 지정할 수 있습니다.</p></div></div>
        <div className="form-grid compact-form">
          <Field className="span-2" label="플레이스 URL" required error={errors.placeUrl}><div className="input-with-status"><input value={draft.placeUrl} onChange={(event) => updateDraft('placeUrl', event.target.value)} placeholder="https://m.place.naver.com/place/1234567890/home" />{extractMid(draft.placeUrl) && <span>MID {extractMid(draft.placeUrl)}</span>}</div></Field>
          <Field label="상호명" required error={errors.storeName}><input value={draft.storeName} onChange={(event) => updateDraft('storeName', event.target.value)} placeholder="상호명 입력" maxLength={50} /></Field>
          <Field label="대표 키워드" required error={errors.keyword}><input value={draft.keyword} onChange={(event) => updateDraft('keyword', event.target.value)} placeholder="대표 키워드 입력" maxLength={50} /></Field>
          <Field label="일일 구동 수량" required error={errors.dailyShots}><div className="input-unit"><input type="number" min="1" step="1" value={draft.dailyShots} onChange={(event) => updateDraft('dailyShots', event.target.value)} /><span>{quantityUnit}</span></div></Field>
          <Field label="구동 일수" required error={errors.operationDays}><div className="input-unit"><input type="number" min="1" step="1" value={draft.operationDays} onChange={(event) => updateDraft('operationDays', event.target.value)} /><span>일</span></div></Field>
          <Field label="시작일" required error={errors.startDate}><input type="date" min={minimumStartDate} value={draft.startDate} onChange={(event) => updateDraft('startDate', event.target.value)} /></Field>
          <Field className="span-2" label="메모" error={errors.memo}><textarea value={draft.memo} onChange={(event) => updateDraft('memo', event.target.value)} maxLength={300} rows={3} /></Field>
        </div>
        <EstimateStrip unitPrice={unitPrice} programType={programType} draft={draft} settings={settings} now={now} />
        <div className="form-footer"><button className="secondary-button" onClick={() => { setDraft(emptyDraft(programType, now)); setErrors({}); setFormOpen(false) }}>취소</button><button className="primary-button" onClick={openPreview}>접수 확인</button></div>
      </section>}

      {eligibilityError && <p className="form-error" role="alert">{eligibilityError}</p>}
      {user.role === 'admin' && <div className="selection-summary"><span>{selectedOrders.length}개 선택됨</span><button className="text-button" disabled={!selectedOrders.length} onClick={() => { setSelectedIds(new Set()); selectionAnchor.current = null }}>선택 해제</button></div>}
      <section className="panel orders-panel fill-panel">
        <div className="archive-view-tabs"><button className={archiveView === 'active' ? 'active' : ''} onClick={() => { setArchiveView('active'); setSelectedIds(new Set()) }}>운영 작업</button><button className={archiveView === 'archived' ? 'active' : ''} onClick={() => { setArchiveView('archived'); setSelectedIds(new Set()) }}>보관함 <span>{sourceOrders.filter((order) => order.archivedAt && (user.role === 'admin' || order.createdBy === user.id)).length}</span></button></div>
        <div className="order-toolbar"><div className="filter-tabs">{(['전체', ...STATUS_ORDER] as const).map((status) => <button key={status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>{status}<span>{counts[status]}</span></button>)}</div><div className="toolbar-actions"><select className="order-sort-select" aria-label="접수일 정렬" value={sortDirection} onChange={(event) => setSortDirection(event.target.value as OrderSortDirection)}><option value="desc">최신순</option><option value="asc">오래된순</option></select><label className="search-box"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="등록자·그룹명·상호명·추천인·MID 검색" /></label>{user.role === 'admin' && <div className="admin-order-actions"><button className="secondary-button small bulk-transfer-button" onClick={openBulkProgramTransfer}><Icon name="refresh" />프로그램 변경{selectedOrders.length > 0 && <span>{selectedOrders.length.toLocaleString('ko-KR')}</span>}</button></div>}</div></div>
        {visible.length === 0 ? <div className="empty-state fill-empty-state">조건에 맞는 작업이 없습니다.</div> : <>
          <div className="desktop-table"><table className={user.role === 'admin' ? 'orders-table admin-orders-table' : 'orders-table'}>
            {user.role === 'admin' && <colgroup>
              <col className="order-col-check" /><col className="order-col-number" />
              <col className="order-col-date" /><col className="order-col-date" /><col className="order-col-days" />
              <col className="order-col-creator" /><col className="order-col-group" /><col />
              <col className="order-col-url" /><col className="order-col-keyword" />
              <col className="order-col-quantity" /><col className="order-col-quantity" /><col className="order-col-status" />
              {archiveView === 'archived' && <col className="order-col-reason" />}
              <col className="order-col-actions" />
            </colgroup>}<thead><tr>{user.role === 'admin' && <th className="checkbox-cell"><input type="checkbox" checked={visible.length > 0 && visible.every((order) => selectedIds.has(order.id))} onChange={toggleAll} /></th>}<th>No.</th><th>시작일</th><th>종료일</th><th>남은일</th>{user.role === 'admin' && <><th>등록자</th><th>그룹명</th></>}<th>상호명</th><th>플레이스 URL</th>{user.role !== 'admin' && <th>MID</th>}<th>키워드</th><th>구동일수</th><th>일일수량</th><th>상태</th>{archiveView === 'archived' && <th>보관 사유</th>}{showProgress && <th>오늘 진행</th>}<th>관리</th></tr></thead><tbody>{visible.map((order, index) => { const canArchive = !order.archivedAt && (user.role === 'admin' || (order.createdBy === user.id && ['입금대기', '정지', '만료'].includes(order.status))); const canRestore = Boolean(order.archivedAt && user.role === 'admin'); return <tr key={order.id} onClick={(event) => { if (user.role === 'admin' && !isRowInteractive(event.target)) toggleSelected(order, event.shiftKey) }} className={selectedIds.has(order.id) ? 'selected-row' : ''}>{user.role === 'admin' && <td className="checkbox-cell"><input type="checkbox" checked={selectedIds.has(order.id)} aria-label={`${order.storeName} 선택`} onClick={(event) => toggleSelected(order, event.shiftKey)} onChange={() => {}} /></td>}<td>{index + 1}</td><td>{formatDate(order.startDate)}</td><td>{formatDate(order.endDate)}</td><td>{daysRemaining(order.startDate, order.endDate, now)}</td>{user.role === 'admin' && <><td><span className="order-cell-text" title={order.creatorUsername}>{order.creatorUsername}</span></td><td><span className="order-cell-text" title={currentGroupNameForOrder(order) || '-'}>{currentGroupNameForOrder(order) || '-'}</span></td></>}<td className="order-store-cell"><strong className="order-cell-text" title={order.storeName}>{order.storeName}</strong></td><td><a href={order.placeUrl} title={order.placeUrl} target="_blank" rel="noreferrer">{order.placeUrl}</a></td>{user.role !== 'admin' && <td>{order.mid}</td>}<td><span className="order-cell-text" title={order.keyword}>{order.keyword}</span></td><td>{order.operationDays}일</td><td>{order.dailyShots.toLocaleString('ko-KR')}{quantityUnit}</td><td><div className="order-status-stack"><StatusBadge status={order.status} />{order.programTransferState === 'payment_pending' && <span className="transfer-pending-badge">{order.programTransferDifference > 0 ? `추가입금 ${formatWon(order.programTransferDifference)}` : '변경 정산 대기'}</span>}</div></td>{archiveView === 'archived' && <td><span className="order-cell-text" title={order.archiveReason || '-'}>{order.archiveReason || '-'}</span></td>}{showProgress && <td>{order.status === '구동중' ? <ProgressGauge order={order} now={now} compact /> : <span className="muted">-</span>}</td>}<td><div className="table-action-stack">{memberActions(order)}{user.role === 'admin' && !user.isOperationsManager && !order.archivedAt && <button className="secondary-button small" onClick={() => setCorrectionOrder(order)}>수정</button>}{user.role === 'admin' && !order.archivedAt && <select className="status-select" disabled={changingId === order.id} value={order.status} onChange={(event) => void changeStatus(order, event.target.value as OrderStatus)}>{allowedOrderStatuses(order.status).map((status) => <option key={status}>{status}</option>)}</select>}{canArchive && <button className="secondary-button small archive-button" disabled={changingId === order.id} onClick={() => void archiveOrder(order)}><Icon name="archive" />보관</button>}{canRestore && <button className="secondary-button small restore-button" disabled={changingId === order.id} onClick={() => void restoreOrder(order)}><Icon name="restore" />복원</button>}{!canArchive && !canRestore && <span className="muted">-</span>}</div></td></tr>})}</tbody></table></div>
          <div className="mobile-order-list">{visible.map((order) => { const canArchive = !order.archivedAt && (user.role === 'admin' || (order.createdBy === user.id && ['입금대기', '정지', '만료'].includes(order.status))); const canRestore = Boolean(order.archivedAt && user.role === 'admin'); return <article key={order.id} onClick={(event) => { if (user.role === 'admin' && !isRowInteractive(event.target)) toggleSelected(order, event.shiftKey) }} className={`mobile-order-card ${selectedIds.has(order.id) ? 'selected-row' : ''}`}><div>{user.role === 'admin' && <label className="mobile-order-select"><input type="checkbox" checked={selectedIds.has(order.id)} aria-label={`${order.storeName} 선택`} onClick={(event) => toggleSelected(order, event.shiftKey)} onChange={() => {}} /><span>선택</span></label>}<strong title={order.storeName}>{order.storeName}</strong><StatusBadge status={order.status} /></div>{order.programTransferState === 'payment_pending' && <span className="transfer-pending-badge">{order.programTransferDifference > 0 ? `추가입금 ${formatWon(order.programTransferDifference)}` : '변경 정산 대기'}</span>}<p>{order.keyword}</p><dl><div><dt>구동기간</dt><dd>{order.startDate} ~ {order.endDate}</dd></div><div><dt>일일수량</dt><dd>{order.dailyShots.toLocaleString('ko-KR')}{quantityUnit}</dd></div><div><dt>금액</dt><dd>{formatWon(order.totalAmount)}</dd></div>{order.archivedAt && <div><dt>보관 사유</dt><dd>{order.archiveReason || '-'}</dd></div>}{user.role === 'admin' && <><div><dt>등록자</dt><dd>{order.creatorUsername}</dd></div><div><dt>그룹명</dt><dd>{currentGroupNameForOrder(order) || '-'}</dd></div></>}</dl>{order.status === '구동중' && showProgress && <ProgressGauge order={order} now={now} />}{memberActions(order)}{user.role === 'admin' && !user.isOperationsManager && !order.archivedAt && <button className="secondary-button small" onClick={() => setCorrectionOrder(order)}>수정</button>}{user.role === 'admin' && !order.archivedAt && <select className="status-select" value={order.status} onChange={(event) => void changeStatus(order, event.target.value as OrderStatus)}>{allowedOrderStatuses(order.status).map((status) => <option key={status}>{status}</option>)}</select>}{canArchive && <button className="secondary-button small archive-button" disabled={changingId === order.id} onClick={() => void archiveOrder(order)}><Icon name="archive" />보관</button>}{canRestore && <button className="secondary-button small restore-button" disabled={changingId === order.id} onClick={() => void restoreOrder(order)}><Icon name="restore" />복원</button>}</article>})}</div>
        </>}
      </section>

      {integratedExportOpen && user.role === 'admin' && <AdminOrdersExportModal orders={orders} now={now} onClose={() => setIntegratedExportOpen(false)} />}
      {memberEdit && !user.isOperationsManager && <MemberOrderEditModal order={memberEdit.order} programOnly={memberEdit.programOnly} onPreview={onMemberEditPreview} onApply={onMemberEditApply} onClose={() => setMemberEdit(null)} />}
      {correctionOrder && user.role === 'admin' && !user.isOperationsManager && <AdminOrderCorrectionModal order={correctionOrder} onPreview={onCorrectionPreview} onApply={onCorrectionApply} onClose={() => setCorrectionOrder(null)} />}
      {bulkTransferOrders && user.role === 'admin' && <AdminBulkProgramTransferModal orders={bulkTransferOrders} onClose={() => setBulkTransferOrders(null)} onPreview={onBulkProgramTransferPreview} onTransfer={onBulkProgramTransfer} onFinished={finishBulkProgramTransfer} />}
      {preview && <Modal title="접수 내용 확인" description="금액과 기간을 확인해 주세요." onClose={() => setPreview(null)} footer={<><button className="secondary-button" onClick={() => setPreview(null)}>수정하기</button><button className="primary-button" disabled={submitting} onClick={() => void submitOrder()}>{submitting ? '접수 중...' : intakeWarning(preview.draft) ? '확인 후 그대로 접수' : '접수 완료'}</button></>}>{intakeWarning(preview.draft) && <p className="intake-warning" role="alert">{intakeWarning(preview.draft)}</p>}<div className="preview-grid"><Summary label="프로그램" value={programLabel} /><Summary label="상호명" value={preview.draft.storeName} /><Summary label="MID" value={preview.mid} /><Summary label="대표 키워드" value={preview.draft.keyword} /><Summary label="일일 수량" value={`${Number(preview.draft.dailyShots).toLocaleString('ko-KR')}${quantityUnit}`} /><Summary label="구동 기간" value={`${preview.startDate} ~ ${preview.endDate}`} wide /><Summary label={unitPriceLabel} value={formatWon(unitPrice)} /><Summary label="공급가액" value={formatWon(preview.supplyAmount)} /><Summary label="부가세" value={formatWon(preview.vatAmount)} /><Summary label="최종 결제금액" value={formatWon(preview.totalAmount)} strong /></div></Modal>}
      {createdOrder && <Modal title="접수가 완료되었습니다." onClose={() => setCreatedOrder(null)} footer={<button className="primary-button" onClick={() => setCreatedOrder(null)}>확인</button>}><div className="success-box"><Icon name="check" size={24} /><div><strong>{createdOrder.storeName}</strong><p>{programLabel} 작업이 입금대기 상태로 접수되었습니다.</p></div></div></Modal>}
      {bulkDrafts.length > 0 && <Modal title="대량 작업 접수 확인" description="검증 오류가 없을 때 전체 작업이 한 번에 접수됩니다." onClose={() => { setBulkDrafts([]); setBulkErrors([]) }} footer={<><button className="secondary-button" onClick={() => { setBulkDrafts([]); setBulkErrors([]) }}>취소</button><button className="primary-button" disabled={bulkSubmitting || bulkErrors.length > 0 || (bulkDrafts.some((item) => intakeWarning(item)) && !bulkWarningsAccepted)} onClick={() => void submitBulk()}>{bulkSubmitting ? '접수 중...' : `${bulkDrafts.length}건 접수`}</button></>}><div className="intake-warnings">{bulkDrafts.map((item, index) => intakeWarning(item) && <p className="intake-warning" key={index}>{bulkRowNumbers[index] ?? index + 2}행: {intakeWarning(item)}</p>)}{bulkDrafts.some((item) => intakeWarning(item)) && <label><input type="checkbox" checked={bulkWarningsAccepted} onChange={(e) => setBulkWarningsAccepted(e.target.checked)} />경고 행의 수량·기간을 확인했으며 그대로 접수합니다.</label>}</div><div className="bulk-preview-summary"><div><span>작업 수</span><strong>{bulkDrafts.length.toLocaleString('ko-KR')}건</strong></div><div><span>총 결제금액</span><strong>{formatWon(bulkAmount)}</strong></div></div>{bulkErrors.length > 0 ? <div className="bulk-error-list"><strong>수정이 필요한 항목 {bulkErrors.length}개</strong>{bulkErrors.slice(0, 20).map((message) => <p key={message}>{message}</p>)}{bulkErrors.length > 20 && <p>외 {bulkErrors.length - 20}개</p>}</div> : <div className="success-notice">모든 행의 URL, MID, 수량, 기간과 시작일 검증을 통과했습니다.</div>}</Modal>}
    </div>
  )
}

function Field({ label, required = false, error, className = '', children }: { label: string; required?: boolean; error?: string; className?: string; children: ReactNode }) {
  return <label className={`field ${className}`}><span>{label}{required && <b>*</b>}</span>{children}{error && <small className="field-error">{error}</small>}</label>
}

function EstimateStrip({ unitPrice, programType, draft, settings, now }: { unitPrice: number; programType: ProgramType; draft: OrderDraft; settings: AppSettings; now: Date }) {
  const dailyShots = Number(draft.dailyShots) || 0
  const operationDays = Number(draft.operationDays) || 0
  const amount = calculateAmount(dailyShots, operationDays, unitPrice)
  const validStart = isIsoDate(draft.startDate) ? draft.startDate : undefined
  const dates = operationDays > 0 ? calculateOperationDates(operationDays, settings.cutoffHour, now, validStart) : { startDate: '-', endDate: '-' }
  const quantityUnit = unitLabelForProgram(programType)
  return <div className="estimate-strip"><span>{dailyShots.toLocaleString('ko-KR')}{quantityUnit} × {operationDays.toLocaleString('ko-KR')}일 × {formatWon(unitPrice)} + VAT</span><span>{dates.startDate} ~ {dates.endDate}</span><strong>{formatWon(amount.totalAmount)}</strong></div>
}

function Summary({ label, value, wide = false, strong = false }: { label: string; value: string; wide?: boolean; strong?: boolean }) {
  return <div className={`${wide ? 'wide' : ''} ${strong ? 'summary-strong' : ''}`}><span>{label}</span><strong>{value}</strong></div>
}
