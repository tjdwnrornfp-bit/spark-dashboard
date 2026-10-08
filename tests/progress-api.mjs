import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'
import { progressFixture } from './progress-api-fixture.mjs'
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  export { createProgressHandler } from './supabase/functions/order-progress/handler.ts';
  export { getDailyProgress } from './src/lib/progress.ts';
  export { getDailyProgress as legacy } from './tests/fixtures/progress-v1014.ts';
` }, bundle: true, platform: 'node', format: 'cjs', write: false })
const compiled = { exports: {} }; new Function('module', bundle.outputFiles[0].text)(compiled)
const { createProgressHandler, getDailyProgress, legacy } = compiled.exports
// Frozen v10.14 parity covers midnight, manual activation, end date and all states.
let comparisons = 0
for (const status of ['구동중','정지','만료','입금대기','입금완료']) for (const shots of [1,100,1500,100000])
for (const activatedAt of [null,'2026-10-07T23:31:18+09:00','2026-10-08T13:11:42+09:00','2026-10-08T23:59:59+09:00'])
for (const offset of [-1,0,1]) for (let minute = -1; minute <= 1441; minute += 29) {
  const order = { id: `SPK-${comparisons % 7}`, status, dailyShots: shots, activatedAt, startDate: `2026-10-0${8+offset}`, endDate: '2026-10-09' }
  const now = new Date(Date.parse('2026-10-08T00:00:00+09:00') + minute * 60000)
  assert.deepEqual(getDailyProgress(order, now), legacy(order, now)); comparisons++
}
const db = new PGlite(); await db.exec(progressFixture)
const q = async (sql,args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
const ids = Object.fromEntries(['admin','copy','child','other','pending','manager'].map(n => [n,randomUUID()]))
for (const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users values($1)',[id])
  await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,is_operations_manager,sponsor_id)
    values($1,$2,$2,$2,$3,$4,true,20,$5,$6)`,[id,name,name==='admin'?'admin':'agency',name==='pending'?'pending':'approved',name==='manager',name==='child'?ids.copy:null])
}
const auth = async name => { await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]??'']); await db.exec(`set role ${name==='anon'?'anon':'authenticated'}`) }
const service = async () => db.exec('reset role;set role service_role')
const token = 'spk_progress_'+'a'.repeat(64), hash = createHash('sha256').update(token).digest('hex')
const keyId = randomUUID(), expiry = new Date(Date.now()+86400000).toISOString()
const issue = async (member=ids.copy,id=keyId,h=hash) => (await one("select issue_progress_api_key_v1015($1,$2,$3,'test',$4) r",[id,member,h,expiry])).r
const lookup = async (h=hash,numbers=['OWN']) => { await service(); return (await one('select get_order_progress_inputs_v1015($1,$2) r',[h,numbers])).r }
const revoke = async id => (await one("select revoke_progress_api_key_v1015($1,'test revoke') r",[id])).r
for (const name of ['anon','copy','child','pending','manager','missing']) {
  await auth(name); await assert.rejects(issue(),/관리자|permission denied/)
  await assert.rejects(q('select get_order_progress_inputs_v1015($1,$2)',[hash,['OWN']]),/permission denied/)
  await assert.rejects(q('select * from spark_private.progress_api_keys_v1015'),/permission denied/)
}
await auth('admin'); for(const name of ['pending','manager','admin']) await assert.rejects(issue(ids[name]),/승인된/)
await assert.rejects(issue(ids.copy,randomUUID(),'bad'),/정보/)
assert.equal((await issue()).username,'copy'); assert.deepEqual(await issue(),await issue())
await service(); await assert.rejects(q('select * from spark_private.progress_api_keys_v1015'),/permission denied/)
await db.exec('reset role')
for (const [number,owner,status,program,archived] of [['OWN','copy','구동중','spark',false],['PAUSED','copy','정지','spark',false],['ARCHIVED','copy','구동중','spark_plus',true],['S','copy','구동중','spark_s',false],['CHILD','child','구동중','spark',false],['OTHER','other','구동중','spark',false]]) {
  await q(`insert into orders(order_number,created_by,creator_username,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date,status,program_type,archived_at)
    values($1,$2,$3,'url','123','store','keyword',100,10,20,20000,2000,22000,current_date-1,current_date+8,$4,$5,case when $6 then now() else null end)`,[number,ids[owner],owner,status,program,archived])
}
const fingerprint = async () => { await db.exec('reset role'); return one(`select (select md5(jsonb_agg(to_jsonb(p) order by id)::text) from profiles p) profiles,(select md5(jsonb_agg(to_jsonb(o) order by id)::text) from orders o) orders,(select count(*) from payment_steps) payments`) }
const before = await fingerprint()
const selected = await lookup(hash,['OWN','CHILD','OTHER','NONE'])
assert.deepEqual(selected.rows.map(r=>r.order_number),['OWN'])
assert.equal((await lookup('b'.repeat(64))).error,'unauthorized')
for(const nums of [[],['OWN','OWN'],[null],['x'.repeat(81)],Array.from({length:101},(_,i)=>'O'+i)]) assert.equal((await lookup(hash,nums)).error,'invalid_request')
// Actual HTTP handler -> restricted DB role -> selected member -> response.
const handler = createProgressHandler(lookup)
const req = (body={order_numbers:['OWN','CHILD','OTHER','NONE','PAUSED','ARCHIVED','S']},extra={}) => new Request('https://example.test/order-progress', { method:'POST', headers:{ Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra }, body:typeof body==='string'?body:JSON.stringify(body) })
const res = await handler(req()), payload=await res.json()
assert.equal(res.status,200); assert.equal(res.headers.get('cache-control'),'no-store')
assert.deepEqual(Object.keys(payload).sort(),['as_of','date','items','time_zone'])
assert.equal(payload.time_zone,'Asia/Seoul'); assert.ok(payload.items[0].progress_percent>=0&&payload.items[0].progress_percent<=100)
assert.deepEqual(payload.items.slice(1,4).map(({order_number,...rest})=>rest),Array(3).fill({error:'not_found'}))
for (const item of payload.items.slice(4)) assert.equal(item.progress_percent,null)
assert.equal(payload.items[5].status,'보관')
assert.deepEqual(Object.keys(payload.items[0]).sort(),['order_number','progress_percent','status'])
assert.ok(!JSON.stringify(payload).includes(hash)); assert.ok(!JSON.stringify(payload).includes(token))
let calls=0; const guarded=createProgressHandler(async()=>{calls++;throw Error(token)})
for (const [r,status] of [[new Request('https://example.test'),405],[req({}, {Origin:'https://partner.test'}),403],[req({}, {Authorization:'bad'}),401],[req({}, {'Content-Type':'text/plain'}),415],[req('x'.repeat(17000)),413],[req('{broken'),400],[req({order_numbers:['OWN'],member_id:ids.other}),400],[req({order_numbers:['OWN','OWN']}),400]]) assert.equal((await guarded(r)).status,status)
assert.equal(calls,0); const failed=await guarded(req()); assert.equal(failed.status,503); assert.deepEqual(await failed.json(),{error:'temporarily_unavailable'})
assert.equal((await createProgressHandler(async()=>({...selected,rows:[{...selected.rows[0],order_number:'UNREQUESTED'}]}))(req())).status,503)
// Bucket limits, reset, rotation cannot bypass member usage.
await db.exec('reset role'); await q("update spark_private.progress_api_usage_v1015 set minute_count=30,minute_at=date_trunc('minute',clock_timestamp())")
let limited=await handler(req()); assert.equal(limited.status,429); assert.ok(Number(limited.headers.get('Retry-After'))>=1)
const newId=randomUUID(),newHash='c'.repeat(64)
await auth('admin'); await issue(ids.copy,newId,newHash)
assert.equal((await lookup(hash)).error,'unauthorized'); assert.equal((await lookup(newHash)).error,'rate_limited')
await db.exec('reset role'); await q("update spark_private.progress_api_usage_v1015 set minute_at=minute_at-interval '1 minute',day_count=10000,day_at=(now() at time zone 'Asia/Seoul')::date")
assert.equal((await lookup(newHash)).error,'rate_limited')
await db.exec('reset role'); await q("update spark_private.progress_api_usage_v1015 set day_at=day_at-1")
assert.equal((await lookup(newHash)).rows.length,1)
// Account approval and expiry are checked on each request, with no stale cache.
await db.exec('reset role'); await q("update profiles set approval_status='pending',active=false where id=$1",[ids.copy]); assert.equal((await lookup(newHash)).error,'unauthorized')
await db.exec('reset role'); await q("update profiles set approval_status='approved',active=true where id=$1",[ids.copy])
await q("update spark_private.progress_api_keys_v1015 set expires_at=now()-interval '1 second' where id=$1",[newId]); assert.equal((await lookup(newHash)).error,'unauthorized')
await auth('admin'); assert.equal(await revoke(newId),true); assert.equal(await revoke(newId),false)
// Failed audit must roll back key issuance and the old key's revocation.
await db.exec(`reset role;create function fail_api_audit() returns trigger language plpgsql as $$begin raise exception 'audit failed';end$$;create trigger fail_api_audit before insert on audit_logs for each row execute function fail_api_audit();`)
await auth('admin'); await assert.rejects(issue(ids.copy,randomUUID(),'d'.repeat(64)),/audit failed/)
assert.deepEqual(await fingerprint(),before)
const audit=await q("select metadata from audit_logs where action like 'member.progress_api_key_%'")
assert.equal(audit.length,3); assert.ok(!JSON.stringify(audit).includes(hash))
await db.close()
console.log(`PASS progress API: ${comparisons} legacy parity cases; own-member isolation; role grants; input/HTTP errors; state handling; minute/day limits; rotation/revoke/expiry; audit rollback; original data preserved`)
