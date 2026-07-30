import type { AppSettings, Order, OrderDraft, OrderStatus, User } from '../domain/types'
import { calculateOperationDates, hasReachedSeoulTime, seoulTimeIso, todayInSeoul } from './date'
import { calculateAmount } from './money'

export function extractMid(url: string): string {
  const value = url.trim()
  const pathMatch = value.match(/(?:m\.)?place\.naver\.com\/(?:place|restaurant|hairshop|hospital|cafe|accommodation)\/(\d+)/i)
  if (pathMatch) return pathMatch[1]
  const genericMatch = value.match(/place\.naver\.com\/[^/]+\/(\d+)/i)
  if (genericMatch) return genericMatch[1]
  const queryMatch = value.match(/[?&](?:id|placePath)=(\d+)/i)
  return queryMatch?.[1] ?? ''
}

export function validateDraft(draft: OrderDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!extractMid(draft.placeUrl)) errors.placeUrl = 'MID를 확인할 수 있는 네이버 플레이스 URL을 입력해 주세요.'
  if (!draft.storeName.trim()) errors.storeName = '상호명을 입력해 주세요.'
  if (!draft.keyword.trim()) errors.keyword = '대표 키워드를 입력해 주세요.'
  if (!Number.isInteger(Number(draft.dailyShots)) || Number(draft.dailyShots) < 1) errors.dailyShots = '1 이상의 정수를 입력해 주세요.'
  if (!Number.isInteger(Number(draft.operationDays)) || Number(draft.operationDays) < 1) errors.operationDays = '1 이상의 정수를 입력해 주세요.'
  if (draft.memo.length > 300) errors.memo = '메모는 300자 이하로 입력해 주세요.'
  return errors
}

function nextSequence(orders: Order[], datePart: string): number {
  const prefix = `SP-${datePart}-`
  return orders.filter((order) => order.id.startsWith(prefix)).reduce((max, order) => {
    const sequence = Number(order.id.slice(prefix.length))
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max
  }, 0) + 1
}

export function createOrder(user: User, draft: OrderDraft, settings: AppSettings, existing: Order[], now = new Date()): Order {
  if (user.role === 'admin' || user.role === null || user.approvalStatus !== 'approved' || user.pricePerShot <= 0) {
    throw new Error('승인된 대행사 또는 총판만 작업을 접수할 수 있습니다.')
  }
  const dailyShots = Number(draft.dailyShots)
  const operationDays = Number(draft.operationDays)
  const dates = calculateOperationDates(operationDays, settings.cutoffHour, now)
  const amount = calculateAmount(dailyShots, operationDays, user.pricePerShot)
  const datePart = todayInSeoul(now).replaceAll('-', '')
  const iso = now.toISOString()
  return {
    id: `SP-${datePart}-${String(nextSequence(existing, datePart)).padStart(4, '0')}`,
    createdAt: iso,
    createdBy: user.id,
    creatorUsername: user.username,
    placeUrl: draft.placeUrl.trim(),
    mid: extractMid(draft.placeUrl),
    storeName: draft.storeName.trim(),
    keyword: draft.keyword.trim(),
    dailyShots,
    operationDays,
    pricePerShot: user.pricePerShot,
    ...amount,
    startDate: dates.startDate,
    endDate: dates.endDate,
    status: '입금대기',
    memo: draft.memo.trim(),
    activatedAt: null,
    stoppedAt: null,
    paymentNotifiedAt: null,
    updatedAt: iso,
  }
}

export function transitionOrder(order: Order, nextStatus: OrderStatus, now = new Date()): Order {
  const iso = now.toISOString()
  return {
    ...order,
    status: nextStatus,
    activatedAt: nextStatus === '구동중' ? (order.status === '구동중' ? order.activatedAt : iso) : (nextStatus === '입금대기' || nextStatus === '입금완료' ? null : order.activatedAt),
    stoppedAt: nextStatus === '정지' ? iso : null,
    paymentNotifiedAt: nextStatus === '입금완료' && !order.paymentNotifiedAt ? iso : order.paymentNotifiedAt,
    updatedAt: iso,
  }
}

export interface ScheduledTransition {
  orderId: string
  userId: string
  role: 'agency' | 'distributor'
  nextStatus: '구동중' | '만료'
}

export function applyScheduledTransitions(orders: Order[], members: User[], settings: AppSettings, now = new Date()) {
  const today = todayInSeoul(now)
  const transitions: ScheduledTransition[] = []
  let changed = false
  const nextOrders = orders.map((order) => {
    const member = members.find((item) => item.id === order.createdBy)
    const role = member?.role === 'distributor' ? 'distributor' : 'agency'
    if (order.status === '입금완료' && hasReachedSeoulTime(order.startDate, settings.autoStartHour, now) && order.endDate >= today) {
      changed = true
      transitions.push({ orderId: order.id, userId: order.createdBy, role, nextStatus: '구동중' })
      return { ...order, status: '구동중' as const, activatedAt: seoulTimeIso(order.startDate, settings.autoStartHour), updatedAt: now.toISOString() }
    }
    if (['입금완료', '구동중', '정지'].includes(order.status) && order.endDate < today) {
      changed = true
      transitions.push({ orderId: order.id, userId: order.createdBy, role, nextStatus: '만료' })
      return { ...order, status: '만료' as const, updatedAt: now.toISOString() }
    }
    return order
  })
  return { orders: changed ? nextOrders : orders, transitions }
}

export const STATUS_ORDER: OrderStatus[] = ['입금대기', '입금완료', '구동중', '정지', '만료']
