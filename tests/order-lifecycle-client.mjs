import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
const {outputFiles}=await build({entryPoints:['src/lib/orderLifecycle.ts'],bundle:true,platform:'node',format:'cjs',write:false,
  plugins:[{name:'mock',setup(b){b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:'export const supabase={rpc:(...args)=>globalThis.testRpc(...args)}',loader:'js'}))}}]})
const m={exports:{}};new Function('require','module','exports',outputFiles[0].text)(createRequire(import.meta.url),m,m.exports)
const {previewLifecycle,lifecycleRequest,applyLifecycle,lifecycleError}=m.exports
const items=[{id:'one',version:3,fingerprint:'a'.repeat(32),eligible:true,waitingAmount:100},{id:'two',eligible:false,reason:'처리 이력',waitingAmount:200,fingerprint:'b'.repeat(32)}]
globalThis.testRpc=async(name,args)=>{assert.equal(name,'preview_admin_order_lifecycle_v1014');assert.equal(args.p_order_ids,null);return {data:{items},error:null}}
assert.deepEqual(await previewLifecycle('archive',{programs:['spark']},null),items)
for(const [action,reason,confirmation] of [['archive','a','확인'],['delete','테스트','확인']])assert.throws(()=>lifecycleRequest(action,items,reason,confirmation))
const request=lifecycleRequest('archive',items,'정리 사유','확인')
assert.deepEqual(request.p_items,[{id:'one',version:3,fingerprint:'a'.repeat(32)}])
let first=true;const calls=[]
globalThis.testRpc=async(name,args)=>{calls.push(structuredClone(args));if(first){first=false;throw new Error('network disconnected')}return {data:{requestId:args.p_request_id,results:[{id:'one',success:true,reason:''}]},error:null}}
await assert.rejects(applyLifecycle(request));assert.equal((await applyLifecycle(request)).results[0].success,true);assert.deepEqual(calls[0],calls[1])
globalThis.testRpc=async()=>({data:{requestId:request.p_request_id,results:[]},error:null})
await assert.rejects(applyLifecycle(request),/응답/)
assert.ok(!lifecycleError({message:'SQL relation secret_table 오류'}).includes('secret_table'))
assert.equal(lifecycleError({message:'검색 결과가 500건을 초과합니다.'}),'검색 결과가 500건을 초과합니다.')
console.log('PASS lifecycle client: exact selection, eligible subset, confirmation, identical retry payload, malformed response and safe errors')
