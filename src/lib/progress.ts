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

/**
 * 화면용 일일 진행률입니다. 자정부터 주문별 완료 시각(23:00~23:50)까지
 * 완만하게 증가하며, 주문번호·날짜·타수를 시드로 사용해 새로고침해도 동일합니다.
 * 실제 처리 서버 데이터가 연결되면 이 함수만 실측값 조회로 교체하면 됩니다.
 */
export function getDailyProgress(order: Order, now = new Date()): DailyProgress {
  const current = seoulDateTimeParts(now)
  const currentSecond = current.hour * 3600 + current.minute * 60 + current.second
  const seed = hashString(`${order.id}:${current.date}:${order.dailyShots}`)

  // 타수 차이는 최대 약 8분만 반영하고, 주문별 난수로 완료 시각을 크게 분산합니다.
  const workloadMinutes = clamp(Math.log10(Math.max(10, order.dailyShots)) - 2, 0, 2) * 4
  const finishJitterMinutes = Math.round(random01(seed) * 42)
  const completionSecond = Math.round(clamp(
    23 * 3600 + workloadMinutes * 60 + finishJitterMinutes * 60,
    23 * 3600,
    23 * 3600 + 50 * 60,
  ))

  if (current.date < order.startDate || order.status !== '구동중') {
    return { percent: 0, completedShots: 0, targetShots: order.dailyShots, state: 'waiting' }
  }
  if (current.date > order.endDate || currentSecond >= completionSecond) {
    return { percent: 100, completedShots: order.dailyShots, targetShots: order.dailyShots, state: 'complete' }
  }

  const intervalSeconds = 10 * 60
  const totalIntervals = Math.ceil(completionSecond / intervalSeconds)
  const completedIntervals = Math.floor(currentSecond / intervalSeconds)
  const partialInterval = (currentSecond % intervalSeconds) / intervalSeconds
  const weights: number[] = []

  for (let index = 0; index < totalIntervals; index += 1) {
    const position = totalIntervals <= 1 ? 1 : index / (totalIntervals - 1)
    const dailyShape = 0.82 + position * 0.28
    const randomFactor = 0.72 + random01(seed + index * 131) * 0.56
    weights.push(dailyShape * randomFactor)
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const elapsedWeight = weights.reduce((sum, weight, index) => {
    if (index < completedIntervals) return sum + weight
    if (index === completedIntervals) return sum + weight * partialInterval
    return sum
  }, 0)

  const rawPercent = totalWeight === 0 ? 0 : elapsedWeight / totalWeight * 100
  const percent = Math.min(99.99, Math.max(0, Math.floor(rawPercent * 100) / 100))
  const completedShots = Math.min(order.dailyShots - 1, Math.floor(order.dailyShots * percent / 100))
  return { percent, completedShots, targetShots: order.dailyShots, state: 'running' }
}
