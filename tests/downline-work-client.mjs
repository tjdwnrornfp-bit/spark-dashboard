import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url)
globalThis.xlsx=require('xlsx')
const {outputFiles}=await build({
  stdin:{resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts',contents:`
    export { fetchDownlineOverviewV1010, fetchDownlineOrdersV1010, fetchAllDownlineOrdersV1010, fetchAgencyFoldersV1010, fetchAllAgencyOrdersV1010 } from './src/lib/backend'
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
const api=module.exports,calls=[]
globalThis.rpc=async(name,p)=>{
  calls.push({name,p})
  if(name.includes('overview')||name.includes('folders')) return {error:null,data:{page:1,pageSize:20,totalPages:1,groupCount:1,agencyCount:1,groups:[],agencies:[]}}
  if(p.p_agency_id==='forbidden') return {error:{message:'현재 sponsor 하위 대행사만 조회할 수 있습니다.'},data:null}
  const count=501,start=(p.p_page-1)*p.p_page_size
  return {error:null,data:Array.from({length:Math.max(0,Math.min(count-start,p.p_page_size))},(_,i)=>({order_id:`${start+i}`,registrant_id:'agency',registrant_username:'agency',current_group_name:'현재 그룹',store_name:'작업',keyword:'검색',mid:'123',program_type:'spark',order_status:'입금대기',settlement_status:'정산대기',start_date:'2026-09-15',end_date:'2026-10-14',created_at:'2026-09-15T00:00:00Z',total_amount:66000,total_count:count}))}
}
const filters={agencyId:'agency',groupName:'현재 그룹',programType:'spark',orderStatus:'in_progress',sort:'priority',settlementStatus:'정산대기',query:' 검색 ',startDateFrom:'2026-09-01',startDateTo:'2026-10-01'}
await api.fetchDownlineOverviewV1010(filters)
assert.equal(calls.length,1);assert.equal(calls[0].name,'get_downline_group_overview_v1010');assert.equal(calls[0].p.p_page_size,20)
await api.fetchDownlineOverviewV1010(filters,2,'recent',true)
assert.equal(calls[1].name,'get_downline_agency_overview_v1010');assert.equal(calls[1].p.p_group_name,'현재 그룹');assert.equal(calls[1].p.p_page,2)
calls.length=0
const rows=await api.fetchAllDownlineOrdersV1010(filters)
assert.equal(rows.length,501);assert.equal(calls.length,2)
for(const {name,p} of calls){assert.equal(name,'get_downline_orders_v1010');assert.equal(p.p_agency_id,'agency');assert.equal(p.p_group_name,'현재 그룹');assert.deepEqual(p.p_order_statuses,['입금대기','입금완료']);assert.equal(p.p_query,'검색');assert.equal(p.p_settlement_status,'정산대기');assert.equal(p.p_start_date_from,'2026-09-01')}
api.downloadManagedOrdersExcel(rows,'downline.xlsx')
const sheet=globalThis.savedWorkbook[0].Sheets['관리작업']
assert.equal(sheet.O1.v,'현재 그룹명');assert.equal(sheet.O2.v,'현재 그룹');assert.equal(sheet.I2.t,'n');assert.equal(sheet.N2.v,66000)
await assert.rejects(api.fetchDownlineOrdersV1010({...filters,agencyId:'forbidden'}),e=>/sponsor/.test(e.message))
calls.length=0
await api.fetchAgencyFoldersV1010(filters);await api.fetchAllAgencyOrdersV1010(filters)
assert.equal(calls[0].name,'get_manager_agency_folders_v1010');assert.ok(calls.slice(1).every(c=>c.name==='get_manager_agency_orders_v1010' && !('p_group_name' in c.p)))
console.log('PASS: summary-only loading; separate manager/downline RPCs; scoped group/agency 501-row export; filter parity; current group/date/money workbook; denied API propagation')
