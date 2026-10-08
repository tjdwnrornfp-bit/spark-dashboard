import { getDailyProgress, seoulProgressDate } from '../_shared/progress.ts'

export interface ProgressInput {
  order_number: string; program_type: string; status: string; archived: boolean
  daily_shots: number; start_date: string; end_date: string; activated_at: string | null
}
export interface ProgressQueryResult { error?: string; retry_after_seconds?: number; as_of?: string; rows?: ProgressInput[]; remaining_minute?: number }
type Lookup = (hash: string, numbers: string[]) => Promise<ProgressQueryResult>
const MAX_BYTES = 16384
const statuses = ['입금대기', '입금완료', '구동중', '정지', '만료']

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } })
}
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_request')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error('too_large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
export function createProgressHandler(lookup: Lookup) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' })
    // This endpoint is for the partner's backend. CORS is not authentication.
    if (request.headers.has('origin')) return json(403, { error: 'server_to_server_only' })
    if (new URL(request.url).search) return json(400, { error: 'invalid_request' })
    const match = /^Bearer (spk_progress_[a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')
    if (!match) return json(401, { error: 'unauthorized' })
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(415, { error: 'json_required' })
    let body: unknown
    try { body = await readBody(request) } catch (err) { return json(err instanceof Error && err.message === 'too_large' ? 413 : 400, { error: err instanceof Error && err.message === 'too_large' ? 'payload_too_large' : 'invalid_request' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('order_numbers' in body)) return json(400, { error: 'invalid_request' })
    const numbers = body.order_numbers
    if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > 100 || new Set(numbers).size !== numbers.length || numbers.some(n => typeof n !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(n))) return json(400, { error: 'invalid_request' })
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const result = await lookup(hash, numbers)
      if (result.error === 'unauthorized') return json(401, { error: 'unauthorized' })
      if (result.error === 'invalid_request') return json(400, { error: 'invalid_request' })
      if (result.error === 'rate_limited') return json(429, { error: 'rate_limited' }, { 'Retry-After': String(Math.max(1, result.retry_after_seconds ?? 60)) })
      if (result.error || !result.as_of || !Number.isFinite(Date.parse(result.as_of)) || !Array.isArray(result.rows) || result.rows.length > numbers.length) throw new Error('invalid_response')
      const now = new Date(result.as_of)
      const byNumber = new Map(result.rows.map(row => [row.order_number, row]))
      if (byNumber.size !== result.rows.length || result.rows.some(row => !numbers.includes(row.order_number) || !statuses.includes(row.status) || typeof row.archived !== 'boolean' || !Number.isSafeInteger(row.daily_shots) || row.daily_shots <= 0 || !['spark','spark_plus','spark_s','spark_s_plus'].includes(row.program_type) || !/^\d{4}-\d{2}-\d{2}$/.test(row.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(row.end_date))) throw new Error('invalid_response')
      const items = numbers.map(order_number => {
        const row = byNumber.get(order_number)
        if (!row) return { order_number, error: 'not_found' }
        const showProgress = !row.archived && row.status === '구동중' && ['spark','spark_plus'].includes(row.program_type)
        const percent = showProgress ? getDailyProgress({ id: row.order_number, status: row.status, dailyShots: row.daily_shots, startDate: row.start_date, endDate: row.end_date, activatedAt: row.activated_at }, now).percent : null
        return { order_number, status: row.archived ? '보관' : row.status, progress_percent: percent }
      })
      return json(200, { date: seoulProgressDate(now), as_of: now.toISOString(), time_zone: 'Asia/Seoul', items }, { 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': String(result.remaining_minute ?? 0) })
    } catch {
      // Do not echo credentials, request bodies or upstream database diagnostics.
      return json(503, { error: 'temporarily_unavailable' }, { 'Retry-After': '30' })
    }
  }
}
