import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { utils, writeFileXLSX } from 'xlsx'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { ProgressGauge } from '../components/ProgressGauge'
import { StatusBadge } from '../components/StatusBadge'
import type { AppSettings, Order, OrderDraft, OrderStatus, User } from '../domain/types'
import { calculateOperationDates, daysRemaining, formatDate, todayInSeoul } from '../lib/date'
import { calculateAmount, formatWon } from '../lib/money'
import { extractMid, STATUS_ORDER, validateDraft } from '../lib/order'
import { PageHeader } from './DashboardPage'

const EMPTY_DRAFT: OrderDraft = { placeUrl: '', storeName: '', keyword: '', dailyShots: '', operationDays: '', memo: '' }

interface Preview {
  draft: OrderDraft
  mid: string
  startDate: string
  endDate: string
  supplyAmount: number
  vatAmount: number
  totalAmount: number
}

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '요청을 처리하지 못했습니다.'
}

export function OrdersPage({ user, orders, settings, now, onCreateOrder, onStatusChange }: {
  user: User
  orders: Order[]
  settings: AppSettings
  now: Date
  onCreateOrder: (draft: OrderDraft) => Promise<Order>
  onStatusChange: (order: Order, status: OrderStatus) => Promise<void>
}) {
  const [filter, setFilter] = useState<'전체' | OrderStatus>('전체')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<OrderDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)

  const visible = useMemo(() => {
    const source = user.role === 'admin' ? orders : orders.filter((order) => order.createdBy === user.id)
    return source
      .filter((order) => filter === '전체' || order.status === filter)
      .filter((order) => {
        const keyword = query.trim().toLocaleLowerCase('ko-KR')
        return !keyword || [order.id, order.creatorUsername, order.storeName, order.keyword, order.mid].some((value) => value.toLocaleLowerCase('ko-KR').includes(keyword))
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [filter, orders, query, user.id, user.role])

  const counts = useMemo(() => {
    const source = user.role === 'admin' ? orders : orders.filter((order) => order.createdBy === user.id)
    return Object.fromEntries(['전체', ...STATUS_ORDER].map((status) => [status, status === '전체' ? source.length : source.filter((order) => order.status === status).length])) as Record<'전체' | OrderStatus, number>
  }, [orders, user.id, user.role])

  const updateDraft = (field: keyof OrderDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const openPreview = () => {
    const nextErrors = validateDraft(draft)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const dailyShots = Number(draft.dailyShots)
    const operationDays = Number(draft.operationDays)
    const dates = calculateOperationDates(operationDays, settings.cutoffHour, now)
    setPreview({
      draft,
      mid: extractMid(draft.placeUrl),
      ...dates,
      ...calculateAmount(dailyShots, operationDays, user.pricePerShot),
    })
  }

  const submitOrder = async () => {
    if (!preview || submitting) return
    setSubmitting(true)
    try {
      const order = await onCreateOrder(preview.draft)
      setCreatedOrder(order)
      setPreview(null)
      setDraft(EMPTY_DRAFT)
      setErrors({})
      setFormOpen(false)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const changeStatus = async (order: Order, status: OrderStatus) => {
    if (order.status === status || changingId) return
    setChangingId(order.id)
    try {
      await onStatusChange(order, status)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setChangingId(null)
    }
  }

  const toggleAll = () => {
    setSelectedIds((current) => {
      const allSelected = visible.length > 0 && visible.every((order) => current.has(order.id))
      if (allSelected) return new Set()
      return new Set(visible.map((order) => order.id))
    })
  }

  const downloadExcel = () => {
    const target = orders
      .filter((order) => selectedIds.has(order.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (target.length === 0) {
      window.alert('다운로드할 작업을 선택해 주세요.')
      return
    }

    const rows: Array<Array<string | number>> = [
      ['등록자', '상호명', '대표키워드', '플레이스URL', 'MID값', '일일수량', '구동일수', '시작일', '종료일'],
      ...target.map((order) => [
        order.creatorUsername,
        order.storeName,
        order.keyword,
        order.placeUrl,
        order.mid,
        order.dailyShots,
        order.operationDays,
        order.startDate,
        order.endDate,
      ]),
    ]

    const worksheet = utils.aoa_to_sheet(rows)
    worksheet['!cols'] = [
      { wch: 16 },
      { wch: 28 },
      { wch: 28 },
      { wch: 62 },
      { wch: 20 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
    ]
    worksheet['!autofilter'] = { ref: `A1:I${rows.length}` }

    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, worksheet, '작업접수')
    writeFileXLSX(workbook, `spark-orders-${todayInSeoul(now)}.xlsx`, { compression: true, cellStyles: true })
  }

  return (
    <div className="page-stack orders-page-stack">
      <PageHeader
        title={user.role === 'admin' ? '작업접수' : '스파크 접수'}
        subtitle={user.role === 'admin' ? '전체 접수 작업과 상태를 관리합니다.' : '플레이스 작업을 접수하고 진행 상태를 확인합니다.'}
        action={user.role !== 'admin' ? <button className="primary-button small" onClick={() => setFormOpen((current) => !current)}><Icon name={formOpen ? 'close' : 'plus'} />{formOpen ? '접수 닫기' : '접수 신청'}</button> : undefined}
      />

      {user.role !== 'admin' && formOpen && (
        <section className="panel intake-form-panel">
          <div className="panel-header"><div><h2>스파크 접수 신청</h2><p>회원 단가 {formatWon(user.pricePerShot)} / 타 · 오후 {settings.cutoffHour}시 이전 접수는 익일 시작</p></div></div>
          <div className="form-grid compact-form">
            <Field className="span-2" label="플레이스 URL" required error={errors.placeUrl}>
              <div className="input-with-status"><input value={draft.placeUrl} onChange={(event) => updateDraft('placeUrl', event.target.value)} placeholder="https://m.place.naver.com/place/1234567890/home" />{extractMid(draft.placeUrl) && <span>MID {extractMid(draft.placeUrl)}</span>}</div>
            </Field>
            <Field label="상호명" required error={errors.storeName}><input value={draft.storeName} onChange={(event) => updateDraft('storeName', event.target.value)} placeholder="상호명 입력" maxLength={50} /></Field>
            <Field label="대표 키워드" required error={errors.keyword}><input value={draft.keyword} onChange={(event) => updateDraft('keyword', event.target.value)} placeholder="대표 키워드 입력" maxLength={50} /></Field>
            <Field label="일일 구동 수량" required error={errors.dailyShots}><div className="input-unit"><input type="number" min="1" step="1" value={draft.dailyShots} onChange={(event) => updateDraft('dailyShots', event.target.value)} placeholder="100" /><span>타</span></div></Field>
            <Field label="구동 일수" required error={errors.operationDays}><div className="input-unit"><input type="number" min="1" step="1" value={draft.operationDays} onChange={(event) => updateDraft('operationDays', event.target.value)} placeholder="30" /><span>일</span></div></Field>
            <Field className="span-2" label="메모" error={errors.memo}><textarea value={draft.memo} onChange={(event) => updateDraft('memo', event.target.value)} placeholder="관리자에게 전달할 내용이 있다면 입력하세요." maxLength={300} rows={3} /></Field>
          </div>
          <EstimateStrip user={user} draft={draft} settings={settings} now={now} />
          <div className="form-footer"><button className="secondary-button" onClick={() => { setDraft(EMPTY_DRAFT); setErrors({}); setFormOpen(false) }}>취소</button><button className="primary-button" onClick={openPreview}>접수 확인</button></div>
        </section>
      )}

      <section className="panel orders-panel fill-panel">
        <div className="order-toolbar">
          <div className="filter-tabs">{(['전체', ...STATUS_ORDER] as const).map((status) => <button key={status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>{status}<span>{counts[status]}</span></button>)}</div>
          <div className="toolbar-actions"><label className="search-box"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="등록자, 상호명, MID 검색" /></label>{user.role === 'admin' && <button className="secondary-button small" onClick={downloadExcel}><Icon name="download" />엑셀</button>}</div>
        </div>
        {visible.length === 0 ? <div className="empty-state fill-empty-state">조건에 맞는 작업이 없습니다.</div> : (
          <>
            <div className="desktop-table"><table className="orders-table"><thead><tr>{user.role === 'admin' && <th className="checkbox-cell"><input type="checkbox" checked={visible.length > 0 && visible.every((order) => selectedIds.has(order.id))} onChange={toggleAll} /></th>}<th>No.</th><th>시작일</th><th>종료일</th><th>남은일</th>{user.role === 'admin' && <th>등록자</th>}<th>상호명</th><th>플레이스 URL</th><th>MID</th><th>키워드</th><th>구동일수</th><th>일일수량</th><th>상태</th>{user.role !== 'admin' && <th>오늘 진행</th>}{user.role === 'admin' && <th>관리</th>}</tr></thead>
            <tbody>{visible.map((order, index) => <tr key={order.id}>{user.role === 'admin' && <td className="checkbox-cell"><input type="checkbox" checked={selectedIds.has(order.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(order.id)) next.delete(order.id); else next.add(order.id); return next })} /></td>}<td>{index + 1}</td><td>{formatDate(order.startDate)}</td><td>{formatDate(order.endDate)}</td><td>{daysRemaining(order.startDate, order.endDate, now)}</td>{user.role === 'admin' && <td>{order.creatorUsername}</td>}<td><strong>{order.storeName}</strong></td><td><a href={order.placeUrl} target="_blank" rel="noreferrer">{order.placeUrl}</a></td><td>{order.mid}</td><td>{order.keyword}</td><td>{order.operationDays}일</td><td>{order.dailyShots.toLocaleString('ko-KR')}타</td><td><StatusBadge status={order.status} /></td>{user.role !== 'admin' && <td>{order.status === '구동중' ? <ProgressGauge order={order} now={now} compact /> : <span className="muted">-</span>}</td>}{user.role === 'admin' && <td><select className="status-select" disabled={changingId === order.id} value={order.status} onChange={(event) => void changeStatus(order, event.target.value as OrderStatus)}>{STATUS_ORDER.map((status) => <option key={status}>{status}</option>)}</select></td>}</tr>)}</tbody></table></div>
            <div className="mobile-order-list">{visible.map((order) => <article key={order.id} className="mobile-order-card"><div><strong>{order.storeName}</strong><StatusBadge status={order.status} /></div><p>{order.keyword}</p><dl><div><dt>구동기간</dt><dd>{order.startDate} ~ {order.endDate}</dd></div><div><dt>일일수량</dt><dd>{order.dailyShots.toLocaleString('ko-KR')}타</dd></div><div><dt>구동일수</dt><dd>{order.operationDays.toLocaleString('ko-KR')}일</dd></div><div><dt>금액</dt><dd>{formatWon(order.totalAmount)}</dd></div></dl>{order.status === '구동중' && user.role !== 'admin' && <ProgressGauge order={order} now={now} />}{user.role === 'admin' && <select className="status-select" disabled={changingId === order.id} value={order.status} onChange={(event) => void changeStatus(order, event.target.value as OrderStatus)}>{STATUS_ORDER.map((status) => <option key={status}>{status}</option>)}</select>}</article>)}</div>
          </>
        )}
      </section>

      {preview && <Modal title="접수 내용 확인" description="접수 후 금액과 기간을 다시 확인해 주세요." onClose={() => setPreview(null)} footer={<><button className="secondary-button" onClick={() => setPreview(null)}>수정</button><button className="primary-button" disabled={submitting} onClick={() => void submitOrder()}>{submitting ? '접수 중...' : '접수 완료'}</button></>}><div className="preview-grid"><Summary label="상호명" value={preview.draft.storeName} /><Summary label="MID" value={preview.mid} /><Summary label="대표 키워드" value={preview.draft.keyword} /><Summary label="일일 수량" value={`${Number(preview.draft.dailyShots).toLocaleString('ko-KR')}타`} /><Summary label="구동 기간" value={`${preview.startDate} ~ ${preview.endDate}`} wide /><Summary label="1타당 단가" value={formatWon(user.pricePerShot)} /><Summary label="공급가액" value={formatWon(preview.supplyAmount)} /><Summary label="부가세" value={formatWon(preview.vatAmount)} /><Summary label="최종 결제금액" value={formatWon(preview.totalAmount)} strong /></div></Modal>}
      {createdOrder && <Modal title="접수가 완료되었습니다." onClose={() => setCreatedOrder(null)} footer={<button className="primary-button" onClick={() => setCreatedOrder(null)}>확인</button>}><div className="success-box"><Icon name="check" size={24} /><div><strong>{createdOrder.storeName}</strong><p>입금대기 상태로 접수되었습니다.</p></div></div></Modal>}
    </div>
  )
}

function Field({ label, required = false, error, className = '', children }: { label: string; required?: boolean; error?: string; className?: string; children: ReactNode }) {
  return <label className={`field ${className}`}><span>{label}{required && <b>*</b>}</span>{children}{error && <small className="field-error">{error}</small>}</label>
}

function EstimateStrip({ user, draft, settings, now }: { user: User; draft: OrderDraft; settings: AppSettings; now: Date }) {
  const dailyShots = Number(draft.dailyShots) || 0
  const operationDays = Number(draft.operationDays) || 0
  const amount = calculateAmount(dailyShots, operationDays, user.pricePerShot)
  const dates = operationDays > 0 ? calculateOperationDates(operationDays, settings.cutoffHour, now) : { startDate: '-', endDate: '-' }
  return <div className="estimate-strip"><span>{dailyShots.toLocaleString('ko-KR')}타 × {operationDays.toLocaleString('ko-KR')}일 × {formatWon(user.pricePerShot)} + VAT</span><span>{dates.startDate} ~ {dates.endDate}</span><strong>{formatWon(amount.totalAmount)}</strong></div>
}

function Summary({ label, value, wide = false, strong = false }: { label: string; value: string; wide?: boolean; strong?: boolean }) {
  return <div className={`${wide ? 'wide' : ''} ${strong ? 'summary-strong' : ''}`}><span>{label}</span><strong>{value}</strong></div>
}
