import type { Order } from '../domain/types'
import { seoulDateTimeParts } from './date'

export interface DailyProgress {
  percent: number
  completedShots: number
  targetShots: number
  state: 'waiting' | 'running' | 'complete'
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function random01(seed: number): number {
  let value = seed + 0x6d2b79f5
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function activatedParts(order: Order): ReturnType<typeof seoulDateTimeParts> | null {
  if (!order.activatedAt) return null
  const date = new Date(order.activatedAt)
  return Number.isNaN(date.getTime()) ? null : seoulDateTimeParts(date)
}

/**
 * 화면용 일일 진행률입니다.
 * - 자동 구동은 자정부터 시작합니다.
 * - 관리자가 낮에 수동으로 구동중으로 바꾸면 그 시점부터 0%에서 시작합니다.
 * - 주문별·날짜별 시드를 사용하여 새로고침해도 수치가 튀지 않습니다.
 * - 완료 시각은 주문별로 23:00~23:50 사이입니다.
 */
export function getDailyProgress(order: Order, now = new Date()): DailyProgress {
  const current = seoulDateTimeParts(now)
  const currentSecond = current.hour * 3600 + current.minute * 60 + current.second
  const activation = activatedParts(order)

  if (order.status !== '구동중') {
    return { percent: 0, completedShots: 0, targetShots: order.dailyShots, state: 'waiting' }
  }
  if (current.date > order.endDate) {
    return { percent: 100, completedShots: order.dailyShots, targetShots: order.dailyShots, state: 'complete' }
  }

  // 지정 시작일 전이라도 관리자가 수동으로 구동중으로 바꾼 작업은 즉시 진행률을 표시합니다.
  const manuallyStartedBeforeSchedule = Boolean(activation && activation.date < order.startDate)
  const activatedToday = activation?.date === current.date
  if (current.date < order.startDate && !manuallyStartedBeforeSchedule) {
    return { percent: 0, completedShots: 0, targetShots: order.dailyShots, state: 'waiting' }
  }

  const seed = hashString(`${order.id}:${current.date}:${order.dailyShots}`)
  const finishJitterMinutes = Math.round(random01(seed) * 50)
  const workloadMinutes = Math.round(clamp(Math.log10(Math.max(10, order.dailyShots)) - 2, 0, 3) * 2)
  const completionSecond = clamp(23 * 3600 + (finishJitterMinutes + workloadMinutes) * 60, 23 * 3600, 23 * 3600 + 50 * 60)

  const startSecond = activatedToday && activation
    ? activation.hour * 3600 + activation.minute * 60 + activation.second
    : 0

  if (currentSecond <= startSecond) {
    return { percent: 0, completedShots: 0, targetShots: order.dailyShots, state: 'running' }
  }
  if (currentSecond >= completionSecond) {
    return { percent: 100, completedShots: order.dailyShots, targetShots: order.dailyShots, state: 'complete' }
  }

  const duration = Math.max(1, completionSecond - startSecond)
  const elapsed = clamp(currentSecond - startSecond, 0, duration)
  const intervalSeconds = 15 * 60
  const totalIntervals = Math.max(1, Math.ceil(duration / intervalSeconds))
  const completedIntervals = Math.floor(elapsed / intervalSeconds)
  const partialInterval = (elapsed % intervalSeconds) / intervalSeconds
  const weights: number[] = []

  for (let index = 0; index < totalIntervals; index += 1) {
    const position = totalIntervals <= 1 ? 1 : index / (totalIntervals - 1)
    // 하루 종일 비슷한 속도로 조금씩 올라가되, 후반부에 약간만 빨라집니다.
    const dailyShape = 0.94 + position * 0.12
    const randomFactor = 0.78 + random01(seed + index * 197) * 0.44
    const shotFactor = 1 + clamp(Math.log10(Math.max(10, order.dailyShots)) - 2, 0, 3) * 0.012
    weights.push(dailyShape * randomFactor / shotFactor)
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const elapsedWeight = weights.reduce((sum, weight, index) => {
    if (index < completedIntervals) return sum + weight
    if (index === completedIntervals) return sum + weight * partialInterval
    return sum
  }, 0)

  const rawPercent = totalWeight === 0 ? 0 : elapsedWeight / totalWeight * 100
  const percent = Math.min(99.99, Math.max(0, Math.floor(rawPercent * 100) / 100))
  const completedShots = Math.min(Math.max(0, order.dailyShots - 1), Math.floor(order.dailyShots * percent / 100))
  return { percent, completedShots, targetShots: order.dailyShots, state: 'running' }
}
