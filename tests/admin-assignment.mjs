import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
process.on('uncaughtException', (error) => { console.error(error.message, error.detail ?? '', error.where ?? '', error.stack?.split('\n').slice(0, 3).join('\n')); process.exit(1) })

const db = new PGlite()
const query = async (sql, args = []) => (await db.query(sql, args)).rows
const one = async (sql, args = []) => (await query(sql, args))[0]
const fixture = readFileSync(new URL('./fixtures/v105-intake.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql', import.meta.url), 'utf8')
await db.exec(fixture)
await db.exec(readFileSync(new URL('./fixtures/v105-quotes.sql', import.meta.url), 'utf8'))
await db.exec(migration)
await db.exec(readFileSync(new URL('../supabase/migrations/20260907045616_v10_7_admin_order_correction.sql', import.meta.url), 'utf8'))

const ids = Object.fromEntries(['admin', 'manager', 'dist', 'agency', 'managed', 'pending', 'zero'].map((key) => [key, randomUUID()]))
for (const [name, id] of Object.entries(ids)) {
  await query('insert into auth.users values ($1)', [id])
  await query(`insert into public.profiles(id,username,username_key,referral_code,role,approval_status,active,approved_at,
    price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,group_name,is_operations_manager)
    values ($1,$2,$2,$2,$3,$4,$5,now(),$6,$6,$7,$8,$9,'기존그룹',$10)`,
  [id, `test_${name}`, name === 'admin' ? 'admin' : name === 'dist' ? 'distributor' : 'agency', name === 'pending' ? 'pending' : 'approved', name !== 'pending', name === 'admin' ? 999 : name === 'dist' ? 20 : 35, name === 'zero' ? 0 : 40, 45, 50, name === 'manager'])
}
await query('update public.profiles set sponsor_id=$1,sponsor_username=$2 where id=$3', [ids.dist, 'test_dist', ids.agency])
await query('update public.profiles set manager_id=$1,manager_username=$2 where id=$3', [ids.manager, 'test_manager', ids.managed])
const baseline = await query('select id,sponsor_id,manager_id from public.profiles order by id')
const authenticate = async (id, role = 'authenticated') => {
  await db.exec('reset role')
  await query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ''])
  await db.exec(`set role ${role}`)
}
const draft = { program_type: 'spark', place_url: 'https://m.place.naver.com/place/1234567890/home', mid: '1234567890', store_name: '검증 상호', keyword: '검증 키워드', daily_shots: 100, operation_days: 10, start_date: '2099-01-01', memo: '' }
const manual = async (target, item = draft, request = randomUUID()) => (await one('select to_jsonb(public.admin_create_order_for_member_v106($1,$2,$3)) result', [target, item, request])).result
const bulk = async (items, request = randomUUID()) => (await one('select public.admin_bulk_create_orders_for_members_v106($1,$2) result', [items, request])).result.items
await authenticate(null, 'anon')
await assert.rejects(manual(ids.agency), /permission denied/)
for (const key of ['agency', 'manager', 'pending']) {
  await authenticate(ids[key]); await assert.rejects(manual(ids.agency), /관리자만/)
  await assert.rejects(bulk([{ ...draft, target_username: 'test_agency' }]), /관리자만/)
}
await authenticate(ids.admin)
for (const key of ['admin', 'manager', 'pending']) await assert.rejects(manual(ids[key]), /부여 대상/)
await assert.rejects(manual(randomUUID()), /찾을 수 없습니다/)
await assert.rejects(manual(ids.zero, { ...draft, program_type: 'spark_plus' }), /단가/)
for (const changes of [{ program_type: null }, { program_type: 'bad' }, { daily_shots: 0 }, { daily_shots: 1.5 }, { daily_shots: null }, { operation_days: null }, { store_name: '' }, { store_name: 'x'.repeat(51) }, { keyword: 'x'.repeat(51) }, { place_url: 'https://example.org' }, { mid: 'wrong' }, { start_date: '2020-01-01' }, { start_date: '2099-02-30' }, { memo: 'x'.repeat(301) }]) {
  await assert.rejects(manual(ids.agency, { ...draft, ...changes }))
}
const request = randomUUID()
const order = await manual(ids.agency, draft, request)
assert.equal(order.created_by, ids.agency)
assert.equal(order.price_per_shot, 35)
assert.equal(order.creator_username, 'test_agency')
assert.equal(order.creator_group_name, '기존그룹')
assert.equal(order.total_amount, 38500)
assert.equal((await manual(ids.agency, draft, request)).id, order.id)
await assert.rejects(manual(ids.agency, { ...draft, memo: 'changed' }, request), /내용이 변경/)
await db.exec('reset role')
const steps = await query('select payer_id,payee_id,unit_price,program_type from public.payment_steps where order_id=$1 order by step_order', [order.id])
assert.deepEqual(steps.map((s) => [s.payer_id, s.payee_id, s.unit_price]), [[ids.agency, ids.dist, 35], [ids.dist, ids.admin, 20]])
assert.equal(steps[0].program_type, 'spark')
const audit = await one("select * from public.audit_logs where action='order.admin_assigned' and entity_id=$1", [order.id])
assert.equal(audit.actor_id, ids.admin)
assert.equal(audit.metadata.assignment_method, 'manual')
assert.equal(audit.metadata.target_user_id, ids.agency)

await authenticate(ids.admin)
for (const [program, price] of [['spark', 35], ['spark_plus', 40], ['spark_s', 45], ['spark_s_plus', 50]]) {
  const assigned = await manual(ids.managed, { ...draft, program_type: program })
  assert.equal(assigned.price_per_shot, price)
  await db.exec('reset role')
  const chain = await query('select * from public.payment_steps where order_id=$1 order by step_order', [assigned.id])
  assert.equal(chain.length, 1); assert.equal(chain[0].payee_id, ids.admin); assert.equal(chain[0].payer_id, ids.managed); assert.equal(chain[0].program_type, program)
  await authenticate(ids.admin)
}
const mixedRequest = randomUUID()
const items = [{ ...draft, target_username: 'test_agency', row_number: 2 }, { ...draft, target_username: 'missing', row_number: 3 }, { ...draft, target_username: 'test_managed', row_number: 4 }]
const mixed = await bulk(items, mixedRequest)
assert.deepEqual(mixed.map((item) => item.status), ['success', 'failed', 'success'])
assert.deepEqual((await bulk(items, mixedRequest)).map((item) => item.order?.id), mixed.map((item) => item.order?.id))
await assert.rejects(bulk([]), /1~500/)
await assert.rejects(bulk(Array.from({ length: 501 }, () => items[0])), /1~500/)
const many = await bulk(Array.from({ length: 500 }, (_, index) => ({ ...draft, target_username: 'test_agency', row_number: index + 2 })))
assert.equal(many.filter((item) => item.status === 'success').length, 500)
await db.exec('reset role')
assert.deepEqual(await query('select id,sponsor_id,manager_id from public.profiles order by id'), baseline)
assert.equal(Number((await one("select count(*) from public.audit_logs where action='order.admin_assigned'")).count), 507)
assert.equal(Number((await one('select count(*) from public.orders')).count), 507)

// A failure after inserting an order (invalid sponsor price) leaves no partial rows.
await query('update public.profiles set spark_plus_price_per_shot=0 where id=$1', [ids.dist])
await authenticate(ids.admin)
const lateFailure = await bulk([
  { ...draft, program_type: 'spark_plus', target_username: 'test_agency' },
  { ...draft, program_type: 'spark_plus', target_username: 'test_managed' },
])
assert.deepEqual(lateFailure.map((item) => item.status), ['failed', 'success'])
await db.exec('reset role')
assert.equal(Number((await one('select count(*) from public.orders')).count), 508)
assert.equal(Number((await one("select count(*) from public.audit_logs where action='order.admin_assigned'")).count), 508)
await query('update public.profiles set spark_plus_price_per_shot=40 where id=$1', [ids.dist])

// Ordinary single and bulk intake still use the shared engine without admin assignment logs.
await authenticate(ids.agency)
const self = await one('select (public.create_order_v10($1,$2,$3,$4,$5,$6,$7,$8,$9)).*', Object.values(draft))
assert.equal(self.created_by, ids.agency); assert.equal(self.price_per_shot, 35)
assert.equal((await query('select * from public.create_orders_bulk_v10($1)', [[draft, { ...draft, program_type: 'spark_s_plus' }]])).length, 2)
await db.exec('reset role')
await query("update public.profiles set group_name='새그룹' where id=$1", [ids.agency])
assert.equal((await one('select creator_group_name from public.orders where id=$1', [order.id])).creator_group_name, '기존그룹')
await authenticate(ids.admin)
let options = (await one('select public.get_my_settlement_filter_options_v92() result')).result
assert.ok(options.groups.includes('새그룹')); assert.ok(options.groups.includes('기존그룹'))
const settlement = (await one("select public.get_my_settlement_page_v94(p_group_name => '새그룹', p_status => 'all') result")).result
assert.ok(settlement.rows.length > 0)
assert.ok(settlement.rows.every((row) => row.registrantGroupName === '새그룹'))
// Make an existing first step ready only in this isolated fixture, then select by current group.
await db.exec('reset role')
await query('update public.payment_steps set confirmed_at=now() where order_id=$1 and step_order=1', [order.id])
await authenticate(ids.admin)
const quote = (await one("select public.create_settlement_quote_v92(p_selection_mode => 'filtered', p_group_name => '새그룹') result")).result
assert.equal(quote.itemCount, 1)
const company = (await one("select public.get_admin_company_overview_v96(1,50,'새그룹','') result")).result
assert.ok(company.companies.some((item) => item.registrantId === ids.agency && item.groupName === '새그룹'))
await db.exec('reset role')
await query("update public.profiles set group_name='' where id=$1", [ids.agency])
await authenticate(ids.admin)
options = (await one('select public.get_my_settlement_filter_options_v92() result')).result
assert.ok(!options.groups.includes('새그룹'))
const emptyCompany = (await one("select public.get_admin_company_overview_v96(1,50,'test_agency','') result")).result
assert.equal(emptyCompany.companies[0].groupName, '미지정 그룹')
await db.close()
console.log('PASS: admin authorization, target validation, 4 programs, ownership, sponsor/manager chains, per-row rollback, audit, idempotency, 500 rows, ordinary intake, current/empty group and snapshot preservation')
