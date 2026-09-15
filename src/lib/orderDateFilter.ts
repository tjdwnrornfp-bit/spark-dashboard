import { addDays, isIsoDate, todayInSeoul } from './date'

export interface OrderDateRange { from: string; to: string }
export type OrderDatePreset = 'today' | 'yesterday' | 'last7' | 'month'

export function orderDatePreset(preset: OrderDatePreset, now: Date): OrderDateRange {
  const today = todayInSeoul(now)
  if (preset === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) }
  if (preset === 'last7') return { from: addDays(today, -6), to: today }
  if (preset === 'month') {
    const from = `${today.slice(0, 7)}-01`
    const nextMonth = `${addDays(from, 32).slice(0, 7)}-01`
    return { from, to: addDays(nextMonth, -1) }
  }
  return { from: today, to: today }
}

/** Inclusive KST calendar dates. Next midnight is exclusive to include all subsecond timestamps. */
export function createdAtInDateRange(range: OrderDateRange): (createdAt: string) => boolean {
  if (!range.from && !range.to) return () => true
  if ((range.from && !isIsoDate(range.from)) || (range.to && !isIsoDate(range.to)) || (range.from && range.to && range.from > range.to)) return () => false
  const from = range.from ? Date.parse(`${range.from}T00:00:00+09:00`) : -Infinity
  const until = range.to ? Date.parse(`${addDays(range.to, 1)}T00:00:00+09:00`) : Infinity
  return (createdAt) => {
    const timestamp = Date.parse(createdAt)
    return timestamp >= from && timestamp < until
  }
}
