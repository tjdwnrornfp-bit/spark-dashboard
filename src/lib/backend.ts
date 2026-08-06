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

export async function fetchRemoteSnapshot(): Promise<{
  members: User[]
  orders: Order[]
  paymentSteps: PaymentStep[]
  paymentAccount: PaymentAccount
  notifications: NotificationItem[]
  notices: Notice[]
  settings: AppSettings
}> {
  const client = requiredClient()
  const [profilesResult, ordersResult, activeStepsResult, accountResult, notificationsResult, noticesResult, settingsResult] = await Promise.all([
    client.from('profiles').select('*').order('requested_at', { ascending: false }),
    client.from('orders').select('*').order('created_at', { ascending: true }),
    client.rpc('get_my_active_payment_steps_v91'),
    client.rpc('get_my_payment_account'),
    client.from('notifications').select('*, orders(order_number)').order('created_at', { ascending: false }),
    client.from('notices').select('*').order('created_at', { ascending: false }),
    client.from('app_settings').select('*').eq('id', true).single(),
  ])

  let stepsResult = activeStepsResult
  if (activeStepsResult.error && ['PGRST202', '42883'].includes(String(activeStepsResult.error.code ?? ''))) {
    stepsResult = await client.from('payment_steps').select('*').order('created_at', { ascending: true }).order('step_order', { ascending: true })
  }

  const firstError = [profilesResult, ordersResult, stepsResult, accountResult, notificationsResult, noticesResult, settingsResult].find((result) => result.error)?.error
  if (firstError) throw firstError

  const notifications = (notificationsResult.data ?? []).map((row: Record<string, unknown>) => {
    const orderRelation = row.orders as Record<string, unknown> | null | undefined
    return mapNotification({ ...row, order_number: orderRelation?.order_number })
  })
  const accountRow = Array.isArray(accountResult.data) ? accountResult.data[0] : accountResult.data

  return {
    members: (profilesResult.data ?? []).map((row: Record<string, unknown>) => mapProfile(row)),
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
  const { data, error } = await client.rpc('review_member_v9', {
    p_member_id: params.memberId,
    p_role: params.role,
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
