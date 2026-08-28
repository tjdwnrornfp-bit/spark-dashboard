import type {
  AccountDraft,
  AppSettings,
  AdminCompanyOverviewResult,
  BulkProgramTransferPreview,
  BulkProgramTransferResult,
  CompanyOverviewSort,
  AuditLog,
  MemberDeletionCheck,
  MemberDeletionResult,
  MemberPasswordResetResult,
  MemberReviewInput,
  ManagedOrderFilterOption,
  ManagedOrderFilters,
  ManagedOrderRow,
  ManagedOrdersPageResult,
  ManagedOrdersSummary,
  ManagerAgencyOverviewResult,
  ManagerAgencyOverviewSort,
  ManagerDashboardSummary,
  Notice,
  NotificationItem,
  Order,
  OrderDraft,
  OrderStatus,
  PaymentAccount,
  PaymentReversalResult,
  OperationsHealth,
  PaymentStep,
  ProgramTransferPreview,
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
    sparkSPlusPricePerShot: numberValue(row.spark_s_plus_price_per_shot),
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
    programTransferState: row.program_transfer_state === 'payment_pending' ? 'payment_pending' : 'none',
    programTransferDifference: numberValue(row.program_transfer_difference),
    lastProgramTransferAt: nullableString(row.last_program_transfer_at),
    settlementReversalPending: Boolean(row.settlement_reversal_pending),
    lockVersion: Math.max(1, numberValue(row.lock_version)),
    updatedAt: stringValue(row.updated_at),
  }
}

function mapProgramTransferPreview(row: Record<string, unknown>): ProgramTransferPreview {
  return {
    orderDbId: stringValue(row.orderDbId),
    orderNumber: stringValue(row.orderNumber),
    currentStatus: row.currentStatus as ProgramTransferPreview['currentStatus'],
    afterStatus: row.afterStatus as ProgramTransferPreview['afterStatus'],
    beforeProgram: row.beforeProgram as ProgramType,
    afterProgram: row.afterProgram as ProgramType,
    beforeUnitPrice: numberValue(row.beforeUnitPrice),
    afterUnitPrice: numberValue(row.afterUnitPrice),
    beforeSupplyAmount: numberValue(row.beforeSupplyAmount),
    afterSupplyAmount: numberValue(row.afterSupplyAmount),
    beforeVatAmount: numberValue(row.beforeVatAmount),
    afterVatAmount: numberValue(row.afterVatAmount),
    beforeTotalAmount: numberValue(row.beforeTotalAmount),
    afterTotalAmount: numberValue(row.afterTotalAmount),
    difference: numberValue(row.difference),
    confirmedPaymentCount: numberValue(row.confirmedPaymentCount),
    pendingPaymentCount: numberValue(row.pendingPaymentCount),
    settlementMode: row.settlementMode === 'adjustment' ? 'adjustment' : 'rebuild',
    settlementImpact: stringValue(row.settlementImpact),
    keepsOperationRunning: Boolean(row.keepsOperationRunning),
    expectedVersion: numberValue(row.expectedVersion),
    canTransfer: Boolean(row.canTransfer),
    blockedReason: stringValue(row.blockedReason),
  }
}

function mapBulkProgramTransferPreview(row: Record<string, unknown>): BulkProgramTransferPreview {
  const programCounts = (row.programCounts ?? {}) as Record<string, unknown>
  return {
    selectedCount: numberValue(row.selectedCount),
    readyCount: numberValue(row.readyCount),
    excludedCount: numberValue(row.excludedCount),
    blockedCount: numberValue(row.blockedCount),
    programCounts: {
      spark: numberValue(programCounts.spark),
      spark_plus: numberValue(programCounts.spark_plus),
      spark_s: numberValue(programCounts.spark_s),
      spark_s_plus: numberValue(programCounts.spark_s_plus),
    },
    targetProgram: row.targetProgram as ProgramType,
    expectedAdditionalAmount: numberValue(row.expectedAdditionalAmount),
    expectedDeductionAmount: numberValue(row.expectedDeductionAmount),
    expectedDifference: numberValue(row.expectedDifference),
    items: Array.isArray(row.items) ? row.items.map((value) => {
      const item = value as Record<string, unknown>
      const preview = item.preview && typeof item.preview === 'object'
        ? mapProgramTransferPreview(item.preview as Record<string, unknown>)
        : null
      return {
        orderDbId: stringValue(item.orderDbId),
        orderNumber: stringValue(item.orderNumber),
        storeName: stringValue(item.storeName),
        beforeProgram: item.beforeProgram as ProgramType,
        status: item.status === 'ready' ? 'ready' as const : item.status === 'excluded' ? 'excluded' as const : 'blocked' as const,
        difference: numberValue(item.difference),
        expectedVersion: numberValue(item.expectedVersion),
        blockedReason: stringValue(item.blockedReason),
        preview,
      }
    }) : [],
  }
}

function mapBulkProgramTransferResult(row: Record<string, unknown>): BulkProgramTransferResult {
  return {
    selectedCount: numberValue(row.selectedCount),
    succeededCount: numberValue(row.succeededCount),
    failedCount: numberValue(row.failedCount),
    excludedCount: numberValue(row.excludedCount),
    targetProgram: row.targetProgram as ProgramType,
    items: Array.isArray(row.items) ? row.items.map((value) => {
      const item = value as Record<string, unknown>
      return {
        orderDbId: stringValue(item.orderDbId),
        orderNumber: stringValue(item.orderNumber),
        storeName: stringValue(item.storeName),
        status: item.status === 'succeeded' ? 'succeeded' as const : item.status === 'excluded' ? 'excluded' as const : 'failed' as const,
        message: stringValue(item.message),
        order: item.order && typeof item.order === 'object' ? mapOrder(item.order as Record<string, unknown>) : null,
        transfer: item.transfer && typeof item.transfer === 'object' ? mapProgramTransferPreview(item.transfer as Record<string, unknown>) : null,
      }
    }) : [],
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

function mapManagedOrder(row: Record<string, unknown>): ManagedOrderRow {
  const settlementStatus = row.settlement_status === '정산완료'
    ? '정산완료' as const
    : row.settlement_status === '부분완료'
      ? '부분완료' as const
      : '정산대기' as const
  return {
    orderId: stringValue(row.order_id),
    orderNumber: stringValue(row.order_number),
    registrantId: stringValue(row.registrant_id),
    registrantUsername: stringValue(row.registrant_username),
    programType: (row.program_type as ManagedOrderRow['programType']) ?? 'spark',
    storeName: stringValue(row.store_name),
    keyword: stringValue(row.keyword),
    mid: stringValue(row.mid),
    placeUrl: stringValue(row.place_url),
    dailyShots: numberValue(row.daily_shots),
    operationDays: numberValue(row.operation_days),
    pricePerShot: numberValue(row.price_per_shot),
    supplyAmount: numberValue(row.supply_amount),
    vatAmount: numberValue(row.vat_amount),
    totalAmount: numberValue(row.total_amount),
    startDate: stringValue(row.start_date),
    endDate: stringValue(row.end_date),
    orderStatus: row.order_status as ManagedOrderRow['orderStatus'],
    settlementStatus,
    settlementDetail: stringValue(row.settlement_detail),
    confirmedSteps: numberValue(row.confirmed_steps),
    totalSteps: numberValue(row.total_steps),
    programTransferState: row.program_transfer_state === 'payment_pending' ? 'payment_pending' : 'none',
    settlementReversalPending: Boolean(row.settlement_reversal_pending),
    createdAt: stringValue(row.created_at),
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
  const { data, error } = await client.rpc('create_order_v10', {
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
  const { data, error } = await client.rpc('create_orders_bulk_v10', { p_items: items })
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

export async function previewRemoteOrderProgramTransfer(order: Order, targetProgram: ProgramType): Promise<ProgramTransferPreview> {
  if (!order.dbId) throw new Error('서버 주문 식별자가 없습니다.')
  const client = requiredClient()
  const { data, error } = await client.rpc('preview_order_program_transfer_v99', {
    p_order_id: order.dbId,
    p_target_program: targetProgram,
    p_expected_version: order.lockVersion,
  })
  if (error) throw error
  return mapProgramTransferPreview((data ?? {}) as Record<string, unknown>)
}

export async function transferRemoteOrderProgram(
  order: Order,
  targetProgram: ProgramType,
  reason: string,
): Promise<{ order: Order; transfer: ProgramTransferPreview }> {
  if (!order.dbId) throw new Error('서버 주문 식별자가 없습니다.')
  const client = requiredClient()
  const { data, error } = await client.rpc('transfer_order_program_v99', {
    p_order_id: order.dbId,
    p_target_program: targetProgram,
    p_expected_version: order.lockVersion,
    p_reason: reason.trim(),
  })
  if (error) throw error
  const row = (data ?? {}) as Record<string, unknown>
  return {
    order: mapOrder((row.order ?? {}) as Record<string, unknown>),
    transfer: mapProgramTransferPreview((row.transfer ?? {}) as Record<string, unknown>),
  }
}

function bulkProgramTransferItems(orders: Order[]) {
  return orders.map((order) => {
    if (!order.dbId) throw new Error(`${order.id} 작업의 서버 식별자가 없습니다.`)
    return { order_id: order.dbId, expected_version: order.lockVersion }
  })
}

export async function previewRemoteBulkOrderProgramTransfer(
  orders: Order[],
  targetProgram: ProgramType,
): Promise<BulkProgramTransferPreview> {
  const client = requiredClient()
  const { data, error } = await client.rpc('preview_bulk_order_program_transfer_v910', {
    p_items: bulkProgramTransferItems(orders),
    p_target_program: targetProgram,
  })
  if (error) throw error
  return mapBulkProgramTransferPreview((data ?? {}) as Record<string, unknown>)
}

export async function transferRemoteBulkOrderProgram(
  orders: Order[],
  targetProgram: ProgramType,
  reason: string,
): Promise<BulkProgramTransferResult> {
  const client = requiredClient()
  const { data, error } = await client.rpc('transfer_bulk_order_program_v910', {
    p_items: bulkProgramTransferItems(orders),
    p_target_program: targetProgram,
    p_reason: reason.trim(),
  })
  if (error) throw error
  return mapBulkProgramTransferResult((data ?? {}) as Record<string, unknown>)
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

export async function checkRemoteMemberDeletion(memberId: string): Promise<MemberDeletionCheck> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_member_deletion_check_v95', { p_member_id: memberId })
  if (error) throw error
  const row = (data ?? {}) as Record<string, unknown>
  return {
    memberId: stringValue(row.member_id),
    username: stringValue(row.username),
    canDelete: Boolean(row.can_delete),
    isAdminAccount: Boolean(row.is_admin_account),
    isCurrentUser: Boolean(row.is_current_user),
    orderCount: numberValue(row.order_count),
    sponsoredOrderCount: numberValue(row.sponsored_order_count),
    paymentStepCount: numberValue(row.payment_step_count),
    childCount: numberValue(row.child_count),
    noticeCount: numberValue(row.notice_count),
    settlementQuoteCount: numberValue(row.settlement_quote_count),
    settlementBatchCount: numberValue(row.settlement_batch_count),
    reasons: Array.isArray(row.reasons) ? row.reasons.filter((value): value is string => typeof value === 'string') : [],
  }
}

export async function deleteRemoteMemberAccount(memberId: string): Promise<MemberDeletionResult> {
  const client = requiredClient()
  const { data, error } = await client.functions.invoke('delete-member', { body: { memberId } })
  if (error) {
    let message = error.message || '계정을 삭제하지 못했습니다.'
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { message?: unknown; error?: unknown }
        if (typeof payload.message === 'string' && payload.message) message = payload.message
        else if (typeof payload.error === 'string' && payload.error) message = payload.error
      } catch {
        // Keep the Supabase Functions error message when the response body is not JSON.
      }
    }
    throw new Error(message)
  }
  if (!data || data.ok !== true) throw new Error(typeof data?.message === 'string' ? data.message : '계정을 삭제하지 못했습니다.')
  return {
    ok: true,
    memberId: stringValue(data.memberId),
    username: stringValue(data.username),
    deletedAt: stringValue(data.deletedAt),
  }
}

export async function resetRemoteMemberPassword(memberId: string, newPassword: string): Promise<MemberPasswordResetResult> {
  const client = requiredClient()
  const { data, error } = await client.functions.invoke('reset-member-password', { body: { memberId, newPassword } })
  if (error) {
    let message = error.message || '비밀번호를 재설정하지 못했습니다.'
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { message?: unknown; error?: unknown }
        if (typeof payload.message === 'string' && payload.message) message = payload.message
        else if (typeof payload.error === 'string' && payload.error) message = payload.error
      } catch {
        // Keep the Supabase Functions error message when the response body is not JSON.
      }
    }
    throw new Error(message)
  }
  if (!data || data.ok !== true) throw new Error(typeof data?.message === 'string' ? data.message : '비밀번호를 재설정하지 못했습니다.')
  return {
    ok: true,
    memberId: stringValue(data.memberId),
    username: stringValue(data.username),
    resetAt: stringValue(data.resetAt),
  }
}

export async function reviewRemoteMember(params: Omit<MemberReviewInput, 'member'> & { memberId: string; memberUpdatedAt: string }): Promise<User> {
  const client = requiredClient()
  const { data, error } = await client.rpc('review_member_v10', {
    p_member_id: params.memberId,
    p_role: params.role === 'manager' ? 'agency' : params.role,
    p_is_operations_manager: params.role === 'manager',
    p_spark_price_per_shot: params.prices.spark,
    p_spark_plus_price_per_shot: params.prices.spark_plus,
    p_spark_s_price_per_shot: params.prices.spark_s,
    p_spark_s_plus_price_per_shot: params.prices.spark_s_plus,
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

export async function reverseRemotePaymentConfirmation(params: {
  stepId: string
  expectedConfirmedAt: string
  expectedOrderVersion: number
  reason: string
}): Promise<PaymentReversalResult> {
  const client = requiredClient()
  const { data, error } = await client.rpc('admin_reverse_payment_confirmation_v101', {
    p_step_id: params.stepId,
    p_expected_confirmed_at: params.expectedConfirmedAt,
    p_expected_order_version: params.expectedOrderVersion,
    p_reason: params.reason.trim(),
  })
  if (error) throw error
  const result = recordValue(data)
  return {
    paymentStepId: stringValue(result.paymentStepId),
    orderId: stringValue(result.orderId),
    orderStatus: result.orderStatus as PaymentReversalResult['orderStatus'],
    orderLockVersion: numberValue(result.orderLockVersion),
    operationStatusPreserved: Boolean(result.operationStatusPreserved),
    restoredToWaiting: Boolean(result.restoredToWaiting),
    settlementReversalPending: Boolean(result.settlementReversalPending),
    reversedAt: stringValue(result.reversedAt),
  }
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
    orderStatus: (row.orderStatus || '입금대기') as SettlementRow['orderStatus'],
    orderLockVersion: Math.max(1, numberValue(row.orderLockVersion)),
    settlementReversalPending: Boolean(row.settlementReversalPending),
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
    registrantSparkSPlusCount: numberValue(row.registrantSparkSPlusCount),
    registrantSparkSPlusAmount: numberValue(row.registrantSparkSPlusAmount),
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
  let { data, error } = await client.rpc('get_my_settlement_page_v101', {
    ...settlementRpcParams(filters),
    p_page: page,
    p_page_size: pageSize,
  })
  if (error && ['PGRST202', '42883'].includes(String(error.code ?? ''))) {
    const fallback = await client.rpc('get_my_settlement_page_v94', {
      ...settlementRpcParams(filters),
      p_page: page,
      p_page_size: pageSize,
    })
    data = fallback.data
    error = fallback.error
  }
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



export async function fetchAdminCompanyOverviewV96(params: {
  page?: number
  pageSize?: number
  query?: string
  sort?: CompanyOverviewSort
} = {}): Promise<AdminCompanyOverviewResult> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_admin_company_overview_v96', {
    p_page: params.page ?? 1,
    p_page_size: params.pageSize ?? 12,
    p_query: params.query?.trim() || null,
    p_sort: params.sort ?? 'pending_amount',
  })
  if (error) throw error
  const result = recordValue(data)
  const companies = Array.isArray(result.companies) ? result.companies.map((item) => {
    const row = recordValue(item)
    return {
      registrantId: stringValue(row.registrantId),
      username: stringValue(row.username),
      groupName: stringValue(row.groupName) || '미지정 그룹',
      totalOrders: numberValue(row.totalOrders),
      waitingOrderCount: numberValue(row.waitingOrderCount),
      waitingAmount: numberValue(row.waitingAmount),
      confirmedOrderCount: numberValue(row.confirmedOrderCount),
      confirmedAmount: numberValue(row.confirmedAmount),
      expiredCount: numberValue(row.expiredCount),
      runningCount: numberValue(row.runningCount),
      dailyRunningShots: numberValue(row.dailyRunningShots),
      sparkSRunningUnits: numberValue(row.sparkSRunningUnits),
      sparkSPlusRunningUnits: numberValue(row.sparkSPlusRunningUnits),
      sparkCount: numberValue(row.sparkCount),
      sparkPlusCount: numberValue(row.sparkPlusCount),
      sparkSCount: numberValue(row.sparkSCount),
      sparkSPlusCount: numberValue(row.sparkSPlusCount),
      lastOrderAt: stringValue(row.lastOrderAt),
    }
  }) : []

  return {
    page: Math.max(1, numberValue(result.page) || params.page || 1),
    pageSize: Math.max(1, numberValue(result.pageSize) || params.pageSize || 12),
    totalPages: Math.max(1, numberValue(result.totalPages) || 1),
    companyCount: numberValue(result.companyCount),
    totalOrders: numberValue(result.totalOrders),
    waitingAmount: numberValue(result.waitingAmount),
    confirmedAmount: numberValue(result.confirmedAmount),
    expiredCount: numberValue(result.expiredCount),
    dailyRunningShots: numberValue(result.dailyRunningShots),
    sparkSRunningUnits: numberValue(result.sparkSRunningUnits),
    sparkSPlusRunningUnits: numberValue(result.sparkSPlusRunningUnits),
    companies,
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

export async function fetchManagedOrdersV102(
  filters: ManagedOrderFilters,
  page = 1,
  pageSize = 50,
): Promise<ManagedOrdersPageResult> {
  const client = requiredClient()
  const safePage = Math.max(1, Math.trunc(page))
  const safePageSize = Math.min(500, Math.max(1, Math.trunc(pageSize)))
  const { data, error } = await client.rpc('get_manager_managed_orders_v102', {
    p_agency_id: filters.agencyId || null,
    p_program_type: filters.programType === 'all' ? null : filters.programType,
    p_order_status: filters.orderStatus === 'all' ? null : filters.orderStatus,
    p_settlement_status: filters.settlementStatus === 'all' ? null : filters.settlementStatus,
    p_query: filters.query.trim() || null,
    p_start_date_from: filters.startDateFrom || null,
    p_start_date_to: filters.startDateTo || null,
    p_page: safePage,
    p_page_size: safePageSize,
  })
  if (error) throw error
  const resultRows = (data ?? []) as Array<Record<string, unknown>>
  const totalCount = resultRows.length > 0 ? numberValue(resultRows[0].total_count) : 0
  return {
    rows: resultRows.map(mapManagedOrder),
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / safePageSize)),
    totalCount,
  }
}

export async function fetchAllManagedOrdersV102(filters: ManagedOrderFilters): Promise<ManagedOrderRow[]> {
  const rows: ManagedOrderRow[] = []
  const pageSize = 500
  let page = 1
  while (true) {
    const result = await fetchManagedOrdersV102(filters, page, pageSize)
    rows.push(...result.rows)
    if (rows.length >= result.totalCount || result.rows.length === 0) return rows
    page += 1
  }
}

export async function fetchManagedOrderFilterOptionsV102(): Promise<ManagedOrderFilterOption[]> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_manager_managed_order_filter_options_v102')
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: stringValue(row.agency_id),
    username: stringValue(row.agency_username),
  }))
}

export async function fetchManagedOrdersSummaryV102(): Promise<ManagedOrdersSummary> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_manager_managed_orders_summary_v102')
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    managedAgencyCount: numberValue(row?.managed_agency_count),
    totalOrderCount: numberValue(row?.total_order_count),
    runningOrderCount: numberValue(row?.running_order_count),
    settlementWaitingCount: numberValue(row?.settlement_waiting_count),
    totalAmount: numberValue(row?.total_amount),
    settlementWaitingAmount: numberValue(row?.settlement_waiting_amount),
  }
}

export async function fetchManagerDashboardSummaryV103(): Promise<ManagerDashboardSummary> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_manager_dashboard_summary_v103')
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    managedAgencyCount: numberValue(row?.managed_agency_count),
    totalOrderCount: numberValue(row?.total_order_count),
    totalSettlementAmount: numberValue(row?.total_settlement_amount),
    settlementWaitingAmount: numberValue(row?.settlement_waiting_amount),
    settlementCompletedAmount: numberValue(row?.settlement_completed_amount),
    runningOrderCount: numberValue(row?.running_order_count),
    paymentWaitingOrderCount: numberValue(row?.payment_waiting_order_count),
    paymentCompletedOrderCount: numberValue(row?.payment_completed_order_count),
    expiredOrderCount: numberValue(row?.expired_order_count),
    stoppedOrderCount: numberValue(row?.stopped_order_count),
  }
}

export async function fetchManagerAgencyOverviewV103(params: {
  page?: number
  pageSize?: number
  query?: string
  sort?: ManagerAgencyOverviewSort
} = {}): Promise<ManagerAgencyOverviewResult> {
  const client = requiredClient()
  const { data, error } = await client.rpc('get_manager_agency_overview_v103', {
    p_page: params.page ?? 1,
    p_page_size: params.pageSize ?? 12,
    p_query: params.query?.trim() || null,
    p_sort: params.sort ?? 'settlement_waiting',
  })
  if (error) throw error
  const result = recordValue(data)
  const agencies = Array.isArray(result.agencies) ? result.agencies.map((item) => {
    const row = recordValue(item)
    return {
      agencyId: stringValue(row.agencyId),
      username: stringValue(row.username),
      totalOrderCount: numberValue(row.totalOrderCount),
      runningOrderCount: numberValue(row.runningOrderCount),
      paymentWaitingOrderCount: numberValue(row.paymentWaitingOrderCount),
      paymentCompletedOrderCount: numberValue(row.paymentCompletedOrderCount),
      expiredOrderCount: numberValue(row.expiredOrderCount),
      stoppedOrderCount: numberValue(row.stoppedOrderCount),
      totalSettlementAmount: numberValue(row.totalSettlementAmount),
      settlementWaitingAmount: numberValue(row.settlementWaitingAmount),
      settlementCompletedAmount: numberValue(row.settlementCompletedAmount),
      lastOrderAt: stringValue(row.lastOrderAt),
    }
  }) : []
  return {
    page: Math.max(1, numberValue(result.page) || params.page || 1),
    pageSize: Math.max(1, numberValue(result.pageSize) || params.pageSize || 12),
    totalPages: Math.max(1, numberValue(result.totalPages) || 1),
    agencyCount: numberValue(result.agencyCount),
    agencies,
  }
}
