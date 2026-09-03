import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts', contents: `
    import assert from 'node:assert/strict'
    import { utils, write } from 'xlsx'
    import { ADMIN_ASSIGNMENT_HEADERS, readAssignmentWorkbook, parseAssignmentProgram, assignmentErrors } from './src/lib/adminAssignment'
    import { currentGroupNameForOrder } from './src/lib/order'
    import { getUserProgramPrice } from './src/lib/program'
    import { createAdminOrdersWorkbook } from './src/lib/adminExcel'
    import { DEMO_USERS } from './src/data/demo'
    for (const [label, expected] of [['스파크','spark'],['스파크+','spark_plus'],['스파크 +','spark_plus'],['스파크S','spark_s'],['스파크s','spark_s'],['스파크S+','spark_s_plus'],['스파크s+','spark_s_plus']]) assert.equal(parseAssignmentProgram(label),expected)
    assert.equal(parseAssignmentProgram('알수없음'), undefined)
    const parse = (rows) => { const book = utils.book_new(); utils.book_append_sheet(book,utils.aoa_to_sheet([ADMIN_ASSIGNMENT_HEADERS,...rows]),'관리자 작업부여'); return readAssignmentWorkbook(write(book,{type:'array',bookType:'xlsx'})) }
    const row = ['agency1','스파크S+','상호','키워드','https://m.place.naver.com/place/123/home',100,10,'2099-01-01','']
    const parsed = parse([row,[],row])
    assert.deepEqual(parsed.map((r)=>r.rowNumber),[2,4])
    assert.equal(parsed[0].draft.programType,'spark_s_plus')
    assert.equal(parse([row.slice(0,7).concat([72686,''])])[0].draft.startDate,'2099-01-01')
    assert.equal(parse(Array.from({length:500},()=>row)).length,500)
    assert.throws(()=>parse(Array.from({length:501},()=>row)),/500/)
    const member = DEMO_USERS.find((m)=>m.username==='agency1')
    assert.deepEqual(assignmentErrors(member,parsed[0].draft),[])
    assert.ok(assignmentErrors({...member,active:false},parsed[0].draft).length)
    assert.ok(assignmentErrors({...member,isOperationsManager:true},parsed[0].draft).length)
    assert.ok(assignmentErrors({...member,sparkSPlusPricePerShot:0},parsed[0].draft).length)
    assert.equal(getUserProgramPrice({...member,pricePerShot:35,sparkPricePerShot:0},'spark'),0)
    assert.equal(currentGroupNameForOrder({creatorGroupName:'과거',currentCreatorGroupName:''}),'')
    const order = {id:'test',createdAt:'2099-01-01',creatorUsername:'agency1',creatorGroupName:'과거',currentCreatorGroupName:'현재',programType:'spark',keyword:'키워드',mid:'123',storeName:'상호',placeUrl:'URL',pricePerShot:35,dailyShots:100,startDate:'2099-01-01',endDate:'2099-01-10',operationDays:10,status:'입금대기'}
    const book = createAdminOrdersWorkbook({orders:[order],sheetName:'검증'})
    assert.equal(book.Sheets['검증'].B2.v,'현재'); assert.equal(order.creatorGroupName,'과거')
    console.log('PASS: Excel labels, dates, physical row numbers, 500-row limit, target/price validation, current-group Excel and snapshot preservation')
  ` }, bundle: true, platform: 'node', format: 'cjs', write: false,
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
