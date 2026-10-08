// Actual UI -> HTTP -> isolated PostgreSQL (PGlite) -> production RPC -> UI.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { base,migration } from './monthly-settlement-fixture.mjs'
const out=process.env.MONTHLY_UI_DIR||'.test-output/monthly-ui';fs.mkdirSync(out,{recursive:true})
const db=new PGlite();await db.exec(base)
const admin='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333'
for(const [id,name,role,group] of [[admin,'admin','admin','관리자'],[a,'agencyA','agency','푸른마케팅'],[b,'agencyB','agency','오렌지기획']]){await db.query('insert into auth.users values($1)',[id]);await db.query(`insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,group_name) values($1,$2,$2,$2,$3,'approved',true,20,$4)`,[id,name,role,group])}
await db.query(`insert into orders(order_number,created_by,creator_username,place_url,mid,store_name,keyword,daily_shots,operation_days,price_per_shot,supply_amount,vat_amount,total_amount,start_date,end_date,archived_at)
 select 'SPK-'||g,case when g<=60 then $1::uuid else $2::uuid end,case when g<=60 then 'agencyA' else 'agencyB' end,'url','123','테스트 상호 '||g,'키워드',100,1,20,1000,0,1000,'2001-09-01','2001-09-01',case when g=1 then now() else null end from generate_series(1,70) g`,[a,b])
await db.query(`insert into payment_steps(order_id,order_number,store_name,step_order,payer_id,payer_username,payee_id,payee_username,unit_price,supply_amount,vat_amount,total_amount,confirmed_at,program_type)
 select id,order_number,store_name,1,created_by,creator_username,$1,'admin',20,1000,0,1000,case when split_part(order_number,'-',2)::integer<=35 then '2001-10-01T01:00:00Z'::timestamptz else null end,'spark' from orders`,[admin])
await db.exec(migration);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await db.exec('set role authenticated')
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {SettlementPage} from './src/features/SettlementPage';import {DEMO_USERS,DEFAULT_SETTINGS} from './src/data/demo';const admin={...DEMO_USERS.find(u=>u.role==='admin'),id:'${admin}'};createRoot(document.getElementById('root')).render(<main style={{padding:20,maxWidth:1280,margin:'auto'}}><SettlementPage user={admin} members={[]} orders={[]} paymentSteps={[]} paymentAccount={{bank:'',accountNumber:'',accountHolder:''}} settings={DEFAULT_SETTINGS} refreshKey={0} onSettingsChange={async()=>{}} onConfirmPayment={async()=>{}} onReversePayment={async()=>{}} onConfirmSettlementQuote={async()=>{}}/></main>);`
const mock=`window.calls=[];window.loseSaveResponse=false;export const isSupabaseConfigured=true;export const supabase={rpc:async(name,args={})=>{window.calls.push({name,args:structuredClone(args)});if(!name.includes('monthly'))return {data:{rows:[],companies:[],groups:[],payers:[],registrants:[]},error:null};const response=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args})});const body=await response.json();if(name.startsWith('save_')&&window.loseSaveResponse){window.loseSaveResponse=false;throw Error('연결이 끊어졌습니다.')}return body;}};`
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:source},bundle:true,platform:'browser',format:'esm',outfile:path.join(out,'app.js'),plugins:[{name:'isolated',setup(b){b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:mock,loader:'js'}))}}]})
fs.copyFileSync('src/styles.css',path.join(out,'style.css'));fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>')
let chain=Promise.resolve()
const server=http.createServer(async(req,res)=>{
 if(req.url==='/rpc'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk
  const {name,args}=JSON.parse(body);const task=async()=>{try{let query,values;
    if(name==='get_admin_monthly_settlement_v1016'){query='select get_admin_monthly_settlement_v1016($1,$2,$3,$4,$5,$6,$7,$8,$9) r';values=['p_month','p_mode','p_program','p_query','p_registrant','p_page','p_view','p_snapshot','p_expected_revision'].map(k=>args[k]??null)}
    else if(name==='save_admin_monthly_settlement_v1016'){query='select save_admin_monthly_settlement_v1016($1,$2,$3,$4) r';values=['p_month','p_request_id','p_expected_revision','p_reason'].map(k=>args[k])}else throw Error('denied');
    const data=(await db.query(query,values)).rows[0].r;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data,error:null}))
   }catch(e){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:null,error:{message:e.message}}))}};chain=chain.then(task);return;
 }
 const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(path.join(out,file)))
})
server.listen(4176,'127.0.0.1',()=>console.log('Monthly isolated UI listening on 4176'))
process.on('SIGTERM',()=>server.close(()=>db.close().then(()=>process.exit(0))))
