import { useState } from 'react'
import { ApprovalBadge } from '../components/StatusBadge'
import type { User } from '../domain/types'
import { validatePassword } from '../lib/auth'
import { formatDateTime } from '../lib/date'
import { formatWon } from '../lib/money'
import { PageHeader } from './DashboardPage'

function getErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : '비밀번호를 변경하지 못했습니다.'
}

export function MyInfoPage({ user, onPasswordChange }: { user: User; onPasswordChange: (currentPassword: string, nextPassword: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const roleLabel = user.role === 'admin' ? '관리자' : user.role === 'distributor' ? '총판' : '대행사'

  const submit = async () => {
    setMessage(null)
    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      setMessage({ type: 'error', text: passwordError })
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '새 비밀번호 확인이 일치하지 않습니다.' })
      return
    }
    setLoading(true)
    try {
      await onPasswordChange(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' })
    } catch (error) {
      setMessage({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-stack myinfo-page-stack">
      <PageHeader title="내 정보" subtitle="회원 정보와 비밀번호를 관리합니다." />
      <section className="myinfo-grid fill-myinfo-grid">
        <article className="panel profile-summary">
          <div className="profile-circle">{user.username.slice(0, 1).toUpperCase()}</div>
          <strong>{user.username}</strong>
          <span>{roleLabel}</span>
          <ApprovalBadge status={user.approvalStatus} />
          <dl>
            <div><dt>아이디</dt><dd>{user.username}</dd></div>
            <div><dt>가입 신청일</dt><dd>{formatDateTime(user.requestedAt)}</dd></div>
            <div><dt>승인일</dt><dd>{user.approvedAt ? formatDateTime(user.approvedAt) : '-'}</dd></div>
            {user.role !== 'admin' && <div><dt>1타당 단가</dt><dd>{formatWon(user.pricePerShot)}</dd></div>}
          </dl>
        </article>
        <article className="panel password-panel">
          <div className="panel-header"><div><h2>비밀번호 변경</h2><p>문자 종류와 관계없이 4자 이상 입력해 주세요.</p></div></div>
          <div className="modal-form password-form-wide">
            <label><span>현재 비밀번호</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label><span>새 비밀번호</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label><span>새 비밀번호 확인</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          </div>
          {message && <p className={`inline-message ${message.type}`}>{message.text}</p>}
          <div className="form-footer"><button className="primary-button" disabled={loading || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submit()}>{loading ? '변경 중...' : '저장'}</button></div>
        </article>
      </section>
    </div>
  )
}
