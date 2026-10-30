// Actual components and review client -> HTTP -> isolated database -> UI.
import { build } from 'esbuild'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
const out=process.env.RETIREMENT_UI_DIR||'.test-output/retirement-ui';fs.mkdirSync(out,{recursive:true})
const db=new PGlite();await db.exec(fs.readFileSync('tests/fixtures/v105-intake.sql','utf8')+'\ncreate role service_role;')
for(const file of ['tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql','supabase/migrations/20260907045616_v10_7_admin_order_correction.sql','supabase/migrations/20260909085400_v10_8_member_edit_selection_managed_filters.sql'])await db.exec(fs.readFileSync(file,'utf8'))
const ids={admin:'11111111-1111-4111-8111-111111111111',member:'22222222-2222-4222-8222-222222222222',pending:'33333333-3333-4333-8333-333333333333'}
for(const [name,id] of Object.entries(ids)){
 await db.query('insert into auth.users values($1)',[id])
 await db.query(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot,group_name)
 values($1,$2,$2,$2,$3,$4,$5,$6,$6,30,40,40,'테스트 업체')`,[id,'test_'+name,name==='admin'?'admin':'agency',name==='pending'?'pending':'approved',name!=='pending',name==='pending'?0:20])
}
await db.query(`insert into orders(order_number,created_by,creator_username,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date,program_type)
 values('SPK-history',$1,'test_member','url','123','보존된 기존 작업','키워드',100,10,20,20000,2000,22000,'2099-01-01','2099-01-10','spark')`,[ids.member])
await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_v10_17_retire_spark_adjust_plus_prices.sql')),'utf8'))
const initial={profiles:(await db.query('select to_jsonb(p) r from profiles p')).rows.map(x=>x.r),orders:(await db.query('select to_jsonb(o) r from orders o')).rows.map(x=>x.r)}
const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AppShell} from './src/components/AppShell';import {DashboardPage} from './src/features/DashboardPage';import {OrdersPage} from './src/features/OrdersPage';import {MembersPage} from './src/features/MembersPage';import {MyInfoPage} from './src/features/MyInfoPage';import {DEFAULT_SETTINGS} from './src/data/demo';import {mapProfile,mapOrder,reviewRemoteMember} from './src/lib/backend';import {PROGRAM_PAGE_MAP} from './src/lib/program';
const initial=${JSON.stringify(initial)},orders=initial.orders.map(mapOrder),noop=async()=>{};
function Harness(){const [members,setMembers]=useState(initial.profiles.map(mapProfile)),[actor,setActor]=useState('${ids.admin}'),[page,setPage]=useState('dashboard');const user=members.find(m=>m.id===actor),program=PROGRAM_PAGE_MAP[page];window.actor=actor;
 const review=async params=>{const updated=await reviewRemoteMember({memberId:params.member.id,memberUpdatedAt:params.member.updatedAt,role:params.role,prices:params.prices,approvalStatus:params.approvalStatus,groupName:params.groupName});setMembers(m=>m.map(v=>v.id===updated.id?updated:v));};
 return <><div style={{position:'fixed',bottom:0,right:0,zIndex:9999,background:'white'}}><label>테스트 계정<select aria-label="테스트 계정" value={actor} onChange={e=>{setActor(e.target.value);setPage('dashboard')}}><option value="${ids.admin}">관리자</option><option value="${ids.member}">회원</option></select></label></div><AppShell user={user} page={page} unreadCount={0} serverMode={false} onNavigate={setPage} onLogout={noop}>
 {page==='dashboard'&&<DashboardPage user={user} members={members} orders={orders} paymentSteps={[]} notices={[]} now={new Date()} serverMode={false} refreshKey={0} onNavigate={setPage} onOpenManagedOrders={noop}/>}
 {page==='myinfo'&&<MyInfoPage user={user} onPasswordChange={noop} onAccountChange={noop}/>}
 {page==='members'&&<MembersPage user={user} members={members} onReview={review} onAssignManager={noop} onBulkAssignManager={noop} onCheckDeletion={noop} onDeleteMember={noop} onResetPassword={noop}/>}
 {program&&<OrdersPage key={actor+program} user={user} orders={orders} settings={DEFAULT_SETTINGS} now={new Date()} programType={program} memberEditRefreshKey={0} onLifecycleFinished={noop} onMemberEditPreview={noop} onMemberEditApply={noop} onCorrectionPreview={noop} onCorrectionApply={noop} onLoadAssignmentMembers={async()=>members} onAdminAssign={noop} onAdminBulkAssign={noop} onCreateOrder={noop} onCreateOrdersBulk={noop} onStatusChange={noop} onBulkProgramTransferPreview={noop} onBulkProgramTransfer={noop} onArchiveOrder={noop} onRestoreOrder={noop}/>}
 </AppShell></>};createRoot(document.getElementById('root')).render(<Harness/>);`
const mock=`export const isSupabaseConfigured=false;export const supabase={rpc:async(name,args)=>{const response=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args,actor:window.actor})});return response.json();}};`
await build({stdin:{resolveDir:process.cwd(),contents:source,loader:'tsx'},bundle:true,platform:'browser',format:'esm',outfile:path.join(out,'app.js'),plugins:[{name:'isolated',setup(b){b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:mock,loader:'js'}))}}]})
fs.copyFileSync('src/styles.css',path.join(out,'style.css'));fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>')
let chain=Promise.resolve()
const server=http.createServer(async(req,res)=>{
 if(req.url==='/rpc'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk
  const {name,args,actor}=JSON.parse(body);chain=chain.then(async()=>{try{
   if(!['review_member_v1017','member_own_order_edit_eligibility_v108'].includes(name)||!Object.values(ids).includes(actor))throw Error('unexpected test request')
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated')
   const keys=['p_member_id','p_role','p_is_operations_manager','p_spark_plus_price_per_shot','p_spark_s_price_per_shot','p_spark_s_plus_price_per_shot','p_approval_status','p_group_name','p_expected_updated_at']
   const data=name==='member_own_order_edit_eligibility_v108'?(await db.query('select * from member_own_order_edit_eligibility_v108($1)',[args.p_order_ids])).rows:(await db.query('select to_jsonb(review_member_v1017($1,$2,$3,$4,$5,$6,$7,$8,$9)) r',keys.map(k=>args[k]))).rows[0].r
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data,error:null}))
  }catch(e){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:null,error:{message:e.message}}))}});return
 }
 const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(path.join(out,file)))
})
server.listen(4177,'127.0.0.1',()=>console.log('Retirement isolated UI listening on 4177'))
process.on('SIGTERM',()=>server.close(()=>db.close().then(()=>process.exit(0))))
