import type {
  AccountDraft,
  AppSettings,
  AuditLog,
  MemberReviewInput,
  Notice,
  NotificationItem,
  Order,
  OrderDraft,
  OrderStatus,
  PaymentAccount,
  OperationsHealth,
  PaymentStep,
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
import { extractMid } from './order'
import { supabase } from './supabase'

function requiredClient(): any {
  if (!supabase) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.')
  return supabase
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function mapProfile(row: Record<string, unknown>): User {
  const sparkPrice = numberValue(row.spark_price_per_shot || row.price_per_shot)
  return {
    id: stringValue(row.id),
    username: stringValue(row.username),
    phoneNumber: stringValue(row.phone_number),
    role: (row.role as User['role']) ?? null,
    approvalStatus: (row.approval_status as User['approvalStatus']) ?? 'pending',
    pricePerShot: sparkPrice,
    sparkPricePerShot: sparkPrice,
    sparkPlusPricePerShot: numberValue(row.spark_plus_price_per_shot),
    sparkSPricePerShot: numberValue(row.spark_s_price_per_shot),
    active: Boolean(row.active),
    requestedAt: stringValue(row.requested_at),
    approvedAt: nullableString(row.approved_at),
    updatedAt: stringValue(row.updated_at),
    sponsorId: nullableString(row.sponsor_id),
    sponsorUsername: nullableString(row.sponsor_username),
    isOperationsManager: Boolean(row.is_operations_manager),
    managerId: nullableString(row.manager_id),
    managerUsername: nullableString(row.manager_username),
    referralCode: stringValue(row.referral_code),
    groupName: stringValue(row.group_name),
    hierarchyDepth: numberValue(row.hierarchy_depth),
    bank: stringValue(row.bank),
    accountNumber: stringValue(row.account_number),
    accountHolder: stringValue(row.account_holder),
  }
}

export function mapOrder(row: Record<string, unknown>): Order {
  return {
    id: stringValue(row.order_number),
    dbId: stringValue(row.id),
    createdAt: stringValue(row.created_at),
    createdBy: stringValue(row.created_by),
    creatorUsername: stringValue(row.creator_username),
    sponsorId: nullableString(row.sponsor_id),
    sponsorUsername: nullableString(row.sponsor_username),
    creatorGroupName: stringValue(row.creator_group_name),
    programType: (row.program_type as Order['programType']) ?? 'spark',
    placeUrl: stringValue(row.place_url),
    mid: stringValue(row.mid),
    storeName: stringValue(row.store_name),
    keyword: stringValue(row.keyword),
    dailyShots: numberValue(row.daily_shots),
    operationDays: numberValue(row.operation_days),
    pricePerShot: numberValue(row.price_per_shot),
    supplyAmount: numberValue(row.supply_amount),
    vatAmount: numberValue(row.vat_amount),
    totalAmount: numberValue(row.total_amount),
    startDate: stringValue(row.start_date),
    endDate: stringValue(row.end_date),
    status: row.status as OrderStatus,
    memo: stringValue(row.memo),
    activatedAt: nullableString(row.activated_at),
    stoppedAt: nullableString(row.stopped_at),
    paymentNotifiedAt: nullableString(row.payment_notified_at),
    archivedAt: nullableString(row.archived_at),
    archivedBy: nullableString(row.archived_by),
    archiveReason: stringValue(row.archive_reason),
    lockVersion: Math.max(1, numberValue(row.lock_version)),
    updatedAt: stringValue(row.updated_at),
  }
}

export function mapPaymentStep(row: Record<string, unknown>): PaymentStep {
  return {
    id: stringValue(row.id),
    programType: (row.program_type as PaymentStep['programType']) ?? 'spark',
    orderDbId: stringValue(row.order_id),
    orderNumber: stringValue(row.order_number),
    storeName: stringValue(row.store_name),
    stepOrder: numberValue(row.step_order),
    payerId: stringValue(row.payer_id),
    payerUsername: stringValue(row.payer_username),
    payeeId: stringValue(row.payee_id),
    payeeUsername: stringValue(row.payee_username),
    unitPrice: numberValue(row.unit_price),
    supplyAmount: numberValue(row.supply_amount),
    vatAmount: numberValue(row.vat_amount),
    totalAmount: numberValue(row.total_amount),
    confirmedAt: nullableString(row.confirmed_at),
    canConfirm: row.can_confirm === undefined ? !nullableString(row.confirmed_at) : Boolean(row.can_confirm),
    previousPendingCount: numberValue(row.previous_pending_count),
    createdAt: stringValue(row.created_at),
  }
}

export function mapNotification(row: Record<string, unknown>): NotificationItem {
  return {
    id: stringValue(row.id),
    createdAt: stringValue(row.created_at),
    userId: nullableString(row.user_id),
    role: (row.target_role as NotificationItem['role']) ?? 'all',
    title: stringValue(row.title),
    message: stringValue(row.message),
    read: Boolean(row.read_at),
    orderId: nullableString(row.order_number) ?? undefined,
  }
}

export function mapNotice(row: Record<string, unknown>): Notice {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    content: stringValue(row.content),
    pinned: Boolean(row.pinned),
    createdAt: stringValue(row.created_at),
  }
}

export function mapSettings(row: Record<string, unknown>): AppSettings {
  return {
    cutoffHour: numberValue(row.cutoff_hour),
    autoStartHour: numberValue(row.auto_start_hour),
    bank: stringValue(row.bank),
    accountNumber: stringValue(row.account_number),
    accountHolder: stringValue(row.account_holder),
  }
}



export function mapAuditLog(row: Record<string, unknown>): AuditLog {
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {}
  return {
    id: stringValue(row.id),
    createdAt: stringValue(row.created_at),
    actorId: nullableString(row.actor_id),
    actorUsername: stringValue(row.actor_username) || 'system',
    actorRole: (row.actor_role as AuditLog['actorRole']) ?? null,
    action: stringValue(row.action),
    entityType: (row.entity_type as AuditLog['entityType']) ?? 'system',
    entityId: nullableString(row.entity_id),
    entityLabel: stringValue(row.entity_label),
    metadata,
  }
}

export function mapOperationsHealth(row: Record<string, unknown>): OperationsHealth {
  return {
    schemaVersion: stringValue(row.schema_version),
    activeAdmins: numberValue(row.active_admins),
    activeOrders: numberValue(row.active_orders),
    archivedOrders: numberValue(row.archived_orders),
    ordersWithoutPaymentSteps: numberValue(row.orders_without_payment_steps),
    invalidPaymentStates: numberValue(row.invalid_payment_states),
    inactiveCronJobs: numberValue(row.inactive_cron_jobs),
    checkedAt: stringValue(row.checked_at),
  }
}

function mapPaymentAccount(row: Record<string, unknown> | null | undefined): PaymentAccount {
  return {
    payeeId: nullableString(row?.payee_id),
    payeeUsername: stringValue(row?.payee_username),
    bank: stringValue(row?.bank),
    accountNumber: stringValue(row?.account_number),
    accountHolder: stringValue(row?.account_holder),
    source: row?.source === 'sponsor' ? 'sponsor' : 'admin',
  }
}

export async function fetchProfile(userId: string): Promise<User | null> {
  const client = requiredClient()
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data ? mapProfile(data as Record<string, unknown>) : null
}

export async function fetchRemoteSnapshot(includeAdminContacts = false): Promise<{
  members: User[]
  orders: Order[]
  paymentSteps: PaymentStep[]
  paymentAccount: PaymentAccount
  notifications: NotificationItem[]
  notices: Notice[]
  settings: AppSettings
}> {
  const client = requiredClient()
  const contactsPromise = includeAdminContacts
    ? client.rpc('get_admin_member_contacts_v94')
    : Promise.resolve({ data: [], error: null })
  const [profilesResult, ordersResult, activeStepsResult, accountResult, notificationsResult, noticesResult, settingsResult, contactsResult] = await Promise.all([
    client.from('profiles').select('*').order('requested_at', { ascending: false }),
    client.from('orders').select('*').order('created_at', { ascending: true }),
    client.rpc('get_my_active_payment_steps_v91'),
    client.rpc('get_my_payment_account'),
    client.from('notifications').select('*, orders(order_number)').order('created_at', { ascending: false }),
    client.from('notices').select('*').order('created_at', { ascending: false }),
    client.from('app_settings').select('*').eq('id', true).single(),
    contactsPromise,
  ])

  let stepsResult = activeStepsResult
  if (activeStepsResult.error && ['PGRST202', '42883'].includes(String(activeStepsResult.error.code ?? ''))) {
    stepsResult = await client.from('payment_steps').select('*').order('created_at', { ascending: true }).order('step_order', { ascending: true })
  }

  const firstError = [profilesResult, ordersResult, stepsResult, accountResult, notificationsResult, noticesResult, settingsResult, contactsResult].find((result) => result.error)?.error
  if (firstError) throw firstError

  const notifications = (notificationsResult.data ?? []).map((row: Record<string, unknown>) => {
    const orderRelation = row.orders as Record<string, unknown> | null | undefined
    return mapNotification({ ...row, order_number: orderRelation?.order_number })
  })
  const accountRow = Array.isArray(accountResult.data) ? accountResult.data[0] : accountResult.data
  const phoneByUserId = new Map<string, string>(
    (contactsResult.data ?? []).map((row: Record<string, unknown>) => [stringValue(row.user_id), stringValue(row.phone_number)]),
  )

  return {
    members: (profilesResult.data ?? []).map((row: Record<string, unknown>) => mapProfile({
      ...row,
      phone_number: phoneByUserId.get(stringValue(row.id)) ?? '',
    })),
    orders: (ordersResult.data ?? []).map((row: Record<string, unknown>) => mapOrder(row)),
    paymentSteps: (stepsResult.data ?? []).map((row: Record<string, unknown>) => mapPaymentStep(row)),
    paymentAccount: mapPaymentAccount(accountRow as Record<string, unknown> | null),
    notifications,
    notices: (noticesResult.data ?? []).map((row: Record<string, unknown>) => mapNotice(row)),
    settings: mapSettings(settingsResult.data as Record<string, unknown>),
  }
}

export async function createRemoteOrder(params: {
  programType: Order['programType']
  placeUrl: string
  mid: string
  storeName: string
  keyword: string
  dailyShots: number
  operationDays: number
  startDate: string
  memo: string
}): Promise<Order> {
  const client = requiredClient()
  const { data, error } = await client.rpc('create_order', {
    p_program_type: params.programType,
    p_place_url: params.placeUrl,
    p_mid: params.mid,
    p_store_name: params.storeName,
    p_keyword: params.keyword,
    p_daily_shots: params.dailyShots,
    p_operation_days: params.operationDays,
    p_start_date: params.startDate,
    p_memo: params.memo,
  })
  if (error) throw error
  return mapOrder(data as Record<string, unknown>)
}

export async function createRemoteOrdersBulk(drafts: OrderDraft[]): Promise<Order[]> {
  const client = requiredClient()
  const items = drafts.map((draft) => ({
    program_type: draft.programType,
    place_url: draft.placeUrl.trim(),
    mid: extractMid(draft.placeUrl),
    store_name: draft.storeName.trim(),
    keyword: draft.keyword.trim(),
    daily_shots: Number(draft.dailyShots),
    operation_days: Number(draft.operationDays),
    start_date: draft.startDate,
    memo: draft.memo.trim(),
  }))
  const { data, error } = await client.rpc('create_orders_bulk', { p_items: items })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => mapOrder(row))
}

export async function setRemoteOrderStatus(order: Order, status: OrderStatus, reason: string): Promise<Order> {
  if (!order.dbId) throw new Error('서버 주문 식별자가 없습니다.')
  const client = requiredClient()
  const { data, error } = await client.rpc('set_order_status_v9', {
    p_order_id: order.dbId,
    p_status: status,
    p_expected_version: order.lockVersion,
    p_reason: reason.trim(),
  })
  if (error) throw error
  return mapOrder(data as Record<string, unknown>)
}

export async function archiveRemoteOrder(order: Order, reason: string): Promise<Order> {
  if (!order.dbId) throw new Error('서버 주문 식별자가 없습니다.')
  const client = requiredClient()
  const { data, error } = await client.rpc('archive_order', {
    p_order_id: order.dbId,
    p_expected_version: order.lockVersion,
    p_reason: reason.trim(),
  })
  if (error) throw error
  return mapOrder(data as Record<string, unknown>)
}

export async function restoreRemoteOrder(order: Order, reason: string): Promise<Order> {
  if (!order.dbId) throw new Error('서버 주문 식별자가 없습니다.')
  const client = requiredClient()
  const { data, error } = await client.rpc('restore_order', {
    p_order_id: order.dbId,
    p_expected_version: order.lockVersion,
    p_reason: reason.trim(),
  })
  if (error) throw error
  return mapOrder(data as Record<string, unknown>)
}

export async function reviewRemoteMember(params: Omit<MemberReviewInput, 'member'> & { memberId: string; memberUpdatedAt: string }): Promise<User> {
  const client = requiredClient()
  const { data, error } = await client.rpc('review_member_v93', {
    p_member_id: params.memberId,
    p_role: params.role === 'manager' ? 'agency' : params.role,
    p_is_operations_manager: params.role === 'manager',
    p_spark_price_per_shot: params.prices.spark,
    p_spark_plus_price_per_shot: params.prices.spark_plus,
    p_spark_s_price_per_shot: params.prices.spark_s,
    p_approval_status: params.approvalStatus,
    p_group_name: params.groupName,
    p_expected_updated_at: params.memberUpdatedAt,
  })
  if (error) throw error
  return mapProfile(data as Record<string, unknown>)
}

export async function saveRemoteAccount(account: AccountDraft): Promise<User> {
  const client = requiredClient()
  const { data, error } = await client.rpc('save_my_settlement_account', {
    p_bank: account.bank.trim(),
    p_account_number: account.accountNumber.trim(),
    p_account_holder: account.accountHolder.trim(),
  })
  if (error) throw error
  return mapProfile(data as Record<string, unknown>)
}

export async function confirmRemotePaymentStep(stepId: string): Promise<PaymentStep> {
  const client = requiredClient()
  const { data, error } = await client.rpc('confirm_payment_step', { p_step_id: stepId })
  if (error) throw error
  return mapPaymentStep(data as Record<string, unknown>)
}

export async function saveRemoteSettings(settings: AppSettings): Promise<AppSettings> {
  const client = requiredClient()
  const { data, error } = await client.from('app_settings').update({
    cutoff_hour: settings.cutoffHour,
    auto_start_hour: settings.autoStartHour,
    bank: settings.bank,
    account_number: settings.accountNumber,
    account_holder: settings.accountHolder,
    updated_at: new Date().toISOString(),
  }).eq('id', true).select('*').single()
  if (error) throw error
  return mapSettings(data as Record<string, unknown>)
}

export async function markRemoteNotificationRead(id: string): Promise<void> {
  const client = requiredClient()
  const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function markAllRemoteNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = requiredClient()
  const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
}

export async function deleteRemoteNotification(id: string): Promise<void> {
  const client = requiredClient()
  const { error } = await client.from('notifications').delete().eq('id', id)
  if (error) throw error
}

export async function deleteAllRemoteNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = requiredClient()
  const { error } = await client.from('notifications').delete().in('id', ids)
  if (error) throw error
}

export async function createRemoteNotice(input: Pick<Notice, 'title' | 'content' | 'pinned'>): Promise<Notice> {
  const client = requiredClient()
  const { data, error } = await client.from('notices').insert(input).select('*').single()
  if (error) throw error
  return mapNotice(data as Record<string, unknown>)
}

export async function deleteRemoteNotice(id: string): Promise<void> {
  const client = requiredClient()
  const { error } = await client.from('notices').delete().eq('id', id)
  if (error) throw error
}


export async function fetchRemoteAuditLogs(limit = 200): Promise<AuditLog[]> {
  const client = requiredClient()
  const { data, error } = await client.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => mapAuditLog(row))
}

export async function fetchOperationsHealth(): Promise<OperationsHealth> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_operations_health')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return mapOperationsHealth((row ?? {}) as Record<string, unknown>)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function mapSettlementRow(row: Record<string, unknown>): SettlementRow {
  return {
    id: stringValue(row.id),
    programType: (row.programType as SettlementRow['programType']) ?? 'spark',
    orderDbId: stringValue(row.orderDbId),
    orderNumber: stringValue(row.orderNumber),
    storeName: stringValue(row.storeName),
    stepOrder: numberValue(row.stepOrder),
    payerId: stringValue(row.payerId),
    payerUsername: stringValue(row.payerUsername),
    payeeId: stringValue(row.payeeId),
    payeeUsername: stringValue(row.payeeUsername),
    unitPrice: numberValue(row.unitPrice),
    supplyAmount: numberValue(row.supplyAmount),
    vatAmount: numberValue(row.vatAmount),
    totalAmount: numberValue(row.totalAmount),
    confirmedAt: nullableString(row.confirmedAt),
    canConfirm: Boolean(row.canConfirm),
    previousPendingCount: numberValue(row.previousPendingCount),
    createdAt: stringValue(row.createdAt),
    mid: stringValue(row.mid),
    registrantId: stringValue(row.registrantId),
    registrantUsername: stringValue(row.registrantUsername),
    registrantGroupName: stringValue(row.registrantGroupName),
    startDate: stringValue(row.startDate),
    registrantItemCount: numberValue(row.registrantItemCount),
    registrantTotalAmount: numberValue(row.registrantTotalAmount),
    registrantReadyCount: numberValue(row.registrantReadyCount),
    registrantReadyAmount: numberValue(row.registrantReadyAmount),
    registrantSparkCount: numberValue(row.registrantSparkCount),
    registrantSparkAmount: numberValue(row.registrantSparkAmount),
    registrantSparkPlusCount: numberValue(row.registrantSparkPlusCount),
    registrantSparkPlusAmount: numberValue(row.registrantSparkPlusAmount),
    registrantSparkSCount: numberValue(row.registrantSparkSCount),
    registrantSparkSAmount: numberValue(row.registrantSparkSAmount),
  }
}

function settlementRpcParams(filters: SettlementFilters) {
  return {
    p_status: filters.status,
    p_payer_id: filters.payerId || null,
    p_registrant_id: filters.registrantId || null,
    p_group_name: filters.groupName || null,
    p_query: filters.query.trim() || null,
    p_program_type: filters.programType === 'all' ? null : filters.programType,
    p_start_date_from: filters.startDateFrom || null,
    p_start_date_to: filters.startDateTo || null,
  }
}

export async function fetchSettlementPageV92(filters: SettlementFilters, page = 1, pageSize = 50): Promise<SettlementPageResult> {
  const client = requiredClient()
  let { data, error } = await client.rpc('get_my_settlement_page_v94', {
    ...settlementRpcParams(filters),
    p_page: page,
    p_page_size: pageSize,
  })
  if (error && ['PGRST202', '42883'].includes(String(error.code ?? ''))) {
    const fallback = await client.rpc('get_my_settlement_page_v92', {
      ...settlementRpcParams(filters),
      p_page: page,
      p_page_size: pageSize,
    })
    data = fallback.data
    error = fallback.error
  }
  if (error) throw error
  const result = recordValue(data)
  const rows = Array.isArray(result.rows) ? result.rows.map((row) => mapSettlementRow(recordValue(row))) : []
  return {
    rows,
    page: Math.max(1, numberValue(result.page) || page),
    pageSize: Math.max(1, numberValue(result.pageSize) || pageSize),
    totalPages: Math.max(1, numberValue(result.totalPages) || 1),
    totalCount: numberValue(result.totalCount),
    totalAmount: numberValue(result.totalAmount),
    readyCount: numberValue(result.readyCount),
    readyAmount: numberValue(result.readyAmount),
  }
}

export async function fetchSettlementSummaryV92(): Promise<SettlementSummary> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_my_settlement_summary_v92')
  if (error) throw error
  const result = recordValue(data)
  return {
    waitingCount: numberValue(result.waitingCount),
    waitingAmount: numberValue(result.waitingAmount),
    confirmedCount: numberValue(result.confirmedCount),
    confirmedAmount: numberValue(result.confirmedAmount),
    totalCount: numberValue(result.totalCount),
    totalAmount: numberValue(result.totalAmount),
    receivedCount: numberValue(result.receivedCount),
    receivedAmount: numberValue(result.receivedAmount),
  }
}

export async function fetchSettlementFilterOptionsV92(): Promise<SettlementFilterOptions> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_my_settlement_filter_options_v92')
  if (error) throw error
  const result = recordValue(data)
  const mapOptions = (value: unknown) => Array.isArray(value)
    ? value.map((item) => recordValue(item)).map((item) => ({ id: stringValue(item.id), label: stringValue(item.label) })).filter((item) => item.id)
    : []
  return {
    payers: mapOptions(result.payers),
    registrants: mapOptions(result.registrants),
    groups: Array.isArray(result.groups) ? result.groups.map(stringValue).filter(Boolean) : [],
  }
}

export async function createSettlementQuoteV92(params: {
  selectionMode: 'explicit' | 'filtered'
  selectedStepIds: string[]
  excludedStepIds: string[]
  filters: SettlementFilters
}): Promise<SettlementQuote> {
  const client = requiredClient()
  const { data, error } = await client.rpc('create_settlement_quote_v92', {
    p_selection_mode: params.selectionMode,
    p_step_ids: params.selectedStepIds,
    p_excluded_step_ids: params.excludedStepIds,
    ...settlementRpcParams({ ...params.filters, status: 'waiting' }),
  })
  if (error) throw error
  const result = recordValue(data)
  return {
    id: stringValue(result.id),
    itemCount: numberValue(result.itemCount),
    expectedAmount: numberValue(result.expectedAmount),
    expiresAt: stringValue(result.expiresAt),
    groups: Array.isArray(result.groups) ? result.groups.map((item) => {
      const group = recordValue(item)
      return {
        payerId: stringValue(group.payerId),
        payerUsername: stringValue(group.payerUsername),
        itemCount: numberValue(group.itemCount),
        expectedAmount: numberValue(group.expectedAmount),
      }
    }) : [],
  }
}

export async function confirmSettlementQuoteV92(quoteId: string, confirmations: SettlementConfirmationInput[], memo: string): Promise<SettlementBatchResult> {
  const client = requiredClient()
  const { data, error } = await client.rpc('confirm_settlement_quote_v92', {
    p_quote_id: quoteId,
    p_payer_confirmations: confirmations.map((item) => ({
      payer_id: item.payerId,
      actual_amount: item.actualAmount,
      depositor_name: item.depositorName.trim(),
    })),
    p_memo: memo.trim(),
  })
  if (error) throw error
  const result = recordValue(data)
  return {
    itemCount: numberValue(result.itemCount),
    totalAmount: numberValue(result.totalAmount),
    batches: Array.isArray(result.batches) ? result.batches.map((item) => {
      const batch = recordValue(item)
      return {
        id: stringValue(batch.id),
        batchNumber: stringValue(batch.batchNumber),
        payerId: stringValue(batch.payerId),
        payerUsername: stringValue(batch.payerUsername),
        itemCount: numberValue(batch.itemCount),
        expectedAmount: numberValue(batch.expectedAmount),
        actualAmount: numberValue(batch.actualAmount),
        confirmedAt: stringValue(batch.confirmedAt),
      }
    }) : [],
  }
}

export async function fetchSettlementBatchHistoryV92(limit = 50): Promise<SettlementBatchHistoryItem[]> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_my_settlement_batches_v92', { p_limit: limit })
  if (error) throw error
  return Array.isArray(data) ? data.map((item) => {
    const batch = recordValue(item)
    return {
      id: stringValue(batch.id),
      batchNumber: stringValue(batch.batchNumber),
      payerId: stringValue(batch.payerId),
      payerUsername: stringValue(batch.payerUsername),
      payeeId: stringValue(batch.payeeId),
      payeeUsername: stringValue(batch.payeeUsername),
      itemCount: numberValue(batch.itemCount),
      expectedAmount: numberValue(batch.expectedAmount),
      actualAmount: numberValue(batch.actualAmount),
      depositorName: stringValue(batch.depositorName),
      memo: stringValue(batch.memo),
      status: batch.status === 'voided' ? 'voided' : 'confirmed',
      confirmedAt: stringValue(batch.confirmedAt),
    }
  }) : []
}

export async function fetchSettlementBatchItemsV92(batchId: string): Promise<SettlementBatchItemDetail[]> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_settlement_batch_items_v92', { p_batch_id: batchId })
  if (error) throw error
  return Array.isArray(data) ? data.map((item) => {
    const row = recordValue(item)
    return {
      paymentStepId: stringValue(row.paymentStepId),
      orderId: stringValue(row.orderId),
      orderNumber: stringValue(row.orderNumber),
      storeName: stringValue(row.storeName),
      registrantId: stringValue(row.registrantId),
      registrantUsername: stringValue(row.registrantUsername),
      registrantGroupName: stringValue(row.registrantGroupName),
      programType: (row.programType as SettlementBatchItemDetail['programType']) ?? 'spark',
      amount: numberValue(row.amount),
    }
  }) : []
}
