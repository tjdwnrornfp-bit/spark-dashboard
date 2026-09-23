import { useState } from 'react'
import type { User } from '../domain/types'
import { Modal } from '../components/Modal'
import { isIsoDate, formatDateTime } from '../lib/date'
import { isSupabaseConfigured } from '../lib/supabase'
import { previewStartDateRestriction, saveStartDateRestriction } from '../lib/startDateRestrictions'
import type { StartDateRestriction, RestrictionImpact } from '../lib/startDateRestrictions'
import { useStartDateRestrictions } from '../hooks/useStartDateRestrictions'
import { PageHeader } from './DashboardPage'

type Draft = Pick<StartDateRestriction, 'id' | 'startDate' | 'endDate' | 'reason' | 'enabled' | 'version'>
const fresh = (): Draft => ({ id: crypto.randomUUID(), startDate: '', endDate: '', reason: '', enabled: true, version: 0 })
export function StartDateRestrictionsPage({ user }: { user: User }) {
  const state = useStartDateRestrictions(true)
  const [draft, setDraft] = useState<Draft>(fresh)
  const [impact, setImpact] = useState<RestrictionImpact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  if (user.role !== 'admin' || user.isOperationsManager) return <p>관리자만 사용할 수 있습니다.</p>
  const valid = isIsoDate(draft.startDate) && isIsoDate(draft.endDate) && draft.startDate <= draft.endDate && draft.reason.trim().length > 0 && draft.reason.trim().length <= 300
  const edit = (changes: Partial<Draft>) => { setDraft((d) => ({ ...d, ...changes })); setImpact(null); setError(''); setSaved('') }
  const check = async () => {
    if (busy || !valid) return
    setBusy(true); setError(''); setSaved('')
    try { setImpact(await previewStartDateRestriction(draft.startDate, draft.endDate)) }
    catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (busy || !impact || !valid) return
    setBusy(true); setError('')
    try {
      await saveStartDateRestriction(draft)
      setSaved(draft.enabled ? '시작일 접수 제한을 저장했습니다. 해당 기간의 신규 접수와 시작일 변경이 차단됩니다.' : '이 기간의 제한을 사용 안 함으로 저장했습니다. 겹치는 다른 제한은 유지됩니다.')
      setImpact(null); setDraft(fresh()); state.reload()
    } catch (e) { setError(message(e)); setImpact(null); state.reload() }
    finally { setBusy(false) }
  }
  return <div className="page-stack">
    <PageHeader title="접수 제한 설정" subtitle="작업 시작일 기준으로 개별·엑셀·관리자 대리접수를 제한합니다. 모든 프로그램에 공통 적용됩니다." />
    {!isSupabaseConfigured && <p className="server-error-banner">설정 저장은 운영 서버 연결 후 사용할 수 있습니다.</p>}
    <div className="start-restriction-notice"><strong>기존 접수·정산·구동은 변경하지 않습니다.</strong><p>접수하는 오늘 날짜가 아니라, 작업에 지정하는 시작일을 검사합니다. 시작일이 그대로인 기존 작업은 제한 기간에 포함돼도 유지됩니다. 관리자의 신규 접수에도 예외 없이 적용됩니다.</p></div>
    {saved && <p className="assignment-success" role="status">{saved}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel"><div className="panel-header"><h2>{draft.version ? '기간 수정' : '차단 기간 추가'}</h2><button className="secondary-button small" disabled={busy} onClick={() => { setDraft(fresh()); setImpact(null); setError('') }}>새 기간 입력</button></div>
      <fieldset disabled={busy} className="restriction-editor form-grid">
        <label className="field"><span>차단 시작일 (포함)</span><input type="date" value={draft.startDate} onChange={(e) => edit({ startDate: e.target.value })} /></label>
        <label className="field"><span>차단 종료일 (포함)</span><input type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={(e) => edit({ endDate: e.target.value })} /></label>
        <label className="field span-2"><span>회원 안내 문구 (1~300자)</span><textarea maxLength={300} placeholder="연휴 운영 일정으로 해당 시작일의 접수를 제한합니다." value={draft.reason} onChange={(e) => edit({ reason: e.target.value })} /></label>
        <label className="restriction-enabled"><input type="checkbox" checked={draft.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />사용 · 해당 시작일의 접수 차단</label>
      </fieldset>
      <div className="restriction-editor-actions"><button className="primary-button" disabled={busy || !valid || !isSupabaseConfigured} onClick={() => void check()}>{busy ? '확인 중…' : '영향 확인 후 저장'}</button></div>
    </section>
    <section className="panel"><div className="panel-header"><h2>등록된 기간</h2><button className="secondary-button small" disabled={state.loading || busy} onClick={state.reload}>새로고침</button></div>
      {state.loading ? <p role="status" className="restriction-editor">설정을 불러오는 중입니다.</p> : state.error ? <p className="form-error restriction-editor" role="alert">{state.error}</p> : !state.rules?.length ? <div className="empty-state">등록된 차단 기간이 없습니다. 기간을 추가하고 저장하면 제한이 적용됩니다.</div> : <div className="restriction-list">{state.rules.map((r) => <article key={r.id} className="restriction-card"><div><strong>{r.startDate} ~ {r.endDate}</strong><span className={r.enabled ? 'form-error' : 'muted'}>{r.enabled ? '사용 중' : '사용 안 함'}</span></div><p>{r.reason}</p><small>최근 저장 {formatDateTime(r.updatedAt)} · 버전 {r.version}</small><button className="secondary-button small" disabled={busy} onClick={() => { setDraft(r); setImpact(null); setError(''); setSaved(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>수정 / 사용 여부 변경</button></article>)}</div>}
    </section>
    <p className="muted">여러 기간이 겹치면 하나라도 사용 중인 기간에는 접수할 수 없습니다. 해제는 해당 기간을 수정해 사용 체크를 끈 뒤 저장하세요. 변경 이력은 운영기록에 남습니다.</p>
    {impact && <Modal title="접수 제한 설정 확인" description={`${draft.startDate} ~ ${draft.endDate} · 양 끝 날짜 포함`} onClose={() => { if (!busy) setImpact(null) }} footer={<><button className="secondary-button" disabled={busy} onClick={() => setImpact(null)}>돌아가기</button><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '설정 저장'}</button></>}>
      <p><strong>{draft.enabled ? '이 시작일의 신규 접수·시작일 변경을 차단합니다.' : '이 기간의 제한을 사용 안 함으로 변경합니다.'}</strong></p><p>안내 문구: {draft.reason}</p><p>해당 기간에 시작하는 기존 미보관 작업: <strong>{impact.existingCount}건</strong> (입금대기·입금완료 {impact.waitingCount}건, 구동중 {impact.runningCount}건)</p><p>위 건수는 확인 시점 기준입니다. 기존 주문을 취소하거나 시작일·정산 금액을 변경하지 않습니다.</p>
    </Modal>}
  </div>
}
function message(e: unknown) { return e && typeof e === 'object' && 'message' in e ? String(e.message) : '설정을 저장하지 못했습니다.' }
