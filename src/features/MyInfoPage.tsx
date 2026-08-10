import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { ProgramIcon } from '../components/ProgramIcon'
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
  const [copied, setCopied] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState('')
  const [account, setAccount] = useState<AccountDraft>({ bank: user.bank, accountNumber: user.accountNumber, accountHolder: user.accountHolder })
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const prices = getProgramPriceMap(user)
  const isManager = user.isOperationsManager
  const roleLabel = isManager ? '중간관리자' : user.role === 'admin' ? '관리자' : user.role === 'distributor' ? '총판' : '대행사'

  const copyReferralCode = async () => {
    if (!user.referralCode) return
    await navigator.clipboard.writeText(user.referralCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

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
    <div className="page-stack myinfo-page-stack">
      <PageHeader title="내 정보" subtitle={isManager ? '중간관리자 권한과 관리 코드를 확인합니다.' : '계정과 프로그램별 단가, 정산 정보를 한곳에서 확인합니다.'} />

      <section className="myinfo-hero">
        <div className="myinfo-identity">
          <div className="myinfo-logo-wrap"><Logo compact /></div>
          <div>
            <span className="myinfo-eyebrow">MY ACCOUNT</span>
            <div className="myinfo-name-line"><h2>{user.username}</h2><span className="myinfo-role-badge">{roleLabel}</span><span className="myinfo-active-badge">사용중</span></div>
            <p>{user.role === 'admin' ? 'SPARK 관리자 계정' : isManager ? 'SPARK 중간관리자 계정' : 'SPARK 작업 관리 계정'}</p>
          </div>
        </div>
        {user.role !== 'admin' && (
          <div className="myinfo-referral-card">
            <span>{isManager ? '관리 코드' : '추천 코드'}</span>
            <strong>{user.referralCode || user.username}</strong>
            <button className="myinfo-copy-button" onClick={() => void copyReferralCode()}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? '복사됨' : '코드 복사'}</button>
          </div>
        )}
      </section>

      {user.role !== 'admin' && !isManager && (
        <section className="panel myinfo-program-panel">
          <div className="panel-header"><div><h2>프로그램별 단가</h2><p>접수 시점의 단가가 주문과 정산 내역에 고정됩니다.</p></div></div>
          <div className="myinfo-price-grid">
            <article className="myinfo-price-card">
              <ProgramIcon programType="spark" size={48} />
              <div><span>스파크</span><strong>{formatWon(prices.spark)}</strong><small>1타 기준</small></div>
            </article>
            <article className="myinfo-price-card">
              <ProgramIcon programType="spark_plus" size={48} />
              <div><span>스파크 +</span><strong>{formatWon(prices.spark_plus)}</strong><small>1타 기준</small></div>
            </article>
            <article className="myinfo-price-card">
              <ProgramIcon programType="spark_s" size={48} />
              <div><span>스파크S</span><strong>{formatWon(prices.spark_s)}</strong><small>1건 기준</small></div>
            </article>
          </div>
        </section>
      )}

      <section className="myinfo-detail-grid">
        {isManager ? (
          <section className="panel myinfo-detail-card manager-permission-card">
            <div className="myinfo-detail-header">
              <div className="myinfo-section-icon"><Icon name="users" size={20} /></div>
              <div><h2>중간관리자 권한</h2><p>내 관리 코드로 가입한 대행사만 승인하고 단가를 지정할 수 있습니다.</p></div>
            </div>
            <dl className="myinfo-info-tiles">
              <div><dt>회원 승인</dt><dd>가능</dd></div>
              <div><dt>단가 지정</dt><dd>가능</dd></div>
              <div><dt>정산 경로</dt><dd>관리자 직결</dd></div>
            </dl>
            <div className="myinfo-security-state manager-direct-settlement"><span className="myinfo-security-dot" /><div><strong>중간관리자 계좌는 정산에 사용되지 않습니다.</strong><p>관리 대행사에는 관리자 입금 계좌가 표시되고, 정산 단계도 관리자에게 직접 생성됩니다.</p></div></div>
          </section>
        ) : (
          <section className="panel myinfo-detail-card">
            <div className="myinfo-detail-header">
              <div className="myinfo-section-icon"><Icon name="wallet" size={20} /></div>
              <div><h2>정산 계좌</h2><p>{user.role === 'admin' ? '관리자 정산 계좌입니다.' : '하위 대행사에게 표시되는 입금 계좌입니다.'}</p></div>
              {user.role !== 'admin' && <button className="secondary-button small" onClick={() => { setAccount({ bank: user.bank, accountNumber: user.accountNumber, accountHolder: user.accountHolder }); setAccountOpen((value) => !value) }}>{accountOpen ? '닫기' : '계좌 수정'}</button>}
            </div>
            <dl className="myinfo-info-tiles">
              <div><dt>은행</dt><dd>{user.bank || '미등록'}</dd></div>
              <div><dt>계좌번호</dt><dd>{user.accountNumber || '미등록'}</dd></div>
              <div><dt>예금주</dt><dd>{user.accountHolder || '미등록'}</dd></div>
            </dl>
            {accountOpen && user.role !== 'admin' && (
              <div className="myinfo-inline-editor">
                <div className="myinfo-editor-grid">
                  <label><span>은행</span><input value={account.bank} onChange={(event) => setAccount((current) => ({ ...current, bank: event.target.value }))} placeholder="은행명" /></label>
                  <label><span>계좌번호</span><input value={account.accountNumber} onChange={(event) => setAccount((current) => ({ ...current, accountNumber: event.target.value }))} placeholder="계좌번호" /></label>
                  <label><span>예금주</span><input value={account.accountHolder} onChange={(event) => setAccount((current) => ({ ...current, accountHolder: event.target.value }))} placeholder="예금주" /></label>
                </div>
                <div className="myinfo-editor-actions"><button className="secondary-button" onClick={() => setAccountOpen(false)}>취소</button><button className="primary-button" disabled={savingAccount} onClick={() => void saveAccount()}>{savingAccount ? '저장 중...' : '계좌 저장'}</button></div>
              </div>
            )}
          </section>
        )}

        <section className="panel myinfo-detail-card">
          <div className="myinfo-detail-header">
            <div className="myinfo-section-icon security"><Icon name="lock" size={20} /></div>
            <div><h2>로그인 보안</h2><p>주기적으로 비밀번호를 변경해 계정을 보호하세요.</p></div>
            <button className="secondary-button small" onClick={() => setPasswordOpen((value) => !value)}>{passwordOpen ? '닫기' : '비밀번호 변경'}</button>
          </div>
          {!passwordOpen && <div className="myinfo-security-state"><span className="myinfo-security-dot" /><div><strong>비밀번호가 설정되어 있습니다.</strong><p>현재 비밀번호는 화면에 표시되지 않습니다.</p></div></div>}
          {passwordOpen && (
            <div className="myinfo-inline-editor">
              <div className="myinfo-password-grid">
                <label><span>현재 비밀번호</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                <label><span>새 비밀번호</span><input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label>
                <label><span>새 비밀번호 확인</span><input type="password" value={nextPasswordConfirm} onChange={(event) => setNextPasswordConfirm(event.target.value)} /></label>
              </div>
              <div className="myinfo-editor-actions"><button className="secondary-button" onClick={() => setPasswordOpen(false)}>취소</button><button className="primary-button" disabled={savingPassword} onClick={() => void savePassword()}>{savingPassword ? '저장 중...' : '비밀번호 저장'}</button></div>
            </div>
          )}
        </section>
      </section>
    </div>
  )
}
