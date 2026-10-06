import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { lifecycleFixture } from './order-lifecycle-fixture.mjs'
const db = new PGlite()
process.on('uncaughtException',e=>{console.error(e.message,e.where??'');process.exit(1)})
await db.exec(lifecycleFixture)
const q=async(sql,args=[])=>(await db.query(sql,args)).rows
const one=async(sql,args=[])=>(await q(sql,args))[0]
const ids=Object.fromEntries(['admin','agency','manager','pending','inactive'].map(k=>[k,randomUUID()]))
for(const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users values($1)',[id])
  await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,is_operations_manager,group_name)
    values($1,$2,$2,$2,$3,$4,$5,20,20,30,40,50,$6,'현재그룹')`,[id,name,name==='agency'?'agency':'admin',['pending','inactive'].includes(name)?'pending':'approved',name!=='inactive',name==='manager'])
}
const auth=async(name)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]??'']);await db.exec(`set role ${name==='anon'?'anon':'authenticated'}`)}
const admin=()=>auth('admin')
const filters={programs:['spark','spark_plus','spark_s','spark_s_plus']}
const preview=async(action,orders=null,f=filters,schema='public')=>(await one(`select ${schema}.preview_admin_order_lifecycle_v1014($1,$2,$3) r`,[action,orders?.map(o=>o.order_number),f])).r.items
const apply=async(action,items,request=randomUUID(),reason='테스트 정리',confirmation=action==='delete'?'영구 삭제':'확인')=>(await one('select apply_admin_order_lifecycle_v1014($1,$2,$3,$4,$5) r',[action,items.map(({id,version,fingerprint})=>({id,version,fingerprint})),reason,request,confirmation])).r
const create=async(program='spark')=>{await auth('agency');const o=(await one(`select to_jsonb(create_order_v10($1,'https://m.place.naver.com/place/123/home','123','테스트 상호','키워드',100,10,'2099-01-10','')) r`,[program])).r;await admin();return o}
const archive=async(o)=>{const rows=await preview('archive',[o]);const r=await apply('archive',rows);assert.equal(r.results[0].success,true);return o}
const before=await one('select count(*) n from orders')
for(const name of ['anon','agency','manager','pending','inactive','no_user']) {
  await auth(name)
  await assert.rejects(preview('archive'),/관리자|permission denied/)
  await assert.rejects(preview('archive',null,filters,'spark_private'),/관리자|permission denied/)
  await assert.rejects(apply('archive',[{id:randomUUID(),version:1,fingerprint:'a'.repeat(32)}]),/관리자|permission denied/)
}
await admin()
await assert.rejects(q('select * from spark_private.order_lifecycle_requests_v1014'),/permission denied/)
await db.exec('reset role');assert.equal((await one('select count(*) n from orders')).n,before.n);await admin()
const four=[];for(const program of filters.programs)four.push(await create(program))
for(const o of four)assert.equal((await preview('archive',null,{programs:[o.program_type]})).length,1)
assert.equal((await preview('archive',null,{...filters,query:'현재그룹'})).length,4)
await assert.rejects(preview('archive',[],filters),/1~500/)
await assert.rejects(preview(null),/처리 방식/)
await assert.rejects(preview('archive',null,{programs:[]}),/프로그램/)
await assert.rejects(preview('archive',null,{...filters,from:'2099-02-01',to:'2099-01-01'}),/시작일/)
await db.exec('reset role');await q("update orders set created_at='2099-01-01 15:00:00+00' where id=$1",[four[0].id]);await admin()
assert.equal((await preview('archive',null,{...filters,from:'2099-01-02',to:'2099-01-02'})).length,1)
assert.equal((await preview('archive',null,{...filters,from:'2099-01-01',to:'2099-01-01'})).length,0)
const first=await preview('archive',four)
await db.exec('reset role');const stepBefore=await one('select to_jsonb(s) r from payment_steps s where order_id=$1',[four[0].id]);await q('update orders set lock_version=lock_version+1 where id=$1',[four[1].id]);await admin()
const request=randomUUID(),r=await apply('archive',first,request)
assert.equal(r.results.filter(x=>x.success).length,3);assert.equal(r.results.filter(x=>!x.success).length,1)
assert.deepEqual(await apply('archive',first,request),r)
await assert.rejects(apply('archive',first,request,'변경된 사유'),/요청이 변경/)
await db.exec('reset role');assert.deepEqual(await one('select to_jsonb(s) r from payment_steps s where order_id=$1',[four[0].id]),stepBefore);await admin()
assert.equal((await apply('restore',await preview('restore',[four[0]]))).results[0].success,true)
await archive(four[0])
const safe=await create();await archive(safe)
const safePreview=await preview('delete',[safe]);assert.equal(safePreview[0].eligible,true)
await assert.rejects(apply('delete',safePreview,randomUUID(),'테스트 정리','확인'),/영향/)
const deleteId=randomUUID(),deleted=await apply('delete',safePreview,deleteId)
assert.equal(deleted.results[0].success,true);assert.deepEqual(await apply('delete',safePreview,deleteId),deleted)
await db.exec('reset role')
assert.equal((await one('select count(*) n from orders where id=$1',[safe.id])).n,0)
assert.equal((await one('select count(*) n from payment_steps where order_id=$1',[safe.id])).n,0)
assert.equal((await one("select count(*) n from audit_logs where entity_id=$1 and action='order.permanently_deleted' and metadata->>'reason'='테스트 정리'",[safe.id])).n,1)
await admin()
// Both current confirmations and reversed historical confirmations block deletion.
for(const kind of ['confirmed','reversed','batch','quote','transfer','assignment','running','corrected']) {
  const o=await create();await archive(o);await db.exec('reset role')
  if(['confirmed','reversed'].includes(kind)) {
    await q('update payment_steps set confirmed_at=now(),confirmed_by=$2 where order_id=$1',[o.id,ids.admin])
    if(kind==='reversed')await q('update payment_steps set confirmed_at=null,confirmed_by=null where order_id=$1',[o.id])
  }
  if(kind==='batch')await q('insert into settlement_batch_items(order_id,payment_step_id) select order_id,id from payment_steps where order_id=$1',[o.id])
  if(kind==='quote')await q("insert into settlement_quote_items select gen_random_uuid(),id,payer_id,payer_username,total_amount from payment_steps where order_id=$1",[o.id])
  if(kind==='transfer')await q('insert into order_program_transfers(id,order_id) values(gen_random_uuid(),$1)',[o.id])
  if(kind==='assignment')await q("insert into spark_private.admin_order_assignments_v106(actor_id,request_id,row_number,payload,order_id) values($1,$2,1,'{}',$3)",[ids.admin,randomUUID(),o.id])
  if(kind==='running')await q("update orders set status='구동중',activated_at=now() where id=$1",[o.id])
  if(kind==='corrected')await q("insert into audit_logs(action,entity_type,entity_id) values('order.corrected','order',$1)",[o.id])
  await admin();const blocked=await preview('delete',[o]);assert.equal(blocked[0].eligible,false,kind);assert.ok(blocked[0].reason)
  assert.equal((await apply('delete',blocked)).results[0].success,false,kind)
}
const stale=await create();await archive(stale);const stalePreview=await preview('delete',[stale])
await db.exec('reset role');await q("update payment_steps set updated_at=now()+interval '1 second' where order_id=$1",[stale.id]);await admin()
assert.equal((await apply('delete',stalePreview)).results[0].success,false)
// Audit failure rolls back the deletion, rather than losing evidence.
const fail=await create();await archive(fail);const failPreview=await preview('delete',[fail])
await db.exec(`reset role;create function block_delete_audit() returns trigger language plpgsql as $$begin if new.action='order.permanently_deleted' then raise exception '감사 저장 실패';end if;return new;end$$;create trigger audit_failure before insert on audit_logs for each row execute function block_delete_audit();`)
await admin();assert.equal((await apply('delete',failPreview)).results[0].success,false)
await db.exec('reset role');assert.equal((await one('select count(*) n from orders where id=$1',[fail.id])).n,1)
await db.exec('drop trigger audit_failure on audit_logs')
// 501 matches must never silently become a destructive subset of 500.
await q(`insert into orders(order_number,created_by,creator_username,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date)
  select 'LIMIT-'||g,$1,'agency','url','123','한도테스트','key',100,1,20,2000,200,2200,'2099-01-10','2099-01-10' from generate_series(1,501) g`,[ids.agency])
await admin();await assert.rejects(preview('archive',null,{...filters,query:'한도테스트'}),/500건을 초과/)
await db.exec('reset role');await q("delete from orders where order_number='LIMIT-501'");await admin()
assert.equal((await preview('archive',null,{...filters,query:'한도테스트'})).length,500)
await db.close()
console.log('PASS lifecycle: admin authorization, four programs, current group/KST filters, archive/restore, partial failure, stale payment/version, all history blockers, audit rollback, idempotence and 500 limit')
