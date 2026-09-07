import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
process.on('uncaughtException', e => { console.error(e.message,e.detail??'',e.where??''); process.exit(1) })
const q = async (sql,args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
for (const file of ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','supabase/migrations/20260907045616_v10_7_admin_order_correction.sql']) await db.exec(readFileSync(file,'utf8'))
const ids = Object.fromEntries(['admin','member','manager','pending','inactive'].map(k=>[k,randomUUID()]))
for (const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users values($1)',[id])
  await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,is_operations_manager)
    values($1,$2,$2,$2,$3,$4,$5,20,20,30,40,50,$6)`,[id,name,['admin','pending','inactive'].includes(name)?'admin':'agency',name==='pending'?'pending':name==='inactive'?'rejected':'approved',name!=='inactive',name==='manager'])
}
const auth = async (id,role='authenticated') => { await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']); await db.exec(`set role ${role}`) }
const draft={program_type:'spark',place_url:'https://m.place.naver.com/place/1855867917/home',mid:'1855867917',store_name:'테스트',keyword:'키워드',daily_shots:3,operation_days:100,start_date:'2099-01-01',memo:''}
const create=async()=> (await one('select to_jsonb(admin_create_order_for_member_v106($1,$2,$3)) r',[ids.member,draft,randomUUID()])).r
const preview=async(o,c,reason='정정 사유')=>(await one('select admin_preview_order_correction_v107($1,$2,$3,$4) r',[o.id,o.lock_version,c,reason])).r
const apply=async(o,c,reason='정정 사유')=>(await one('select to_jsonb(admin_apply_order_correction_v107($1,$2,$3,$4)) r',[o.id,o.lock_version,c,reason])).r
const steps=async(id)=>{await db.exec('reset role');return q('select * from payment_steps where order_id=$1 order by step_order',[id])}
await auth(ids.admin)
const o=await create()
for(const [id,role] of [[null,'anon'],[ids.member,'authenticated'],[ids.manager,'authenticated'],[ids.pending,'authenticated'],[ids.inactive,'authenticated']]) {
  await auth(id,role); await assert.rejects(preview(o,{})); await assert.rejects(apply(o,{}))
}
await auth(ids.admin)
for(const c of [{created_by:ids.admin},{program_type:'spark_plus'},{daily_shots:1.5},{daily_shots:null},{operation_days:0},{place_url:'https://evil.com/?id=123'},{memo:null}]) await assert.rejects(preview(o,c))
await assert.rejects(preview({...o,lock_version:null},{}));await assert.rejects(apply(o,{},'x'))
await db.exec('reset role')
await q("update payment_steps set confirmed_at=now(),confirmed_by=$2 where order_id=$1",[o.id,ids.admin])
await q("update orders set status='구동중',activated_at=now() where id=$1",[o.id])
const running=await one('select * from orders where id=$1',[o.id]); const before=await steps(o.id)
await auth(ids.admin)
assert.equal((await preview(running,{daily_shots:100,operation_days:3})).financialImpact,'financial_neutral')
const corrected=await apply(running,{daily_shots:100,operation_days:3})
assert.equal(corrected.end_date,'2099-01-03');assert.equal(corrected.status,'구동중');assert.equal(corrected.total_amount,6600)
assert.equal(new Date(corrected.activated_at).toISOString(),new Date(running.activated_at).toISOString());assert.equal(corrected.lock_version,running.lock_version+1)
assert.deepEqual(await steps(o.id),before)
const audit=await one("select metadata from audit_logs where entity_id=$1 and action='order.corrected'",[o.id])
assert.equal(audit.metadata.before.daily_shots,3);assert.equal(audit.metadata.after.daily_shots,100);assert.equal(audit.metadata.payment_adjustment_created,false)
await auth(ids.admin); await assert.rejects(apply(running,{}),/먼저/)
for(const c of [{daily_shots:200},{daily_shots:50},{start_date:'2099-01-02'}]) assert.equal((await preview(corrected,c)).allowed,false)
// Snapshot pricing and prepayment increases/decreases preserve pending step IDs.
let unpaid=await create();const unpaidSteps=await steps(unpaid.id)
await q('update profiles set spark_price_per_shot=999 where id=$1',[ids.member]);await auth(ids.admin)
unpaid=await apply(unpaid,{daily_shots:6});assert.equal(unpaid.total_amount,13200);assert.equal(unpaid.price_per_shot,20)
assert.equal((await steps(unpaid.id))[0].id,unpaidSteps[0].id);await auth(ids.admin)
unpaid=await apply(unpaid,{daily_shots:2});assert.equal(unpaid.total_amount,4400)
// Paid increases append only the difference, preserving every confirmed field.
await db.exec('reset role');await q('update profiles set spark_price_per_shot=20 where id=$1',[ids.member]);await auth(ids.admin)
let paid=await create();await db.exec('reset role');await q('update payment_steps set confirmed_at=now(),confirmed_by=$2 where order_id=$1',[paid.id,ids.admin]);await q("update orders set status='입금완료' where id=$1",[paid.id]);const paidBefore=await steps(paid.id);await auth(ids.admin)
paid=await apply(paid,{daily_shots:6});assert.equal(paid.status,'입금대기')
const paidAfter=await steps(paid.id);assert.deepEqual(paidAfter[0],paidBefore[0]);assert.equal(paidAfter[1].total_amount,6600);assert.equal(paidAfter[1].confirmed_at,null)
await auth(ids.admin);assert.equal((await preview(paid,{daily_shots:3})).allowed,false)
// Partial confirmation chain: the creator's additional payment precedes the unpaid sponsor step.
await db.exec('reset role')
const distributor=randomUUID();await q('insert into auth.users values($1)',[distributor])
await q("insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot) values($1,'dist','dist','dist','distributor','approved',true,10,10)",[distributor])
await q("update profiles set sponsor_id=$1,sponsor_username='dist' where id=$2",[distributor,ids.member]);await auth(ids.admin)
let partial=await create();const chainBefore=await steps(partial.id)
await q('update payment_steps set confirmed_at=now(),confirmed_by=$2 where id=$1',[chainBefore[0].id,distributor]);await auth(ids.admin)
partial=await apply(partial,{daily_shots:6});const chainAfter=await steps(partial.id)
assert.equal(chainAfter.filter(s=>s.confirmed_at===null)[0].payer_id,ids.member)
assert.equal(chainAfter.filter(s=>s.confirmed_at===null)[1].payer_id,distributor)
assert.equal(chainAfter.find(s=>s.payer_id===distributor).id,chainBefore[1].id)
await q('update profiles set sponsor_id=null,sponsor_username=null where id=$1',[ids.member]);await auth(ids.admin)
// Expired metadata only, archived block, stopped timestamps preserved.
for(const status of ['정지','만료']) {
  await db.exec('reset role');await q('update orders set status=$2 where id=$1',[o.id,status]);const current=await one('select * from orders where id=$1',[o.id]);await auth(ids.admin)
  const changed=await apply(current,{memo:'메모 정정'});assert.equal(changed.status,status);assert.equal(changed.activated_at,corrected.activated_at)
  if(status==='만료') assert.equal((await preview(changed,{daily_shots:3,operation_days:100})).allowed,false)
}
await db.exec('reset role');await q('update orders set archived_at=now() where id=$1',[o.id]);const archived=await one('select * from orders where id=$1',[o.id]);await auth(ids.admin);assert.equal((await preview(archived,{})).allowed,false)
// All four entry methods produce traceable creation audits, and scoped context is restored.
await auth(ids.admin);const adminManual=await create()
const adminExcel=(await one('select admin_bulk_create_orders_for_members_v106($1,$2) r',[[{...draft,target_user_id:ids.member}],randomUUID()])).r.items[0].order
await auth(ids.member)
const regular=(await one('select to_jsonb(create_order_v10($1,$2,$3,$4,$5,$6,$7,$8,$9)) r',Object.values(draft))).r
const excel=(await one('select to_jsonb(create_orders_bulk_v10($1)) r',[[draft]])).r
await db.exec('reset role')
for(const [order,method] of [[adminManual,'admin_manual'],[adminExcel,'admin_excel'],[regular,'manual'],[excel,'excel']]) {
  const {metadata}=await one("select metadata from audit_logs where entity_id=$1 and action='order.created'",[order.id])
  assert.equal(metadata.input_method,method);assert.equal(metadata.daily_shots,3);assert.equal(metadata.operation_days,100);assert.equal(metadata.mid,draft.mid);assert.equal(metadata.registrant_username,'member');assert.ok(metadata.actor_username)
}
await db.close()
console.log('PASS: correction authorization, strict fields, stale locking, neutral preservation, snapshot pricing, unpaid decrease, paid increase, running/stopped/expired/archive guards, four creation audit methods')
