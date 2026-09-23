import { isIsoDate } from './date'

export interface StartDateRestriction {
  id: string
  startDate: string
  endDate: string
  reason: string
  enabled: boolean
  version: number
  updatedAt: string
}
export interface RestrictionImpact { existingCount: number; waitingCount: number; runningCount: number }
export interface RestrictionState {
  rules: StartDateRestriction[] | undefined
  loading: boolean
  error: string
  reload: () => void
}
export function startDateRestrictionError(date: string, rules: StartDateRestriction[] | undefined, originalDate?: string): string {
  // Grandfather only an unchanged start date, not a new order on that same date.
  if (originalDate !== undefined && date === originalDate) return ''
  if (!rules) return '접수 제한 설정을 확인하지 못했습니다. 다시 확인한 뒤 접수해 주세요.'
  if (!isIsoDate(date)) return '' // Existing date-format/earliest-day validation owns this error.
  const block = rules.find((r) => r.enabled && r.startDate <= date && date <= r.endDate)
  return block ? `시작일 ${date}은 접수 제한 기간(${block.startDate} ~ ${block.endDate})입니다. 사유: ${block.reason}` : ''
}
export function restrictedRowErrors(rows: { startDate: string; storeName?: string }[], rules: StartDateRestriction[] | undefined, rowNumbers?: number[]): string[] {
  if (!rules) return ['접수 제한 설정을 확인하지 못했습니다. 다시 확인해 주세요.']
  return rows.flatMap((row, i) => {
    const error = startDateRestrictionError(row.startDate, rules)
    return error ? [`${rowNumbers?.[i] ?? i + 2}행${row.storeName ? ` · ${row.storeName}` : ''}: ${error}`] : []
  })
}
