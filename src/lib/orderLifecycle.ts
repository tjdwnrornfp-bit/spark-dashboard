import type { OrderStatus, ProgramType } from '../domain/types'
import { supabase } from './supabase'

export type LifecycleAction = 'archive' | 'restore' | 'delete'
export type LifecycleFilters = { programs: ProgramType[]; status?: OrderStatus | ''; query?: string; from?: string; to?: string }
export type LifecycleItem = { id: string; orderNumber: string; storeName: string; programType: ProgramType; status: OrderStatus; version: number; waitingAmount: number; eligible: boolean; reason: string; fingerprint: string }
export type LifecycleResult = { requestId: string; results: { id: string; orderNumber?: string; success: boolean; reason: string }[] }
export type LifecycleRequest = { p_action: LifecycleAction; p_items: { id: string; version: number; fingerprint: string }[]; p_reason: string; p_request_id: string; p_confirmation: string }
export const LIFECYCLE_LABELS: Record<LifecycleAction, string> = { archive: '보관', restore: '복원', delete: '영구 삭제' }

export function lifecycleError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  // Only display application messages, not internal SQL/schema diagnostics.
  return /[가-힣]/.test(message) && !/(?:SQL|schema|relation|function|column)/i.test(message)
    ? message : '서버 응답을 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'
}
export async function previewLifecycle(action: LifecycleAction, filters: LifecycleFilters, orderIds: string[] | null): Promise<LifecycleItem[]> {
  if (!supabase) throw new Error('서버에 연결한 뒤 이용할 수 있습니다.')
  const { data, error } = await supabase.rpc('preview_admin_order_lifecycle_v1014', { p_action: action, p_filters: filters, p_order_ids: orderIds })
  if (error) throw error
  if (!data || !Array.isArray(data.items) || data.items.length > 500 || data.items.some((item: LifecycleItem) => !item.id || !item.fingerprint || typeof item.eligible !== 'boolean' || !Number.isSafeInteger(item.waitingAmount))) throw new Error('대상 확인 응답이 올바르지 않습니다.')
  return data.items
}
export function lifecycleRequest(action: LifecycleAction, items: LifecycleItem[], reason: string, confirmation: string): LifecycleRequest {
  const eligible = items.filter(item => item.eligible)
  if (!eligible.length || eligible.length > 500 || reason.trim().length < 2 || reason.trim().length > 500) throw new Error('대상과 처리 사유를 확인해 주세요.')
  if (confirmation !== (action === 'delete' ? '영구 삭제' : '확인')) throw new Error('처리 대상과 영향을 확인해 주세요.')
  return { p_action: action, p_items: eligible.map(({ id, version, fingerprint }) => ({ id, version, fingerprint })), p_reason: reason.trim(), p_request_id: crypto.randomUUID(), p_confirmation: confirmation }
}
export async function applyLifecycle(request: LifecycleRequest): Promise<LifecycleResult> {
  if (!supabase) throw new Error('서버에 연결한 뒤 이용할 수 있습니다.')
  const { data, error } = await supabase.rpc('apply_admin_order_lifecycle_v1014', request)
  if (error) throw error
  if (!data || data.requestId !== request.p_request_id || !Array.isArray(data.results)
    || data.results.length !== request.p_items.length || new Set(data.results.map((r: { id: string }) => r.id)).size !== request.p_items.length
    || data.results.some((r: { id: string; success: boolean; reason: string }) => !request.p_items.some(i => i.id === r.id) || typeof r.success !== 'boolean' || typeof r.reason !== 'string')) throw new Error('처리 결과 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.')
  return data
}
