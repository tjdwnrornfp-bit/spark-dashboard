import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const q = async (sql,args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
for (const file of ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','supabase/migrations/20260907045616_v10_7_admin_order_correction.sql','supabase/migrations/20260909085400_v10_8_member_edit_selection_managed_filters.sql','supabase/migrations/20260914070835_v10_9_manager_agency_folders.sql','supabase/migrations/20260916044522_v10_10_grouped_downline_work.sql']) await db.exec(readFileSync(file,'utf8'))
const ids=Object.fromEntries(['admin','manager','otherManager','distributor','a','b','c','d','empty','outside','inactive','pending',...Array.from({length:23},(_,i)=>`extra${i}`)].map(n=>[n,randomUUID()]))
for(const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users values($1)',[id])
  await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,is_operations_manager,group_name)
    values($1,$2,$2,$2,$3,$4,$5,20,20,$6,$7)`,[id,'test_'+name,name==='admin'?'admin':name==='distributor'?'distributor':'agency',name==='pending'?'pending':name==='inactive'?'rejected':'approved',name!=='inactive',['manager','otherManager'].includes(name),name==='d'?'':name.startsWith('extra')?name:'현재 그룹'])
}
for(const [child,parent] of [['a','distributor'],['b','a'],['c','b'],['d','c'],...Array.from({length:23},(_,i)=>[`extra${i}`,'distributor'])]) await q('update profiles set sponsor_id=$1 where id=$2',[ids[parent],ids[child]])
await q('update profiles set manager_id=$1 where id=any($2::uuid[])',[ids.manager,[ids.a,ids.outside]])
await q('update profiles set manager_id=$1 where id=$2',[ids.otherManager,ids.d])
const auth=async(id,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`)}
const draft={program_type:'spark',place_url:'https://m.place.naver.com/place/1855867917/home',mid:'1855867917',store_name:'Store needle',keyword:'keyword',daily_shots:3,operation_days:100,start_date:'2099-01-01',memo:''}
const created=[]
for(let i=0;i<58;i++) {
  await auth(ids.admin)
  const member=i<52?ids.d:i===52?ids.c:i===53?ids.b:i===54?ids.a:i===55?ids.outside:i===56?ids.distributor:ids.empty
  const o=(await one('select to_jsonb(admin_create_order_for_member_v106($1,$2,$3)) r',[member,draft,randomUUID()])).r
  created.push(o)
  await db.exec('reset role')
  await q('update orders set status=$2 where id=$1',[o.id,['입금대기','입금완료','구동중','만료','정지'][i%5]])
}
await q('update orders set archived_at=now() where id=$1',[created[0].id])
const group=async(params={})=>(await one('select get_downline_group_overview_v1010(p_page=>$1,p_page_size=>$2,p_query=>$3,p_order_statuses=>$4,p_sort=>$5) r',[params.page??1,params.size??20,params.query??null,params.status??null,params.sort??'in_progress'])).r
const agencies=async(name=null)=>(await one('select get_downline_agency_overview_v1010(p_group_name=>$1) r',[name])).r
const orders=async(agency=null,page=1,size=50,query=null,groupName=null,status=null)=>q('select * from get_downline_orders_v1010(p_agency_id=>$1,p_page=>$2,p_page_size=>$3,p_query=>$4,p_group_name=>$5,p_order_statuses=>$6)',[agency,page,size,query,groupName,status])
await auth(ids.distributor)
const g=await group();assert.equal(g.groupCount,25);assert.equal(g.groups.length,20)
const g2=await group({page:2});assert.equal(g2.groups.length,5)
assert.equal((await group({page:999})).page,2)
assert.equal(new Set([...g.groups,...g2.groups].map(x=>x.groupName)).size,25)
assert.equal((await agencies('현재 그룹')).agencyCount,3)
assert.equal((await agencies('미지정 그룹')).agencies[0].agencyId,ids.d)
const all=await orders(null,1,500);assert.equal(all.length,54);assert.ok(!all.some(o=>[ids.outside,ids.distributor].includes(o.registrant_id)))
assert.equal((await orders(ids.d)).length,50);assert.equal((await orders(ids.d,2)).length,1)
assert.equal(new Set([...await orders(ids.d),...await orders(ids.d,2)].map(o=>o.order_id)).size,51)
assert.equal((await orders(null,1,500,'미지정 그룹')).length,51)
assert.equal((await orders(null,1,500,null,'미지정 그룹')).length,51)
for(const query of ['d','Store needle','keyword','1855867917']) assert.ok((await orders(ids.d,1,500,query)).length>0)
assert.ok((await orders(ids.d,1,500,null,null,['입금대기','입금완료'])).every(o=>['입금대기','입금완료'].includes(o.order_status)))
await assert.rejects(orders(ids.outside),/sponsor/);await assert.rejects(orders(ids.distributor),/sponsor/)
await assert.rejects(q('select get_downline_agency_overview_v1010(p_agency_id=>$1)',[ids.outside]),/sponsor/)
await assert.rejects(group({sort:'bogus'}));await assert.rejects(group({status:['bogus']}))
await assert.rejects(q('select * from spark_private.downline_members_v1010()'),/permission denied/)
// Amounts come only from the caller's receivable payment steps, once per step.
await db.exec('reset role')
const expected=(await one('select coalesce(sum(s.total_amount),0)::text n from payment_steps s join orders o on o.id=s.order_id where s.payee_id=$1 and s.confirmed_at is null and o.archived_at is null and o.created_by=any($2::uuid[])',[ids.distributor,[ids.a,ids.b,ids.c,ids.d]])).n
await auth(ids.distributor)
assert.equal([...g.groups,...g2.groups].reduce((s,a)=>s+a.settlementWaitingAmount,0),Number(expected))
// No write permission gained through a read-only RPC.
await assert.rejects(q('update orders set store_name=$1 where id=$2',['illegal',created[1].id]),/permission denied/)
await assert.rejects(q('select member_apply_own_order_edit_v108($1,$2,$3,$4)',[created[1].id,created[1].lock_version,{store_name:'illegal'},'권한 검증']),/본인/)
// Live group metadata changes folder and export, without changing the order snapshot.
await db.exec('reset role');const before=(await one('select creator_group_name from orders where id=$1',[created[1].id])).creator_group_name
await q("update profiles set group_name='새 그룹' where id=$1",[ids.d]);await auth(ids.distributor)
assert.equal((await orders(ids.d))[0].current_group_name,'새 그룹');assert.equal((await agencies('새 그룹')).agencyCount,1)
assert.equal((await agencies('미지정 그룹')).agencyCount,0)
await db.exec('reset role');assert.equal((await one('select creator_group_name from orders where id=$1',[created[1].id])).creator_group_name,before)
// An inactive intermediate node does not discard historical descendant work.
await q("update profiles set active=false,approval_status='rejected' where id=$1",[ids.b]);await auth(ids.a);assert.equal((await orders(null,1,500)).length,53)
await auth(ids.empty);assert.equal((await group()).groupCount,0);assert.equal((await orders()).length,0)
// Manager-only links never become sponsor descendants, and vice versa.
await auth(ids.manager)
assert.equal((await one('select get_manager_agency_folders_v1010() r')).r.agencyCount,2)
await assert.rejects(q('select * from get_manager_agency_orders_v1010(p_agency_id=>$1)',[ids.d]),/현재 관리/)
await assert.rejects(orders(),/활성 대행사/)
for(const name of ['admin','manager','inactive','pending']) {await auth(ids[name]);await assert.rejects(group());await assert.rejects(orders())}
await auth(null,'anon');await assert.rejects(group());await assert.rejects(orders())
// Cycle defence: d -> a closes a cycle; finite traversal and no self orders.
await db.exec('reset role');await q('update profiles set sponsor_id=$1 where id=$2',[ids.d,ids.a]);await auth(ids.a)
assert.equal((await orders(null,1,500)).length,53);assert.ok(!(await orders(null,1,500)).some(o=>o.registrant_id===ids.a))
await db.exec('reset role')
await db.exec(readFileSync('supabase/verify_v10_10.sql','utf8'))
await db.close()
console.log('PASS: deep hierarchy; cycles; role/approval/active/anonymous guards; manager/sponsor isolation; unauthorized IDs; current group and preserved snapshots; group/order pagination; composite/search; receivable amounts; no new writes')
