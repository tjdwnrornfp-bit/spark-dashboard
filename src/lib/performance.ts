import type { NotificationItem, Order, OrderStatus, PaymentStep, ProgramType, SettlementSummary } from '../domain/types'
import { mapNotification, mapOrder, mapPaymentStep } from './backend'
import { supabase } from './supabase'

export interface OrderPageQuery {
  p_program_type?: ProgramType | null
  p_status?: OrderStatus | null
  p_archived?: boolean | null
  p_query?: string | null
  p_created_from?: string | null
  p_created_to?: string | null
  p_page?: number
  p_page_size?: number
  p_sort?: 'asc' | 'desc'
  p_order_ids?: string[] | null
  p_export_before?: string | null
  p_expected_revision?: string | null
}
export interface OrderPageResult {
  rows: Order[]
  totalCount: number
  totalPages: number
  page: number
  pageSize: number
  counts: Record<'전체' | OrderStatus, number>
  revision: string
  settlementAmounts: Record<string, number>
}
export interface DashboardSummary {
  totalCount: number
  runningCount: number
  runningShots: number
  runningCases: number
  runningSPlusCases: number
  totalContractShots: number
  totalContractCases: number
  totalContractSPlusCases: number
  statusCounts: Record<OrderStatus, number>
  programSummaries: { type: ProgramType; total: number; waiting: number; paid: number; running: number; expired: number }[]
  settlement: SettlementSummary
  recent: Order[]
}
export interface NotificationCursor { createdAt: string; id: string }
export interface NotificationPageResult {
  rows: NotificationItem[]
  totalCount: number
  unreadCount: number
  hasMore: boolean
  cursor: NotificationCursor | null
}
async function rpc(name: string, args: Record<string, unknown> = {}): Promise<any> {
  if (!supabase) throw new Error('서버 연결을 확인해 주세요.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  if (data === null || data === undefined) throw new Error('서버에서 조회 결과가 반환되지 않았습니다.')
  return data
}
export async function fetchOrderPage(query: OrderPageQuery = {}): Promise<OrderPageResult> {
  const data = await rpc('get_order_page_v1011', { ...query })
  if (!Array.isArray(data.rows) || !Number.isSafeInteger(data.totalCount)) throw new Error('작업 페이지 응답이 올바르지 않습니다.')
  return { ...data, rows: data.rows.map((row: Record<string, unknown>) => ({ ...mapOrder(row), currentCreatorGroupName: String(row.current_creator_group_name ?? '') })),
    settlementAmounts: Object.fromEntries(data.rows.map((row: Record<string, unknown>) => [String(row.id), Number(row.settlement_amount ?? 0)])) }
}

// Full export is intentionally separate from the 50-row screen request. A data
// revision guards against combining different revisions across export pages.
export async function fetchOrdersForExport(query: OrderPageQuery = {}): Promise<Order[]> {
  const parameters = { ...query, p_page_size: 1000 }
  const first = await fetchOrderPage({ ...parameters, p_page: 1 })
  const rows = [...first.rows]
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await fetchOrderPage({ ...parameters, p_page: page, p_expected_revision: first.revision })
    if (next.totalCount !== first.totalCount || next.page !== page) throw new Error('내보내기 중 작업이 변경되었습니다. 다시 시도해 주세요.')
    rows.push(...next.rows)
  }
  if (rows.length !== first.totalCount || new Set(rows.map((row) => row.dbId)).size !== rows.length) throw new Error('엑셀 전체 행 수 검증에 실패했습니다. 다시 시도해 주세요.')
  return rows
}
export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const data = await rpc('get_dashboard_summary_v1011')
  return { ...data, recent: data.recent.map((row: Record<string, unknown>) => ({ ...mapOrder(row), currentCreatorGroupName: String(row.current_creator_group_name ?? '') })) }
}
export async function fetchOutgoingSettlementPage(page: number): Promise<{ rows: PaymentStep[]; page: number; totalCount: number }> {
  const data = await rpc('get_outgoing_settlement_page_v1011', { p_page: page, p_page_size: 50 })
  return { ...data, rows: data.rows.map(mapPaymentStep) }
}
export async function fetchNotificationCounts(): Promise<{ totalCount: number; unreadCount: number }> {
  return rpc('get_my_notification_counts_v1011')
}
export async function fetchNotificationPage(unread = false, cursor?: NotificationCursor | null): Promise<NotificationPageResult> {
  const data = await rpc('get_my_notifications_page_v1011', { p_unread: unread, p_limit: 100, p_before_time: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null })
  return { ...data, rows: data.rows.map(mapNotification) }
}
export async function markAllMyNotificationsRead(): Promise<number> {
  return rpc('mark_all_my_notifications_read_v1011')
}
