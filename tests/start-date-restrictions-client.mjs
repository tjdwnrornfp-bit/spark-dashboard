import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url), root=fileURLToPath(new URL('..',import.meta.url))
let hostCurrent
function host(){const slots=[];let i=0;return {useState(initial){const n=i++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],v=>{slots[n]=typeof v==='function'?v(slots[n]):v}]},useRef(value){return slots[i++]??={current:value}},useEffect(){i++},useId(){return 'id'},useMemo(fn){return fn()},render(fn){hostCurrent=this;i=0;return fn()}}}
globalThis.blackoutHooks=Object.fromEntries(['useState','useRef','useEffect','useMemo','useId'].map(n=>[n,(...a)=>hostCurrent[n](...a)]))
let rules=[],rpcError=null,rpcDataOverride=undefined,requests=0
const client={rpc:async(name,args)=>{requests++;return {data:rpcDataOverride!==undefined?rpcDataOverride:rules,error:rpcError}}}
globalThis.blackoutClient=client
const result=await build({stdin:{resolveDir:root,loader:'ts',contents:`
export * from './src/lib/startDateRestrictions'
export {validateDraft} from './src/lib/order'
export {StartDateInput} from './src/components/StartDateInput'
export {AppShell} from './src/components/AppShell'
`},bundle:true,platform:'node',format:'cjs',write:false,external:['react/jsx-runtime'],plugins:[{name:'harness',setup(b){
b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:'export const {useState,useRef,useEffect,useMemo,useId}=globalThis.blackoutHooks'}));
b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:'export const supabase=globalThis.blackoutClient; export const isSupabaseConfigured=true;'}));
}}]})
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);const api=mod.exports
const rule={id:'test',startDate:'2099-01-10',endDate:'2099-01-12',reason:'연휴 테스트',enabled:true,version:1,updatedAt:'2026-09-23T00:00:00Z'};rules=[rule]
for(const date of ['2099-01-10','2099-01-11','2099-01-12'])assert.match(api.startDateRestrictionError(date,rules),/접수 제한 기간/)
for(const date of ['2099-01-09','2099-01-13'])assert.equal(api.startDateRestrictionError(date,rules),'')
assert.equal(api.startDateRestrictionError(rule.startDate,rules,rule.startDate),'')
assert.match(api.startDateRestrictionError(rule.startDate,undefined),/확인하지 못했/)
assert.equal(api.startDateRestrictionError(rule.startDate,undefined,rule.startDate),'')
assert.equal(api.startDateRestrictionError(rule.startDate,[{...rule,enabled:false}]),'')
assert.equal(api.restrictedRowErrors([{startDate:rule.startDate,storeName:'업체A'},{startDate:'2099-01-13'}],rules,[8,10]).length,1)
assert.match(api.restrictedRowErrors([{startDate:rule.startDate,storeName:'업체A'}],rules,[8])[0],/8행 · 업체A/)
assert.deepEqual(await api.fetchStartDateRestrictions(),rules)
await assert.rejects(api.assertAllowedStartDates([{startDate:rule.endDate}]),/접수 제한 기간/)
await api.assertAllowedStartDates([{startDate:'2099-01-13'}])
const before=requests;await api.assertAllowedStartDates([{startDate:rule.startDate}],rule.startDate);assert.equal(requests,before,'unchanged-date edits do not require policy loading')
rpcError={message:'network failed'};await assert.rejects(api.assertAllowedStartDates([{startDate:'2099-01-13'}]));rpcError=null
rpcDataOverride=null;await assert.rejects(api.fetchStartDateRestrictions(),/올바르지/)
rpcDataOverride=[{...rule,enabled:'true'}];await assert.rejects(api.fetchStartDateRestrictions(),/올바르지/);rpcDataOverride=undefined
const draft={programType:'spark',placeUrl:'https://m.place.naver.com/place/123/home',storeName:'테스트',keyword:'키워드',dailyShots:'100',operationDays:'10',startDate:rule.startDate,memo:''}
assert.match(api.validateDraft(draft,new Date('2099-01-01T00:00:00Z'),rules).startDate,/접수 제한 기간/)
assert.match(api.validateDraft({...draft,startDate:'2099-02-30'},new Date('2099-01-01T00:00:00Z'),rules).startDate,/시작일/)
function nodes(t){if(Array.isArray(t))return t.flatMap(nodes);if(!t||typeof t!=='object')return [];return [t,...nodes(t.props?.children)]}
function text(t){if(Array.isArray(t))return t.map(text).join('');if(t===null||t===undefined||typeof t==='boolean')return '';return typeof t==='object'?text(t.props?.children):String(t)}
const state={rules,loading:false,error:'',reload(){}}
let selected='';const h=host();const props={value:'2099-01-09',onChange:d=>selected=d,restrictions:state,min:'2099-01-02'}
let tree=h.render(()=>api.StartDateInput(props));nodes(tree).find(n=>n.type==='button'&&n.props['aria-expanded']===false).props.onClick()
tree=h.render(()=>api.StartDateInput(props));for(const date of ['2099-01-10','2099-01-11','2099-01-12'])assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']===date).props.disabled,true)
const allowed=nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']==='2099-01-13');assert.equal(allowed.props.disabled,false);allowed.props.onClick();assert.equal(selected,'2099-01-13')
const sh=host();globalThis.window={};
for(const [role,manager,expected] of [['admin',false,true],['agency',false,false],['distributor',false,false],['agency',true,false]]){
 tree=sh.render(()=>api.AppShell({user:{id:'u',role,isOperationsManager:manager},page:'dashboard',unreadCount:0,serverMode:true,children:null,onNavigate(){},onLogout(){}}));assert.equal(text(tree).includes('접수 제한 설정'),expected)
}
console.log('PASS: inclusive/overlap/disabled rules; explicit original-date grandfathering; Excel row numbers; API errors and malformed responses fail closed; validation; real calendar component disables dates; admin-only navigation')
