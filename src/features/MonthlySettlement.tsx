import { useState } from 'react'
import type { ProgramType, User } from '../domain/types'
import { useRemoteRead } from '../hooks/useRemoteRead'
import { fetchMonthlySettlement, fetchMonthlyExport, saveMonthlySettlement, shiftMonth } from '../lib/monthlySettlement'
import type { MonthlyMode, MonthlyQuery, MonthlyResult, MonthlySave } from '../lib/monthlySettlement'
import { formatDateTime, todayInSeoul } from '../lib/date'
import { formatWon } from '../lib/money'
import { labelForProgram } from '../lib/program'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'

const programs:ProgramType[]=['spark','spark_plus','spark_s','spark_s_plus']
function errorText(error:unknown) { return error && typeof error==='object' && 'message' in error ? String(error.message) : '요청을 처리하지 못했습니다.' }
export function MonthlySettlement({user,revision}:{user:User;revision:number}) {
  const currentMonth=todayInSeoul().slice(0,7)
  const [month,setMonth]=useState(currentMonth),[mode,setMode]=useState<MonthlyMode>('work')
  const [program,setProgram]=useState<ProgramType|''>(''),[query,setQuery]=useState(''),[page,setPage]=useState(1)
  const [snapshot,setSnapshot]=useState(''),[refresh,setRefresh]=useState(0),[detail,setDetail]=useState<{id:string;label:string}|null>(null)
  const [saving,setSaving]=useState(false),[closing,setClosing]=useState(false),[reason,setReason]=useState(''),[pending,setPending]=useState<MonthlySave|null>(null)
  const [actionError,setActionError]=useState(''),[notice,setNotice]=useState(''),[exporting,setExporting]=useState(false)
  const params:MonthlyQuery={month,mode,program,query,page,snapshot}
  const read=useRemoteRead(`monthly:${user.id}:${revision}:${refresh}:${JSON.stringify(params)}`,()=>fetchMonthlySettlement(params),true,200)
  const data=read.data
  const changeMonth=(value:string)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return;setMonth(value);setSnapshot('');setPage(1);setDetail(null);setNotice('');setActionError('')}
  const download=async()=>{if(exporting||!data)return;setExporting(true);setActionError('');try{const output=await fetchMonthlyExport(params);const {downloadMonthlyWorkbook}=await import('../lib/monthlySettlementExcel');downloadMonthlyWorkbook(params,output.result,output.rows)}catch(e){setActionError(errorText(e))}finally{setExporting(false)}}
  const closeMonth=async()=>{
    if(!data||saving)return
    const request=pending??{month,requestId:crypto.randomUUID(),revision:data.liveRevision,reason:reason.trim()}
    setPending(request);setSaving(true);setActionError('')
    try{const result=await saveMonthlySettlement(request);setSnapshot(result.id);setRefresh(r=>r+1);setClosing(false);setPending(null);setReason('');setNotice(`${month} 마감 ${result.version}차를 저장했습니다.`)}catch(e){setActionError(errorText(e))}finally{setSaving(false)}
  }
  return <div className="monthly-settlement">
    <section className="monthly-toolbar panel compact-panel">
      <div className="monthly-month-control"><button className="secondary-button" aria-label="이전 달" disabled={month<='2000-01'} onClick={()=>changeMonth(shiftMonth(month,-1))}>‹</button><label><span>조회 월</span><input type="month" aria-label="조회 월" min="2000-01" max="2100-12" value={month} onChange={e=>changeMonth(e.target.value)}/></label><button className="secondary-button" aria-label="다음 달" disabled={month>='2100-12'} onClick={()=>changeMonth(shiftMonth(month,1))}>›</button><button className="text-button" onClick={()=>changeMonth(currentMonth)}>이번 달</button><button className="text-button" onClick={()=>changeMonth(shiftMonth(currentMonth,-1))}>지난달</button></div>
      <div className="monthly-actions"><button className="secondary-button" disabled={!data||exporting} onClick={()=>void download()}>{exporting?'내보내는 중…':'엑셀 저장'}</button><button className="primary-button" title="월마감은 지난달까지 현재 내역에서 저장할 수 있습니다." disabled={!data||month>=currentMonth||Boolean(snapshot)} onClick={()=>{setClosing(true);setActionError('');setPending(null);setReason('')}}>월마감 저장</button></div>
    </section>
    <div className="monthly-filter-row"><div className="monthly-basis" role="group" aria-label="집계 기준"><button aria-pressed={mode==='work'} onClick={()=>{setMode('work');setPage(1);setDetail(null)}}>작업별 정산</button><button aria-pressed={mode==='receipts'} onClick={()=>{setMode('receipts');setPage(1);setDetail(null)}}>월별 입금 내역</button></div><label><span>프로그램</span><select value={program} onChange={e=>{setProgram(e.target.value as ProgramType|'');setPage(1)}}><option value="">전체 프로그램</option>{programs.map(p=><option key={p} value={p}>{labelForProgram(p)}</option>)}</select></label><label className="monthly-search"><span>업체·작업 검색</span><input maxLength={100} placeholder="그룹, 아이디, 상호, 작업번호" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label><button className="secondary-button" onClick={()=>{setQuery('');setProgram('');setPage(1);setRefresh(r=>r+1)}}>초기화</button></div>
    <p className="monthly-caption">{mode==='work'?'작업 시작월 기준 · 선택한 조회 자료의 입금 상태를 확인합니다.':'입금 확인일 기준 · 확인 취소는 취소한 달에 차감합니다. 실제 환불 내역과는 별도입니다.'} 보관된 작업도 포함합니다.</p>
    {notice&&<p role="status" className="monthly-success">{notice}</p>}
    {actionError&&!closing&&<p role="alert" className="monthly-error">{actionError}</p>}
    {read.error&&<div role="alert" className="monthly-error">{read.error} <button className="text-button" onClick={read.reload}>다시 조회</button></div>}
    {read.loading&&<div role="status" className="monthly-loading">{month} 정산 내역을 조회하고 있습니다.</div>}
    {data&&<>
      <div className="monthly-snapshot-row"><label><span>조회 자료</span><select aria-label="조회 자료" value={snapshot} onChange={e=>{setSnapshot(e.target.value);setPage(1);setDetail(null)}}><option value="">현재 내역</option>{data.snapshots.map(s=><option key={s.id} value={s.id}>마감 {s.version}차 · {formatDateTime(s.createdAt)}</option>)}</select></label><span>{snapshot?'마감 저장 시점':'조회 시점'} {formatDateTime(data.asOf)} <button className="text-button" onClick={()=>setRefresh(r=>r+1)}>새로고침</button></span></div>
      {snapshot&&<div className="monthly-close-note">{data.snapshots.find(s=>s.id===snapshot)?.reason} · 마감은 저장 시점의 기록이며, 월말 당시 잔액을 소급 계산한 자료가 아닙니다.{data.changedSinceClose&&<strong> 저장 이후 내역이 변경되었습니다. 현재 내역으로 전환해 비교하세요.</strong>}</div>}
      <MonthlyCards data={data}/>
      <section className="panel compact-panel monthly-trend"><div className="panel-header"><div><h2>최근 12개월</h2><p>{mode==='work'?'정산액':'입금 순 확인액'} · 현재 내역 기준 · 적용한 검색 조건 포함</p></div></div><div className="monthly-bars">{data.trend.map(t=>{const max=Math.max(1,...data.trend.map(v=>Math.abs(v.amount)));return <button key={t.month} className={t.month.slice(0,7)===month?'selected':''} onClick={()=>changeMonth(t.month.slice(0,7))} aria-label={`${t.month.slice(0,7)} ${formatWon(t.amount)}`} title={`${t.month.slice(0,7)} · ${formatWon(t.amount)}`}><span className="monthly-bar-area"><i className={t.amount<0?'negative':''} style={{height:`${Math.max(2,Math.abs(t.amount)/max*100)}%`}}/></span><strong>{Number(t.month.slice(5,7))}월</strong><small>{compactWon(t.amount)}</small></button>})}</div></section>
      <section className="panel compact-panel"><div className="panel-header"><div><h2>업체별 {mode==='work'?'정산':'입금'} 현황</h2><p>업체를 선택하면 포함 작업과 금액을 확인할 수 있습니다.</p></div><span>{data.totalCount.toLocaleString()}개 업체</span></div>
        {!data.companies.length?<div className="empty-state">선택한 조건의 정산 내역이 없습니다.</div>:<div className="monthly-table-wrap"><table className="simple-table monthly-table"><thead><tr><th>등록 업체</th><th>건수</th><th>{mode==='work'?'정산액':'입금 확인액'}</th><th>{mode==='work'?'입금 완료':'확인 취소액'}</th><th>{mode==='work'?'미수금':'순 확인액'}</th></tr></thead><tbody>{data.companies.map(c=><tr key={c.registrantId}><td><button className="monthly-company-button" onClick={()=>setDetail({id:c.registrantId,label:c.groupName})}><strong>{c.groupName}</strong><small>{c.username}</small></button></td><td>{c.summary.count.toLocaleString()}건</td><td>{formatWon(mode==='work'?c.summary.totalAmount:c.summary.confirmationAmount)}</td><td>{formatWon(mode==='work'?c.summary.confirmedAmount:c.summary.reversalAmount)}</td><td className={mode==='work'?'monthly-pending':'monthly-net'}>{formatWon(mode==='work'?c.summary.waitingAmount:c.summary.totalAmount)}</td></tr>)}</tbody></table></div>}
        <Pagination page={data.page} total={data.totalCount} onChange={setPage}/>
      </section>
      {mode==='receipts'&&<p className="monthly-caption">기존 입금은 저장된 확인일·금액을 기준으로 가져왔습니다. 전체 변경 이력 추적은 {data.coverage.trackingSince?formatDateTime(data.coverage.trackingSince):'업데이트 적용 시점'}부터 적용됩니다. 그 이전에 남아 있지 않은 취소·변경 이력은 복원하지 않습니다.</p>}
    </>}
    {detail&&data&&<MonthlyDetails key={`${detail.id}:${JSON.stringify(params)}:${data.revision}`} userId={user.id} params={{...params,registrant:detail.id,revision:data.revision}} label={detail.label} onClose={()=>setDetail(null)}/>}
    {closing&&data&&<Modal className="monthly-close-modal" title={`${month} 월마감 저장`} onClose={()=>{if(!saving){setClosing(false);setPending(null)}}} description="선택한 월 전체의 작업 정산과 입금 내역을 함께 저장합니다." footer={<><button className="secondary-button" disabled={saving} onClick={()=>{setClosing(false);setPending(null)}}>닫기</button><button className="primary-button" disabled={saving||(!pending&&reason.trim().length<2)} onClick={()=>void closeMonth()}>{saving?'저장 중…':pending?'같은 요청으로 결과 다시 확인':'마감본 저장'}</button></>}>
      <div className="monthly-close-content"><p>프로그램·검색 조건과 관계없이 <strong>{month} 전체 내역</strong>을 보관합니다. 기존 마감본은 유지되며 새 버전으로 추가됩니다.</p><dl><dt>작업 정산액</dt><dd>{formatWon(data.liveTotals.work.totalAmount)}</dd><dt>현재 미수금</dt><dd>{formatWon(data.liveTotals.work.waitingAmount)}</dd><dt>입금 순 확인액</dt><dd>{formatWon(data.liveTotals.receipts.totalAmount)}</dd></dl><p className="monthly-close-note">지금 조회한 상태를 저장합니다. 입금 처리와 주문 상태는 변경되지 않습니다.</p><label><span>마감 사유</span><textarea value={reason} maxLength={300} disabled={saving||Boolean(pending)} onChange={e=>setReason(e.target.value)} placeholder="예: 9월 정산 검토 완료"/></label>{actionError&&<p role="alert" className="monthly-error">{actionError}{pending&&' 응답을 확인하지 못했다면 같은 요청으로 다시 확인하세요. 대상 변경 오류는 닫기 후 새로고침해 주세요.'}</p>}</div>
    </Modal>}
  </div>
}
function compactWon(amount:number) { const a=Math.abs(amount);return a>=100000000?`${(amount/100000000).toFixed(1)}억`:a>=10000?`${Math.round(amount/10000).toLocaleString()}만`:amount.toLocaleString() }
function MonthlyCards({data}:{data:MonthlyResult}) {
  const t=data.summary,work=data.mode==='work'
  return <section className="monthly-cards" aria-label="월별 정산 요약">{(work?[['정산액',t.totalAmount],['입금 완료',t.confirmedAmount],['미수금',t.waitingAmount]]:[['입금 확인액',t.confirmationAmount],['확인 취소액',t.reversalAmount],['순 확인액',t.totalAmount]]).map(([label,value],i)=><article key={label} className={`monthly-card monthly-card-${i}`}><span>{label}</span><strong>{formatWon(Number(value))}</strong><small>{i===0?`${t.count.toLocaleString()}건 · 부가세 포함`:work?(i===1?'조회 자료 기준 확인 완료':'조회 자료 기준 확인 대기'):(i===1?'입금확인 취소 기록':'확인액 − 확인 취소액')}</small></article>)}</section>
}
function MonthlyDetails({userId,params,label,onClose}:{userId:string;params:MonthlyQuery;label:string;onClose:()=>void}) {
  const [page,setPage]=useState(1),[error,setError]=useState(''),[exporting,setExporting]=useState(false)
  const read=useRemoteRead(`monthly-detail:${userId}:${JSON.stringify(params)}:${page}`,()=>fetchMonthlySettlement({...params,page,view:'details'}))
  const download=async()=>{setExporting(true);setError('');try{const out=await fetchMonthlyExport(params);const {downloadMonthlyWorkbook}=await import('../lib/monthlySettlementExcel');downloadMonthlyWorkbook(params,out.result,out.rows)}catch(e){setError(errorText(e))}finally{setExporting(false)}}
  return <Modal title={`${label} · ${params.month}`} className="monthly-detail-modal" description={params.mode==='work'?'작업 시작월 기준 상세 정산':'입금 확인일 기준 상세 내역'} onClose={onClose} footer={<><button className="secondary-button" disabled={!read.data||exporting} onClick={()=>void download()}>{exporting?'저장 중…':'업체 엑셀 저장'}</button><button className="primary-button" onClick={onClose}>닫기</button></>}>
    {(read.error||error)&&<p role="alert" className="monthly-error">{read.error||error}</p>}{read.loading&&<p role="status">상세 내역을 조회하고 있습니다.</p>}{read.data&&<><div className="monthly-detail-total">{read.data.summary.count}건 · 합계 <strong>{formatWon(read.data.summary.totalAmount)}</strong></div><div className="monthly-detail-list">{read.data.rows.map(r=><article key={r.id}><div><strong>{r.storeName}</strong><small>{r.orderNumber} · {labelForProgram(r.program)}{r.stepKind!=='standard'?' · 조정':''}</small><small>시작 {r.startDate}{r.archived?' · 보관':''}</small></div><div><strong>{formatWon(r.amount)}</strong><span>{params.mode==='work'?(r.confirmedAt?'입금 완료':'미수금'):(r.kind==='reversal'?'입금확인 취소':'입금확인')}</span><small>{(r.occurredAt||r.confirmedAt)?formatDateTime(r.occurredAt||r.confirmedAt!):'미확인'}</small></div></article>)}</div><Pagination page={read.data.page} total={read.data.totalCount} onChange={setPage}/></>}
  </Modal>
}
