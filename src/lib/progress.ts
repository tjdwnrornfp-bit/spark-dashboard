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
 * 화면용 일일 진행률 시뮬레이션입니다.
 * 주문번호와 날짜를 시드로 사용하므로 새로고침해도 같은 시점에는 같은 값이 나오고,
 * 일일 수량이 클수록 완료 시각이 늦어져 100타와 300타의 진행 속도 차이가 드러납니다.
 */
export function getDailyProgress(order: Order, now = new Date()): DailyProgress {
  const current = seoulDateTimeParts(now)
  const startSecond = 9 * 60 * 60
  const currentSecond = current.hour * 60 * 60 + current.minute * 60 + current.second
  const seed = hashString(`${order.id}:${current.date}`)

  // 100타는 약 20시 전후, 300타는 약 21:30~22시대, 1,000타 이상은 23시대 완료.
  const workload = clamp(Math.log2(Math.max(1, order.dailyShots / 100)) / Math.log2(10), 0, 1)
  const completionJitter = Math.round((random01(seed) - 0.5) * 50 * 60)
  const completionSecond = Math.round(clamp(
    20 * 60 * 60 + workload * 210 * 60 + completionJitter,
    19 * 60 * 60 + 35 * 60,
    23 * 60 * 60 + 45 * 60,
  ))

  if (current.date < order.startDate || currentSecond < startSecond) {
    return { percent: 0, completedShots: 0, targetShots: order.dailyShots, state: 'waiting' }
  }
  if (current.date > order.endDate || currentSecond >= completionSecond) {
    return { percent: 100, completedShots: order.dailyShots, targetShots: order.dailyShots, state: 'complete' }
  }

  // 3분 구간별 가중치를 만들고 현재 초까지 부분 반영해 게이지가 실제로 움직이게 합니다.
  const intervalSeconds = 3 * 60
  const totalIntervals = Math.ceil((completionSecond - startSecond) / intervalSeconds)
  const elapsed = currentSecond - startSecond
  const completedIntervals = Math.floor(elapsed / intervalSeconds)
  const partialInterval = (elapsed % intervalSeconds) / intervalSeconds
  const weights: number[] = []

  for (let index = 0; index < totalIntervals; index += 1) {
    const position = totalIntervals <= 1 ? 1 : index / (totalIntervals - 1)
    const lateBias = 0.55 + Math.pow(position + 0.08, 1 + workload * 2.2) * (1.1 + workload * 1.8)
    const randomFactor = 0.66 + random01(seed + index * 97) * 0.68
    weights.push(Math.max(0.08, lateBias * randomFactor))
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const elapsedWeight = weights.reduce((sum, weight, index) => {
    if (index < completedIntervals) return sum + weight
    if (index === completedIntervals) return sum + weight * partialInterval
    return sum
  }, 0)

  const rawPercent = totalWeight === 0 ? 0 : elapsedWeight / totalWeight * 100
  const percent = Math.min(99.99, Math.max(0.01, Math.floor(rawPercent * 100) / 100))
  const completedShots = Math.min(order.dailyShots - 1, Math.floor(order.dailyShots * percent / 100))

  return { percent, completedShots, targetShots: order.dailyShots, state: 'running' }
}
