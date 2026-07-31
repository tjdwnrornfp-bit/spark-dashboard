import { useState } from 'react'
import type { AccountDraft, User } from '../domain/types'
import { formatWon } from '../lib/money'
import { getProgramPriceMap } from '../lib/program'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '저장하지 못했습니다.'
}

export function MyInfoPage({ user, onPasswordChange, onAccountChange }: {
  user: User
  onPasswordChange: (currentPassword: string, nextPassword: string) => Promise<void>
  onAccountChange: (account: AccountDraft) => Promise<void>
}) {
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState('')
  const [account, setAccount] = useState<AccountDraft>({ bank: user.bank, accountNumber: user.accountNumber, accountHolder: user.accountHolder })
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const prices = getProgramPriceMap(user)

  const savePassword = async () => {
    if (savingPassword) return
    if (!currentPassword || !nextPassword) return window.alert('현재 비밀번호와 새 비밀번호를 입력해 주세요.')
    if (nextPassword !== nextPasswordConfirm) return window.alert('새 비밀번호 확인이 일치하지 않습니다.')
    setSavingPassword(true)
    try {
      await onPasswordChange(currentPassword, nextPassword)
      setCurrentPassword('')
      setNextPassword('')
      setNextPasswordConfirm('')
      setPasswordOpen(false)
      window.alert('비밀번호가 변경되었습니다.')
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSavingPassword(false)
    }
  }

  const saveAccount = async () => {
    if (savingAccount) return
    setSavingAccount(true)
    try {
      await onAccountChange(account)
      setAccountOpen(false)
      window.alert('정산 계좌가 저장되었습니다.')
    } catch (error) {
      window.alert(getErrorMessage(error))
    } finally {
      setSavingAccount(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="내 정보" subtitle="계정 정보와 프로그램별 단가, 정산 계좌를 확인합니다." />
      <section className="panel">
        <div className="panel-header"><div><h2>기본 정보</h2></div></div>
        <dl className="profile-grid">
          <div><dt>아이디</dt><dd>{user.username}</dd></div>
          <div><dt>회원유형</dt><dd>{user.role === 'admin' ? '관리자' : user.role === 'distributor' ? '총판' : '대행사'}</dd></div>
          {user.role !== 'admin' && <><div><dt>추천 코드</dt><dd className="code-value">{user.referralCode || user.username}</dd></div><div><dt>그룹명</dt><dd>{user.groupName || '-'}</dd></div></>}
        </dl>
      </section>

      {user.role !== 'admin' && (
        <section className="panel">
          <div className="panel-header"><div><h2>프로그램별 단가</h2><p>정산은 주문 접수 시점의 프로그램별 단가 기준으로 고정됩니다.</p></div></div>
          <div className="mini-stat-grid payment-stat-grid">
            <article className="mini-stat"><span>스파크</span><strong>{formatWon(prices.spark)}</strong></article>
            <article className="mini-stat"><span>스파크 +</span><strong>{formatWon(prices.spark_plus)}</strong></article>
            <article className="mini-stat"><span>스파크S</span><strong>{formatWon(prices.spark_s)}</strong></article>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header"><div><h2>정산 계좌</h2></div><button className="dark-small-button" onClick={() => setAccountOpen((value) => !value)}>{accountOpen ? '닫기' : '수정'}</button></div>
        <dl className="profile-grid">
          <div><dt>은행</dt><dd>{user.bank || '-'}</dd></div>
          <div><dt>계좌번호</dt><dd>{user.accountNumber || '-'}</dd></div>
          <div><dt>예금주</dt><dd>{user.accountHolder || '-'}</dd></div>
        </dl>
        {accountOpen && <div className="member-editor"><div className="member-editor-grid"><label><span>은행</span><input value={account.bank} onChange={(event) => setAccount((current) => ({ ...current, bank: event.target.value }))} /></label><label><span>계좌번호</span><input value={account.accountNumber} onChange={(event) => setAccount((current) => ({ ...current, accountNumber: event.target.value }))} /></label><label><span>예금주</span><input value={account.accountHolder} onChange={(event) => setAccount((current) => ({ ...current, accountHolder: event.target.value }))} /></label></div><div className="member-editor-actions"><button className="primary-button" disabled={savingAccount} onClick={() => void saveAccount()}>{savingAccount ? '저장 중...' : '계좌 저장'}</button></div></div>}
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>비밀번호 변경</h2></div><button className="dark-small-button" onClick={() => setPasswordOpen((value) => !value)}>{passwordOpen ? '닫기' : '변경'}</button></div>
        {passwordOpen && <div className="member-editor"><div className="member-editor-grid"><label><span>현재 비밀번호</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label><span>새 비밀번호</span><input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label><label><span>새 비밀번호 확인</span><input type="password" value={nextPasswordConfirm} onChange={(event) => setNextPasswordConfirm(event.target.value)} /></label></div><div className="member-editor-actions"><button className="primary-button" disabled={savingPassword} onClick={() => void savePassword()}>{savingPassword ? '저장 중...' : '비밀번호 저장'}</button></div></div>}
      </section>
    </div>
  )
}
