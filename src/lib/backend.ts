import type {
  AccountDraft,
  AppSettings,
  MemberReviewInput,
  Notice,
  NotificationItem,
  Order,
  OrderDraft,
  OrderStatus,
  PaymentAccount,
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
  return {
    id: stringValue(row.id),
    username: stringValue(row.username),
    role: (row.role as User['role']) ?? null,
    approvalStatus: (row.approval_status as User['approvalStatus']) ?? 'pending',
    pricePerShot: numberValue(row.price_per_shot),
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
    updatedAt: stringValue(row.updated_at),
  }
}

export function mapPaymentStep(row: Record<string, unknown>): PaymentStep {
  return {
    id: stringValue(row.id),
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
  const [profilesResult, ordersResult, stepsResult, accountResult, notificationsResult, noticesResult, settingsResult] = await Promise.all([
    client.from('profiles').select('*').order('requested_at', { ascending: false }),
    client.from('orders').select('*').order('created_at', { ascending: true }),
    client.from('payment_steps').select('*').order('created_at', { ascending: true }).order('step_order', { ascending: true }),
    client.rpc('get_my_payment_account'),
    client.from('notifications').select('*, orders(order_number)').order('created_at', { ascending: false }),
    client.from('notices').select('*').order('created_at', { ascending: false }),
    client.from('app_settings').select('*').eq('id', true).single(),
  ])

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

export async function setRemoteOrderStatus(order: Order, status: OrderStatus): Promise<Order> {
  if (!order.dbId) throw new Error('서버 주문 식별자가 없습니다.')
  const client = requiredClient()
  const { data, error } = await client.rpc('set_order_status', { p_order_id: order.dbId, p_status: status })
  if (error) throw error
  return mapOrder(data as Record<string, unknown>)
}

export async function reviewRemoteMember(params: Omit<MemberReviewInput, 'member'> & { memberId: string }): Promise<User> {
  const client = requiredClient()
  const { data, error } = await client.rpc('review_member_v6', {
    p_member_id: params.memberId,
    p_role: params.role,
    p_price_per_shot: params.pricePerShot,
    p_approval_status: params.approvalStatus,
    p_group_name: params.groupName,
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
