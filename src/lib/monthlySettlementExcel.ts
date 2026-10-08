import { utils, writeFileXLSX } from 'xlsx'
import { formatDateTime } from './date'
import { labelForProgram } from './program'
import type { MonthlyQuery, MonthlyResult, MonthlyRow } from './monthlySettlement'
export function monthlyWorkbook(q:MonthlyQuery,result:MonthlyResult,rows:MonthlyRow[]) {
  const receipts=q.mode==='receipts',t=result.summary
  const summary=[['정산월',q.month],['기준',receipts?'입금 확인일':'작업 시작일'],['자료',q.snapshot?'저장된 마감본':'현재 내역'],['조회/저장 시각',formatDateTime(result.asOf)],['프로그램',q.program?labelForProgram(q.program):'전체'],['검색',q.query||'전체'],['건수',t.count],
    ...(receipts?[['입금 확인액',t.confirmationAmount],['확인 취소액',t.reversalAmount],['순 확인액',t.totalAmount]]:[['정산액',t.totalAmount],['입금 완료',t.confirmedAmount],['미수금',t.waitingAmount]])]
  const details=[['작업번호','그룹','등록자','상호명','프로그램','시작일',receipts?'기록 구분':'입금 상태','금액',receipts?'기록 시각':'확인 시각','보관','정산 단계'],...rows.map(r=>[r.orderNumber,r.groupName,r.username,r.storeName,labelForProgram(r.program),r.startDate,receipts?(r.kind==='reversal'?'입금확인 취소':'입금확인'):(r.confirmedAt?'완료':'미수'),r.amount,(receipts?r.occurredAt:r.confirmedAt)?formatDateTime((receipts?r.occurredAt:r.confirmedAt)!):'',r.archived?'보관':'',r.stepKind==='standard'?'기본':'조정'])]
  const book=utils.book_new();const s=utils.aoa_to_sheet(summary),d=utils.aoa_to_sheet(details)
  s['!cols']=[{wch:20},{wch:40}];d['!cols']=[22,20,16,28,14,13,20,18,24,10,12].map(wch=>({wch}));d['!autofilter']={ref:d['!ref']!}
  for(let row=2;row<=details.length;row++)if(d[`H${row}`])d[`H${row}`].z='#,##0'
  utils.book_append_sheet(book,s,'요약');utils.book_append_sheet(book,d,'상세 내역');return book
}
export function downloadMonthlyWorkbook(q:MonthlyQuery,result:MonthlyResult,rows:MonthlyRow[]) { writeFileXLSX(monthlyWorkbook(q,result,rows),`SPARK_${q.month}_${q.mode==='work'?'작업정산':'입금내역'}${q.snapshot?'_마감':''}.xlsx`) }
