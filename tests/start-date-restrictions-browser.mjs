// Isolated browser fixture. No production URL, credential, or mutation is used.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { utils, write } from 'xlsx'
const out=process.env.BLACKOUT_UI_DIR || '/mnt/data/blackout-ui'
fs.mkdirSync(out,{recursive:true})
const source=`
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {StartDateRestrictionsPage} from './src/features/StartDateRestrictionsPage';
import {OrdersPage} from './src/features/OrdersPage';
import {AdminBulkOrderAssignmentModal} from './src/features/AdminBulkOrderAssignmentModal';
import {MemberOrderEditModal} from './src/features/MemberOrderEditModal';
import {StartDateInput,StartDateRestrictionNotice} from './src/components/StartDateInput';
import {useStartDateRestrictions} from './src/hooks/useStartDateRestrictions';
import {DEMO_USERS,DEFAULT_SETTINGS} from './src/data/demo';
const admin={...DEMO_USERS.find(u=>u.role==='admin'),id:'admin'};
const member={...DEMO_USERS.find(u=>u.username==='agency1'),id:'member',username:'agency1'};
window.fixtureCalls=[];
const old={id:'OLD-1',dbId:'old',createdBy:'member',creatorUsername:'agency1',storeName:'기존작업',keyword:'키워드',placeUrl:'https://m.place.naver.com/place/123/home',mid:'123',programType:'spark',dailyShots:100,operationDays:10,pricePerShot:20,startDate:'2099-01-10',endDate:'2099-01-19',status:'입금대기',memo:'',lockVersion:1,totalAmount:22000};
function Calendar(){const restrictions=useStartDateRestrictions();const [date,setDate]=useState('2099-01-09');return <section className='panel restriction-editor'><StartDateRestrictionNotice state={restrictions}/><StartDateInput value={date} onChange={setDate} min='2099-01-01' restrictions={restrictions}/></section>}
function App(){const [tab,setTab]=useState('admin');return <main className='fixture-main'><nav className='fixture-nav'>{['admin','calendar','intake','adminExcel','edit'].map(t=><button key={t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
{tab==='admin'&&<StartDateRestrictionsPage user={admin}/>}{tab==='calendar'&&<Calendar/>}
{tab==='intake'&&<OrdersPage user={member} orders={[]} settings={DEFAULT_SETTINGS} now={new Date()} programType='spark' memberEditRefreshKey={0} onCreateOrder={async(d)=>{window.fixtureCalls.push(d);return {...old,startDate:d.startDate}}} onCreateOrdersBulk={async(d)=>{window.fixtureCalls.push(d);return d.map(x=>({...old,startDate:x.startDate}))}}/>}
{tab==='adminExcel'&&<AdminBulkOrderAssignmentModal onLoadMembers={async()=>[member]} onAssign={async(rows)=>{window.fixtureCalls.push(rows);return []}} onClose={()=>setTab('admin')}/>}
{tab==='edit'&&<MemberOrderEditModal order={old} programOnly={false} onPreview={async(o,d)=>{window.fixtureCalls.push(d);return {allowed:true,before:{},after:{program_type:'spark'},financialImpact:'financial_neutral',differenceAmount:0}}} onApply={async()=>old} onClose={()=>setTab('admin')}/>}
</main>};createRoot(document.getElementById('root')).render(<App/>);
`
const mock=`
window.fixtureRules=[];window.fixtureFailure=false;
export const isSupabaseConfigured=true;
export const supabase={rpc:async(name,args)=>{
 if(name==='get_order_start_restrictions_v1012')return window.fixtureFailure?{data:null,error:{message:'테스트 연결 오류'}}:{data:window.fixtureRules.filter(r=>args.p_admin||r.enabled),error:null};
 if(name==='preview_order_start_restriction_v1012')return {data:{existingCount:2,waitingCount:1,runningCount:1},error:null};
 if(name==='save_order_start_restriction_v1012'){
 const r={id:args.p_id,startDate:args.p_start_date,endDate:args.p_end_date,reason:args.p_reason,enabled:args.p_enabled,version:args.p_expected_version+1,updatedAt:new Date().toISOString()};
 window.fixtureRules=window.fixtureRules.filter(x=>x.id!==r.id).concat(r);return {data:r,error:null};}
 if(name==='get_order_page_v1011')return {data:{rows:[],totalCount:0,totalPages:1,page:1,pageSize:50,counts:{'전체':0},revision:''},error:null};
 return {data:[],error:null};
},channel:()=>({on(){return this},subscribe(fn){if(fn)setTimeout(()=>fn('SUBSCRIBED'),0);return this}}),removeChannel:async()=>{}};
`
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:source},bundle:true,platform:'browser',format:'esm',outfile:path.join(out,'app.js'),plugins:[{name:'mock',setup(b){b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:mock,loader:'js'}))}}]})
fs.copyFileSync('src/styles.css',path.join(out,'style.css'))
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>.fixture-main{max-width:1100px;margin:20px auto;padding:12px}.fixture-nav{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}</style><div id="root"></div><script type="module" src="/app.js"></script></html>`)
for(const admin of [false,true])for(const blocked of [false,true]){
 const book=utils.book_new();const headers=admin?['등록자아이디','프로그램','상호명','대표키워드','플레이스URL','일일수량','구동일수','시작일','메모']:['상호명','대표키워드','플레이스URL','일일수량','구동일수','시작일','메모'];
 const row=(date)=>[...(admin?['agency1','스파크']:[]),'엑셀테스트','키워드','https://m.place.naver.com/place/123/home',100,10,date,''];
 utils.book_append_sheet(book,utils.aoa_to_sheet([headers,row('2099-01-13'),row(blocked?'2099-01-11':'2099-01-14')]),'접수');fs.writeFileSync(path.join(out,`${admin?'admin':'member'}-${blocked?'blocked':'allowed'}.xlsx`),write(book,{type:'buffer',bookType:'xlsx'}));
}
console.log('Browser fixture built:',out)
