import { useState } from 'react'
import { ApprovalBadge } from '../components/StatusBadge'
import type { AccountDraft, User } from '../domain/types'
import { validatePassword } from '../lib/auth'
import { formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '요청을 처리하지 못했습니다.'
}

export function MyInfoPage({ user, onPasswordChange, onAccountChange }: {
  user: User
  onPasswordChange: (currentPassword: string, nextPassword: string) => Promise<void>
  onAccountChange: (account: AccountDraft) => Promise<void>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [account, setAccount] = useState<AccountDraft>({ bank: user.bank, accountNumber: user.accountNumber, accountHolder: user.accountHolder })
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [accountMessage, setAccountMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [accountLoading, setAccountLoading] = useState(false)
  const roleLabel = user.role === 'admin' ? '관리자' : user.role === 'distributor' ? '총판' : '대행사'

  const submitPassword = async () => {
    setPasswordMessage(null)
    const passwordError = validatePassword(newPassword)
    if (passwordError) return setPasswordMessage({ type: 'error', text: passwordError })
    if (newPassword !== confirmPassword) return setPasswordMessage({ type: 'error', text: '새 비밀번호 확인이 일치하지 않습니다.' })
    setLoading(true)
    try {
      await onPasswordChange(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' })
    } catch (error) {
      setPasswordMessage({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  const submitAccount = async () => {
    setAccountMessage(null)
    if (!account.bank.trim() || !account.accountNumber.trim() || !account.accountHolder.trim()) {
      setAccountMessage({ type: 'error', text: '은행, 계좌번호, 예금주를 모두 입력해 주세요.' })
      return
    }
    setAccountLoading(true)
    try {
      await onAccountChange(account)
      setAccountMessage({ type: 'success', text: '하위 대행사에게 표시할 계좌가 저장되었습니다.' })
    } catch (error) {
      setAccountMessage({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setAccountLoading(false)
    }
  }

  return (
    <div className="page-stack myinfo-page-stack">
      <PageHeader title="내 정보" subtitle="회원 정보, 추천 코드, 정산 계좌와 비밀번호를 관리합니다." />
      <section className="myinfo-grid fill-myinfo-grid">
        <article className="panel profile-summary">
          <div className="profile-circle">{user.username.slice(0, 1).toUpperCase()}</div>
          <strong>{user.username}</strong><span>{roleLabel}</span><ApprovalBadge status={user.approvalStatus} />
          <dl>
            <div><dt>아이디</dt><dd>{user.username}</dd></div>
            <div><dt>가입 신청일</dt><dd>{formatDateTime(user.requestedAt)}</dd></div>
            <div><dt>승인일</dt><dd>{user.approvedAt ? formatDateTime(user.approvedAt) : '-'}</dd></div>
            {user.role !== 'admin' && <><div><dt>1타당 단가</dt><dd>{formatWon(user.pricePerShot)}</dd></div><div><dt>추천 코드</dt><dd className="code-value">{user.referralCode || user.username}</dd></div><div><dt>정산 계정</dt><dd>연결 완료</dd></div></>}
          </dl>
        </article>

        <div className="myinfo-content-stack">
          {user.role !== 'admin' && <article className="panel password-panel account-panel">
            <div className="panel-header"><div><h2>하위 대행사 입금 계좌</h2><p>내 추천 코드로 가입한 대행사에게 이 계좌가 표시됩니다.</p></div></div>
            <div className="modal-form password-form-wide account-form-grid">
              <label><span>은행</span><input value={account.bank} onChange={(event) => setAccount((current) => ({ ...current, bank: event.target.value }))} /></label>
              <label><span>계좌번호</span><input value={account.accountNumber} onChange={(event) => setAccount((current) => ({ ...current, accountNumber: event.target.value }))} /></label>
              <label><span>예금주</span><input value={account.accountHolder} onChange={(event) => setAccount((current) => ({ ...current, accountHolder: event.target.value }))} /></label>
            </div>
            {accountMessage && <p className={`inline-message ${accountMessage.type}`}>{accountMessage.text}</p>}
            <div className="form-footer"><button className="primary-button" disabled={accountLoading} onClick={() => void submitAccount()}>{accountLoading ? '저장 중...' : '계좌 저장'}</button></div>
          </article>}

          <article className="panel password-panel">
            <div className="panel-header"><div><h2>비밀번호 변경</h2><p>문자 종류와 관계없이 4자 이상 입력해 주세요.</p></div></div>
            <div className="modal-form password-form-wide">
              <label><span>현재 비밀번호</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label><span>새 비밀번호</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label><span>새 비밀번호 확인</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            </div>
            {passwordMessage && <p className={`inline-message ${passwordMessage.type}`}>{passwordMessage.text}</p>}
            <div className="form-footer"><button className="primary-button" disabled={loading || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submitPassword()}>{loading ? '변경 중...' : '저장'}</button></div>
          </article>
        </div>
      </section>
    </div>
  )
}
