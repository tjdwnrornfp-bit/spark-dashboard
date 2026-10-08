import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { base,migration } from './monthly-settlement-fixture.mjs'
const db=new PGlite();await db.exec(base)
process.on('uncaughtException',e=>{console.error(e.message,e.where??'',e.position??'',e.query?.slice(Math.max(0,Number(e.position)-130),Number(e.position)+130)??'');process.exit(1)})
const q=async(sql,args=[])=>(await db.query(sql,args)).rows
const one=async(sql,args=[])=>(await q(sql,args))[0]
const ids=Object.fromEntries(['admin','admin2','agency','child','manager','inactive','pending'].map(n=>[n,randomUUID()]))
for(const [n,id] of Object.entries(ids)){await q('insert into auth.users values($1)',[id]);await q(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,group_name,is_operations_manager,sponsor_id) values($1,$2,$2,$2,$3,$4,$5,20,$6,$7,$8)`,[id,n,['agency','child'].includes(n)?'agency':'admin',['pending','inactive'].includes(n)?'pending':'approved',n!=='inactive',n==='agency'?'원래 그룹':'하위 그룹',n==='manager',n==='child'?ids.agency:null])}
const root=()=>db.exec('reset role')
const auth=async n=>{await root();await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[n]??'']);await db.exec(`set role ${n==='anon'?'anon':'authenticated'}`)}
const create=async({owner='agency',payee='admin',month='2001-09',program='spark',amount=100,confirmed=null,archived=false}={})=>{await root();const id=randomUUID(),step=randomUUID(),num='SPK-'+step;
await q(`insert into orders(id,order_number,created_by,creator_username,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date,program_type,archived_at) values($1,$2,$3,$4,'url','123','상호','키워드',100,1,20,2000,200,2200,$5,$5,$6,case when $7 then now() else null end)`,[id,num,ids[owner],owner,month+'-01',program,archived]);
await q(`insert into payment_steps(id,order_id,order_number,store_name,step_order,payer_id,payer_username,payee_id,payee_username,unit_price,supply_amount,vat_amount,total_amount,confirmed_at,program_type) values($1,$2,$3,'상호',1,$4,$5,$6,$7,20,$8,0,$8,$9,$10)`,[step,id,num,ids[owner],owner,ids[payee],payee,amount,confirmed,program]);return {id,step,num}}
const legacy=await create({confirmed:'2001-08-31T15:00:00Z',archived:true}),waiting=await create({amount:200})
await create({payee:'admin2',amount:999,confirmed:'2001-09-01T01:00:00Z'})
await create({payee:'agency',owner:'child',amount:777,confirmed:'2001-09-01T01:00:00Z'})
const fingerprint=async()=>{await root();return one(`select (select md5(jsonb_agg(to_jsonb(p) order by id)::text) from profiles p) profiles,(select md5(jsonb_agg(to_jsonb(p) order by id)::text) from orders p) orders,(select md5(jsonb_agg(to_jsonb(p) order by id)::text) from payment_steps p) payments`)}
const before=await fingerprint();await db.exec(migration);assert.deepEqual(await fingerprint(),before)
const read=async(args={})=>(await one('select get_admin_monthly_settlement_v1016($1,$2,$3,$4,$5,$6,$7,$8,$9) r',['2001-09-01','work',null,'',null,1,'companies',null,null].map((v,i)=>Object.hasOwn(args,i)?args[i]:v))).r
const save=async(revision,id=randomUUID(),reason='월별 검토 완료',month='2001-09-01')=>(await one('select save_admin_monthly_settlement_v1016($1,$2,$3,$4) r',[month,id,revision,reason])).r
for(const n of ['anon','agency','child','manager','inactive','pending','unknown']){await auth(n);await assert.rejects(read(),/관리자|permission denied/);await assert.rejects(save('a'.repeat(32)),/관리자|permission denied/);await assert.rejects(q('select * from spark_private.settlement_events_v1016'),/permission denied/)}
await auth('admin');let work=await read();assert.equal(work.summary.totalAmount,300);assert.equal(work.summary.confirmedAmount,100);assert.equal(work.summary.waitingAmount,200);assert.equal(work.companies.length,1);assert.equal(work.trend.length,12)
let receipts=await read({1:'receipts'});assert.equal(receipts.summary.totalAmount,100);assert.equal(receipts.coverage.legacyCount,1)
assert.equal((await read({0:'2001-08-01',1:'receipts'})).summary.totalAmount,0)
assert.equal((await read({3:'원래 그룹'})).summary.totalAmount,300)
assert.equal((await read({2:'spark_plus'})).summary.totalAmount,0)
for(const bad of [{0:'2001-09-02'},{0:null},{1:'invalid'},{2:'oops'},{5:0},{6:null},{3:'x'.repeat(101)}])await assert.rejects(read(bad),/조건/)
const request=randomUUID(),first=await save(work.revision,request)
assert.equal(first.version,1);assert.deepEqual(await save(work.revision,request),first)
await assert.rejects(save(work.revision,request,'다른 사유'),/변경/)
await assert.rejects(save(work.revision,randomUUID(),'미래 마감','2099-01-01'),/지난달/)
await auth('admin2');await assert.rejects(read({7:first.id}),/마감 기록/);await auth('admin')
await root();await q("update profiles set group_name='새 그룹' where id=$1",[ids.agency]);await q("update payment_steps set confirmed_at='2001-10-01T00:00:00Z' where id=$1",[waiting.step]);await auth('admin')
let changed=await read();assert.equal(changed.summary.confirmedAmount,300);assert.equal(changed.summary.waitingAmount,0);assert.equal(changed.companies[0].groupName,'새 그룹')
assert.equal((await read({0:'2001-10-01',1:'receipts'})).summary.totalAmount,200)
await assert.rejects(save(work.revision),/마감 대상이 변경/)
assert.deepEqual(await save(work.revision,request),first)
const closed=await read({7:first.id});assert.equal(closed.summary.waitingAmount,200);assert.equal(closed.companies[0].groupName,'원래 그룹');assert.equal(closed.changedSinceClose,true)
await assert.rejects(read({8:work.revision}),/조회 중/)
const second=await save(changed.revision);assert.equal(second.version,2);assert.equal((await read()).snapshots.length,2)
// Cancelling an old confirmation records a debit in the cancellation month, not in September.
await root();await q('update payment_steps set confirmed_at=null where id=$1',[legacy.step]);const current=(await one("select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-01') as month")).month;await auth('admin')
assert.equal((await read({1:'receipts'})).summary.totalAmount,100)
let cancellation=await read({0:current,1:'receipts'});assert.equal(cancellation.summary.reversalAmount,100);assert.equal(cancellation.summary.totalAmount,-100)
await root();await q('update payment_steps set confirmed_at=now() where id=$1',[legacy.step]);await auth('admin');assert.equal((await read({0:current,1:'receipts'})).summary.totalAmount,0)
// Changes to a confirmed amount preserve both sides of the adjustment.
await root();await q('update payment_steps set total_amount=120,supply_amount=120 where id=$1',[legacy.step]);await auth('admin');assert.equal((await read({0:current,1:'receipts'})).summary.totalAmount,20)
// Ledger and close documents survive source deletion; no foreign-key cascades erase them.
await root();await q('delete from payment_steps where id=$1',[legacy.step]);await q('delete from orders where id=$1',[legacy.id]);await auth('admin');assert.equal((await read({7:first.id})).summary.totalAmount,300);assert.equal((await read({1:'receipts'})).summary.totalAmount,100)
// Newly inserted confirmed rows and all programs are tracked once.
for(const program of ['spark_plus','spark_s','spark_s_plus'])await create({program,amount:30,confirmed:'2001-09-30T14:59:59Z'})
await auth('admin');assert.equal((await read({1:'receipts'})).summary.totalAmount,190);assert.equal((await read({2:'spark_s'})).summary.totalAmount,30)
// Stable 50-row paging and revision protection for a whole export.
for(let i=0;i<102;i++)await create({amount:1})
await auth('admin');const page1=await read({6:'details'}),page2=await read({5:2,6:'details',8:page1.revision}),page3=await read({5:3,6:'details',8:page1.revision})
assert.equal(page1.rows.length,50);assert.equal(new Set([...page1.rows,...page2.rows,...page3.rows].map(r=>r.id)).size,page1.totalCount)
// A close must never succeed when its required audit cannot be written.
await root();await db.exec(`create function block_monthly_audit() returns trigger language plpgsql as $$begin if new.action='settlement.month_closed' then raise exception 'audit failed';end if;return new;end$$;create trigger block_monthly_audit before insert on audit_logs for each row execute function block_monthly_audit();`)
await auth('admin');const closeCount=(await read()).snapshots.length;await assert.rejects(save(page1.revision),/audit failed/);assert.equal((await read()).snapshots.length,closeCount)
await db.close();console.log('PASS monthly: no migration row changes; admin/owner isolation; start-month vs KST confirmation-month; archived inclusion; filters; immutable/versioned/replay-safe closes; stale guards; cancellation/reconfirmation/amount changes; source deletion preservation; 50-row pagination; strict audit rollback')
