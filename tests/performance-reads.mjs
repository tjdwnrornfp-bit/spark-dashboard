import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const q = async (sql,args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
await db.exec(readFileSync('tests/fixtures/v105-intake.sql','utf8'))
await db.exec(readFileSync('tests/fixtures/v105-quotes.sql','utf8'))
await db.exec(readFileSync('supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','utf8'))
// Catalog-compatible read prerequisites; all rows below are synthetic.
await db.exec(`
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and approval_status='approved' and active) $$;
create function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=now(); return new; end $$;
create table public.notices(id uuid primary key default gen_random_uuid(),created_by uuid);
create table public.settlement_batches(id uuid primary key default gen_random_uuid(),confirmed_by uuid,voided_by uuid);
alter table public.orders enable row level security;
alter table public.profiles enable row level security;
alter table public.payment_steps enable row level security;
alter table public.notifications enable row level security;
create policy orders_read on public.orders for select to authenticated using(created_by=(select auth.uid()) or (select public.is_admin()));
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select public.is_admin()) or sponsor_id=(select auth.uid()));
create policy steps_read on public.payment_steps for select to authenticated using(payer_id=(select auth.uid()) or payee_id=(select auth.uid()) or (select public.is_admin()));
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create policy notifications_update on public.notifications for update to authenticated using(user_id=(select auth.uid()) or (select public.is_admin())) with check(user_id=(select auth.uid()) or (select public.is_admin()));
grant select on public.orders,public.profiles,public.payment_steps,public.notifications to authenticated;
grant update on public.notifications to authenticated;
create index on public.orders(created_by,archived_at,created_at desc);
create index on public.payment_steps(payee_id,confirmed_at,created_at);
create index on public.payment_steps(payer_id,confirmed_at,created_at);
`)
function installFunction(file,name) {
  const sql=readFileSync(file,'utf8'); const start=sql.indexOf(`create or replace function public.${name}(`)
  assert.ok(start>=0)
  return db.exec(sql.slice(start,sql.indexOf('$$;',start)+3))
}
await installFunction('supabase/migrations/20260821090000_v9_9_admin_program_transfer.sql','get_my_active_payment_steps_v91')
await installFunction('supabase/migrations/20260806183000_v9_2_settlement_batches.sql','get_my_settlement_summary_v92')
const ids=Object.fromEntries(['admin','distributor','agencyA','agencyB','manager','pending','inactive'].map(name=>[name,randomUUID()]))
for(const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users values($1)',[id])
  await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,is_operations_manager,group_name,sponsor_id)
    values($1,$2,$2,$2,$3,$4,$5,20,20,$6,$7,$8)`,[id,name,name==='admin'?'admin':name==='distributor'?'distributor':'agency',name==='pending'?'pending':name==='inactive'?'rejected':'approved',!['pending','inactive'].includes(name),name==='manager','현재_'+name,name.startsWith('agency')?ids.distributor:null])
}
const auth=async(id,role='authenticated')=>{ await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']); await db.exec(`set role ${role}`) }
const seed=async(from,to)=>{
  await db.exec('reset role')
  await q(`insert into orders(order_number,created_by,creator_username,sponsor_id,sponsor_username,creator_group_name,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date,status,created_at,updated_at,program_type,archived_at)
    select 'TEST-'||lpad(i::text,6,'0'),case when i%3=0 then $1::uuid else $2::uuid end,case when i%3=0 then 'agencyB' else 'agencyA' end,$3,'distributor','과거 그룹','https://example.test/123','123','Store '||i,'search_'||i,
    100+i%40,10,20,(100+i%40)*200,(100+i%40)*20,(100+i%40)*220,'2099-01-01'::date,'2099-01-10'::date,
    (array['입금대기','입금완료','구동중','정지','만료'])[1+i%5]::order_status,
    '2026-09-01T00:00:00Z'::timestamptz+(i%20)*interval '1 day', '2026-09-21T00:00:00Z'::timestamptz,
    (array['spark','spark_plus','spark_s','spark_s_plus'])[1+i%4],case when i%19=0 then now() else null end
    from generate_series($4::integer,$5::integer) i`,[ids.agencyB,ids.agencyA,ids.distributor,from,to])
  await q(`insert into payment_steps(order_id,order_number,store_name,step_order,payer_id,payer_username,payee_id,payee_username,unit_price,supply_amount,vat_amount,total_amount,confirmed_at,program_type)
    select o.id,o.order_number,o.store_name,s.step,
      case when s.step=1 then o.created_by else $1::uuid end,case when s.step=1 then o.creator_username else 'distributor' end,
      case when s.step=1 then $1::uuid else $2::uuid end,case when s.step=1 then 'distributor' else 'admin' end,
      case when s.step=1 then 15 else 10 end, o.daily_shots*case when s.step=1 then 150 else 100 end,
      o.daily_shots*case when s.step=1 then 15 else 10 end,o.daily_shots*case when s.step=1 then 165 else 110 end,
      case when substring(o.order_number from 6)::integer % (2*s.step)=0 then now() else null end, o.program_type
    from orders o cross join (values(1),(2)) s(step) where substring(o.order_number from 6)::integer between $3 and $4`,[ids.distributor,ids.admin,from,to])
}
await seed(1,20)
const fingerprint=async()=>one("select (select md5(string_agg(to_jsonb(o)::text,'' order by id)) from orders o) orders,(select md5(string_agg(to_jsonb(p)::text,'' order by id)) from payment_steps p) payments")
const before=await fingerprint()
const migration=readdirSync('supabase/migrations').find(name=>name.endsWith('_v10_11_performance_read_paths.sql'))
await db.exec('begin;'+readFileSync('supabase/migrations/'+migration,'utf8')+'commit;')
assert.deepEqual(await fingerprint(),before,'Migration must not modify order/payment data')
const rpc=async(name,args={})=>{
  const entries=Object.entries(args)
  return (await one(`select public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) result`,entries.map(([,value])=>value))).result
}
const orderPage=args=>rpc('get_order_page_v1011',args)
let previous=20
for(const size of [1000,5000,10000]) {
  await seed(previous+1,size);previous=size
  for(const actor of ['admin','agencyA','agencyB','distributor']) {
    await auth(ids[actor])
    const start=performance.now()
    const page=await orderPage({p_page_size:50})
    const expected=(await one('select count(*)::integer n from orders where archived_at is null')).n
    assert.equal(page.totalCount,expected)
    assert.equal(page.rows.length,Math.min(50,expected)); assert.equal(page.counts['전체'],expected)
    const dashboard=await rpc('get_dashboard_summary_v1011')
    const oldSummary=await rpc('get_my_settlement_summary_v92')
    assert.deepEqual(dashboard.settlement,oldSummary)
    assert.equal(dashboard.totalCount,expected)
    assert.equal(Object.values(dashboard.statusCounts).reduce((s,n)=>s+n,0),expected)
    assert.equal(dashboard.recent.length,Math.min(7,expected))
    const outgoing=await rpc('get_outgoing_settlement_page_v1011')
    const expectedSteps=(await one('select count(*)::integer n from public.get_my_active_payment_steps_v91() where payer_id=auth.uid()')).n
    assert.equal(outgoing.totalCount,expectedSteps);assert.equal(outgoing.rows.length,Math.min(50,expectedSteps))
    assert.ok(outgoing.rows.every(row=>row.payer_id===ids[actor]))
    console.log(`PASS: synthetic=${size}, actor=${actor}, visible=${expected}, outgoing=${expectedSteps}, page+summary=${(performance.now()-start).toFixed(1)}ms (isolated PGlite, not production latency)`)
  }
}
await auth(ids.admin)
const all=(await orderPage({p_page_size:1000,p_sort:'asc'}))
let exported=[...all.rows]
for(let page=2;page<=all.totalPages;page++){
  const next=await orderPage({p_page:page,p_page_size:1000,p_sort:'asc',p_expected_revision:all.revision})
  assert.equal(next.totalCount,all.totalCount);exported.push(...next.rows)
}
assert.equal(exported.length,all.totalCount);assert.equal(new Set(exported.map(o=>o.id)).size,all.totalCount)
assert.ok(exported.every(o=>o.current_creator_group_name.startsWith('현재_')))
const idsToSelect=[exported[1].order_number,exported[70].order_number,exported.at(-1).order_number]
const selected=await orderPage({p_order_ids:idsToSelect,p_archived:null})
assert.equal(selected.totalCount,3);assert.deepEqual(selected.rows.map(o=>o.order_number).sort(),idsToSelect.sort())
const filtered=await orderPage({p_program_type:'spark',p_status:'구동중',p_query:'Store 1',p_created_from:'2026-09-05',p_created_to:'2026-09-15'})
const expectedFiltered=exported.filter(o=>o.program_type==='spark'&&o.status==='구동중'&&o.store_name.includes('Store 1')&&Date.parse(o.created_at)>=Date.parse('2026-09-05T00:00:00+09:00')&&Date.parse(o.created_at)<Date.parse('2026-09-16T00:00:00+09:00'))
assert.equal(filtered.totalCount,expectedFiltered.length)
assert.equal((await orderPage({p_page:999999})).page,all.totalPages*20-1 <= 0 ? 1 : Math.ceil(all.totalCount/50))
const wildcard=await orderPage({p_query:'%'})
assert.equal(wildcard.totalCount,0,'Literal search must not turn % into a wildcard')
await assert.rejects(orderPage({p_program_type:'bogus'}));await assert.rejects(orderPage({p_sort:'bogus'}));await assert.rejects(orderPage({p_created_from:'2026-09-15',p_created_to:'2026-09-01'}))
// Updates across export pages must fail closed rather than mix revisions.
await db.exec('reset role');await q('update orders set updated_at=now() where id=$1',[exported[0].id]);await auth(ids.admin)
await assert.rejects(orderPage({p_page:2,p_page_size:1000,p_expected_revision:all.revision}),/내보내기 중/)
for(const actor of ['manager','pending','inactive']) {
  await auth(ids[actor]);await assert.rejects(orderPage());await assert.rejects(rpc('get_dashboard_summary_v1011'));await assert.rejects(rpc('get_outgoing_settlement_page_v1011'))
}
await auth(null,'anon')
for(const fn of ['get_order_page_v1011','get_dashboard_summary_v1011','get_outgoing_settlement_page_v1011','get_my_notification_counts_v1011','get_my_notifications_page_v1011','mark_all_my_notifications_read_v1011','is_admin']) await assert.rejects(rpc(fn),/permission denied/)
// More than 100 unread rows, equal timestamps and another user's notifications.
await db.exec('reset role')
await q(`insert into notifications(user_id,target_role,title,message,created_at) select $1,'agency','Test','Synthetic', '2026-09-21T00:00:00Z' from generate_series(1,230)`,[ids.agencyA])
await q(`insert into notifications(user_id,target_role,title,message,created_at) select $1,'agency','Other','Synthetic', '2026-09-21T00:00:00Z' from generate_series(1,12)`,[ids.agencyB])
await q(`insert into notifications(user_id,target_role,title,message,created_at) select $1,'admin','Admin','Synthetic', '2026-09-21T00:00:00Z' from generate_series(1,6)`,[ids.admin])
await auth(ids.agencyA)
const notifications=await rpc('get_my_notifications_page_v1011',{p_unread:true})
assert.equal(notifications.unreadCount,230);assert.equal(notifications.rows.length,100);assert.equal(notifications.hasMore,true)
await q('update notifications set read_at=now() where id=$1',[notifications.rows[0].id])
const nextNotifications=await rpc('get_my_notifications_page_v1011',{p_unread:true,p_before_time:notifications.cursor.createdAt,p_before_id:notifications.cursor.id})
const lastNotifications=await rpc('get_my_notifications_page_v1011',{p_unread:true,p_before_time:nextNotifications.cursor.createdAt,p_before_id:nextNotifications.cursor.id})
assert.equal(new Set([...notifications.rows,...nextNotifications.rows,...lastNotifications.rows].map(n=>n.id)).size,230)
assert.equal(lastNotifications.rows.length,30)
assert.equal(await rpc('mark_all_my_notifications_read_v1011'),229)
assert.equal((await rpc('get_my_notification_counts_v1011')).unreadCount,0)
await auth(ids.admin)
assert.equal((await rpc('get_my_notification_counts_v1011')).unreadCount,6,'Admin notification count must not include other users')
assert.equal(await rpc('mark_all_my_notifications_read_v1011'),6)
await auth(ids.agencyB)
assert.equal((await rpc('get_my_notification_counts_v1011')).unreadCount,12,'Admin all-read must not mark another user notifications')
await db.exec('reset role')
const paths=await one("select proconfig from pg_proc where proname='touch_updated_at'")
assert.ok(paths.proconfig.some(value=>value.startsWith('search_path=')))
assert.equal((await one("select count(*)::int n from pg_indexes where indexname like '%v1011_idx' ")).n,8)
console.log('PASS: migration row fingerprints unchanged; full exports >1000; cross-page selection; current groups; date/status/program/search/archive filters; permissions; snapshot drift; cursor pagination; true unread/all-read isolation; 8 indexes and fixed search_path')
await db.close()
