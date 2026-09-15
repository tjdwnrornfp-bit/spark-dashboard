import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// Run actual component handlers with a small deterministic hook host; no backend writes.
let slots = [], cursor = 0
globalThis.dateTestHooks = {
  useState(initial) {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
    return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
  },
  useMemo: (fn) => fn(), useEffect: () => {}, useRef: (value) => ({ current: value }), useId: () => 'test',
}
const { outputFiles } = await build({
  stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts', contents: `
    export { OrdersPage } from './src/features/OrdersPage'
    export { AdminOrdersExportModal } from './src/features/AdminOrdersExportModal'
    export { OrderDateFilter } from './src/components/OrderDateFilter'
    export { createdAtInDateRange, orderDatePreset } from './src/lib/orderDateFilter'
  ` }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react/jsx-runtime', 'xlsx'],
  plugins: [{ name: 'test-host', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hooks' }))
    b.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({ contents: 'export const {useState,useMemo,useEffect,useRef,useId}=globalThis.dateTestHooks;' }))
    b.onLoad({ filter: /[/\\]supabase\.ts$/ }, () => ({ contents: 'export const supabase=null; export const isSupabaseConfigured=false;' }))
    b.onLoad({ filter: /[/\\]adminExcel\.ts$/ }, () => ({ contents: 'export const ADMIN_EXCEL_PROGRAM_LABELS={}; export const downloadAdminOrdersExcel=(value)=>{globalThis.dateTestExport=value};' }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports)
const { OrdersPage, OrderDateFilter, AdminOrdersExportModal, createdAtInDateRange, orderDatePreset } = module.exports
const now = new Date('2026-09-14T15:00:00Z')
const day = { from: '2026-09-15', to: '2026-09-15' }
const matches = createdAtInDateRange(day)
for (const timestamp of ['2026-09-14T15:00:00Z', '2026-09-15T14:59:59.999999Z', '2026-09-15T00:00:00+09:00']) assert.ok(matches(timestamp), timestamp)
for (const timestamp of ['2026-09-14T14:59:59.999999Z', '2026-09-15T15:00:00Z', 'invalid']) assert.ok(!matches(timestamp), timestamp)
assert.ok(createdAtInDateRange({ from: '', to: '' })('2020-01-01T00:00:00Z'))
assert.ok(createdAtInDateRange({ from: '', to: day.to })('2020-01-01T00:00:00Z'))
assert.ok(createdAtInDateRange({ from: day.from, to: '' })('2030-01-01T00:00:00Z'))
assert.ok(!createdAtInDateRange({ from: day.to, to: '2026-09-01' })(now.toISOString()))
assert.ok(!createdAtInDateRange({ from: '2026-02-30', to: '' })(now.toISOString()))
assert.deepEqual(orderDatePreset('today', now), day)
assert.deepEqual(orderDatePreset('yesterday', now), { from: '2026-09-14', to: '2026-09-14' })
assert.deepEqual(orderDatePreset('last7', now), { from: '2026-09-09', to: '2026-09-15' })
assert.deepEqual(orderDatePreset('month', now), { from: '2026-09-01', to: '2026-09-30' })
assert.deepEqual(orderDatePreset('month', new Date('2024-02-15T00:00:00Z')), { from: '2024-02-01', to: '2024-02-29' })
assert.deepEqual(orderDatePreset('month', new Date('2026-12-31T00:00:00Z')), { from: '2026-12-01', to: '2026-12-31' })

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.action), ...nodes(tree.props?.footer)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (tree == null || typeof tree === 'boolean') return ''
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree)
}
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n).startsWith(label))
const base = { createdBy: 'member', creatorUsername: 'agency', creatorGroupName: 'group', storeName: '찾을상호', keyword: '검색', mid: '123', dailyShots: 10, operationDays: 5, totalAmount: 1000, startDate: '2026-09-16', endDate: '2026-09-20', status: '입금대기', archivedAt: null, programTransferState: 'none', placeUrl: '', memo: '' }
const make = (id, createdAt, extra = {}) => ({ ...base, id, createdAt, programType: 'spark', ...extra })
const orders = [
  make('before', '2026-08-31T14:59:59Z'), make('first', '2026-08-31T15:00:00Z'),
  make('today-start', '2026-09-14T15:00:00Z'), make('today-end', '2026-09-15T14:59:59.999999Z', { status: '입금완료' }),
  make('after', '2026-09-15T15:00:00Z'), make('archived', '2026-09-15T01:00:00Z', { archivedAt: now.toISOString() }),
  make('plus', '2026-09-15T01:00:00Z', { programType: 'spark_plus' }),
  make('s', '2026-09-15T01:00:00Z', { programType: 'spark_s' }),
  make('s-plus', '2026-09-15T01:00:00Z', { programType: 'spark_s_plus' }),
]
const props = { user: { id: 'admin', role: 'admin' }, orders, now, programType: 'spark', settings: {} }
const render = () => { cursor = 0; return OrdersPage(props) }
const rows = tree => nodes(tree).filter(n => n.type === 'tr' && n.key).map(n => n.key)
const dateControl = tree => nodes(tree).find(n => n.type === OrderDateFilter)
let tree = render()
assert.deepEqual(rows(tree), ['after', 'today-end', 'today-start', 'first', 'before'])
// Select before applying a date range: selected Excel must retain this item.
nodes(tree).find(n => n.type === 'input' && n.props['aria-label'] === '찾을상호 선택').props.onClick({ shiftKey: false })
dateControl(tree).props.onChange(day); tree = render()
assert.deepEqual(rows(tree), ['today-end', 'today-start'])
button(tree, '선택 엑셀').props.onClick()
assert.deepEqual(globalThis.dateTestExport.orders.map(o => o.id), ['after'])
const tabs = nodes(tree).find(n => n.props?.className === 'filter-tabs')
assert.equal(text(button(tabs, '전체')), '전체2')
nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === '접수일 정렬').props.onChange({ target: { value: 'asc' } }); tree = render()
assert.deepEqual(rows(tree), ['today-start', 'today-end'])
button(tree, '입금대기').props.onClick()
nodes(tree).find(n => n.type === 'input' && n.props.placeholder?.includes('MID 검색')).props.onChange({ target: { value: '찾을상호' } }); tree = render()
assert.deepEqual(rows(tree), ['today-start'])
button(tree, '보관함').props.onClick(); tree = render()
assert.deepEqual(rows(tree), ['archived'])
button(tree, '운영 작업').props.onClick(); button(tree, '전체').props.onClick()
dateControl(tree).props.onChange({ from: '2026-09-01', to: '2026-09-15' }); tree = render()
assert.deepEqual(rows(tree), ['first', 'today-start', 'today-end'])
button(tree, '통합 엑셀').props.onClick(); tree = render()
const exportProps = nodes(tree).find(n => n.type === AdminOrdersExportModal).props
assert.deepEqual(exportProps.dateRange, { from: '2026-09-01', to: '2026-09-15' })
for (const [program, expected] of [['spark_plus', 'plus'], ['spark_s', 's'], ['spark_s_plus', 's-plus']]) {
  props.programType = program; assert.deepEqual(rows(render()), [expected])
}
props.programType = 'spark'; props.user = { id: 'member', role: 'agency' }
tree = render(); assert.equal(dateControl(tree), undefined)
assert.deepEqual(rows(tree), ['before', 'first', 'today-start', 'today-end', 'after'])
slots = []; cursor = 0
tree = AdminOrdersExportModal(exportProps)
button(tree, '엑셀 다운로드').props.onClick()
assert.deepEqual(globalThis.dateTestExport.orders.map(o => o.id).sort(), ['first', 'plus', 's', 's-plus', 'today-end', 'today-start'])
let updated
tree = OrderDateFilter({ value: day, now, onChange: v => { updated = v } })
const inputs = nodes(tree).filter(n => n.type === 'input')
assert.equal(inputs[0].props.max, day.to); assert.equal(inputs[1].props.min, day.from)
inputs[0].props.onChange({ target: { value: '2026-09-16' } })
assert.deepEqual(updated, { from: '2026-09-16', to: '2026-09-16' })
inputs[1].props.onChange({ target: { value: '2026-09-14' } })
assert.deepEqual(updated, { from: '2026-09-14', to: '2026-09-14' })
button(tree, '오늘').props.onClick(); assert.deepEqual(updated, day)
button(tree, '날짜 초기화').props.onClick(); assert.deepEqual(updated, { from: '', to: '' })
console.log('PASS: KST boundaries, presets, all four programs, date/status/search/archive/sort, counts, selected/integrated exports, member isolation and date validation')
