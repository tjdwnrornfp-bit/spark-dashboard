import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
process.on('uncaughtException', e => { console.error(e.message, e.detail ?? '', e.where ?? '', e.stack?.split('\n').slice(0, 4).join('\n')); process.exit(1) })
const db = new PGlite()
const q = async (sql, args = []) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
for (const file of ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','supabase/migrations/20260907045616_v10_7_admin_order_correction.sql','supabase/migrations/20260909085400_v10_8_member_edit_selection_managed_filters.sql']) await db.exec(readFileSync(file,'utf8'))
await db.exec(`create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active and approval_status='approved') $$;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select public.is_admin()));
create policy orders_read on public.orders for select to authenticated using(created_by=(select auth.uid()) or (select public.is_admin()));
create policy orders_admin_update on public.orders for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));
grant select on public.profiles,public.orders to authenticated;
grant update on public.orders to authenticated;`)
const ids=Object.fromEntries(['admin','admin2','agency','dist','manager','pending','inactive'].map(k=>[k,randomUUID()]))
for(const [name,id] of Object.entries(ids)) {
 await q('insert into auth.users values($1)',[id])
 await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,is_operations_manager) values($1,$2,$2,$2,$3,$4,$5,20,20,30,40,50,$6)`,[id,name,name.startsWith('admin')?'admin':name==='dist'?'distributor':'agency',name==='pending'?'pending':name==='inactive'?'rejected':'approved',name!=='inactive',name==='manager'])
}
const auth=async(id,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`)}
const draft={program_type:'spark',place_url:'https://m.place.naver.com/place/123456/home',mid:'123456',store_name:'검증 작업',keyword:'키워드',daily_shots:100,operation_days:10,start_date:'2099-01-10',memo:''}
const manual=async(d=draft,request=randomUUID())=>(await one('select to_jsonb(admin_create_order_for_member_v106($1,$2,$3)) r',[ids.agency,d,request])).r
const self=async(d=draft)=>(await one('select to_jsonb(create_order_v10($1,$2,$3,$4,$5,$6,$7,$8,$9)) r',Object.values(d))).r
const adminBulk=async(items,request=randomUUID())=>(await one('select admin_bulk_create_orders_for_members_v106($1,$2) r',[items,request])).r
const ownBulk=async(items)=>q('select * from create_orders_bulk_v10($1)',[items])
const fingerprint=async()=>{await db.exec('reset role');return one(`select (select count(*) from orders) orders,(select count(*) from payment_steps) steps,(select count(*) from notifications) notifications,(select md5(string_agg(to_jsonb(o)::text,'' order by id)) from orders o) oh,(select md5(string_agg(to_jsonb(p)::text,'' order by id)) from payment_steps p) ph`)}
await auth(ids.admin)
const oldRequest=randomUUID();let old=await manual(draft,oldRequest)
const outside=await manual({...draft,start_date:'2099-01-09'})
const before=await fingerprint()
const migration=readdirSync('supabase/migrations').find(f=>f.endsWith('_v10_12_start_date_restrictions.sql'))
await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'))
assert.deepEqual(await fingerprint(),before)
assert.equal((await one('select count(*) n from order_start_restrictions')).n,0)
const rule={id:randomUUID(),start:'2099-01-10',end:'2099-01-12',reason:'연휴 테스트',enabled:true,version:0}
const save=async(r=rule)=>(await one('select save_order_start_restriction_v1012($1,$2,$3,$4,$5,$6) r',Object.values(r))).r
const read=async(admin=false)=>(await one('select get_order_start_restrictions_v1012($1) r',[admin])).r
for (const [id,role] of [[null,'anon'],[ids.agency,'authenticated'],[ids.dist,'authenticated'],[ids.manager,'authenticated'],[ids.pending,'authenticated'],[ids.inactive,'authenticated']]) {
 await auth(id,role);await assert.rejects(save());await assert.rejects(read(true))
}
await auth(ids.admin)
const impact=(await one('select preview_order_start_restriction_v1012($1,$2) r',[rule.start,rule.end])).r
assert.equal(impact.existingCount,1)
for(const r of [{...rule,start:'2099-01-13'}, {...rule,reason:''},{...rule,reason:'x'.repeat(301)},{...rule,end:'infinity'},{...rule,enabled:null}])await assert.rejects(save(r))
const saved=await save();assert.equal(saved.version,1)
assert.deepEqual(await fingerprint(),before)
await auth(ids.admin);assert.equal((await read(true)).length,1)
await auth(ids.agency);assert.equal((await read()).length,1)
await assert.rejects(q('update order_start_restrictions set enabled=false'),/permission denied/)
await assert.rejects(q("insert into order_start_restrictions(start_date,end_date,reason) values('2099-01-01','2099-01-02','x')"),/permission denied/)
await assert.rejects(q('select * from spark_private.start_restriction_state_v1012'),/permission denied/)
await assert.rejects(q('select spark_private.assert_order_start_dates_v1012($1)',[[rule.start]]),/permission denied/)
for(const user of [ids.agency,ids.dist]) for(const program of ['spark','spark_plus','spark_s','spark_s_plus']) for(const date of ['2099-01-10','2099-01-11','2099-01-12']) {
 await auth(user);await assert.rejects(self({...draft,program_type:program,start_date:date}),/접수 제한 기간/)
}
await auth(ids.admin)
await assert.rejects(manual(),/접수 제한 기간/)
assert.equal((await manual(draft,oldRequest)).id,old.id,'idempotent existing order lookup is grandfathered')
const baseline=await fingerprint()
await auth(ids.agency);await assert.rejects(ownBulk([{...draft,start_date:'2099-01-13'},draft]),/접수 제한 기간/)
assert.deepEqual(await fingerprint(),baseline,'ordinary bulk rollback includes steps and notifications')
await auth(ids.admin);await assert.rejects(adminBulk([{...draft,start_date:'2099-01-13',target_username:'agency',row_number:2},{...draft,target_username:'agency',row_number:5}]),/접수 제한 기간/)
assert.deepEqual(await fingerprint(),baseline,'admin preflight runs outside per-row exception handlers')
// Trigger covers direct administrator table updates as well as RPC updates.
await auth(ids.admin);await assert.rejects(q('update orders set start_date=$2 where id=$1',[outside.id,rule.start]),/접수 제한 기간/)
await assert.rejects(q('select admin_apply_order_correction_v107($1,$2,$3,$4)',[outside.id,outside.lock_version,{start_date:rule.start},'시작일 변경']),/접수 제한 기간/)
await auth(ids.agency);await assert.rejects(q('select member_apply_own_order_edit_v108($1,$2,$3,$4)',[outside.id,outside.lock_version,{start_date:rule.end},'시작일 변경']),/접수 제한 기간/)
assert.deepEqual(await fingerprint(),baseline,'rejected corrections preserve all financial data')
// The trigger does not re-validate unchanged dates, including UPDATE SET start_date=start_date.
await auth(ids.agency)
old=(await one('select to_jsonb(member_apply_own_order_edit_v108($1,$2,$3,$4)) r',[old.id,old.lock_version,{memo:'기존 접수 유지',start_date:old.start_date},'메모 수정'])).r
assert.equal(old.start_date,rule.start)
await auth(ids.admin)
old=(await one('select to_jsonb(admin_apply_order_correction_v107($1,$2,$3,$4)) r',[old.id,old.lock_version,{memo:'관리자 유지',start_date:old.start_date},'메모 수정'])).r
await q("update orders set status='입금완료',start_date=start_date where id=$1",[old.id])
await q("update orders set status='구동중' where id=$1",[old.id])
// Outside start dates remain valid even when their operating span overlaps the holiday.
await auth(ids.agency);assert.equal((await self({...draft,start_date:'2099-01-09'})).end_date,'2099-01-18')
assert.equal((await self({...draft,start_date:'2099-01-13'})).start_date,'2099-01-13')
await auth(ids.admin2);await assert.rejects(save(),/먼저 변경/)
const overlap={...rule,id:randomUUID(),start:'2099-01-12',end:'2099-01-14'};await save(overlap)
await save({...rule,enabled:false,version:1});await assert.rejects(save({...rule,version:1}),/먼저 변경/)
await auth(ids.agency);assert.equal((await read()).length,1)
assert.equal((await self({...draft,start_date:'2099-01-10'})).start_date,'2099-01-10')
await assert.rejects(self({...draft,start_date:'2099-01-12'}),/접수 제한 기간/)
await auth(ids.admin);assert.equal((await read(true)).length,2)
await save({...overlap,enabled:false,version:1})
const leap={...rule,id:randomUUID(),start:'2100-02-28',end:'2100-02-28'};await save(leap)
await auth(ids.agency);await assert.rejects(self({...draft,start_date:leap.start}),/접수 제한 기간/)
assert.equal((await self({...draft,start_date:'2100-03-01'})).start_date,'2100-03-01')
await db.exec('reset role')
const audits=await q("select * from audit_logs where action='intake.start_date_restriction_saved'")
assert.equal(audits.length,5);assert.ok(audits.every(a=>a.metadata.existing_orders_preserved===true))
const newPublic=await q("select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_order_start_restrictions_v1012','preview_order_start_restriction_v1012','save_order_start_restriction_v1012')")
assert.equal(newPublic.length,3);assert.ok(newPublic.every(p=>!p.prosecdef&&!p.anon))
console.log('PASS: empty initial policy; inclusive single/multi-day boundaries; four programs; agency/distributor/admin single and bulk; preflight atomicity; direct SQL/RPC edit guard; unchanged dates/status/payment rows preserved; overlap/disable; optimistic concurrency; admin-only write and deny-by-default state; audit history')
await db.close()
