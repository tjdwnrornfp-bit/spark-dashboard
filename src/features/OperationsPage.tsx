import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import type { AuditLog, OperationsHealth, User } from '../domain/types'
import { formatDateTime } from '../lib/date'
import { fetchOperationsHealth, fetchRemoteAuditLogs } from '../lib/backend'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { PageHeader } from './DashboardPage'

const EMPTY_HEALTH: OperationsHealth = {
  schemaVersion: '-',
  activeAdmins: 0,
  activeOrders: 0,
  archivedOrders: 0,
  ordersWithoutPaymentSteps: 0,
  invalidPaymentStates: 0,
  inactiveCronJobs: 0,
  checkedAt: '',
}

const ACTION_LABELS: Record<string, string> = {
  'order.created': '작업 접수',
  'order.status_changed': '상태 변경',
  'order.archived': '작업 보관',
  'order.restored': '작업 복원',
  'order.updated': '작업 수정',
  'member.created': '회원 신청',
  'member.updated': '회원 변경',
  'payment.confirmed': '입금 확인',
  'system.migration': 'DB 업데이트',
}

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '운영 정보를 불러오지 못했습니다.'
}

function metaText(log: AuditLog): string {
  const values = Object.entries(log.metadata)
    .filter(([, value]) => value !== null && value !== '' && value !== undefined)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
  return values.join(' · ')
}

export function OperationsPage({ user }: { user: User }) {
  const [health, setHealth] = useState<OperationsHealth>(EMPTY_HEALTH)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (user.role !== 'admin') return
    if (!isSupabaseConfigured) {
      setHealth({ ...EMPTY_HEALTH, schemaVersion: '로컬 모드', activeAdmins: 1, checkedAt: new Date().toISOString() })
      setLogs([])
      return
    }
    setLoading(true)
    try {
      const [nextHealth, nextLogs] = await Promise.all([fetchOperationsHealth(), fetchRemoteAuditLogs(300)])
      setHealth(nextHealth)
      setLogs(nextLogs)
      setError('')
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [user.role])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || user.role !== 'admin') return
    const client = supabase
    let timer: number | null = null
    const scheduleRefresh = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(), 300)
    }
    const channel = client.channel(`spark-operations-v9-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, scheduleRefresh)
      .subscribe()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [refresh, user.id, user.role])

  const actions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs])
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('ko-KR')
    return logs.filter((log) => {
      if (action !== 'all' && log.action !== action) return false
      if (!keyword) return true
      return [log.actorUsername, log.entityLabel, log.action, metaText(log)].some((value) => value.toLocaleLowerCase('ko-KR').includes(keyword))
    })
  }, [action, logs, query])

  const healthy = health.activeAdmins > 0
    && health.ordersWithoutPaymentSteps === 0
    && health.invalidPaymentStates === 0
    && health.inactiveCronJobs === 0

  return (
    <div className="page-stack operations-page-stack">
      <PageHeader
        title="운영기록"
        subtitle="데이터 무결성, 자동화 상태와 주요 변경 이력을 확인합니다."
        action={<button className="secondary-button small" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" />{loading ? '확인 중' : '새로고침'}</button>}
      />

      {error && <div className="server-error-banner">{error}<button onClick={() => void refresh()}>다시 확인</button></div>}

      <section className={`operations-health-banner ${healthy ? 'health-ok' : 'health-warning'}`}>
        <div className="operations-health-icon"><Icon name="shield" size={26} /></div>
        <div><strong>{healthy ? '핵심 운영 점검 정상' : '확인이 필요한 운영 항목이 있습니다.'}</strong><p>스키마 {health.schemaVersion || '-'} · {health.checkedAt ? `${formatDateTime(health.checkedAt)} 기준` : '확인 전'}</p></div>
      </section>

      <section className="operations-stat-grid">
        <HealthCard label="활성 관리자" value={health.activeAdmins} warning={health.activeAdmins < 1} />
        <HealthCard label="운영 작업" value={health.activeOrders} />
        <HealthCard label="보관 작업" value={health.archivedOrders} />
        <HealthCard label="정산 단계 누락" value={health.ordersWithoutPaymentSteps} warning={health.ordersWithoutPaymentSteps > 0} />
        <HealthCard label="정산 상태 불일치" value={health.invalidPaymentStates} warning={health.invalidPaymentStates > 0} />
        <HealthCard label="비활성 Cron" value={health.inactiveCronJobs} warning={health.inactiveCronJobs > 0} />
      </section>

      <section className="panel operations-log-panel">
        <div className="panel-header"><div><h2>감사 기록</h2><p>최근 300건의 작업·회원·정산 변경 이력입니다.</p></div></div>
        <div className="operations-toolbar">
          <label className="search-box"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="실행자, 작업명, 변경 내용 검색" /></label>
          <select value={action} onChange={(event) => setAction(event.target.value)}><option value="all">전체 작업</option>{actions.map((item) => <option key={item} value={item}>{ACTION_LABELS[item] ?? item}</option>)}</select>
        </div>
        {visible.length === 0 ? <div className="empty-state">표시할 운영기록이 없습니다.</div> : <div className="desktop-table"><table className="simple-table operations-log-table"><thead><tr><th>일시</th><th>실행자</th><th>구분</th><th>대상</th><th>상세</th></tr></thead><tbody>{visible.map((log) => <tr key={log.id}><td>{formatDateTime(log.createdAt)}</td><td><strong>{log.actorUsername || 'system'}</strong><small>{log.actorRole ?? 'system'}</small></td><td><span className="audit-action-badge">{ACTION_LABELS[log.action] ?? log.action}</span></td><td><strong>{log.entityLabel || '-'}</strong><small>{log.entityType}</small></td><td>{metaText(log) || '-'}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  )
}

function HealthCard({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <article className={`operations-stat-card ${warning ? 'is-warning' : ''}`}><span>{label}</span><strong>{value.toLocaleString('ko-KR')}</strong><small>{warning ? '확인 필요' : '정상'}</small></article>
}
