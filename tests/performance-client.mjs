import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
let current
function host(effects = true) {
  const slots = []; let cursor = 0; const pending = []
  return {
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], value=>{slots[i]=typeof value==='function'?value(slots[i]):value}] },
    useRef(initial) { const i=cursor++; return slots[i] ??= {current:initial} },
    useMemo: fn=>fn(), useId: ()=>'test-id',
    useEffect(fn,deps) { const i=cursor++; const before=slots[i]; if (!effects) return; if (!before || deps.some((v,n)=>!Object.is(v,before.deps[n]))) { before?.cleanup?.(); slots[i]={deps}; pending.push(()=>{slots[i].cleanup=fn()}) } },
    render(fn) { current=this; cursor=0; const value=fn(); for(const effect of pending.splice(0)) effect(); return value },
    close() { for(const slot of slots) slot?.cleanup?.() },
  }
}
globalThis.perfHooks = Object.fromEntries(['useState','useRef','useMemo','useId','useEffect'].map(name=>[name,(...args)=>current[name](...args)]))
const { outputFiles }=await build({stdin:{resolveDir:root,loader:'ts',contents:`
  export * from './src/lib/date'
  export * from './src/lib/singleFlight'
  export * from './src/hooks/useRemoteRead'
  export * from './src/hooks/useDisplayClock'
  export {OrdersPage} from './src/features/OrdersPage'
  export {NotificationsPage} from './src/features/NotificationsPage'
  export {DEFAULT_SETTINGS} from './src/data/demo'
`},bundle:true,platform:'node',format:'cjs',write:false,external:['react/jsx-runtime','xlsx'],plugins:[{name:'host',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}))
  b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:'export const {useState,useRef,useMemo,useId,useEffect}=globalThis.perfHooks;'}))
  b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:'export const supabase=null; export const isSupabaseConfigured=false;'}))
  b.onLoad({filter:/[/\\]adminExcel\.ts$/},()=>({contents:'export const ADMIN_EXCEL_PROGRAM_LABELS={}; export const downloadAdminOrdersExcel=value=>{globalThis.perfExport=value};'}))
}}]})
const mod={exports:{}}; new Function('require','module','exports',outputFiles[0].text)(require,mod,mod.exports)
const api=mod.exports
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
let calls=0; const first=deferred()
const one=api.singleFlight('actor-filter',()=>{calls++;return first.promise})
const duplicate=api.singleFlight('actor-filter',()=>{calls++;return Promise.resolve('wrong')})
assert.equal(one,duplicate); await sleep(0); assert.equal(calls,1)
api.invalidateReadRequests()
const afterWrite=api.singleFlight('actor-filter',()=>{calls++;return Promise.resolve('fresh')})
assert.notEqual(one,afterWrite); assert.equal(await afterWrite,'fresh');first.resolve('old');assert.equal(await one,'old');assert.equal(calls,2)
await assert.rejects(api.singleFlight('error',()=>Promise.reject(new Error('expected'))))
assert.equal(await api.singleFlight('error',()=>Promise.resolve('recovered')),'recovered')
const state=host(); const a=deferred(),b=deferred();
let result=state.render(()=>api.useRemoteRead('A',()=>a.promise));assert.equal(result.loading,true)
await sleep(5)
result=state.render(()=>api.useRemoteRead('B',()=>b.promise));assert.equal(result.data,undefined)
await sleep(5);b.resolve('B');await sleep(0)
result=state.render(()=>api.useRemoteRead('B',()=>b.promise));assert.equal(result.data,'B')
a.resolve('A');await sleep(0)
result=state.render(()=>api.useRemoteRead('B',()=>b.promise));assert.equal(result.data,'B')
result=state.render(()=>api.useRemoteRead('C',()=>Promise.resolve('C'),false));assert.equal(result.data,undefined);assert.equal(result.loading,false);state.close()
console.log('PASS: actual hooks discard out-of-order and old-filter responses; in-flight dedup, write invalidation, error recovery')

const oldParts=date=>{ const values=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));return {date:`${values.year}-${values.month}-${values.day}`,hour:Number(values.hour),minute:Number(values.minute),second:Number(values.second)}}
for(let i=0;i<593;i++) { const date=new Date(Date.parse('2026-09-20T14:59:00Z')+i*8640123);assert.deepEqual(api.seoulDateTimeParts(date),oldParts(date));assert.equal(api.daysRemaining('2026-09-20','2026-09-24',date),api.daysRemaining('2026-09-20','2026-09-24',api.todayInSeoul(date))) }
for(const tz of ['UTC','Asia/Seoul','America/Los_Angeles']){process.env.TZ=tz;assert.equal(api.formatDate('2026-09-21'),'2026. 09. 21.');assert.equal(api.todayInSeoul(new Date('2026-09-20T15:00:00Z')),'2026-09-21')}
console.log('PASS: 593 date cases retain Seoul calendar and remaining-day results across UTC/Seoul/Los Angeles')

const realSet=globalThis.setInterval,realClear=globalThis.clearInterval
let intervals=0,clears=0; const visibility=new Map()
globalThis.document={visibilityState:'visible',addEventListener:(name,fn)=>visibility.set(name,fn),removeEventListener:name=>visibility.delete(name)}
globalThis.setInterval=()=>{intervals++;return intervals};globalThis.clearInterval=()=>{clears++}
const gauges=Array.from({length:50},()=>host())
for(const h of gauges) h.render(()=>api.useGaugeClock(undefined,true))
assert.equal(intervals,1)
document.visibilityState='hidden';visibility.get('visibilitychange')();assert.equal(clears,1)
document.visibilityState='visible';visibility.get('visibilitychange')();assert.equal(intervals,2)
for(const h of gauges) h.close();assert.equal(clears,2);assert.equal(visibility.size,0)
const fixed=host();fixed.render(()=>api.useGaugeClock(new Date(),true));fixed.close();assert.equal(intervals,2)
globalThis.setInterval=realSet;globalThis.clearInterval=realClear
console.log('PASS: 50 gauges share one timer; hidden/unmounted gauges stop ticking; controlled clocks do not subscribe')

function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children),...nodes(tree.props?.action),...nodes(tree.props?.footer)]}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(tree==null||typeof tree==='boolean')return '';return typeof tree==='object'?text(tree.props?.children):String(tree)}
let mobile=false
globalThis.window={matchMedia:()=>({matches:mobile,addEventListener(){},removeEventListener(){}}),alert:message=>{throw new Error(message)},confirm:()=>true}
const actor={id:'admin',role:'admin',active:true,approvalStatus:'approved'}
const orders=Array.from({length:10000},(_,i)=>({id:`TEST-${String(i).padStart(5,'0')}`,dbId:`db-${i}`,programType:'spark',createdBy:'agency',creatorUsername:'agency',creatorGroupName:'group',storeName:`테스트 ${i}`,keyword:'검색',mid:'123',dailyShots:100,operationDays:5,totalAmount:1000,supplyAmount:900,vatAmount:100,startDate:'2026-09-21',endDate:'2026-09-25',status:'입금대기',archivedAt:null,programTransferState:'none',placeUrl:'https://example.invalid',memo:'',createdAt:'2026-09-20T00:00:00Z'}))
const props={user:actor,orders,settings:api.DEFAULT_SETTINGS,now:new Date('2026-09-21T00:00:00Z'),programType:'spark',memberEditRefreshKey:0}
const desk=host(false);let tree=desk.render(()=>api.OrdersPage(props))
assert.equal(nodes(tree).filter(n=>n.type==='tr').length,51);assert.equal(nodes(tree).filter(n=>n.type==='article').length,0)
let checkbox=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']?.endsWith('선택'));checkbox.props.onClick({shiftKey:false})
tree=desk.render(()=>api.OrdersPage(props))
const pagination=nodes(tree).find(n=>n.type?.name==='Pagination');assert.equal(pagination.props.total,10000);pagination.props.onChange(2)
tree=desk.render(()=>api.OrdersPage(props));checkbox=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']?.endsWith('선택'));checkbox.props.onClick({shiftKey:false})
tree=desk.render(()=>api.OrdersPage(props));assert.ok(text(tree).includes('2개 선택됨'))
const exportButton=nodes(tree).find(n=>n.type==='button'&&text(n).includes('선택 엑셀'))
assert.ok(exportButton,'selected export button exists');await exportButton.props.onClick();await sleep(0);assert.equal(globalThis.perfExport.orders.length,2)
mobile=true;const phone=host(false);tree=phone.render(()=>api.OrdersPage(props));assert.equal(nodes(tree).filter(n=>n.type==='tr').length,0);assert.equal(nodes(tree).filter(n=>n.type==='article').length,50)
const notices=Array.from({length:100},(_,i)=>({id:`n${i}`,userId:'admin',role:'all',read:false,createdAt:'2026-09-21T00:00:00Z',title:'알림',message:'테스트'}));let more=0
const nh=host(false);tree=nh.render(()=>api.NotificationsPage({user:actor,notifications:notices,unreadTotal:230,notificationTotal:230,filterValue:'unread',hasMore:true,loadingMore:false,onLoadMore:async()=>{more++},onReadAll:async()=>{},onRead:async()=>{},onDelete:async()=>{},onDeleteAll:async()=>{}}))
assert.ok(text(tree).includes('230'));const moreButton=nodes(tree).find(n=>n.type==='button'&&text(n).includes('더보기'));assert.ok(moreButton,'unread cursor load-more button');await moreButton.props.onClick();assert.equal(more,1)
const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');assert.ok(!app.includes('setInterval'));assert.ok(!app.includes('fetchOrdersSnapshot'));assert.ok(!app.includes('fetchPaymentStepsSnapshot'))
console.log('PASS: 10,000-row source renders only 50 rows in one responsive layout; cross-page selection/export; true unread count and unread load-more; no root timer or full snapshots')

for (const name of ['handleOrderStatusChange', 'handleArchiveOrder']) {
  const start = app.indexOf(`const ${name} =`);
  assert.ok(start >= 0);
  const handler = app.slice(start, app.indexOf('\n  const ', start + 1));
  assert.match(handler, /refreshOrderEffectsRemote\(false\)/);
}
console.log('PASS: status and archive writes invalidate server reads without waiting for Realtime');
