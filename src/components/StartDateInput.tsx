import { useState } from 'react'
import { isIsoDate, todayInSeoul } from '../lib/date'
import { startDateRestrictionError } from '../lib/startDateRestrictions'
import type { RestrictionState } from '../lib/startDateRestrictions'

export function StartDateInput({ value, onChange, restrictions, min, originalDate, disabled = false, ariaLabel = '시작일' }: {
  value: string; onChange: (value: string) => void; restrictions: RestrictionState
  min?: string; originalDate?: string; disabled?: boolean; ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => (isIsoDate(value) ? value : todayInSeoul()).slice(0, 7))
  const [year, number] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, number - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate()
  const move = (step: number) => {
    const next = new Date(Date.UTC(year, number - 1 + step, 1))
    if (next.getUTCFullYear() >= 1000 && next.getUTCFullYear() <= 9999) setMonth(next.toISOString().slice(0, 7))
  }
  const error = startDateRestrictionError(value, restrictions.rules, originalDate)
  return <div className="start-date-control">
    <div className="start-date-input-row"><input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} aria-label={ariaLabel} aria-invalid={Boolean(error)} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} /><button type="button" className="secondary-button small" aria-label={`${ariaLabel} 달력 열기`} aria-expanded={open} disabled={disabled} onClick={() => { if (!open && isIsoDate(value)) setMonth(value.slice(0, 7)); setOpen(!open) }}>달력</button></div>
    {error && <small className="form-error" role="alert">{error}</small>}
    {open && !disabled && <div className="start-date-calendar" role="group" aria-label="시작일 선택 달력">
      <div className="start-date-month"><button type="button" aria-label="이전 달" onClick={() => move(-1)}>‹</button><strong>{year}년 {number}월</strong><button type="button" aria-label="다음 달" onClick={() => move(1)}>›</button></div>
      <div className="start-date-grid">{['일','월','화','수','목','금','토'].map((d) => <span key={d}>{d}</span>)}{Array.from({ length: first }, (_, i) => <span key={`empty${i}`} />)}{Array.from({ length: days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`
        const why = startDateRestrictionError(date, restrictions.rules, originalDate)
        const blocked = Boolean(why || (min && date < min && date !== originalDate))
        return <button type="button" key={date} aria-label={date} aria-pressed={value === date} disabled={blocked} title={why || (blocked ? '선택할 수 없는 날짜입니다.' : date)} onClick={() => { onChange(date); setOpen(false) }}>{i + 1}</button>
      })}</div><small>회색 날짜는 선택할 수 없습니다. 차단 기간의 양 끝 날짜도 포함됩니다.</small><button type="button" className="secondary-button small" onClick={() => setOpen(false)}>달력 닫기</button>
    </div>}
  </div>
}

export function StartDateRestrictionNotice({ state }: { state: RestrictionState }) {
  if (state.loading) return <p role="status" className="muted">접수 제한 기간을 확인하고 있습니다.</p>
  if (state.error || !state.rules) return <div className="start-restriction-notice" role="alert">{state.error || '접수 제한 설정을 확인하지 못했습니다.'} <button type="button" className="secondary-button small" onClick={state.reload}>다시 확인</button></div>
  const active = state.rules.filter((r) => r.enabled && r.endDate >= todayInSeoul())
  if (!active.length) return null
  return <div className="start-restriction-notice"><strong>시작일 접수 제한 · 모든 프로그램 공통</strong>{active.map((r) => <p key={r.id}>{r.startDate} ~ {r.endDate} (양 끝 포함) · {r.reason}</p>)}<small>해당 시작일의 신규 접수·시작일 변경은 불가합니다. 기존 접수와 구동은 유지됩니다.</small></div>
}
