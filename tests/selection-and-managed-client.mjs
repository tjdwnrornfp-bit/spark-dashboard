import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts', contents: `
    import { selectRowRange, ROW_INTERACTIVE } from './src/lib/rowSelection'
    import { fetchAllManagedOrdersV108, fetchManagedOrdersV108 } from './src/lib/backend'
    export { selectRowRange, ROW_INTERACTIVE, fetchAllManagedOrdersV108, fetchManagedOrdersV108 }
  ` }, bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'mock-rpc', setup(b) {
    b.onLoad({ filter: /[/\\]supabase\.ts$/ }, () => ({ loader: 'js', contents: 'export const supabase = { rpc: (...args) => globalThis.testRpc(...args) }; export const isSupabaseConfigured = true;' }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { selectRowRange, ROW_INTERACTIVE, fetchAllManagedOrdersV108, fetchManagedOrdersV108 } = module.exports
const visible = ['d', 'b', 'a', 'c']
assert.deepEqual([...selectRowRange(new Set(), visible, null, 'b', false)], ['b'])
assert.deepEqual([...selectRowRange(new Set(['b']), visible, 'b', 'b', false)], [])
assert.deepEqual([...selectRowRange(new Set(['b']), visible, 'b', 'c', true)], ['b', 'a', 'c'])
assert.deepEqual([...selectRowRange(new Set(), visible, 'c', 'b', true)], ['b', 'a', 'c'])
assert.deepEqual([...selectRowRange(new Set(['outside']), visible, 'outside', 'a', true)], ['outside', 'a'])
assert.deepEqual([...selectRowRange(new Set(), visible, 'b', 'hidden', true)], [])
for (const name of ['input', 'button', 'a', 'select', 'textarea', 'label', '[data-no-row-select]']) assert.ok(ROW_INTERACTIVE.split(',').includes(name))

const calls = []
globalThis.testRpc = async (name, params) => {
  calls.push({name, params})
  const start = (params.p_page - 1) * params.p_page_size
  return { error: null, data: Array.from({length: Math.min(params.p_page_size, 501 - start)}, (_, i) => ({order_id: String(start + i), order_number: 'TEST', order_status: '입금대기', total_count: 501})) }
}
const filters = {agencyId: 'agency', programType: 'spark_plus', orderStatus: 'in_progress', sort: 'priority', settlementStatus: '정산대기', query: ' 검색 ', startDateFrom: '2099-01-01', startDateTo: '2099-02-01'}
const exported = await fetchAllManagedOrdersV108(filters)
assert.equal(exported.length, 501)
assert.equal(new Set(exported.map(r => r.orderId)).size, 501)
assert.equal(calls.length, 2)
for (const {name,params} of calls) {
  assert.equal(name, 'get_manager_managed_orders_v108')
  assert.deepEqual(params.p_order_statuses, ['입금대기','입금완료'])
  assert.equal(params.p_sort, 'priority');assert.equal(params.p_agency_id,'agency')
  assert.equal(params.p_program_type,'spark_plus');assert.equal(params.p_settlement_status,'정산대기')
  assert.equal(params.p_query,'검색');assert.equal(params.p_start_date_from,'2099-01-01');assert.equal(params.p_start_date_to,'2099-02-01')
}
for (const status of ['all','구동중']) {
  await fetchManagedOrdersV108({...filters,orderStatus:status,sort:'oldest'})
  assert.deepEqual(calls.at(-1).params.p_order_statuses,status==='all'?null:[status])
  assert.equal(calls.at(-1).params.p_sort,'oldest')
}
console.log('PASS: visible-order selection toggle/ranges/reset boundary; interactive exclusions; composite filter, sorting, existing filters and 501-row export request parity')
