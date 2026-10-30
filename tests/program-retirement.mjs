import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
process.on('uncaughtException', e => { console.error(e.message, e.detail ?? '', e.where ?? ''); process.exit(1) })
const db=new PGlite(), q=async(s,a=[])=>(await db.query(s,a)).rows, one=async(s,a=[])=>(await q(s,a))[0]
const file=p=>readFileSync(p,'utf8')
await db.exec(file('tests/fixtures/v105-intake.sql')+'\ncreate role service_role;')
await db.exec(file('tests/fixtures/v105-quotes.sql'))
await db.exec(file('supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql'))
const ids=Object.fromEntries(['admin','parent','child','higher','at35','manager','managed','pending','newChild','unrelated'].map(k=>[k,randomUUID()]))
const rates={admin:0,parent:25,child:30,higher:52,at35:35,manager:1,managed:33,pending:0,newChild:0,unrelated:40}
for(const [name,id] of Object.entries(ids)){
 await q('insert into auth.users values($1)',[id])
 await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,group_name,is_operations_manager)
 values($1,$2,$2,$2,$3,$4,$5,$6,$6,$7,$8,$8,'원래 그룹',$9)`,[id,'test_'+name,name==='admin'?'admin':name==='parent'?'distributor':'agency',['pending','newChild'].includes(name)?'pending':'approved',!['pending','newChild'].includes(name),['pending','newChild'].includes(name)?0:20,rates[name],name==='parent'?40:50,name==='manager'])
}
await q('update profiles set sponsor_id=$1 where id in ($2,$3)',[ids.parent,ids.child,ids.newChild])
await q('update profiles set manager_id=$1 where id=$2',[ids.manager,ids.managed])
const root=()=>db.exec('reset role')
const auth=async name=>{await root();await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]??'']);await db.exec(`set role ${name==='anon'?'anon':'authenticated'}`)}
const draft={program_type:'spark',place_url:'https://m.place.naver.com/place/123/home',mid:'123',store_name:'기존 상호',keyword:'키워드',daily_shots:100,operation_days:10,start_date:'2099-01-01',memo:''}
const create=async(program)=> (await one('select to_jsonb(create_order_v10($1,$2,$3,$4,$5,$6,$7,$8,$9)) r',[program,draft.place_url,draft.mid,draft.store_name,draft.keyword,100,10,draft.start_date,''])).r
await auth('child');const old=await create('spark')
await root();await q("update orders set start_date='2001-09-01',end_date='2001-09-10' where id=$1",[old.id])
await db.exec(file('supabase/migrations/20261008085133_v10_16_monthly_settlement.sql'))
await auth('admin');const monthly=(await one("select get_admin_monthly_settlement_v1016('2001-09-01') r")).r
await one("select save_admin_monthly_settlement_v1016('2001-09-01',$1,$2,'기존 마감')",[randomUUID(),monthly.revision])
await root()
const hash=async()=>one(`select (select md5(jsonb_agg(to_jsonb(t) order by id)::text) from orders t) orders,(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from payment_steps t) payments,(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from spark_private.settlement_closes_v1016 t) closes`)
const before=await hash(),profiles=await q('select * from profiles order by id')
const migration=file('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_v10_17_retire_spark_adjust_plus_prices.sql')))
await db.exec(migration)
assert.deepEqual(await hash(),before)
const after=await q('select * from profiles order by id')
for(let i=0;i<profiles.length;i++){
 const {spark_plus_price_per_shot:oldRate,updated_at:oldTime,...oldOther}=profiles[i]
 const {spark_plus_price_per_shot:newRate,updated_at:newTime,...newOther}=after[i]
 assert.equal(newRate,Math.max(35,oldRate));assert.deepEqual(newOther,oldOther)
 if(oldRate>=35)assert.equal(String(newTime),String(oldTime))
}
assert.equal((await one("select count(*)::integer n from audit_logs where action='member.spark_plus_price_adjusted'")).n,7)
// All intake paths are blocked while the other three programs still use current price snapshots.
await auth('child');await assert.rejects(create('spark'),/접수가 종료/)
for(const program of ['spark_plus','spark_s','spark_s_plus']){
 const order=await create(program);assert.equal(order.price_per_shot,program==='spark_plus'?35:50)
 if(program==='spark_plus'){
  await root();const steps=await q('select unit_price from payment_steps where order_id=$1 order by step_order',[order.id]);assert.deepEqual(steps.map(s=>s.unit_price),[35,35]);await auth('child')
 }
}
await root();const countBefore=(await one('select count(*)::integer n from orders')).n;await auth('child')
await assert.rejects(q('select create_orders_bulk_v10($1)',[[{...draft,program_type:'spark_plus'},draft]]),/접수가 종료/)
await root();assert.equal((await one('select count(*)::integer n from orders')).n,countBefore)
await auth('admin');await assert.rejects(q('select admin_create_order_for_member_v106($1,$2,$3)',[ids.child,draft,randomUUID()]),/접수가 종료/)
const bulk=(await one('select admin_bulk_create_orders_for_members_v106($1,$2) r',[[{...draft,target_username:'test_child'},{...draft,program_type:'spark_plus',target_username:'test_child'}],randomUUID()])).r
assert.deepEqual(bulk.items.map(r=>r.status),['failed','success'])
await root();const plus=await one("select id from orders where program_type='spark_plus' limit 1")
await assert.rejects(q("update orders set program_type='spark' where id=$1",[plus.id]),/접수가 종료/)
await q("update orders set memo='기존 작업 유지',status='정지' where id=$1",[old.id])
await q("update orders set program_type='spark' where id=$1",[old.id]) // Neutral legacy updates remain allowed.
const profile=async name=>{await root();return one('select * from profiles where id=$1',[ids[name]])}
const review=async(actor,target,overrides={})=>{
 const p=await profile(target);await auth(actor)
 return (await one('select to_jsonb(review_member_v1017($1,$2,$3,$4,$5,$6,$7,$8,$9)) r',[p.id,overrides.role??'agency',overrides.manager??false,overrides.plus??p.spark_plus_price_per_shot,overrides.s??p.spark_s_price_per_shot,overrides.sp??p.spark_s_plus_price_per_shot,overrides.approval??'approved','새 그룹',overrides.version??p.updated_at])).r
}
await assert.rejects(review('anon','child'),/permission denied/)
await assert.rejects(review('unrelated','child'),/직접 추천/)
await assert.rejects(review('manager','child'),/관리 코드/)
await assert.rejects(review('child','admin'),/관리자 계정/)
await assert.rejects(review('pending','child'),/권한/)
await assert.rejects(review('admin','child',{version:'2001-01-01T00:00:00Z'}),/먼저/)
await review('parent','child') // Existing equal 35 remains editable; retired rate is irrelevant.
await review('admin','parent',{role:'distributor'}) // Parent with equal-price child remains editable.
await review('manager','managed')
await assert.rejects(review('parent','newChild',{plus:35,s:50,sp:50}),/높아야/)
await assert.rejects(review('admin','parent',{role:'distributor',plus:36}),/하위 회원 단가/)
await assert.rejects(review('parent','child',{plus:34}),/높아야/)
await assert.rejects(review('parent','child',{s:40}),/높아야/)
await assert.rejects(review('parent','child',{sp:40}),/높아야/)
const pending=await review('admin','pending',{plus:35,s:40,sp:40});assert.equal(pending.price_per_shot,1);assert.equal(pending.spark_price_per_shot,1)
await root();const message=await one('select message from notifications where user_id=$1 order by created_at desc limit 1',[ids.pending]);assert.ok(!message.message.includes('스파크 '))
// Required audit failure rolls the profile edit back.
await db.exec("create function deny_review_audit() returns trigger language plpgsql as $$begin if new.action='member.active_programs_reviewed' then raise exception 'required audit failed';end if;return new;end$$;create trigger deny_review_audit before insert on audit_logs for each row execute function deny_review_audit();")
const saved=await profile('higher');await assert.rejects(review('admin','higher',{plus:53}),/required audit/);assert.deepEqual(await profile('higher'),saved)
await db.close()
console.log('PASS retirement: exact 35-price adjustment and audit; orders/payments/closes preserved; retired intake/transfer denied; existing work editable; active program prices; bulk rollback; review authorization and hierarchy; existing 35 ties; pending approvals without retired price; strict audit rollback')
