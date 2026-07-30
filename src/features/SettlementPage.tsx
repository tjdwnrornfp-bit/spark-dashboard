import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import type { AppSettings, Order, OrderStatus, User } from '../domain/types'
import { formatDate } from '../lib/date'
import { formatWon } from '../lib/money'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '요청을 처리하지 못했습니다.'
}

export function SettlementPage({ user, orders, settings, onSettingsChange, onStatusChange }: {
  user: User
  orders: Order[]
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => Promise<void>
  onStatusChange: (order: Order, status: OrderStatus) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)
  const visible = user.role === 'admin' ? orders : orders.filter((order) => order.createdBy === user.id)
  const waiting = visible.filter((order) => order.status === '입금대기')
  const confirmed = visible.filter((order) => order.status !== '입금대기')
  const waitingAmount = waiting.reduce((sum, order) => sum + order.totalAmount, 0)
  const confirmedAmount = confirmed.reduce((sum, order) => sum + order.totalAmount, 0)
  const totalAmount = waitingAmount + confirmedAmount

  const copyAccount = async () => {
    await navigator.clipboard.writeText(`${settings.bank} ${settings.accountNumber} ${settings.accountHolder}`)
  }

  const confirmPayment = async (order: Order) => {
    if (changingId) return
    setChangingId(order.id)
    try {
      await onStatusChange(order, '입금완료')
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setChangingId(null)
    }
  }

  const saveSettings = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSettingsChange(form)
      setEditing(false)
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack settlement-page-stack">
      <PageHeader title="정산" subtitle="작업별 결제금액과 입금 상태를 확인합니다." />
      <section className="settlement-cards"><article><span>입금 대기 금액</span><strong>{formatWon(waitingAmount)}</strong><small>{waiting.length}건</small></article><article><span>입금 완료 금액</span><strong>{formatWon(confirmedAmount)}</strong><small>{confirmed.length}건</small></article><article><span>총 접수 금액</span><strong>{formatWon(totalAmount)}</strong><small>{visible.length}건</small></article></section>
      <section className="account-strip"><div><span>입금 계좌 안내</span><strong>{settings.bank} {settings.accountNumber}</strong><small>예금주 {settings.accountHolder}</small></div><div><button className="secondary-button small" onClick={() => void copyAccount()}><Icon name="copy" />계좌 복사</button>{user.role === 'admin' && <button className="dark-small-button" onClick={() => { setForm(settings); setEditing(true) }}>계좌 수정</button>}</div></section>
      <section className="panel compact-panel fill-panel"><div className="panel-header"><div><h2>정산 내역</h2><p>관리자는 입금 확인 후 입금완료로 변경할 수 있습니다.</p></div></div>{visible.length === 0 ? <div className="empty-state fill-empty-state">정산 내역이 없습니다.</div> : <><div className="desktop-table"><table className="simple-table settlement-table"><thead><tr><th>접수번호</th><th>등록자</th><th>상호명</th><th>공급가액</th><th>부가세</th><th>최종금액</th><th>시작일</th><th>상태</th>{user.role === 'admin' && <th>입금 관리</th>}</tr></thead><tbody>{visible.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.creatorUsername}</td><td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td>{formatWon(order.supplyAmount)}</td><td>{formatWon(order.vatAmount)}</td><td><strong>{formatWon(order.totalAmount)}</strong></td><td>{formatDate(order.startDate)}</td><td><StatusBadge status={order.status} /></td>{user.role === 'admin' && <td>{order.status === '입금대기' ? <button className="primary-button table-action-button" disabled={changingId === order.id} onClick={() => void confirmPayment(order)}>{changingId === order.id ? '처리 중' : '입금완료'}</button> : <span className="payment-confirmed-text">확인됨</span>}</td>}</tr>)}</tbody></table></div><div className="mobile-settlement-list">{visible.map((order) => <article key={order.id}><div><strong>{order.storeName}</strong><StatusBadge status={order.status} /></div><p>{order.keyword}</p><dl><div><dt>최종금액</dt><dd>{formatWon(order.totalAmount)}</dd></div><div><dt>시작일</dt><dd>{formatDate(order.startDate)}</dd></div></dl>{user.role === 'admin' && order.status === '입금대기' && <button className="primary-button" disabled={changingId === order.id} onClick={() => void confirmPayment(order)}>입금완료 처리</button>}</article>)}</div></>}</section>
      {editing && <Modal title="정산 계좌 수정" onClose={() => setEditing(false)} footer={<><button className="secondary-button" onClick={() => setEditing(false)}>취소</button><button className="primary-button" disabled={saving} onClick={() => void saveSettings()}>{saving ? '저장 중...' : '저장'}</button></>}><div className="modal-form"><label><span>은행</span><input value={form.bank} onChange={(event) => setForm((current) => ({ ...current, bank: event.target.value }))} /></label><label><span>계좌번호</span><input value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value }))} /></label><label><span>예금주</span><input value={form.accountHolder} onChange={(event) => setForm((current) => ({ ...current, accountHolder: event.target.value }))} /></label></div></Modal>}
    </div>
  )
}
