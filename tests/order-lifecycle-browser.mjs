// Real UI with isolated RPC fixtures; no production endpoints or credentials.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
const out=process.env.LIFECYCLE_UI_DIR || '.test-output/lifecycle-ui'
fs.mkdirSync(out,{recursive:true})
const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {OrdersPage} from './src/features/OrdersPage';import {DEMO_USERS,DEFAULT_SETTINGS} from './src/data/demo';
const admin={...DEMO_USERS.find(u=>u.role==='admin'),id:'admin'};
function App(){const [program,setProgram]=useState('spark');const [revision,setRevision]=useState(0);return <main style={{padding:16}}><nav>{['spark','spark_plus','spark_s','spark_s_plus'].map(p=><button key={p} onClick={()=>setProgram(p)}>{p}</button>)}</nav><OrdersPage user={admin} orders={[]} settings={DEFAULT_SETTINGS} now={new Date()} programType={program} memberEditRefreshKey={revision} onLifecycleFinished={async()=>{window.refreshes++;setRevision(r=>r+1)}} /></main>};createRoot(document.getElementById('root')).render(<App/>);`
const mock=`
window.calls=[];window.refreshes=0;window.loseResponse=false;window.previewFailure=false;const receipts=new Map();
const programs=['spark','spark_plus','spark_s','spark_s_plus'];
window.orders=programs.flatMap((program,p)=>Array.from({length:p===0?60:2},(_,i)=>({id:program+'-'+i,order_number:program+'-'+i,created_by:'member',creator_username:'agency1',store_name:'상호'+i,keyword:'키워드',place_url:'https://m.place.naver.com/place/123/home',mid:'123',program_type:program,daily_shots:100,operation_days:10,price_per_shot:20,supply_amount:20000,vat_amount:2000,total_amount:22000,start_date:'2099-01-10',end_date:'2099-01-19',status:i===0?'구동중':'입금대기',memo:'',lock_version:1,created_at:'2026-10-01T10:00:00Z',updated_at:'2026-10-01T10:00:00Z',archived_at:null})));
export const isSupabaseConfigured=true;export const supabase={rpc:async(name,args)=>{
 window.calls.push({name,args:structuredClone(args)});
 if(name==='get_order_start_restrictions_v1012')return {data:[],error:null};
 if(name==='get_order_page_v1011'){
 const rows=window.orders.filter(o=>o.program_type===args.p_program_type&&Boolean(o.archived_at)===args.p_archived&&(!args.p_query||o.store_name.includes(args.p_query))&&(!args.p_status||o.status===args.p_status));
 return {data:{rows:rows.slice((args.p_page-1)*50,args.p_page*50),totalCount:rows.length,totalPages:Math.max(1,Math.ceil(rows.length/50)),page:args.p_page,pageSize:50,counts:{'전체':rows.length},revision:String(window.refreshes)},error:null};}
 if(name==='preview_admin_order_lifecycle_v1014'){
 if(window.previewFailure)return {data:null,error:{message:'검색 결과가 500건을 초과합니다. 기간이나 상태를 좁혀 주세요.'}};
 const rows=window.orders.filter(o=>args.p_filters.programs.includes(o.program_type)&&(args.p_order_ids?args.p_order_ids.includes(o.order_number):Boolean(o.archived_at)===(args.p_action!=='archive')));
 return {data:{items:rows.map(o=>({id:o.id,orderNumber:o.order_number,storeName:o.store_name,programType:o.program_type,status:o.status,version:o.lock_version,waitingAmount:22000,eligible:!(args.p_action==='delete'&&o.status==='구동중'),reason:args.p_action==='delete'&&o.status==='구동중'?'구동 이력이 있습니다.':'',fingerprint:'a'.repeat(32)}))},error:null};}
 if(name==='apply_admin_order_lifecycle_v1014'){
 let result=receipts.get(args.p_request_id);
 if(!result){result={requestId:args.p_request_id,results:args.p_items.map((item,i)=>({id:item.id,success:i!==1,reason:i===1?'다른 관리자가 처리 중입니다. 다시 확인해 주세요.':''}))};
 for(const r of result.results.filter(r=>r.success)){const o=window.orders.find(o=>o.id===r.id);if(args.p_action==='delete')window.orders=window.orders.filter(o=>o.id!==r.id);else o.archived_at=args.p_action==='archive'?'2026-10-06T00:00:00Z':null;}
 receipts.set(args.p_request_id,result);}
 if(window.loseResponse){window.loseResponse=false;throw new Error('lost response');}return {data:result,error:null};}
 return {data:[],error:null};
},channel:()=>({on(){return this},subscribe(fn){if(fn)setTimeout(()=>fn('SUBSCRIBED'),0);return this}}),removeChannel:async()=>{}};`
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:source},bundle:true,platform:'browser',format:'esm',outfile:path.join(out,'app.js'),plugins:[{name:'mock',setup(b){b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:mock,loader:'js'}))}}]})
fs.copyFileSync('src/styles.css',path.join(out,'style.css'))
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>')
console.log('Built isolated lifecycle browser fixture:',out)
