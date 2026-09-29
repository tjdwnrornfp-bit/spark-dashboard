import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
process.on('uncaughtException', e => { console.error(e.message, e.where ?? '', e.stack); process.exit(1) })
// All mutations in this file are synthetic and isolated, never production.
const db = new PGlite()
const q = async (sql, args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
for (const file of ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql']) await db.exec(readFileSync(file,'utf8'))
for (const file of ['20260828120000_v10_2_manager_managed_orders.sql','20260828180000_v10_3_manager_dashboard_overview.sql']) {
  const sql = readFileSync(`supabase/migrations/${file}`,'utf8')
  for (const match of sql.matchAll(/create or replace function public\.get_manager_[\s\S]*?\$\$;/gi)) await db.exec(match[0])
}
for (const file of ['20260903094128_v10_6_admin_order_assignment.sql','20260907045616_v10_7_admin_order_correction.sql','20260909085400_v10_8_member_edit_selection_managed_filters.sql','20260914070835_v10_9_manager_agency_folders.sql','20260916044522_v10_10_grouped_downline_work.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'))
for (const f of await q("select oid::regprocedure::text signature from pg_proc where proname like 'get_manager_%'")) await db.exec(`revoke all on function ${f.signature} from public,anon; grant execute on function ${f.signature} to authenticated`)
await db.exec(`alter table profiles enable row level security; alter table orders enable row level security; alter table payment_steps enable row level security;
 create policy profiles_read on profiles for select to authenticated using (id=auth.uid() or manager_id=auth.uid() or sponsor_id=auth.uid());
 create policy orders_read on orders for select to authenticated using (created_by=auth.uid());
 create policy steps_read on payment_steps for select to authenticated using (payer_id=auth.uid() or payee_id=auth.uid());
 grant select on profiles,orders,payment_steps to authenticated;`)
const names=['admin','m1','m2','m3','dist','a','b','c','d','e','f','g','overlap','outside','cycA','cycB','pending','inactive',...Array.from({length:30},(_,i)=>`deep${i}`)]
const ids=Object.fromEntries(names.map(n=>[n,randomUUID()]))
for (const [name,id] of Object.entries(ids)) {
 await q('insert into auth.users values($1)',[id])
 await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,is_operations_manager,group_name)
 values($1,$2,$2,$2,$3,$4,$5,20,20,30,40,50,$6,$7)`,[id,'test_'+name,name==='admin'?'admin':name==='dist'?'distributor':'agency',name==='pending'?'pending':name==='inactive'?'rejected':'approved',name!=='inactive',['m1','m2','m3','pending','inactive'].includes(name),`group_${name}`])
}
for (const [child,parent] of [['a','dist'],['b','a'],['c','b'],['d','c'],['e','d'],['f','e'],['g','f'],['overlap','a'],['cycB','cycA'],['cycA','cycB'],['deep0','a'],...Array.from({length:29},(_,i)=>[`deep${i+1}`,`deep${i}`])]) await q('update profiles set sponsor_id=$1 where id=$2',[ids[parent],ids[child]])
for (const child of ['a','f','overlap','cycA']) await q('update profiles set manager_id=$1 where id=$2',[ids.m1,ids[child]])
await q('update profiles set manager_id=$1 where id=$2',[ids.m2,ids.d])
const auth=async(id,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`)}
const draft={program_type:'spark',place_url:'https://m.place.naver.com/place/123456/home',mid:'123456',store_name:'Scope Test',keyword:'scope',daily_shots:10,operation_days:7,start_date:'2099-01-01',memo:''}
const created=[]
for (const name of ['a','b','c','d','e','f','g','overlap','outside','dist']) {
 await auth(ids.admin)
 for (const program of ['spark','spark_plus','spark_s','spark_s_plus']) {
  const row=(await one('select to_jsonb(admin_create_order_for_member_v106($1,$2,$3)) r',[ids[name],{...draft,program_type:program,store_name:`${name}_${program}`},randomUUID()])).r
  created.push(row)
 }
}
await db.exec('reset role')
// Preserve archived exclusion, reversal/transfer states and direct-payer amount rules.
await q('update orders set archived_at=now() where id=$1',[created[0].id])
await q("update orders set settlement_reversal_pending=true where id=$1",[created[4].id])
await q("update orders set program_transfer_state='payment_pending' where id=$1",[created[5].id])
await q("update payment_steps set confirmed_at=now() where order_id=any($1::uuid[])",[created.filter((_,i)=>i%3===0).map(o=>o.id)])
await q('delete from payment_steps where order_id=$1',[created[6].id])
// >500 scoped rows force multi-page export coverage; all are fixture-only inserts.
await q(`insert into orders(order_number,created_by,creator_username,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date,created_at)
 select 'SYNTHETIC-'||n,$1,'c','https://example.invalid','123456','bulk_'||n,'scope',1,7,20,140,14,154,'2099-01-01','2099-01-07',now()+n*interval '1 second' from generate_series(1,1001) n`,[ids.c])
// Historical descendant orders are retained across inactive intermediate agencies.
await q("update profiles set active=false,approval_status='rejected' where id=$1",[ids.b])
const snapshot=async()=>one(`select
 (select md5(string_agg(p::text,'' order by id)) from profiles p) ph,
 (select md5(string_agg(o::text,'' order by id)) from orders o) oh,
 (select md5(string_agg(p::text,'' order by id)) from payment_steps p) sh,
 (select md5(string_agg(a::text,'' order by id)) from audit_logs a) ah,
 (select md5(string_agg(n::text,'' order by id)) from notifications n) nh,
 (select md5(string_agg(p::text,'' order by tablename,policyname)) from pg_policies p) policies,
 (select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(proacl::text,''),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','spark_private') and proname not like 'get_manager_%' and proname<>'manager_scope_ids_v1013') other_functions`)
const before=await snapshot()
await auth(ids.m1)
assert.equal((await one('select get_manager_agency_folders_v1010(p_page_size=>50) r')).r.agencyCount,4)
assert.equal((await q('select * from get_manager_managed_orders_v1010(p_query=>$1)', ['group_c'])).length,0)
await db.exec('reset role')
const file=readdirSync('supabase/migrations').find(f=>f.endsWith('_v10_13_manager_descendant_scope.sql'))
await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'))
assert.deepEqual(await snapshot(),before,'migration is read-scope only; no data, RLS or other functions changed')
const expectedNames=['a','b','c','f','g','overlap','cycA','cycB',...Array.from({length:30},(_,i)=>`deep${i}`)]
const expectedIds=expectedNames.map(n=>ids[n])
const folders=async(params={})=>(await one('select get_manager_agency_folders_v1010(p_page=>$1,p_page_size=>50,p_query=>$2) r',[params.page??1,params.query??null])).r
const orders=async(params={})=>q('select * from get_manager_managed_orders_v1010(p_agency_id=>$1,p_page=>$2,p_page_size=>$3,p_query=>$4,p_program_type=>$5,p_order_statuses=>$6)',[params.agency??null,params.page??1,params.size??500,params.query??null,params.program??null,params.status??null])
const summary=async()=>one('select * from get_manager_dashboard_summary_v103()')
const revision=async()=>(await one('select get_manager_read_revision_v1013() r')).r
await auth(ids.m1)
const f=await folders();assert.equal(f.agencyCount,expectedIds.length)
assert.deepEqual(new Set(f.agencies.map(a=>a.agencyId)),new Set(expectedIds))
const all=[...await orders(),...await orders({page:2}),...await orders({page:3})]
assert.equal(all.length,1024);assert.equal(new Set(all.map(o=>o.order_id)).size,1024)
assert.ok(all.every(o=>expectedIds.includes(o.registrant_id)))
assert.equal(f.agencies.reduce((s,a)=>s+a.totalOrderCount,0),all.length)
assert.equal((await summary()).total_order_count,all.length)
assert.equal((await summary()).managed_agency_count,expectedNames.length)
assert.deepEqual(new Set((await q('select * from get_manager_managed_order_filter_options_v102()')).map(p=>p.agency_id)),new Set(expectedIds))
let overviews=[]
for (let page=1;page<=4;page++) overviews.push(...(await one('select get_manager_agency_overview_v103(p_page=>$1,p_page_size=>12) r',[page])).r.agencies)
assert.equal(overviews.length,expectedNames.length)
assert.equal(overviews.reduce((s,a)=>s+a.totalOrderCount,0),all.length)
assert.equal(f.agencies.reduce((s,a)=>s+a.settlementWaitingAmount,0),Number((await summary()).settlement_waiting_amount))
assert.equal(f.agencies.reduce((s,a)=>s+a.settlementCompletedAmount,0),Number((await summary()).settlement_completed_amount))
for (const program of ['spark','spark_plus','spark_s','spark_s_plus']) assert.ok((await orders({program})).every(o=>o.program_type===program))
assert.equal((await orders({query:'group_c'}))[0].total_count,1005)
assert.equal((await folders({query:'group_c'})).agencies.find(a=>a.agencyId===ids.c).matchedOrderCount,1005)
assert.equal((await orders({agency:ids.b})).length,4,'inactive intermediary retains history')
assert.equal((await q('select * from get_manager_agency_orders_v1010(p_agency_id=>$1,p_page_size=>50)',[ids.c])).length,50)
assert.ok((await orders({status:['입금대기','입금완료']})).every(o=>['입금대기','입금완료'].includes(o.order_status)))
for (const id of [ids.d,ids.e,ids.outside,ids.dist]) {
 await assert.rejects(orders({agency:id}),/현재 관리/)
 await assert.rejects(q('select get_manager_agency_folders_v1010(p_agency_id=>$1)',[id]),/현재 관리/)
 await assert.rejects(q('select * from get_manager_agency_orders_v1010(p_agency_id=>$1)',[id]),/현재 관리/)
}
// Broad read of profiles/payment rows is NOT granted by the expanded RPC scope.
assert.equal((await q('select * from orders')).length,0)
assert.equal((await q('select * from profiles where id=$1',[ids.c])).length,0)
await assert.rejects(q('select * from spark_private.manager_scope_ids_v1013()'),/permission denied/)
await assert.rejects(q('update profiles set price_per_shot=999 where id=$1',[ids.c]),/permission denied/)
const rev=await revision();assert.match(rev,/^[a-f0-9]{32}$/)
assert.equal(await revision(),rev)
// Check fixed scope for older clients too.
assert.equal((await q('select * from get_manager_managed_orders_v108(p_agency_id=>$1)',[ids.c])).length,50)
assert.equal((await q('select * from get_manager_managed_orders_v102(p_agency_id=>$1)',[ids.c])).length,50)
assert.equal((await q('select * from get_manager_agency_orders_v109(p_agency_id=>$1)',[ids.c])).length,50)
assert.equal((await one('select get_manager_agency_folders_v109(p_page_size=>50) r')).r.agencyCount,expectedIds.length)
await db.exec('reset role')
const expectedMoney=await one(`select coalesce(sum(case when s.n=0 then o.total_amount else s.waiting end),0)::text waiting,
 coalesce(sum(s.completed),0)::text completed from orders o left join lateral (
 select count(*) n,coalesce(sum(p.total_amount) filter(where p.confirmed_at is null),0) waiting,coalesce(sum(p.total_amount) filter(where p.confirmed_at is not null),0) completed
 from payment_steps p where p.order_id=o.id and p.payer_id=o.created_by) s on true where o.created_by=any($1::uuid[]) and o.archived_at is null`,[expectedIds])
await auth(ids.m1);assert.equal(Number((await summary()).settlement_waiting_amount),Number(expectedMoney.waiting));assert.equal(Number((await summary()).settlement_completed_amount),Number(expectedMoney.completed))
// Newly registered descendants and manager reassignment need no backfill.
await db.exec('reset role');await q('update profiles set sponsor_id=$1 where id=$2',[ids.c,ids.outside]);await auth(ids.m1)
assert.equal((await folders()).agencyCount,expectedNames.length+1);assert.notEqual(await revision(),rev)
await db.exec('reset role');await q('update profiles set manager_id=$1 where id=$2',[ids.m2,ids.a]);await auth(ids.m1)
assert.ok(!(await folders()).agencies.some(a=>[ids.a,ids.b,ids.c,ids.outside].includes(a.agencyId)))
assert.ok((await folders()).agencies.some(a=>a.agencyId===ids.f),'explicit same-manager root under foreign boundary remains assigned')
await assert.rejects(orders({agency:ids.c}),/현재 관리/)
await auth(ids.m2);assert.equal((await orders({agency:ids.c}))[0].total_count,1005);assert.ok(!(await folders()).agencies.some(a=>a.agencyId===ids.f))
for (const id of [ids.admin,ids.a,ids.pending,ids.inactive,null]) {
 await auth(id,id===null?'anon':'authenticated');await assert.rejects(folders());await assert.rejects(orders());await assert.rejects(summary());await assert.rejects(revision())
}
await auth(ids.m3);assert.equal((await summary()).total_order_count,0);assert.equal((await folders()).agencyCount,0)
await db.close()
console.log('PASS: manager descendant scope; 30-level/cyclic/overlapping trees; explicit manager boundaries; inactive history; 1001-row paging/export; all programs; dashboard/direct-payer totals; old APIs; no RLS/write expansion; reassignment/new-child freshness; migration fingerprints')
