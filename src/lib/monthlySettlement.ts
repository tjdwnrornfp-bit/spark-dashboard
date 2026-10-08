import { supabase } from './supabase'
import type { ProgramType } from '../domain/types'
export type MonthlyMode = 'work' | 'receipts'
export interface MonthlyQuery { month: string; mode: MonthlyMode; program: ProgramType | ''; query: string; registrant?: string; page?: number; view?: 'companies' | 'details'; snapshot?: string; revision?: string }
export interface MonthlyTotals { count: number; totalAmount: number; confirmedAmount: number; waitingAmount: number; confirmationAmount: number; reversalAmount: number }
export interface MonthlyRow { id: string; orderId: string; orderNumber: string; storeName: string; registrantId: string; username: string; groupName: string; payer: string; program: ProgramType; startDate: string; status: string; archived: boolean; stepKind: string; amount: number; confirmedAt: string | null; kind?: 'confirmation' | 'reversal'; occurredAt?: string; source?: string }
export interface MonthlyCompany { registrantId: string; username: string; groupName: string; summary: MonthlyTotals }
export interface MonthlyClose { id: string; version: number; createdAt: string; reason: string; revision: string }
export interface MonthlyResult { month: string; mode: MonthlyMode; asOf: string; revision: string; summary: MonthlyTotals; companies: MonthlyCompany[]; rows: MonthlyRow[]; totalCount: number; page: number; totalPages: number; trend: { month: string; amount: number }[]; snapshots: MonthlyClose[]; snapshotId: string | null; liveRevision: string; changedSinceClose: boolean; liveTotals: { work: MonthlyTotals; receipts: MonthlyTotals }; coverage: { legacyCount: number; trackingSince: string | null } }
const totalsKeys = ['count','totalAmount','confirmedAmount','waitingAmount','confirmationAmount','reversalAmount'] as const
function validTotals(t: MonthlyTotals) { return t && totalsKeys.every(k => Number.isSafeInteger(t[k])) && t.count >= 0 }
export function validateMonthlyResult(data: MonthlyResult): MonthlyResult {
  if (!data || !/^[a-f0-9]{32}$/.test(data.revision) || !validTotals(data.summary) || !validTotals(data.liveTotals?.work) || !validTotals(data.liveTotals?.receipts)
    || !Array.isArray(data.rows) || data.rows.length>50 || !Array.isArray(data.companies) || data.companies.length>50 || !Array.isArray(data.trend) || data.trend.length!==12 || !Array.isArray(data.snapshots)
    || !Number.isSafeInteger(data.totalCount) || data.totalCount<0 || !Number.isSafeInteger(data.page) || data.page<1 || !Number.isSafeInteger(data.totalPages) || data.totalPages<1
    || data.rows.some(r=>!r.id || !Number.isSafeInteger(r.amount)) || data.companies.some(c=>!c.registrantId || !validTotals(c.summary)) || data.trend.some(t=>!Number.isSafeInteger(t.amount))) throw new Error('월별 정산 응답을 확인할 수 없습니다. 다시 조회해 주세요.')
  return data
}
export async function fetchMonthlySettlement(q: MonthlyQuery): Promise<MonthlyResult> {
  if (!supabase) throw new Error('운영 서버에 연결한 후 월별 정산을 조회할 수 있습니다.')
  const { data,error } = await supabase.rpc('get_admin_monthly_settlement_v1016', { p_month:`${q.month}-01`,p_mode:q.mode,p_program:q.program||null,p_query:q.query,p_registrant:q.registrant||null,p_page:q.page??1,p_view:q.view??'companies',p_snapshot:q.snapshot||null,p_expected_revision:q.revision||null })
  if (error) throw error
  return validateMonthlyResult(data)
}
export async function fetchMonthlyExport(q: MonthlyQuery): Promise<{ result: MonthlyResult; rows: MonthlyRow[] }> {
  const first = await fetchMonthlySettlement({...q,view:'details',page:1})
  const rows = [...first.rows]
  for (let page=2;page<=first.totalPages;page++) {
    const next=await fetchMonthlySettlement({...q,view:'details',page,revision:first.revision})
    if(next.page!==page || next.totalCount!==first.totalCount || next.revision!==first.revision) throw new Error('내보내기 중 정산 내역이 변경되었습니다. 다시 시도해 주세요.')
    rows.push(...next.rows)
  }
  if(rows.length!==first.totalCount || new Set(rows.map(r=>r.id)).size!==rows.length) throw new Error('전체 내역 검증에 실패했습니다. 다시 시도해 주세요.')
  return {result:first,rows}
}
export interface MonthlySave { month: string; requestId: string; revision: string; reason: string }
export async function saveMonthlySettlement(request: MonthlySave): Promise<{id:string;version:number;createdAt:string}> {
  if(!supabase) throw new Error('서버 연결을 확인해 주세요.')
  const {data,error}=await supabase.rpc('save_admin_monthly_settlement_v1016',{p_month:`${request.month}-01`,p_request_id:request.requestId,p_expected_revision:request.revision,p_reason:request.reason})
  if(error) throw error
  if(!data?.id || !Number.isSafeInteger(data.version) || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('마감 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.')
  return data
}
export function shiftMonth(month:string,offset:number) { const [y,m]=month.split('-').map(Number);const date=new Date(Date.UTC(y,m-1+offset,1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}` }
