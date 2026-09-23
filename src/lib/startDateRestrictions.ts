import { isIsoDate } from './date'
import { isSupabaseConfigured, supabase } from './supabase'
import { restrictedRowErrors } from './startDateRestrictionRules'
import type { StartDateRestriction, RestrictionImpact } from './startDateRestrictionRules'
export * from './startDateRestrictionRules'
export const RESTRICTION_CHANGED_EVENT = 'spark-start-date-restrictions-changed'

export async function fetchStartDateRestrictions(admin = false): Promise<StartDateRestriction[]> {
  if (!isSupabaseConfigured || !supabase) return []
  const { data, error } = await supabase.rpc('get_order_start_restrictions_v1012', { p_admin: admin })
  if (error) throw error
  // A missing/malformed response is never an empty policy.
  if (!Array.isArray(data) || data.some((r) => !r || typeof r.id !== 'string' || !isIsoDate(r.startDate) || !isIsoDate(r.endDate) || typeof r.enabled !== 'boolean' || typeof r.reason !== 'string')) {
    throw new Error('접수 제한 설정 응답이 올바르지 않습니다. 관리자에게 문의해 주세요.')
  }
  return data as StartDateRestriction[]
}
export async function assertAllowedStartDates(rows: { startDate: string; storeName?: string }[], originalDate?: string, rowNumbers?: number[]): Promise<void> {
  if (rows.length === 1 && originalDate !== undefined && rows[0].startDate === originalDate) return
  const rules = await fetchStartDateRestrictions()
  const errors = restrictedRowErrors(rows, rules, rowNumbers)
  if (errors.length) throw new Error(errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n외 ${errors.length - 10}건` : ''))
}
export async function previewStartDateRestriction(startDate: string, endDate: string): Promise<RestrictionImpact> {
  if (!supabase) throw new Error('접수 제한 설정은 운영 서버 연결 후 사용할 수 있습니다.')
  const { data, error } = await supabase.rpc('preview_order_start_restriction_v1012', { p_start_date: startDate, p_end_date: endDate })
  if (error) throw error
  if (!data || !Number.isFinite(Number(data.existingCount))) throw new Error('기존 작업 수를 확인하지 못했습니다.')
  return data as RestrictionImpact
}
export async function saveStartDateRestriction(rule: Pick<StartDateRestriction, 'id' | 'startDate' | 'endDate' | 'reason' | 'enabled' | 'version'>): Promise<void> {
  if (!supabase) throw new Error('접수 제한 설정은 운영 서버 연결 후 사용할 수 있습니다.')
  const { error } = await supabase.rpc('save_order_start_restriction_v1012', {
    p_id: rule.id, p_start_date: rule.startDate, p_end_date: rule.endDate, p_reason: rule.reason.trim(),
    p_enabled: rule.enabled, p_expected_version: rule.version,
  })
  if (error) throw error
  window.dispatchEvent(new Event(RESTRICTION_CHANGED_EVENT))
}
