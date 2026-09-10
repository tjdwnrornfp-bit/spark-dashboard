import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
process.on('uncaughtException', e => { console.error(e.message,e.detail??'',e.where??''); process.exit(1) })
const q = async (sql,args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
for (const file of ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','supabase/migrations/20260907045616_v10_7_admin_order_correction.sql','supabase/migrations/20260909085400_v10_8_member_edit_selection_managed_filters.sql']) await db.exec(readFileSync(file,'utf8'))
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

const ownPreview=async(o,c)=>(await one('select member_preview_own_order_edit_v108($1,$2,$3,$4) r',[o.id,o.lock_version,c,'회원 수정'])).r
const ownApply=async(o,c)=>(await one('select to_jsonb(member_apply_own_order_edit_v108($1,$2,$3,$4)) r',[o.id,o.lock_version,c,'회원 수정'])).r
await auth(ids.admin)
let o=await create();const originalSteps=await steps(o.id)
await auth(ids.member)
assert.equal((await ownPreview(o,{})).allowed,true)
o=await ownApply(o,{store_name:'수정 상호',keyword:'대표키워드',place_url:'https://m.place.naver.com/place/123456/home',daily_shots:10,operation_days:30,start_date:'2099-02-01',memo:'회원 수정 메모'})
assert.equal(o.mid,'123456');assert.equal(o.end_date,'2099-03-02');assert.equal(o.total_amount,6600)
const old=o
await db.exec('reset role');await q('update profiles set spark_price_per_shot=999 where id=$1',[ids.member]);await auth(ids.member)
o=await ownApply(o,{daily_shots:20});assert.equal(o.price_per_shot,20);assert.equal(o.total_amount,13200)
let updatedSteps=await steps(o.id);assert.equal(updatedSteps[0].id,originalSteps[0].id);assert.equal(updatedSteps[0].total_amount,13200)
await auth(ids.member);await assert.rejects(ownApply(old,{}),/먼저/)
o=await ownApply(o,{program_type:'spark_plus'});assert.equal(o.price_per_shot,30);assert.equal(o.total_amount,19800)
updatedSteps=await steps(o.id);assert.equal(updatedSteps[0].id,originalSteps[0].id);assert.equal(updatedSteps[0].program_type,'spark_plus');assert.equal(updatedSteps[0].unit_price,30)
await q('update profiles set spark_s_price_per_shot=0 where id=$1',[ids.member]);await auth(ids.member);await assert.rejects(ownPreview(o,{program_type:'spark_s'}),/승인 단가/);await assert.rejects(ownApply(o,{program_type:'spark_s'}),/승인 단가/)
for(const c of [{created_by:ids.admin},{price_per_shot:1},{sponsor_id:null},{creator_group_name:'x'},{daily_shots:1.5},{operation_days:0},{place_url:'https://naver.com.evil.com/place/123'},{program_type:null},{memo:null}]) await assert.rejects(ownApply(o,c))
for(const [id,role] of [[null,'anon'],[ids.admin,'authenticated'],[ids.manager,'authenticated'],[ids.pending,'authenticated'],[ids.inactive,'authenticated']]) {
  await auth(id,role);await assert.rejects(ownPreview(o,{}));await assert.rejects(ownApply(o,{}))
}
await db.exec('reset role')
const other=randomUUID();await q('insert into auth.users values($1)',[other]);await q("insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot) values($1,'other','other','other','agency','approved',true,20,20,30,40)",[other]);await auth(other);await assert.rejects(ownApply(o,{}),/본인/)
// Any confirmed step blocks ALL edits, including metadata and program changes.
await db.exec('reset role');await q('update payment_steps set confirmed_at=now(),confirmed_by=$2 where order_id=$1',[o.id,ids.admin]);await auth(ids.member)
assert.equal((await ownPreview(o,{memo:'차단'})).allowed,false);await assert.rejects(ownApply(o,{memo:'차단'}),/일부 정산/);await assert.rejects(ownApply(o,{program_type:'spark_s_plus'}),/일부 정산/)
assert.equal(Number((await one('select * from member_own_order_edit_eligibility_v108($1)',[[o.id]])).confirmed_steps),1)
await db.exec('reset role');await q('update payment_steps set confirmed_at=null,confirmed_by=null where order_id=$1',[o.id])
for(const status of ['입금완료','구동중','정지','만료']) {
  await db.exec('reset role');await q('update orders set status=$2 where id=$1',[o.id,status]);await auth(ids.member);await assert.rejects(ownApply(o,{memo:'차단'}),/입금대기/)
}
await db.exec('reset role');await q("update orders set status='입금대기',archived_at=now() where id=$1",[o.id]);await auth(ids.member);await assert.rejects(ownApply(o,{memo:'차단'}),/보관/)
await db.exec('reset role');assert.equal(Number((await one("select count(*) n from audit_logs where entity_id=$1 and action='order.member_program_changed'",[o.id])).n),1)
// Server-wide order/filter tests with page size 1: priority must run BEFORE pagination.
await q('update profiles set manager_id=$1,spark_price_per_shot=20 where id=$2',[ids.manager,ids.member])
const all=[]
for(const [i,status] of ['만료','구동중','입금완료','입금대기','정지','입금대기'].entries()) {
  await auth(ids.admin);const item=await create();all.push(item)
  await db.exec('reset role');await q("update orders set status=$2,created_at='2026-01-01'::timestamptz + $3 * interval '1 day',start_date='2099-01-01'::date+$3::integer where id=$1",[item.id,status,i])
}
const managed=async(statuses=null,sort='priority',page=1,size=1)=>q('select * from get_manager_managed_orders_v108(p_order_statuses=>$1,p_sort=>$2,p_page=>$3,p_page_size=>$4)',[statuses,sort,page,size])
await auth(ids.manager)
assert.equal((await managed())[0].order_id,all[5].id)
assert.equal((await managed(null,'priority',2))[0].order_id,all[3].id)
assert.equal((await managed(null,'priority',3))[0].order_status,'입금완료')
assert.equal((await managed(null,'newest'))[0].order_id,all[5].id)
assert.equal((await managed(null,'oldest'))[0].order_id,all[0].id)
assert.equal((await managed(null,'start_date'))[0].order_id,all[0].id)
const filtered=await managed(['입금대기','입금완료'],'priority',1,500)
assert.equal(filtered.length,3);assert.ok(filtered.every(r=>['입금대기','입금완료'].includes(r.order_status)))
const pages=[];for(let p=1;p<=3;p++) pages.push(...await managed(['입금대기','입금완료'],'priority',p))
assert.deepEqual(pages.map(r=>r.order_id),filtered.map(r=>r.order_id))
await assert.rejects(managed(['구동중','bogus']));await assert.rejects(managed(null,'bogus'))
await auth(ids.member);await assert.rejects(managed())
await db.exec('reset role')
await db.exec(readFileSync('supabase/verify_v10_8.sql','utf8'))
await db.close()
console.log('PASS: member ownership/role/state/confirmed guards, field whitelist, snapshot pricing, approved program pricing, preserved step IDs, optimistic locking, audit, server composite filter, all four sorts, pagination/export parity')
