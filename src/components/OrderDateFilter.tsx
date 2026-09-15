import { isIsoDate } from '../lib/date'
import { orderDatePreset } from '../lib/orderDateFilter'
import type { OrderDatePreset, OrderDateRange } from '../lib/orderDateFilter'

const PRESETS: [OrderDatePreset, string][] = [['today', '오늘'], ['yesterday', '어제'], ['last7', '최근 7일'], ['month', '이번 달']]

export function OrderDateFilter({ value, onChange, now }: { value: OrderDateRange; onChange: (value: OrderDateRange) => void; now: Date }) {
  const update = (field: 'from' | 'to', date: string) => {
    if (date && !isIsoDate(date)) return
    const next = { ...value, [field]: date }
    // Keep the interval valid even when the browser permits typing outside min/max.
    if (next.from && next.to && next.from > next.to) {
      if (field === 'from') next.to = date
      else next.from = date
    }
    onChange(next)
  }
  return <div className="order-date-filter" role="group" aria-label="접수일 필터 (한국시간)">
    <label><span>접수일 시작</span><input type="date" value={value.from} max={value.to || undefined} onChange={(event) => update('from', event.target.value)} /></label>
    <label><span>접수일 종료</span><input type="date" value={value.to} min={value.from || undefined} onChange={(event) => update('to', event.target.value)} /></label>
    <div className="order-date-presets">{PRESETS.map(([preset, label]) => <button key={preset} type="button" className="secondary-button small" onClick={() => onChange(orderDatePreset(preset, now))}>{label}</button>)}
      <button type="button" className="text-button" disabled={!value.from && !value.to} onClick={() => onChange({ from: '', to: '' })}>날짜 초기화</button>
    </div>
    <small>한국시간 기준 · 미지정 시 전체</small>
  </div>
}
