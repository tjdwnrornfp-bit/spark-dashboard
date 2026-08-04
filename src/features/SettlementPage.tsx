import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import type { AppSettings, Order, PaymentAccount, PaymentStep, User } from '../domain/types'
import { formatDate, formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { unitLabelForProgram } from '../lib/program'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '요청을 처리하지 못했습니다.'
}

function paymentStepUnit(step: PaymentStep, orders: Order[]): '타' | '건' {
  const order = orders.find((item) => (item.dbId ?? item.id) === step.orderDbId || item.id === step.orderNumber)
  return unitLabelForProgram(order?.programType ?? 'spark')
}

function adminRegistrantLabel(step: PaymentStep, orders: Order[]): string {
  const order = orders.find((item) => (item.dbId ?? item.id) === step.orderDbId || item.id === step.orderNumber)
  if (!order) return '미지정 그룹'
  const group = order.creatorGroupName.trim() || '미지정 그룹'
  return order.createdBy !== step.payerId || order.sponsorId ? `${group} 하위` : group
}

export function SettlementPage({ user, members: _members, orders, paymentSteps, paymentAccount, settings, onSettingsChange, onConfirmPayment }: {
  user: User
  members: User[]
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
  const incomingSteps = useMemo(
    () => paymentSteps.filter((step) => step.payeeId === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [paymentSteps, user.id],
  )
  const outgoingSteps = useMemo(
    () => paymentSteps.filter((step) => step.payerId === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [paymentSteps, user.id],
  )

  // 관리자에게는 최종 관리자 정산 단계만, 대행사·총판에게는 본인이 실제 납부할 단계만 집계합니다.
  const settlementSteps = user.role === 'admin' ? incomingSteps : outgoingSteps
  const waitingSteps = settlementSteps.filter((step) => !step.confirmedAt)
  const confirmedSteps = settlementSteps.filter((step) => step.confirmedAt)
  const waitingAmount = waitingSteps.reduce((sum, step) => sum + step.totalAmount, 0)
  const confirmedAmount = confirmedSteps.reduce((sum, step) => sum + step.totalAmount, 0)
  const totalAmount = waitingAmount + confirmedAmount
  const receivedSteps = incomingSteps.filter((step) => step.confirmedAt)
  const receivedAmount = receivedSteps.reduce((sum, step) => sum + step.totalAmount, 0)
  const adminSettlementByOrder = useMemo(() => new Map(
    incomingSteps.map((step) => [step.orderDbId ?? step.orderNumber, step.totalAmount]),
  ), [incomingSteps])

  const orderSettlementAmount = (order: Order) => user.role === 'admin'
    ? (adminSettlementByOrder.get(order.dbId ?? order.id) ?? adminSettlementByOrder.get(order.id) ?? 0)
    : order.totalAmount

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

  return (
    <div className="page-stack settlement-page-stack">
      <PageHeader title="정산" subtitle={user.role === 'admin' ? '관리자에게 입금되는 최종 정산 금액을 확인합니다.' : '하위 대행사 입금과 내가 처리할 정산 내역을 확인합니다.'} />
      <section className={`settlement-cards ${user.role === 'admin' ? '' : 'settlement-cards-four'}`}>
        <article><span>입금 대기 금액</span><strong>{formatWon(waitingAmount)}</strong><small>{waitingSteps.length}건</small></article>
        <article><span>입금 완료 금액</span><strong>{formatWon(confirmedAmount)}</strong><small>{confirmedSteps.length}건</small></article>
        <article><span>{user.role === 'admin' ? '총 정산 금액' : '총 접수 금액'}</span><strong>{formatWon(totalAmount)}</strong><small>{settlementSteps.length}건</small></article>
        {user.role !== 'admin' && <article className="received-stat"><span>입금 받은 금액</span><strong>{formatWon(receivedAmount)}</strong><small>{receivedSteps.length}건 확인</small></article>}
      </section>

      <section className="account-strip"><div><span>입금 계좌</span><strong>{accountBank && accountNumber ? `${accountBank} ${accountNumber}` : '계좌 미등록'}</strong><small>{accountHolder ? `예금주 ${accountHolder}` : '정산 계좌 등록이 필요합니다.'}</small></div><div>{accountNumber && <button className="secondary-button small" onClick={() => void copyAccount()}><Icon name="copy" />계좌 복사</button>}{user.role === 'admin' && <button className="dark-small-button" onClick={() => { setForm(settings); setEditing(true) }}>계좌 수정</button>}</div></section>

      <section className={`settlement-chain-grid ${user.role === 'admin' ? 'admin-settlement-grid' : ''}`}>
        <section className="panel compact-panel fill-panel settlement-incoming-panel">
          <div className="panel-header"><div><h2>{user.role === 'admin' ? '관리자 입금 확인' : '하위 대행사 입금 확인'}</h2><p>실제 입금을 확인한 뒤 입금확인 버튼을 누릅니다.</p></div></div>
          {incomingSteps.length === 0 ? <div className="empty-state">확인할 입금 내역이 없습니다.</div> : <div className="desktop-table settlement-table-wrap"><table className="simple-table settlement-table settlement-incoming-table"><thead><tr><th>작업</th><th>{user.role === 'admin' ? '등록 그룹' : '입금자'}</th><th>단가</th><th>입금액</th><th>상태</th><th>확인</th></tr></thead><tbody>{incomingSteps.map((step) => <tr key={step.id}><td><strong>{step.storeName}</strong></td><td>{user.role === 'admin' ? adminRegistrantLabel(step, orders) : step.payerUsername}</td><td>{formatWon(step.unitPrice)} / {paymentStepUnit(step, orders)}</td><td><strong>{formatWon(step.totalAmount)}</strong></td><td>{step.confirmedAt ? <span className="payment-confirmed-text">{formatDateTime(step.confirmedAt)} 확인</span> : <span className="payment-waiting-text">입금대기</span>}</td><td>{step.confirmedAt ? <span className="muted">완료</span> : <button className="primary-button table-action-button payment-confirm-button" disabled={changingId === step.id} onClick={() => void confirmPayment(step)}>{changingId === step.id ? '처리 중' : '입금확인'}</button>}</td></tr>)}</tbody></table></div>}
        </section>

        {user.role !== 'admin' && <section className="panel compact-panel fill-panel settlement-outgoing-panel">
          <div className="panel-header"><div><h2>작업 정산 내역</h2><p>내 작업과 하위 작업을 합산한 정산 내역입니다.</p></div></div>
          {outgoingSteps.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="desktop-table settlement-table-wrap"><table className="simple-table settlement-table settlement-outgoing-table"><thead><tr><th>작업</th><th>단가</th><th>정산액</th><th>상태</th></tr></thead><tbody>{outgoingSteps.map((step) => <tr key={step.id}><td><strong>{step.storeName}</strong></td><td>{formatWon(step.unitPrice)} / {paymentStepUnit(step, orders)}</td><td><strong>{formatWon(step.totalAmount)}</strong></td><td>{step.confirmedAt ? <span className="payment-confirmed-text">입금확인 완료</span> : <span className="payment-waiting-text">확인 대기</span>}</td></tr>)}</tbody></table></div>}
        </section>}
      </section>

      <section className="panel compact-panel fill-panel settlement-orders-panel"><div className="panel-header"><div><h2>{user.role === 'admin' ? '전체 작업 결제 상태' : '내 작업 결제 상태'}</h2><p>필요한 입금 확인이 모두 끝나면 작업이 입금완료로 변경됩니다.</p></div></div>{visibleOrders.length === 0 ? <div className="empty-state">정산 내역이 없습니다.</div> : <div className="desktop-table"><table className="simple-table settlement-table settlement-orders-table"><thead><tr>{user.role === 'admin' && <th>등록 그룹</th>}<th>상호명</th><th>{user.role === 'admin' ? '관리자 정산액' : '접수금액'}</th><th>시작일</th><th>상태</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id}>{user.role === 'admin' && <td>{order.creatorGroupName ? `${order.creatorGroupName}${order.sponsorId ? ' 하위' : ''}` : '미지정 그룹'}</td>}<td><strong>{order.storeName}</strong><small>{order.keyword}</small></td><td><strong>{formatWon(orderSettlementAmount(order))}</strong></td><td>{formatDate(order.startDate)}</td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>}</section>

      {editing && <Modal title="관리자 정산 계좌 수정" onClose={() => setEditing(false)} footer={<><button className="secondary-button" onClick={() => setEditing(false)}>취소</button><button className="primary-button" disabled={saving} onClick={() => void saveSettings()}>{saving ? '저장 중...' : '저장'}</button></>}><div className="modal-form"><label><span>은행</span><input value={form.bank} onChange={(event) => setForm((current) => ({ ...current, bank: event.target.value }))} /></label><label><span>계좌번호</span><input value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value }))} /></label><label><span>예금주</span><input value={form.accountHolder} onChange={(event) => setForm((current) => ({ ...current, accountHolder: event.target.value }))} /></label></div></Modal>}
    </div>
  )
}
