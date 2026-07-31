import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import type { AppSettings, Order, PaymentAccount, PaymentStep, User } from '../domain/types'
import { formatDate, formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '요청을 처리하지 못했습니다.'
}

export function SettlementPage({ user, orders, paymentSteps, paymentAccount, settings, onSettingsChange, onConfirmPayment }: {
  user: User
  orders: Order[]
  paymentSteps: PaymentStep[]
  paymentAccount: PaymentAccount
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => Promise<void>
  onConfirmPayment: (step: PaymentStep) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)
  const visibleOrders = user.role === 'admin' ? orders : orders.filter((order) => order.createdBy === user.id)
  const waiting = visibleOrders.filter((order) => order.status === '입금대기')
  const confirmed = visibleOrders.filter((order) => order.status !== '입금대기')
  const waitingAmount = waiting.reduce((sum, order) => sum + order.totalAmount, 0)
  const confirmedAmount = confirmed.reduce((sum, order) => sum + order.totalAmount, 0)
  const totalAmount = waitingAmount + confirmedAmount

  const incomingSteps = useMemo(
    () => paymentSteps.filter((step) => step.payeeId === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [paymentSteps, user.id],
  )
  const outgoingSteps = useMemo(
    () => paymentSteps.filter((step) => step.payerId === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [paymentSteps, user.id],
  )

  const copyAccount = async () => {
    const account = user.role === 'admin'
      ? `${settings.bank} ${settings.accountNumber} ${settings.accountHolder}`
      : `${paymentAccount.bank} ${paymentAccount.accountNumber} ${paymentAccount.accountHolder}`
    await navigator.clipboard.writeText(account)
  }

  const confirmPayment = async (step: PaymentStep) => {
    if (changingId) return
    setChangingId(step.id)
    try { await onConfirmPayment(step) } catch (error) { window.alert(getErrorMessage(error)) } finally { setChangingId(null) }
  }

  const saveSettings = async () => {
    if (saving) return
    setSaving(true)
    try { await onSettingsChange(form); setEditing(false) } catch (error) { window.alert(getErrorMessage(error)) } finally { setSaving(false) }
  }

  const accountBank = user.role === 'admin' ? settings.bank : paymentAccount.bank
  const accountNumber = user.role === 'admin' ? settings.accountNumber : paymentAccount.accountNumber
  const accountHolder = user.role === 'admin' ? settings.accountHolder : paymentAccount.accountHolder
  const payeeLabel = user.role === 'admin' ? '관리자 입금 계좌' : paymentAccount.source === 'sponsor' ? `상위 회원 ${paymentAccount.payeeUsername} 입금 계좌` : '관리자 입금 계좌'

  return (
    <div className="page-stack settlement-page-stack">
      <PageHeader title="정산" subtitle="하위 회원에게 받은 입금과 상위 회원에게 보낼 정산 단계를 확인합니다." />
      <section className="settlement-cards"><article><span>입금 대기 금액</span><strong>{formatWon(waitingAmount)}</strong><small>{waiting.length}건</small></article><article><span>입금 완료 금액</span><strong>{formatWon(confirmedAmount)}</strong><small>{confirmed.length}건</small></article><article><span>총 접수 금액</span><strong>{formatWon(totalAmount)}</strong><small>{visibleOrders.length}건</small></article></section>

      <section className="account-strip"><div><span>{payeeLabel}</span><strong>{accountBank && accountNumber ? `${accountBank} ${accountNumber}` : '계좌 미등록'}</strong><small>{accountHolder ? `예금주 ${accountHolder}` : '상위 회원에게 계좌 등록을 요청해 주세요.'}</small></div><div>{accountNumber && <button className="secondary-button small" onClick={() => void copyAccount()}><Icon name="copy" />계좌 복사</button>}{user.role === 'admin' && <button className="dark-small-button" onClick={() => { setForm(settings); setEditing(true) }}>계좌 수정</button>}</div></section>

      <section className="settlement-chain-grid">
        <section className="panel compact-panel fill-panel">
          <div className="panel-header"><div><h2>{user.role === 'admin' ? '관리자 입금 확인' : '하위 대행사 입금 확인'}</h2><p>실제 입금 확인 후 수취인이 버튼을 누릅니다.</p></div></div>
          {incomingSteps.length === 0 ? <div className="empty-state">확인할 입금 단계가 없습니다.</div> : <div className="desktop-table"><table className="simple-table settlement-table"><thead><tr><th>작업</th><th>입금자</th><th>1타 단가</th><th>입금액</th><th>상태</th><th>확인</th></tr></thead><tbody>{incomingSteps.map((step) => <tr key={step.id}><td><strong>{step.storeName}</strong><small>{step.orderNumber}</small></td><td>{step.payerUsername}</td><td>{formatWon(step.unitPrice)}</td><td><strong>{formatWon(step.totalAmount)}</strong></td><td>{step.confirmedAt ? <span className="payment-confirmed-text">{formatDateTime(step.confirmedAt)} 확인</span> : <span className="payment-waiting-text">입금대기</span>}</td><td>{step.confirmedAt ? '-' : <button className="primary-button table-action-button" disabled={changingId === step.id} onClick={() => void confirmPayment(step)}>{changingId === step.id ? '처리 중' : '입금확인'}</button>}</td></tr>)}</tbody></table></div>}
        </section>

        {user.role !== 'admin' && <section className="panel compact-panel fill-panel">
          <div className="panel-header"><div><h2>내 상위 정산 내역</h2><p>상위 수취인이 입금을 확인하면 완료됩니다.</p></div></div>
          {outgoingSteps.length === 0 ? <div className="empty-state">상위 정산 내역이 없습니다.</div> : <div className="desktop-table"><table className="simple-table settlement-table"><thead><tr><th>작업</th><th>받는 회원</th><th>1타 단가</th><th>정산액</th><th>상태</th></tr></thead><tbody>{outgoingSteps.map((step) => <tr key={step.id}><td><strong>{step.storeName}</strong><small>{step.orderNumber}</small></td><td>{step.payeeUsername}</td><td>{formatWon(step.unitPrice)}</td><td><strong>{formatWon(step.totalAmount)}</strong></td><td>{step.confirmedAt ? <span className="payment-confirmed-text">입금확인 완료</span> : <span className="payment-waiting-text">상위 확인 대기</span>}</td></tr>)}</tbody></table></div>}
        </section>}
      </section>

      <section className="panel compact-panel fill-panel"><div className="panel-header"><div><h2>내 작업 결제 상태</h2><p>모든 상위 정산 단계가 확인되면 작업이 입금완료로 변경됩니다.</p></div></div>{visibleOrders.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="desktop-table"><table className="simple-table settlement-table"><thead><tr><th>등록자</th><th>상호명</th><th>최종금액</th><th>시작일</th><th>상태</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id}><td>{order.creatorUsername}</td><td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td><strong>{formatWon(order.totalAmount)}</strong></td><td>{formatDate(order.startDate)}</td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>}</section>

      {editing && <Modal title="관리자 정산 계좌 수정" onClose={() => setEditing(false)} footer={<><button className="secondary-button" onClick={() => setEditing(false)}>취소</button><button className="primary-button" disabled={saving} onClick={() => void saveSettings()}>{saving ? '저장 중...' : '저장'}</button></>}><div className="modal-form"><label><span>은행</span><input value={form.bank} onChange={(event) => setForm((current) => ({ ...current, bank: event.target.value }))} /></label><label><span>계좌번호</span><input value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value }))} /></label><label><span>예금주</span><input value={form.accountHolder} onChange={(event) => setForm((current) => ({ ...current, accountHolder: event.target.value }))} /></label></div></Modal>}
    </div>
  )
}
