import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import type {
  AppSettings,
  Order,
  PaymentAccount,
  PaymentStep,
  ProgramType,
  SettlementBatchHistoryItem,
  SettlementBatchItemDetail,
  SettlementBatchResult,
  SettlementConfirmationInput,
  SettlementFilterOptions,
  SettlementFilters,
  SettlementPageResult,
  SettlementQuote,
  SettlementRow,
  SettlementSummary,
  User,
} from '../domain/types'
import {
  createSettlementQuoteV92,
  fetchSettlementBatchHistoryV92,
  fetchSettlementBatchItemsV92,
  fetchSettlementFilterOptionsV92,
  fetchSettlementPageV92,
  fetchSettlementSummaryV92,
} from '../lib/backend'
import { formatDate, formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { labelForProgram, unitLabelForProgram } from '../lib/program'
import { isSupabaseConfigured } from '../lib/supabase'
import { PageHeader } from './DashboardPage'

const EMPTY_FILTERS: SettlementFilters = {
  payerId: '',
  registrantId: '',
  groupName: '',
  query: '',
  programType: 'all',
  status: 'waiting',
  startDateFrom: '',
  startDateTo: '',
}

const EMPTY_OPTIONS: SettlementFilterOptions = { payers: [], registrants: [], groups: [] }

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const parts = ['message', 'details', 'hint', 'code']
      .map((key) => record[key])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (parts.length) return parts.join(' · ')
  }
  return typeof error === 'string' && error.trim() ? error : '요청을 처리하지 못했습니다.'
}

function paymentStepUnit(step: PaymentStep, orders: Order[]): '타' | '건' {
  const order = orders.find((item) => (item.dbId ?? item.id) === step.orderDbId || item.id === step.orderNumber)
  return unitLabelForProgram(step.programType ?? order?.programType ?? 'spark')
}

function adminRegistrantLabel(step: PaymentStep, orders: Order[]): string {
  const richStep = step as SettlementRow
  if (richStep.registrantGroupName !== undefined) return richStep.registrantGroupName.trim() || '미지정 그룹'
  const order = orders.find((item) => (item.dbId ?? item.id) === step.orderDbId || item.id === step.orderNumber)
  if (!order) return '미지정 그룹'
  return order.creatorGroupName.trim() || '미지정 그룹'
}

function toSettlementRow(step: PaymentStep, orders: Order[]): SettlementRow {
  const order = orders.find((item) => (item.dbId ?? item.id) === step.orderDbId || item.id === step.orderNumber)
  return {
    ...step,
    mid: order?.mid ?? '',
    registrantId: order?.createdBy ?? '',
    registrantUsername: order?.creatorUsername ?? '',
    registrantGroupName: order?.creatorGroupName ?? '',
    startDate: order?.startDate ?? '',
  }
}

function localFilterRows(rows: SettlementRow[], filters: SettlementFilters): SettlementRow[] {
  const query = filters.query.trim().toLocaleLowerCase('ko-KR')
  return rows.filter((row) => {
    if (filters.status === 'waiting' && row.confirmedAt) return false
    if (filters.status === 'confirmed' && !row.confirmedAt) return false
    if (filters.payerId && row.payerId !== filters.payerId) return false
    if (filters.registrantId && row.registrantId !== filters.registrantId) return false
    if (filters.groupName && row.registrantGroupName !== filters.groupName) return false
    if (filters.programType !== 'all' && row.programType !== filters.programType) return false
    if (filters.startDateFrom && row.startDate < filters.startDateFrom) return false
    if (filters.startDateTo && row.startDate > filters.startDateTo) return false
    if (query) {
      const haystack = [row.storeName, row.mid, row.orderNumber, row.payerUsername, row.registrantUsername, row.registrantGroupName]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

function makeLocalOptions(rows: SettlementRow[]): SettlementFilterOptions {
  const uniqueOptions = (values: Array<{ id: string; label: string }>) => Array.from(new Map(values.filter((item) => item.id).map((item) => [item.id, item])).values())
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  return {
    payers: uniqueOptions(rows.map((row) => ({ id: row.payerId, label: row.payerUsername }))),
    registrants: uniqueOptions(rows.map((row) => ({ id: row.registrantId, label: row.registrantUsername }))),
    groups: Array.from(new Set(rows.map((row) => row.registrantGroupName.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')),
  }
}

export function SettlementPage({
  user,
  members: _members,
  orders,
  paymentSteps,
  paymentAccount,
  settings,
  onSettingsChange,
  onConfirmPayment,
  onConfirmSettlementQuote,
}: {
  user: User
  members: User[]
  orders: Order[]
  paymentSteps: PaymentStep[]
  paymentAccount: PaymentAccount
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => Promise<void>
  onConfirmPayment: (step: PaymentStep) => Promise<void>
  onConfirmSettlementQuote: (quoteId: string, confirmations: SettlementConfirmationInput[], memo: string) => Promise<SettlementBatchResult>
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)

  const [filters, setFilters] = useState<SettlementFilters>(EMPTY_FILTERS)
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [pageResult, setPageResult] = useState<SettlementPageResult | null>(null)
  const [summary, setSummary] = useState<SettlementSummary | null>(null)
  const [filterOptions, setFilterOptions] = useState<SettlementFilterOptions>(EMPTY_OPTIONS)
  const [batchHistory, setBatchHistory] = useState<SettlementBatchHistoryItem[]>([])
  const [batchDetail, setBatchDetail] = useState<{ batch: SettlementBatchHistoryItem; items: SettlementBatchItemDetail[] } | null>(null)
  const [batchDetailLoadingId, setBatchDetailLoadingId] = useState<string | null>(null)
  const [settlementLoading, setSettlementLoading] = useState(false)
  const [settlementError, setSettlementError] = useState('')

  const [selectedRows, setSelectedRows] = useState<Map<string, SettlementRow>>(new Map())
  const [selectAllFiltered, setSelectAllFiltered] = useState(false)
  const [excludedRows, setExcludedRows] = useState<Map<string, SettlementRow>>(new Map())
  const [quote, setQuote] = useState<SettlementQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [batchConfirming, setBatchConfirming] = useState(false)
  const [batchResult, setBatchResult] = useState<SettlementBatchResult | null>(null)

  const activeOrders = useMemo(() => orders.filter((order) => !order.archivedAt), [orders])
  const archivedOrderIds = useMemo(() => new Set(orders.filter((order) => order.archivedAt).flatMap((order) => [order.dbId ?? order.id, order.id])), [orders])
  const activePaymentSteps = useMemo(() => paymentSteps.filter((step) => !archivedOrderIds.has(step.orderDbId)), [archivedOrderIds, paymentSteps])
  const visibleOrders = user.role === 'admin' ? activeOrders : activeOrders.filter((order) => order.createdBy === user.id)
  const incomingSteps = useMemo(
    () => activePaymentSteps.filter((step) => step.payeeId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activePaymentSteps, user.id],
  )
  const outgoingSteps = useMemo(
    () => activePaymentSteps.filter((step) => step.payerId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activePaymentSteps, user.id],
  )
  const localIncomingRows = useMemo(() => incomingSteps.map((step) => toSettlementRow(step, orders)), [incomingSteps, orders])
  const filteredLocalRows = useMemo(() => localFilterRows(localIncomingRows, filters), [filters, localIncomingRows])

  const localPageResult = useMemo<SettlementPageResult>(() => {
    const pageSize = 50
    const totalPages = Math.max(1, Math.ceil(filteredLocalRows.length / pageSize))
    const safePage = Math.min(page, totalPages)
    const rows = filteredLocalRows.slice((safePage - 1) * pageSize, safePage * pageSize)
    const readyRows = filteredLocalRows.filter((row) => !row.confirmedAt && row.canConfirm)
    return {
      rows,
      page: safePage,
      pageSize,
      totalPages,
      totalCount: filteredLocalRows.length,
      totalAmount: filteredLocalRows.reduce((sum, row) => sum + row.totalAmount, 0),
      readyCount: readyRows.length,
      readyAmount: readyRows.reduce((sum, row) => sum + row.totalAmount, 0),
    }
  }, [filteredLocalRows, page])

  const localSummary = useMemo<SettlementSummary>(() => {
    const settlementSteps = user.role === 'admin' ? incomingSteps : outgoingSteps
    const waiting = settlementSteps.filter((step) => !step.confirmedAt)
    const confirmed = settlementSteps.filter((step) => step.confirmedAt)
    const received = incomingSteps.filter((step) => step.confirmedAt)
    return {
      waitingCount: waiting.length,
      waitingAmount: waiting.reduce((sum, step) => sum + step.totalAmount, 0),
      confirmedCount: confirmed.length,
      confirmedAmount: confirmed.reduce((sum, step) => sum + step.totalAmount, 0),
      totalCount: settlementSteps.length,
      totalAmount: settlementSteps.reduce((sum, step) => sum + step.totalAmount, 0),
      receivedCount: received.length,
      receivedAmount: received.reduce((sum, step) => sum + step.totalAmount, 0),
    }
  }, [incomingSteps, outgoingSteps, user.role])

  const loadSettlementPage = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setSettlementLoading(true)
    setSettlementError('')
    try {
      const nextPage = await fetchSettlementPageV92(filters, page, 50)
      setPageResult(nextPage)
      if (nextPage.page > nextPage.totalPages) setPage(nextPage.totalPages)
      else if (nextPage.page !== page) setPage(nextPage.page)
    } catch (error) {
      setSettlementError(getErrorMessage(error))
    } finally {
      setSettlementLoading(false)
    }
  }, [filters, page])

  const loadSettlementMeta = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const [nextSummary, nextOptions, nextHistory] = await Promise.all([
        fetchSettlementSummaryV92(),
        fetchSettlementFilterOptionsV92(),
        fetchSettlementBatchHistoryV92(50),
      ])
      setSummary(nextSummary)
      setFilterOptions(nextOptions)
      setBatchHistory(nextHistory)
    } catch (error) {
      setSettlementError(getErrorMessage(error))
    }
  }, [])

  const refreshSettlementData = useCallback(async () => {
    await Promise.all([loadSettlementPage(), loadSettlementMeta()])
  }, [loadSettlementMeta, loadSettlementPage])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => current.query === queryInput ? current : { ...current, query: queryInput })
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  useEffect(() => {
    void loadSettlementPage()
  }, [loadSettlementPage])

  useEffect(() => {
    void loadSettlementMeta()
  }, [loadSettlementMeta, user.id])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setFilterOptions(makeLocalOptions(localIncomingRows))
      setSummary(localSummary)
      setPageResult(localPageResult)
    }
  }, [localIncomingRows, localPageResult, localSummary])

  useEffect(() => {
    setSelectedRows(new Map())
    setExcludedRows(new Map())
    setSelectAllFiltered(false)
  }, [filters])

  const activePage = pageResult ?? localPageResult
  const activeSummary = summary ?? localSummary
  const currentRows = activePage.rows
  const selectableRows = currentRows.filter((row) => !row.confirmedAt && row.canConfirm)

  const isRowSelected = (row: SettlementRow) => selectAllFiltered ? !excludedRows.has(row.id) : selectedRows.has(row.id)
  const currentPageAllSelected = selectableRows.length > 0 && selectableRows.every(isRowSelected)
  const explicitSelectedAmount = Array.from(selectedRows.values()).reduce((sum, row) => sum + row.totalAmount, 0)
  const excludedAmount = Array.from(excludedRows.values()).reduce((sum, row) => sum + row.totalAmount, 0)
  const selectedCount = selectAllFiltered ? Math.max(0, activePage.readyCount - excludedRows.size) : selectedRows.size
  const selectedAmount = selectAllFiltered ? Math.max(0, activePage.readyAmount - excludedAmount) : explicitSelectedAmount

  const adminSettlementByOrder = useMemo(() => new Map(
    incomingSteps.map((step) => [step.orderDbId ?? step.orderNumber, step.totalAmount]),
  ), [incomingSteps])

  const orderSettlementAmount = (order: Order) => user.role === 'admin'
    ? (adminSettlementByOrder.get(order.dbId ?? order.id) ?? adminSettlementByOrder.get(order.id) ?? 0)
    : order.totalAmount

  const setFilter = <K extends keyof SettlementFilters>(key: K, value: SettlementFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setQueryInput('')
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const toggleRow = (row: SettlementRow) => {
    if (row.confirmedAt || !row.canConfirm) return
    if (selectAllFiltered) {
      setExcludedRows((current) => {
        const next = new Map(current)
        if (next.has(row.id)) next.delete(row.id)
        else next.set(row.id, row)
        return next
      })
      return
    }
    setSelectedRows((current) => {
      const next = new Map(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.set(row.id, row)
      return next
    })
  }

  const toggleCurrentPage = () => {
    if (selectableRows.length === 0) return
    if (selectAllFiltered) {
      setExcludedRows((current) => {
        const next = new Map(current)
        if (currentPageAllSelected) selectableRows.forEach((row) => next.set(row.id, row))
        else selectableRows.forEach((row) => next.delete(row.id))
        return next
      })
      return
    }
    setSelectedRows((current) => {
      const next = new Map(current)
      if (currentPageAllSelected) selectableRows.forEach((row) => next.delete(row.id))
      else selectableRows.forEach((row) => next.set(row.id, row))
      return next
    })
  }

  const clearSelection = () => {
    setSelectedRows(new Map())
    setExcludedRows(new Map())
    setSelectAllFiltered(false)
  }

  const selectFilteredReadyRows = () => {
    setSelectedRows(new Map())
    setExcludedRows(new Map())
    setSelectAllFiltered(true)
  }

  const copyAccount = async () => {
    const account = user.role === 'admin'
      ? `${settings.bank} ${settings.accountNumber} ${settings.accountHolder}`
      : `${paymentAccount.bank} ${paymentAccount.accountNumber} ${paymentAccount.accountHolder}`
    await navigator.clipboard.writeText(account)
  }

  const confirmPayment = async (step: SettlementRow) => {
    if (changingId) return
    setChangingId(step.id)
    try {
      await onConfirmPayment(step)
      await refreshSettlementData()
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setChangingId(null)
    }
  }

  const openBatchQuote = async () => {
    if (selectedCount === 0 || quoteLoading) return
    setQuoteLoading(true)
    try {
      let nextQuote: SettlementQuote
      if (isSupabaseConfigured) {
        nextQuote = await createSettlementQuoteV92({
          selectionMode: selectAllFiltered ? 'filtered' : 'explicit',
          selectedStepIds: Array.from(selectedRows.keys()),
          excludedStepIds: Array.from(excludedRows.keys()),
          filters,
        })
      } else {
        const rows = selectAllFiltered
          ? filteredLocalRows.filter((row) => !row.confirmedAt && row.canConfirm && !excludedRows.has(row.id))
          : Array.from(selectedRows.values())
        const groups = Array.from(rows.reduce((map, row) => {
          const current = map.get(row.payerId) ?? { payerId: row.payerId, payerUsername: row.payerUsername, itemCount: 0, expectedAmount: 0 }
          current.itemCount += 1
          current.expectedAmount += row.totalAmount
          map.set(row.payerId, current)
          return map
        }, new Map<string, SettlementQuote['groups'][number]>()).values())
        nextQuote = {
          id: `local-${crypto.randomUUID()}`,
          itemCount: rows.length,
          expectedAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0),
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          groups,
        }
      }
      setQuote(nextQuote)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setQuoteLoading(false)
    }
  }

  const quoteIsValid = quote !== null
    && quote.itemCount > 0
    && quote.expectedAmount > 0
    && quote.groups.length > 0

  const confirmBatch = async () => {
    if (!quote || !quoteIsValid || batchConfirming) return
    setBatchConfirming(true)
    try {
      let result: SettlementBatchResult
      if (isSupabaseConfigured) {
        const automaticConfirmations: SettlementConfirmationInput[] = quote.groups.map((group) => ({
          payerId: group.payerId,
          actualAmount: group.expectedAmount,
          depositorName: group.payerUsername || '자동 확인',
        }))
        result = await onConfirmSettlementQuote(quote.id, automaticConfirmations, '')
      } else {
        const rows = selectAllFiltered
          ? filteredLocalRows.filter((row) => !row.confirmedAt && row.canConfirm && !excludedRows.has(row.id))
          : Array.from(selectedRows.values())
        for (const row of rows) await onConfirmPayment(row)
        result = {
          itemCount: rows.length,
          totalAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0),
          batches: quote.groups.map((group, index) => ({
            id: crypto.randomUUID(),
            batchNumber: `LOCAL-${String(index + 1).padStart(3, '0')}`,
            payerId: group.payerId,
            payerUsername: group.payerUsername,
            itemCount: group.itemCount,
            expectedAmount: group.expectedAmount,
            actualAmount: group.expectedAmount,
            confirmedAt: new Date().toISOString(),
          })),
        }
      }
      setQuote(null)
      setBatchResult(result)
      clearSelection()
      await refreshSettlementData()
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setBatchConfirming(false)
    }
  }

  const openBatchDetail = async (batch: SettlementBatchHistoryItem) => {
    if (batchDetailLoadingId) return
    setBatchDetailLoadingId(batch.id)
    try {
      const items = isSupabaseConfigured ? await fetchSettlementBatchItemsV92(batch.id) : []
      setBatchDetail({ batch, items })
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setBatchDetailLoadingId(null)
    }
  }

  const downloadBatchCsv = () => {
    if (!batchDetail) return
    const escapeCsv = (value: string | number) => {
      const text = String(value)
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }
    const rows = [
      ['정산묶음번호', '입금자', '주문번호', '업체명', '등록자', ...(user.role === 'admin' ? ['등록그룹'] : []), '프로그램', '정산금액'],
      ...batchDetail.items.map((item) => [
        batchDetail.batch.batchNumber,
        batchDetail.batch.payerUsername,
        item.orderNumber,
        item.storeName,
        item.registrantUsername,
        ...(user.role === 'admin' ? [item.registrantGroupName] : []),
        labelForProgram(item.programType),
        item.amount,
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${batchDetail.batch.batchNumber}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const saveSettings = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSettingsChange(form)
      setEditing(false)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const accountBank = user.role === 'admin' ? settings.bank : paymentAccount.bank
  const accountNumber = user.role === 'admin' ? settings.accountNumber : paymentAccount.accountNumber
  const accountHolder = user.role === 'admin' ? settings.accountHolder : paymentAccount.accountHolder

  return (
    <div className="page-stack settlement-page-stack">
      <PageHeader title="정산" subtitle={user.role === 'admin' ? '관리자에게 입금되는 최종 정산 금액을 확인합니다.' : '하위 대행사 입금과 내가 처리할 정산 내역을 확인합니다.'} />

      <section className={`settlement-cards ${user.role === 'admin' ? '' : 'settlement-cards-four'}`}>
        <article><span>입금 대기 금액</span><strong>{formatWon(activeSummary.waitingAmount)}</strong><small>{activeSummary.waitingCount}건</small></article>
        <article><span>입금 완료 금액</span><strong>{formatWon(activeSummary.confirmedAmount)}</strong><small>{activeSummary.confirmedCount}건</small></article>
        <article><span>{user.role === 'admin' ? '총 정산 금액' : '총 접수 금액'}</span><strong>{formatWon(activeSummary.totalAmount)}</strong><small>{activeSummary.totalCount}건</small></article>
        {user.role !== 'admin' && <article className="received-stat"><span>입금 받은 금액</span><strong>{formatWon(activeSummary.receivedAmount)}</strong><small>{activeSummary.receivedCount}건 확인</small></article>}
      </section>

      <section className="account-strip">
        <div><span>입금 계좌</span><strong>{accountBank && accountNumber ? `${accountBank} ${accountNumber}` : '계좌 미등록'}</strong><small>{accountHolder ? `예금주 ${accountHolder}` : '정산 계좌 등록이 필요합니다.'}</small></div>
        <div>{accountNumber && <button className="secondary-button small" onClick={() => void copyAccount()}><Icon name="copy" />계좌 복사</button>}{user.role === 'admin' && <button className="dark-small-button" onClick={() => { setForm(settings); setEditing(true) }}>계좌 수정</button>}</div>
      </section>

      <section className={`settlement-chain-grid ${user.role === 'admin' ? 'admin-settlement-grid' : ''}`}>
        <section className="panel compact-panel fill-panel settlement-incoming-panel">
          <div className="panel-header settlement-panel-header">
            <div><h2>{user.role === 'admin' ? '관리자 입금 확인' : '하위 대행사 입금 확인'}</h2><p>입금자·등록자·업체를 대조한 뒤 개별 또는 일괄로 확인합니다.</p></div>
            <button className="secondary-button small" disabled={settlementLoading} onClick={() => void refreshSettlementData()}>{settlementLoading ? '조회 중' : '새로고침'}</button>
          </div>

          <div className="settlement-filter-bar">
            <label className="settlement-search-field"><span>업체·MID·주문번호</span><input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="검색어 입력" /></label>
            <label><span>입금자</span><select value={filters.payerId} onChange={(event) => setFilter('payerId', event.target.value)}><option value="">전체 입금자</option>{filterOptions.payers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            <label><span>등록자</span><select value={filters.registrantId} onChange={(event) => setFilter('registrantId', event.target.value)}><option value="">전체 등록자</option>{filterOptions.registrants.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            {user.role === 'admin' && <label><span>등록 그룹</span><select value={filters.groupName} onChange={(event) => setFilter('groupName', event.target.value)}><option value="">전체 그룹</option>{filterOptions.groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>}
            <label><span>프로그램</span><select value={filters.programType} onChange={(event) => setFilter('programType', event.target.value as ProgramType | 'all')}><option value="all">전체 프로그램</option><option value="spark">스파크</option><option value="spark_plus">스파크 +</option><option value="spark_s">스파크S</option></select></label>
            <label><span>상태</span><select value={filters.status} onChange={(event) => setFilter('status', event.target.value as SettlementFilters['status'])}><option value="waiting">입금대기</option><option value="confirmed">확인완료</option><option value="all">전체</option></select></label>
            <label><span>시작일(부터)</span><input type="date" value={filters.startDateFrom} onChange={(event) => setFilter('startDateFrom', event.target.value)} /></label>
            <label><span>시작일(까지)</span><input type="date" value={filters.startDateTo} onChange={(event) => setFilter('startDateTo', event.target.value)} /></label>
            <button className="secondary-button settlement-reset-button" onClick={resetFilters}>필터 초기화</button>
          </div>

          <div className="settlement-result-summary">
            <div><strong>검색 결과 {activePage.totalCount.toLocaleString('ko-KR')}건</strong><span>합계 {formatWon(activePage.totalAmount)}</span></div>
            <div><strong>지금 확인 가능 {activePage.readyCount.toLocaleString('ko-KR')}건</strong><span>{formatWon(activePage.readyAmount)}</span></div>
            {filters.status !== 'confirmed' && activePage.readyCount > 0 && <button className="secondary-button small" onClick={selectFilteredReadyRows}>확인 가능 전체 선택</button>}
          </div>

          {settlementError && <div className="inline-error settlement-inline-error">{settlementError}</div>}
          {settlementLoading && !pageResult ? <div className="empty-state">정산 내역을 불러오는 중입니다.</div> : currentRows.length === 0 ? <div className="empty-state">조건에 맞는 입금 내역이 없습니다.</div> : <div className="desktop-table settlement-table-wrap">
            <table className="simple-table settlement-table settlement-incoming-table settlement-bulk-table">
              <thead><tr>
                <th className="checkbox-column"><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={currentPageAllSelected} onChange={toggleCurrentPage} disabled={selectableRows.length === 0} /></th>
                <th>작업</th><th>입금자</th><th>등록자</th>{user.role === 'admin' && <th>등록 그룹</th>}<th>프로그램</th><th>단가</th><th>입금액</th><th>상태</th><th>확인</th>
              </tr></thead>
              <tbody>{currentRows.map((step) => <tr key={step.id} className={isRowSelected(step) ? 'selected-settlement-row' : ''}>
                <td className="checkbox-column"><input type="checkbox" aria-label={`${step.storeName} 선택`} checked={isRowSelected(step)} disabled={Boolean(step.confirmedAt) || !step.canConfirm} onChange={() => toggleRow(step)} /></td>
                <td><strong>{step.storeName}</strong><small>{step.orderNumber} · MID {step.mid || '-'}</small></td>
                <td>{step.payerUsername}</td>
                <td>{step.registrantUsername || '-'}</td>
                {user.role === 'admin' && <td>{adminRegistrantLabel(step, orders)}</td>}
                <td>{labelForProgram(step.programType)}</td>
                <td>{formatWon(step.unitPrice)} / {paymentStepUnit(step, orders)}</td>
                <td><strong>{formatWon(step.totalAmount)}</strong></td>
                <td>{step.confirmedAt ? <span className="payment-confirmed-text">{formatDateTime(step.confirmedAt)} 확인</span> : step.canConfirm ? <span className="payment-waiting-text">입금대기</span> : <span className="payment-chain-waiting-text">이전 단계 확인 대기</span>}</td>
                <td>{step.confirmedAt ? <span className="muted">완료</span> : <button className="primary-button table-action-button payment-confirm-button" disabled={changingId === step.id || !step.canConfirm} title={!step.canConfirm ? `이전 정산 ${Math.max(1, step.previousPendingCount)}건의 확인이 먼저 필요합니다.` : '실제 입금 확인 후 처리합니다.'} onClick={() => void confirmPayment(step)}>{changingId === step.id ? '처리 중' : step.canConfirm ? '입금확인' : '순서 대기'}</button>}</td>
              </tr>)}</tbody>
            </table>
          </div>}

          <div className="settlement-pagination">
            <button className="secondary-button small" disabled={activePage.page <= 1 || settlementLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button>
            <span>{activePage.page.toLocaleString('ko-KR')} / {activePage.totalPages.toLocaleString('ko-KR')} 페이지</span>
            <button className="secondary-button small" disabled={activePage.page >= activePage.totalPages || settlementLoading} onClick={() => setPage((current) => current + 1)}>다음</button>
          </div>
        </section>

        {user.role !== 'admin' && <section className="panel compact-panel fill-panel settlement-outgoing-panel">
          <div className="panel-header"><div><h2>작업 정산 내역</h2><p>내 작업과 하위 작업을 합산한 정산 내역입니다.</p></div></div>
          {outgoingSteps.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="desktop-table settlement-table-wrap"><table className="simple-table settlement-table settlement-outgoing-table"><thead><tr><th>작업</th><th>단가</th><th>정산액</th><th>상태</th></tr></thead><tbody>{outgoingSteps.map((step) => <tr key={step.id}><td><strong>{step.storeName}</strong></td><td>{formatWon(step.unitPrice)} / {paymentStepUnit(step, orders)}</td><td><strong>{formatWon(step.totalAmount)}</strong></td><td>{step.confirmedAt ? <span className="payment-confirmed-text">입금확인 완료</span> : <span className="payment-waiting-text">확인 대기</span>}</td></tr>)}</tbody></table></div>}
        </section>}
      </section>

      {batchHistory.length > 0 && <section className="panel compact-panel settlement-batch-history-panel">
        <div className="panel-header"><div><h2>일괄 입금확인 내역</h2><p>입금자별로 처리된 정산 묶음을 확인합니다.</p></div></div>
        <div className="desktop-table settlement-table-wrap"><table className="simple-table settlement-table settlement-batch-history-table"><thead><tr><th>묶음번호</th><th>입금자</th><th>건수</th><th>확인금액</th><th>확인시각</th><th>상세</th></tr></thead><tbody>{batchHistory.map((batch) => <tr key={batch.id}><td><strong>{batch.batchNumber}</strong>{batch.memo && <small>{batch.memo}</small>}</td><td>{batch.payerUsername}</td><td>{batch.itemCount.toLocaleString('ko-KR')}건</td><td><strong>{formatWon(batch.actualAmount)}</strong></td><td>{formatDateTime(batch.confirmedAt)}</td><td><button className="secondary-button small" disabled={batchDetailLoadingId === batch.id} onClick={() => void openBatchDetail(batch)}>{batchDetailLoadingId === batch.id ? '조회 중' : '포함 작업'}</button></td></tr>)}</tbody></table></div>
      </section>}

      <section className="panel compact-panel fill-panel settlement-orders-panel"><div className="panel-header"><div><h2>{user.role === 'admin' ? '전체 작업 결제 상태' : '내 작업 결제 상태'}</h2><p>필요한 입금 확인이 모두 끝나면 작업이 입금완료로 변경됩니다.</p></div></div>{visibleOrders.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="desktop-table"><table className="simple-table settlement-table settlement-orders-table"><thead><tr>{user.role === 'admin' && <th>등록 그룹</th>}<th>상호명</th><th>{user.role === 'admin' ? '관리자 정산액' : '접수금액'}</th><th>시작일</th><th>상태</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id}>{user.role === 'admin' && <td>{order.creatorGroupName || '미지정 그룹'}</td>}<td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td><strong>{formatWon(orderSettlementAmount(order))}</strong></td><td>{formatDate(order.startDate)}</td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>}</section>

      {selectedCount > 0 && <div className="settlement-selection-bar">
        <div><strong>{selectedCount.toLocaleString('ko-KR')}건 선택</strong><span>예정 입금액 {formatWon(selectedAmount)}</span>{selectAllFiltered && <small>검색 결과 전체 선택 · 제외 {excludedRows.size}건</small>}</div>
        <div><button className="secondary-button" onClick={clearSelection}>선택 해제</button><button className="primary-button" disabled={quoteLoading} onClick={() => void openBatchQuote()}>{quoteLoading ? '금액 확인 중...' : '일괄 입금확인'}</button></div>
      </div>}

      {quote && <Modal title="일괄 입금확인" description={`${formatWon(quote.expectedAmount)} 입금을 확인하시겠습니까?`} onClose={() => { if (!batchConfirming) setQuote(null) }} footer={<><button className="secondary-button" disabled={batchConfirming} onClick={() => setQuote(null)}>취소</button><button className="primary-button" disabled={!quoteIsValid || batchConfirming} onClick={() => void confirmBatch()}>{batchConfirming ? '입금 확인 중...' : '입금확인'}</button></>}>
        <div className="settlement-quote-summary settlement-quote-summary-simple"><span>선택 작업</span><strong>{quote.itemCount.toLocaleString('ko-KR')}건</strong><span>확인 금액</span><strong>{formatWon(quote.expectedAmount)}</strong><small>선택한 작업과 금액이 정확한지 확인해 주세요. 확인 후 다음 정산 단계로 넘어갑니다.</small></div>
        {quote.groups.length > 1 && <div className="settlement-quote-groups">{quote.groups.map((group) => <article key={group.payerId} className="quote-group-valid quote-group-auto">
          <header><div><strong>{group.payerUsername}</strong><span>{group.itemCount.toLocaleString('ko-KR')}건</span></div><strong>{formatWon(group.expectedAmount)}</strong></header>
        </article>)}</div>}
        <div className="settlement-confirm-warning"><Icon name="check" size={16} /><span>실제 입금이 완료된 내역만 확인해 주세요. 처리 후에는 정산 묶음 내역에 기록됩니다.</span></div>
      </Modal>}

      {batchResult && <Modal title="일괄 입금확인 완료" description="입금자별 정산 묶음이 생성되고 선택한 단계가 처리되었습니다." onClose={() => setBatchResult(null)} footer={<button className="primary-button" onClick={() => setBatchResult(null)}>확인</button>}>
        <div className="batch-result-summary"><strong>{batchResult.itemCount.toLocaleString('ko-KR')}건</strong><span>{formatWon(batchResult.totalAmount)}</span></div>
        <div className="batch-result-list">{batchResult.batches.map((batch) => <article key={batch.id}><div><strong>{batch.batchNumber}</strong><span>{batch.payerUsername}</span></div><div><span>{batch.itemCount.toLocaleString('ko-KR')}건</span><strong>{formatWon(batch.actualAmount)}</strong></div></article>)}</div>
      </Modal>}

      {batchDetail && <Modal title={`${batchDetail.batch.batchNumber} 포함 작업`} description={`${batchDetail.batch.payerUsername} · ${batchDetail.batch.itemCount.toLocaleString('ko-KR')}건 · ${formatWon(batchDetail.batch.actualAmount)}`} onClose={() => setBatchDetail(null)} footer={<><button className="secondary-button" onClick={downloadBatchCsv}>CSV 다운로드</button><button className="primary-button" onClick={() => setBatchDetail(null)}>닫기</button></>}>
        {batchDetail.items.length === 0 ? <div className="empty-state">상세 항목이 없습니다.</div> : <div className="desktop-table settlement-batch-detail-wrap"><table className="simple-table settlement-table settlement-batch-detail-table"><thead><tr><th>주문번호</th><th>업체명</th><th>등록자</th>{user.role === 'admin' && <th>등록 그룹</th>}<th>프로그램</th><th>금액</th></tr></thead><tbody>{batchDetail.items.map((item) => <tr key={item.paymentStepId}><td>{item.orderNumber}</td><td><strong>{item.storeName}</strong></td><td>{item.registrantUsername}</td>{user.role === 'admin' && <td>{item.registrantGroupName || '-'}</td>}<td>{labelForProgram(item.programType)}</td><td><strong>{formatWon(item.amount)}</strong></td></tr>)}</tbody></table></div>}
      </Modal>}

      {editing && <Modal title="관리자 정산 계좌 수정" onClose={() => setEditing(false)} footer={<><button className="secondary-button" onClick={() => setEditing(false)}>취소</button><button className="primary-button" disabled={saving} onClick={() => void saveSettings()}>{saving ? '저장 중...' : '저장'}</button></>}><div className="modal-form"><label><span>은행</span><input value={form.bank} onChange={(event) => setForm((current) => ({ ...current, bank: event.target.value }))} /></label><label><span>계좌번호</span><input value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value }))} /></label><label><span>예금주</span><input value={form.accountHolder} onChange={(event) => setForm((current) => ({ ...current, accountHolder: event.target.value }))} /></label></div></Modal>}
    </div>
  )
}
