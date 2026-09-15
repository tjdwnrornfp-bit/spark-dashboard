import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url)
globalThis.xlsx=require('xlsx')
const {outputFiles}=await build({
  stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    export { fetchAgencyOrdersV109, fetchAllAgencyOrdersV109, fetchAgencyFoldersV109 } from './src/lib/backend'
    export { downloadManagedOrdersExcel } from './src/lib/managedOrdersExcel'
  `},bundle:true,platform:'node',format:'cjs',write:false,
  plugins:[{name:'mocks',setup(b){
    b.onLoad({filter:/[/\\]supabase\.ts$/},()=>({loader:'js',contents:'export const supabase={rpc:(...a)=>globalThis.rpc(...a)}; export const isSupabaseConfigured=true;'}))
    b.onResolve({filter:/^xlsx$/},()=>({path:'xlsx',namespace:'mock-xlsx'}))
    b.onLoad({filter:/.*/,namespace:'mock-xlsx'},()=>({loader:'js',contents:'export const utils=globalThis.xlsx.utils; export const writeFileXLSX=(...args)=>{globalThis.savedWorkbook=args}'}))
  }}],
})
const module={exports:{}}
new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports)
const {fetchAgencyOrdersV109,fetchAllAgencyOrdersV109,fetchAgencyFoldersV109,downloadManagedOrdersExcel}=module.exports
const calls=[]
globalThis.rpc=async(name,p)=>{
  calls.push({name,p})
  if(name==='get_manager_agency_folders_v109') return {error:null,data:{page:1,pageSize:20,totalPages:1,agencyCount:1,agencies:[]}}
  const count=p.p_agency_id==='a'?501:2,start=(p.p_page-1)*p.p_page_size
  return {error:null,data:Array.from({length:Math.max(0,Math.min(count-start,p.p_page_size))},(_,i)=>({order_id:`${p.p_agency_id}-${start+i}`,registrant_id:p.p_agency_id,registrant_username:p.p_agency_id,store_name:'테스트',keyword:'검색',mid:'123',program_type:'spark',order_status:'입금대기',settlement_status:'정산대기',start_date:'2026-09-15',end_date:'2026-10-14',created_at:'2026-09-15T00:00:00Z',total_amount:66000,total_count:count}))}
}
const filters={agencyId:'a',programType:'spark',orderStatus:'in_progress',sort:'priority',settlementStatus:'정산대기',query:' 검색 ',startDateFrom:'2026-09-01',startDateTo:'2026-10-01'}
await fetchAgencyFoldersV109(filters)
assert.equal(calls.length,1);assert.equal(calls[0].name,'get_manager_agency_folders_v109');assert.equal(calls[0].p.p_page_size,20)
calls.length=0
const a=await fetchAllAgencyOrdersV109(filters)
assert.equal(a.length,501);assert.equal(calls.length,2)
for(const {name,p} of calls){assert.equal(name,'get_manager_agency_orders_v109');assert.equal(p.p_agency_id,'a');assert.deepEqual(p.p_order_statuses,['입금대기','입금완료']);assert.equal(p.p_query,'검색');assert.equal(p.p_settlement_status,'정산대기');assert.equal(p.p_start_date_from,'2026-09-01')}
const b=await fetchAllAgencyOrdersV109({...filters,agencyId:'b'})
downloadManagedOrdersExcel([...a,...b],'selected.xlsx')
const sheet=globalThis.savedWorkbook[0].Sheets['관리작업']
const values=globalThis.xlsx.utils.sheet_to_json(sheet,{header:1})
assert.equal(values.length,504);assert.equal(values.filter(r=>r[0]==='a').length,501);assert.equal(values.filter(r=>r[0]==='b').length,2)
assert.equal(sheet.I2.t,'n');assert.equal(sheet.I2.z,'yyyy-mm-dd');assert.equal(sheet.N2.v,66000)
await assert.rejects(fetchAgencyOrdersV109({...filters,agencyId:''}),/대행사/)
console.log('PASS: summary-only initial fetch; scoped 501-row export pagination; filter parity; cross-agency Excel row count, date and numeric fields')
