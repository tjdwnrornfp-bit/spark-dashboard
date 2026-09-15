import type {User,Order,PaymentStep,ManagedOrderFilters,ManagedOrderRow,ManagedOrdersPageResult} from '../domain/types'
const PAGE_SIZE = 50
export const EMPTY_FILTERS: ManagedOrderFilters = {
  agencyId: '',
  programType: 'all',
  orderStatus: 'all',
  sort: 'priority',
  settlementStatus: 'all',
  query: '',
  startDateFrom: '',
  startDateTo: '',
}

export function localManagedRows(user: User, members: User[], orders: Order[], paymentSteps: PaymentStep[]): ManagedOrderRow[] {
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

export function filterLocalRows(rows: ManagedOrderRow[], filters: ManagedOrderFilters): ManagedOrderRow[] {
  const query = filters.query.trim().toLocaleLowerCase('ko-KR')
  return rows.filter((row) => {
    if (filters.agencyId && row.registrantId !== filters.agencyId) return false
    if (filters.programType !== 'all' && row.programType !== filters.programType) return false
    if (filters.orderStatus === 'in_progress' ? !['입금대기', '입금완료'].includes(row.orderStatus) : filters.orderStatus !== 'all' && row.orderStatus !== filters.orderStatus) return false
    if (filters.settlementStatus !== 'all' && row.settlementStatus !== filters.settlementStatus) return false
    if (filters.startDateFrom && row.startDate < filters.startDateFrom) return false
    if (filters.startDateTo && row.startDate > filters.startDateTo) return false
    if (query && ![row.storeName, row.keyword, row.mid, row.registrantUsername].some((value) => value.toLocaleLowerCase('ko-KR').includes(query))) return false
    return true
  }).sort((a, b) => {
    const priority = ['입금대기', '입금완료', '구동중', '정지', '만료']
    if (filters.sort === 'priority') { const diff = priority.indexOf(a.orderStatus) - priority.indexOf(b.orderStatus); if (diff) return diff }
    if (filters.sort === 'start_date') { const diff = a.startDate.localeCompare(b.startDate); if (diff) return diff }
    if (filters.sort === 'oldest') { const diff = a.createdAt.localeCompare(b.createdAt); if (diff) return diff }
    return b.createdAt.localeCompare(a.createdAt) || b.orderId.localeCompare(a.orderId)
  })
}

export function localPage(rows: ManagedOrderRow[], filters: ManagedOrderFilters, page: number): ManagedOrdersPageResult {
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

export function excelDateSuffix(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

