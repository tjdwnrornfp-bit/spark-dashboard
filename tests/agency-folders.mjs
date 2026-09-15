import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const q = async (sql,args=[]) => (await db.query(sql,args)).rows
const one = async (sql,args=[]) => (await q(sql,args))[0]
for (const file of ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','supabase/migrations/20260907045616_v10_7_admin_order_correction.sql','supabase/migrations/20260909085400_v10_8_member_edit_selection_managed_filters.sql']) await db.exec(readFileSync(file,'utf8'))
// Install the unchanged dashboard read routine in the isolated fixture for parity checks.
const dashboard = readFileSync('supabase/migrations/20260828180000_v10_3_manager_dashboard_overview.sql','utf8')
await db.exec(dashboard.slice(dashboard.indexOf('create or replace function public.get_manager_dashboard_summary_v103()'),dashboard.indexOf('create or replace function public.get_manager_agency_overview_v103(')))
await db.exec(readFileSync('supabase/migrations/20260914070835_v10_9_manager_agency_folders.sql','utf8'))
const ids = Object.fromEntries(['admin','manager','otherManager','inactive','pending',...Array.from({length:23},(_,i)=>`agency${i}`)].map(n=>[n,randomUUID()]))
for (const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users values($1)',[id])
  await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,is_operations_manager,manager_id)
    values($1,$2,$2,$2,$3,$4,$5,20,20,$6,$7)`,[id,name,name==='admin'?'admin':'agency',name==='pending'?'pending':name==='inactive'?'rejected':'approved',name!=='inactive',['manager','otherManager','inactive','pending'].includes(name),name.startsWith('agency')?(name==='agency22'?ids.otherManager:ids.manager):null])
}
const auth = async (id,role='authenticated') => { await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`) }
const draft={program_type:'spark',place_url:'https://m.place.naver.com/place/1855867917/home',mid:'1855867917',store_name:'Folder match',keyword:'keyword find',daily_shots:3,operation_days:100,start_date:'2099-01-01',memo:''}
const statuses=['입금대기','입금완료','구동중','정지','만료']
const created=[]
for(let i=0;i<61;i++) {
  await auth(ids.admin)
  const agency=i<56?ids.agency0:i<60?ids.agency1:ids.agency22
  const o=(await one('select to_jsonb(admin_create_order_for_member_v106($1,$2,$3)) r',[agency,{...draft,store_name:i===2?'unique needle':draft.store_name},randomUUID()])).r
  created.push(o)
  await db.exec('reset role')
  await q('update orders set status=$2 where id=$1',[o.id,statuses[i%5]])
  if(i%2===0) await q('update payment_steps set confirmed_at=now() where order_id=$1',[o.id])
}
await q('update orders set archived_at=now() where id=$1',[created[0].id])
await q("update orders set program_transfer_state='payment_pending' where id=$1",[created[2].id])
await q('update orders set settlement_reversal_pending=true where id=$1',[created[4].id])
await q('delete from payment_steps where order_id=$1',[created[3].id]) // fixture-only no-step fallback
await auth(ids.manager)
const folders = async (params={}) => (await one('select get_manager_agency_folders_v109(p_page=>$1,p_page_size=>$2,p_query=>$3,p_sort=>$4,p_program_type=>$5,p_order_statuses=>$6,p_settlement_status=>$7) r',[params.page??1,params.size??20,params.query??null,params.sort??'in_progress',params.program??null,params.status??null,params.settlement??null])).r
const orders = async (agency=ids.agency0,page=1,size=50,status=null,settlement=null,query=null) => q('select * from get_manager_agency_orders_v109(p_agency_id=>$1,p_page=>$2,p_page_size=>$3,p_order_statuses=>$4,p_settlement_status=>$5,p_query=>$6)',[agency,page,size,status,settlement,query])
const f=await folders();assert.equal(f.agencyCount,22);assert.equal(f.agencies.length,20);assert.equal(f.agencies[0].agencyId,ids.agency0)
const second=await folders({page:2});assert.equal(second.agencies.length,2);assert.equal(new Set([...f.agencies,...second.agencies].map(a=>a.agencyId)).size,22)
assert.equal((await folders({page:999})).page,2)
const all=[...await orders(ids.agency0,1),...await orders(ids.agency0,2)]
assert.equal(all.length,55);assert.equal(new Set(all.map(r=>r.order_id)).size,55);assert.ok(all.every(r=>r.registrant_id===ids.agency0))
assert.equal(f.agencies[0].inProgressCount,all.filter(r=>['입금대기','입금완료'].includes(r.order_status)).length)
assert.deepEqual(all.map(r=>r.order_id),(await orders(ids.agency0,1,500)).map(r=>r.order_id))
for(const status of statuses) assert.ok((await orders(ids.agency0,1,500,[status])).every(r=>r.order_status===status))
const composite=await orders(ids.agency0,1,500,['입금대기','입금완료']);assert.equal(composite.length,f.agencies[0].inProgressCount)
const allFolders=[...f.agencies,...second.agencies]
const summary=await one('select * from get_manager_dashboard_summary_v103()')
assert.equal(allFolders.reduce((s,a)=>s+a.settlementWaitingAmount,0),Number(summary.settlement_waiting_amount))
assert.equal(allFolders.reduce((s,a)=>s+a.settlementCompletedAmount,0),Number(summary.settlement_completed_amount))
assert.equal(allFolders.reduce((s,a)=>s+a.totalOrderCount,0),Number(summary.total_order_count))
for(const [query,expected] of [['unique needle',1],['agency0',55],['keyword find',55],['1855867917',55]]) {
  const result=await folders({query});const match=result.agencies.find(a=>a.agencyId===ids.agency0)
  assert.equal(match.matchedOrderCount,expected)
  assert.equal((await orders(ids.agency0,1,500,null,null,query)).length,expected)
}
for(const settlement of ['정산대기','부분완료','정산완료']) {
  const a=(await folders({settlement})).agencies.find(a=>a.agencyId===ids.agency0)
  assert.equal(a?.matchedOrderCount??0,(await orders(ids.agency0,1,500,null,settlement)).length)
}
await assert.rejects(orders(ids.agency22),/현재 관리 대행사/)
await assert.rejects(orders(null),/현재 관리 대행사/)
await assert.rejects(folders({sort:'invalid'}))
await assert.rejects(folders({status:['bogus']}))
for(const id of [ids.agency0,ids.inactive,ids.pending,null]) {await auth(id,id===null?'anon':'authenticated');await assert.rejects(folders());await assert.rejects(orders())}
// Manager reassignment immediately revokes the former manager scope.
await db.exec('reset role');await q('update profiles set manager_id=$1 where id=$2',[ids.otherManager,ids.agency0]);await auth(ids.manager)
await assert.rejects(orders(ids.agency0),/현재 관리 대행사/)
assert.ok(!(await folders()).agencies.some(a=>a.agencyId===ids.agency0))
await db.close()
console.log('PASS: manager/active/approval/anonymous guards; reassignment; folder and order pagination; dashboard amount parity; transfer/reversal/no-step cases; composite status; server search and export parity')

