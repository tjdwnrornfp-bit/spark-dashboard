import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/lib/monthlySettlement';export * from './src/lib/monthlySettlementExcel'"},bundle:true,platform:'node',format:'cjs',write:false,external:['xlsx'],plugins:[{name:'rpc',setup(b){b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({contents:'export const supabase={rpc:(...args)=>globalThis.monthlyRpc(...args)}'}))}}]})
const module={exports:{}};new Function('require','module','exports',outputFiles[0].text)(createRequire(import.meta.url),module,module.exports)
const {fetchMonthlyExport,saveMonthlySettlement,validateMonthlyResult,shiftMonth,monthlyWorkbook}=module.exports
const total={count:102,totalAmount:10200,confirmedAmount:5100,waitingAmount:5100,confirmationAmount:0,reversalAmount:0}
const rows=Array.from({length:102},(_,i)=>({id:String(i),orderNumber:'ORDER-'+i,groupName:'그룹',username:'agency',storeName:i===0?'=1+1':'상호',program:'spark',startDate:'2001-09-01',amount:100,confirmedAt:i%2?'2001-09-01T01:00:00Z':null,stepKind:'standard',archived:false}))
const template={month:'2001-09-01',mode:'work',asOf:'2001-10-01T01:00:00Z',revision:'a'.repeat(32),summary:total,liveTotals:{work:total,receipts:total},companies:[],rows:[],totalCount:102,page:1,totalPages:3,trend:Array.from({length:12},()=>({month:'2001-09-01',amount:0})),snapshots:[]}
const params={month:'2001-09',mode:'work',program:'',query:'그룹'};const calls=[]
globalThis.monthlyRpc=async(name,args)=>{calls.push(args);return {data:{...template,page:args.p_page,rows:rows.slice((args.p_page-1)*50,args.p_page*50)},error:null}}
const out=await fetchMonthlyExport(params);assert.equal(out.rows.length,102);assert.equal(calls[1].p_expected_revision,template.revision);assert.equal(calls[0].p_query,'그룹')
const book=monthlyWorkbook(params,out.result,out.rows);assert.equal(book.Sheets['상세 내역'].H2.t,'n');assert.equal(book.Sheets['상세 내역'].D2.t,'s');assert.equal(book.Sheets['상세 내역'].D2.f,undefined);assert.equal(book.Sheets['요약'].B8.v,10200)
globalThis.monthlyRpc=async(name,args)=>({data:{...template,page:args.p_page,revision:args.p_page===1?template.revision:'b'.repeat(32),rows:rows.slice((args.p_page-1)*50,args.p_page*50)},error:null})
await assert.rejects(fetchMonthlyExport(params),/변경/)
assert.throws(()=>validateMonthlyResult({...template,summary:{...total,totalAmount:Infinity}}),/응답/)
assert.equal(shiftMonth('2026-01',-1),'2025-12');assert.equal(shiftMonth('2026-12',1),'2027-01')
const request={month:'2001-09',requestId:'req',revision:template.revision,reason:'검토 완료'};let lost=true;const saves=[]
globalThis.monthlyRpc=async(name,args)=>{saves.push(args);if(lost){lost=false;throw Error('lost response')}return {data:{id:'saved',version:1,createdAt:'2026-10-08T00:00:00Z'},error:null}}
await assert.rejects(saveMonthlySettlement(request));assert.equal((await saveMonthlySettlement(request)).version,1);assert.deepEqual(saves[0],saves[1])
console.log('PASS monthly client: full paged export, revision mismatch, exact filters, numeric Excel/formula-safe text, year boundaries, identical save retry')
