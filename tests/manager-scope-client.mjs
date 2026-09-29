import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
let current
function host(effects=true) {
 const slots=[]; let index=0; const pending=[]
 const changed=(a,b)=>!a || b.some((v,i)=>!Object.is(v,a[i]))
 return {
  useId(){return 'scope-test-id'},
  useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]},
  useRef(value){return slots[index++]??={current:value}},
  useMemo(fn,deps){const i=index++;if(changed(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value},
  useCallback(fn,deps){return this.useMemo(()=>fn,deps)},
  useEffect(fn,deps){const i=index++;if(effects&&changed(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};pending.push(()=>slots[i].cleanup=fn())}},
  render(fn){current=this;index=0;const tree=fn();for(const e of pending.splice(0))e();return tree},
  close(){for(const s of slots)s?.cleanup?.()},
 }
}
globalThis.scopeHooks=Object.fromEntries(['useId','useState','useRef','useMemo','useCallback','useEffect'].map(n=>[n,(...args)=>current[n](...args)]))
globalThis.scopeRpc=()=>Promise.resolve({data:'a'.repeat(32),error:null})
const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
 export * from './src/lib/managerScope';export * from './src/lib/managedOrdersLocal';
 export * from './src/hooks/useManagerReadRevision';export * from './src/features/ManagerDashboard';
 export * from './src/features/ManagedOrdersPage';export * from './src/features/AgencyFoldersPage';
 export * from './src/lib/managedOrdersExcel';
`},bundle:true,platform:'node',format:'cjs',write:false,external:['react/jsx-runtime','xlsx'],plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const {useId,useState,useRef,useMemo,useCallback,useEffect}=globalThis.scopeHooks'}))
 b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:`export const isSupabaseConfigured=true; export const supabase={rpc:()=>({abortSignal:signal=>globalThis.scopeRpc(signal)})}` }))
}}]})
const module={exports:{}};new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports)
const api=module.exports
const manager={id:'manager',role:'agency',isOperationsManager:true,active:true,approvalStatus:'approved'}
const member=(id,sponsorId=null,managerId=null)=>({id,username:id,role:'agency',isOperationsManager:false,approvalStatus:'approved',active:true,sponsorId,managerId,groupName:`group_${id}`})
const members=[member('a',null,'manager'),member('b','a'),member('c','b'),member('foreign','c','other'),member('excluded','foreign'),member('reentry','excluded','manager'),member('under','reentry'),member('overlap','a','manager'),member('outside'),member('cycleA','cycleB','manager'),member('cycleB','cycleA')]
members[1].active=false;members[1].approvalStatus='rejected'
const expected=['a','b','c','reentry','under','overlap','cycleA','cycleB']
assert.deepEqual(new Set(api.managerScopeMembers(manager,members).map(m=>m.id)),new Set(expected))
for(const user of [{...manager,active:false},{...manager,approvalStatus:'pending'},{...manager,isOperationsManager:false}]) assert.deepEqual(api.managerScopeMembers(user,members),[])
const rows=members.map((m,i)=>({id:`ORDER-${i}`,dbId:`id-${i}`,createdBy:m.id,creatorUsername:m.username,programType:'spark',storeName:`store_${m.id}`,keyword:'test',mid:'123',placeUrl:'https://example.invalid',dailyShots:10,operationDays:7,pricePerShot:20,supplyAmount:1400,vatAmount:140,totalAmount:1540,startDate:'2099-01-01',endDate:'2099-01-07',status:'입금대기',programTransferState:'none',createdAt:'2026-09-29T04:26:56Z',archivedAt:null}))
const before=JSON.stringify([members,rows])
const scoped=api.localManagedRows(manager,members,rows,[])
assert.deepEqual(new Set(scoped.map(r=>r.registrantId)),new Set(expected))
assert.equal(api.filterLocalRows(scoped,{...api.EMPTY_FILTERS,agencyId:'c',query:'group_c'}).length,1)
assert.equal(JSON.stringify([members,rows]),before,'read resolver does not mutate sponsor/manager/order data')
const props={user:manager,members,orders:rows,paymentSteps:[],notices:[],serverMode:false,refreshKey:0,onNavigate(){},onOpenManagedOrders(){}}
function nodes(t){if(Array.isArray(t))return t.flatMap(nodes);if(!t||typeof t!=='object')return [];return [t,...nodes(t.props?.children),...nodes(t.props?.action)]}
function text(t){return Array.isArray(t)?t.map(text).join(''):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.props?.children):String(t)}
const dash=host(false);const tree=dash.render(()=>api.ManagerDashboard(props))
assert.ok(text(tree).includes('하위 포함'))
const cards=nodes(tree).filter(n=>n.props?.className==='manager-agency-card')
assert.equal(cards.length,expected.length)
assert.ok(cards.some(c=>text(c).includes('대행사c전체')))
assert.ok(!cards.some(c=>text(c).includes('foreign')))
const pause=()=>new Promise(r=>setTimeout(r,0))
const folderHost=host();folderHost.render(()=>api.AgencyFoldersPage(props));await pause()
let ft=folderHost.render(()=>api.AgencyFoldersPage(props))
const panels=nodes(ft).filter(n=>n.type===api.AgencyFolderPanel)
assert.equal(panels.length,expected.length)
assert.ok(panels.every(p=>expected.includes(p.props.agency.agencyId)))
assert.ok(panels.every(p=>p.props.refreshKey===0),'refresh revision reaches open folder cache')
// Reassignment changes the scope without writing descendant manager IDs.
const reassigned=members.map(m=>m.id==='a'?{...m,managerId:'other'}:m)
assert.ok(!api.managerScopeMembers(manager,reassigned).some(m=>m.id==='c'))
assert.ok(api.managerScopeMembers(manager,reassigned).some(m=>m.id==='under'))
folderHost.close()
// Actual full-list and selected export use the same scoped rows.
const wrapper=host();let view=wrapper.render(()=>api.ManagedOrdersPage(props))
nodes(view).find(n=>n.type==='button'&&text(n)==='전체 작업 보기').props.onClick()
view=wrapper.render(()=>api.ManagedOrdersPage(props))
const allPage=nodes(view).find(n=>typeof n.type==='function'&&n.type.name==='AllManagedOrdersPage')
assert.ok(allPage)
const listHost=host();listHost.render(()=>allPage.type(allPage.props));await pause()
let list=listHost.render(()=>allPage.type(allPage.props))
const table=nodes(list).find(n=>typeof n.type==='function'&&n.type.name==='ManagedOrdersTable')
assert.equal(table.props.rows.length,expected.length)
assert.ok(table.props.showCreatedAt,'previous intake timestamp feature stays on')
table.props.toggleRow(table.props.rows.find(r=>r.registrantId==='c'))
list=listHost.render(()=>allPage.type(allPage.props))
assert.equal(nodes(list).find(n=>typeof n.type==='function'&&n.type.name==='ManagedOrdersTable').props.selected.size,1)
listHost.close();wrapper.close()
console.log('PASS: actual manager dashboard/folders/all-work use descendant read scope; search/selection, own-folder counts, timestamps and assignment boundaries; no mutations')

const events=new Map();let interval;let intervalCount=0;let cleared=0;let calls=0;let invalidations=0
const listeners=(target)=>({addEventListener:(n,fn)=>events.set(`${target}:${n}`,fn),removeEventListener:n=>events.delete(`${target}:${n}`)})
globalThis.document={visibilityState:'visible',...listeners('doc')};globalThis.window={...listeners('win')}
const realSet=globalThis.setInterval,realClear=globalThis.clearInterval
globalThis.setInterval=(fn,ms)=>{assert.equal(ms,30000);interval=fn;return ++intervalCount};globalThis.clearInterval=()=>cleared++
let result={data:'a'.repeat(32),error:null};let signal
globalThis.scopeRpc=s=>{calls++;signal=s;return Promise.resolve(result)}
const invalidate=()=>invalidations++
const disabled=host();disabled.render(()=>api.useManagerReadRevision('manager',false,invalidate));assert.equal(calls,0);disabled.close()
const h=host();h.render(()=>api.useManagerReadRevision('manager',true,invalidate));await pause();assert.equal(calls,1);assert.equal(invalidations,0)
interval();await pause();assert.equal(invalidations,0)
result={data:'b'.repeat(32),error:null};interval();await pause();assert.equal(invalidations,1)
document.visibilityState='hidden';interval();await pause();assert.equal(calls,3)
document.visibilityState='visible';events.get('doc:visibilitychange')();await pause();assert.equal(calls,4)
result={data:null,error:new Error('denied')};interval();await pause();assert.equal(invalidations,2)
interval();await pause();assert.equal(invalidations,2,'repeated failure does not force repeated full reload')
result={data:'b'.repeat(32),error:null};events.get('win:online')();await pause();assert.equal(invalidations,3)
let complete;globalThis.scopeRpc=s=>{calls++;signal=s;return new Promise(r=>complete=r)}
interval();await pause();const pendingCalls=calls;interval();assert.equal(calls,pendingCalls,'no overlapping requests')
h.close();assert.equal(signal.aborted,true);complete({data:'c'.repeat(32),error:null});await pause();assert.equal(invalidations,3)
assert.equal(cleared,1);assert.equal(events.size,0)
globalThis.setInterval=realSet;globalThis.clearInterval=realClear
const app=fs.readFileSync('src/App.tsx','utf8');assert.ok(!app.includes('setInterval'));assert.match(app,/page === 'dashboard' \|\| page === 'managedOrders'/)
const membersPage=fs.readFileSync('src/features/MembersPage.tsx','utf8');assert.ok(!membersPage.includes('managerScopeMembers'),'approval and price-edit scopes are not expanded')
console.log('PASS: visible-manager-only revision checks; no snapshot downloads/root timer; unchanged revisions do not rerender; failure/recovery; hidden/unmounted cleanup and request sharing')
