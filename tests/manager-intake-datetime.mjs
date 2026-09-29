import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const { outputFiles } = await build({
  entryPoints: [join(root, 'src/components/ManagedOrdersTable.tsx')],
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports)
const { ManagedOrdersTable } = module.exports
const row = Object.freeze({
  orderId: 'test-order-1', orderNumber: 'SPK-20260928-TEST',
  registrantId: 'test-agency', registrantUsername: 'test_agency', currentGroupName: '테스트 그룹',
  programType: 'spark', storeName: '접수시각 테스트 매장', keyword: '테스트 키워드', mid: '123', placeUrl: '',
  dailyShots: 200, operationDays: 7, pricePerShot: 25,
  supplyAmount: 35000, vatAmount: 3500, totalAmount: 38500,
  startDate: '2026-09-29', endDate: '2026-10-05', orderStatus: '구동중',
  settlementStatus: '정산완료', settlementDetail: '1/1 완료', confirmedSteps: 1, totalSteps: 1,
  programTransferState: 'none', settlementReversalPending: false,
  createdAt: '2026-09-28T03:15:26.123Z',
})
const props = { rows: [row], selected: new Map(), loading: false, toggleRow() {}, toggleCurrentPage() {} }
const render = (overrides = {}) => renderToStaticMarkup(createElement(ManagedOrdersTable, { ...props, ...overrides }))
const markup = render({ showCreatedAt: true })
assert.match(markup, /대표키워드<\/th><th[^>]*>접수일시<\/th><th>시작일/)
assert.equal((markup.match(/<th(?:\s|>)/g) || []).length, 13)
assert.equal((markup.match(/<td(?:\s|>)/g) || []).length, 13)
assert.equal((markup.match(/<time /g) || []).length, 2, 'desktop and mobile both show the timestamp')
assert.match(markup, /<dt>접수일시<\/dt><dd><time /)
assert.match(markup, /<span>2026\. 09\. 28\.<\/span><span>12:15:26<\/span>/)
assert.match(markup, /dateTime="2026-09-28T03:15:26\.123Z"/)
assert.match(markup, /한국 시간/)
assert.match(markup, /2026\. 09\. 29\./)
assert.match(markup, /2026\. 10\. 05\./)
assert.match(markup, /38,500원/)
assert.equal(row.createdAt, '2026-09-28T03:15:26.123Z')

for (const [value, date, time] of [
  ['2026-09-28T14:59:59Z', '2026. 09. 28.', '23:59:59'],
  ['2026-09-28T15:00:00Z', '2026. 09. 29.', '00:00:00'],
  ['2026-12-31T15:00:01Z', '2027. 01. 01.', '00:00:01'],
  ['2026-09-29T12:15:26+09:00', '2026. 09. 29.', '12:15:26'],
]) {
  const html = render({ showCreatedAt: true, rows: [{ ...row, createdAt: value }] })
  assert.ok(html.includes(`<span>${date}</span><span>${time}</span>`), value)
}
for (const value of ['', 'not-a-timestamp']) {
  const html = render({ showCreatedAt: true, rows: [{ ...row, createdAt: value }] })
  assert.ok(!html.includes('<time '), 'missing timestamps must not invent an intake time')
  assert.match(html, /<td><span>—<\/span><\/td>/)
}
for (const options of [{}, { showCreatedAt: false }]) {
  const html = render(options)
  assert.ok(!html.includes('접수일시'), 'other roles retain the existing table layout')
  assert.equal((html.match(/<th(?:\s|>)/g) || []).length, 12)
  assert.ok(!html.includes('min-width:1540px'))
}
const selected = render({ showCreatedAt: true, selected: new Map([[row.orderId, row]]), loading: true })
assert.match(selected, /class="selected-row"/)
assert.match(selected, /disabled=""/)
assert.match(selected, /checked=""/)
const fifty = render({ showCreatedAt: true, rows: Array.from({ length: 50 }, (_, i) => ({ ...row, orderId: `test-${i}` })) })
assert.equal((fifty.match(/<time /g) || []).length, 100)
assert.equal((fifty.match(/<tr /g) || []).length, 50)
assert.ok(readFileSync(join(root, 'src/features/ManagedOrdersPage.tsx'), 'utf8').includes('<ManagedOrdersTable showCreatedAt rows='))
assert.ok(readFileSync(join(root, 'src/features/AgencyFoldersPage.tsx'), 'utf8').includes('<ManagedOrdersTable showCreatedAt={!downline} rows='))

if (process.env.MANAGER_INTAKE_EVIDENCE_DIR) {
  const directory = process.env.MANAGER_INTAKE_EVIDENCE_DIR
  mkdirSync(directory, { recursive: true })
  const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
  writeFileSync(join(directory, 'manager-intake.html'), `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>관리 작업 · 접수일시 검증</title><style>${css}</style><body><main class="page-stack" style="padding:16px"><h1>관리 작업 · 접수일시</h1><p>합성 테스트 데이터 · 한국 시간 기준</p><section class="panel agency-folder">${render({ showCreatedAt: true, rows: Array.from({ length: 5 }, (_, i) => ({ ...row, orderId: `test-${i}` })) })}</section></main></body></html>`)
}
if (!process.argv.includes('--timezone-child')) {
  for (const timezone of ['UTC', 'America/Los_Angeles']) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--timezone-child'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, TZ: timezone, MANAGER_INTAKE_EVIDENCE_DIR: '' },
    })
    assert.equal(child.status, 0, `${timezone}: ${child.stderr || child.stdout}`)
  }
}
console.log('PASS: manager intake date/time, Seoul timezone and midnight, missing data, desktop/mobile, role scope and selection preservation')
