import { useState } from 'react'
import type { SignupDraft } from '../domain/types'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { normalizePhoneNumber, validatePassword, validatePhoneNumber, validateUsername } from '../lib/auth'

const EMPTY_SIGNUP: SignupDraft = { username: '', phoneNumber: '', password: '', passwordConfirm: '', referralCode: '' }

export function AuthPage({ onLogin, onRegister, serverMode }: {
  onLogin: (username: string, password: string) => Promise<{ ok: boolean; message: string }>
  onRegister: (draft: SignupDraft) => Promise<{ ok: boolean; message: string }>
  serverMode: boolean
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState(EMPTY_SIGNUP)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next)
    setMessage(null)
  }

  const submitLogin = async () => {
    setMessage(null)
    if (!username.trim() || !password) {
      setMessage({ type: 'error', text: '아이디와 비밀번호를 입력해 주세요.' })
      return
    }
    setLoading(true)
    const result = await onLogin(username, password)
    setLoading(false)
    if (!result.ok) setMessage({ type: 'error', text: result.message })
  }

  const submitSignup = async () => {
    setMessage(null)
    const usernameError = validateUsername(signup.username)
    const phoneError = validatePhoneNumber(signup.phoneNumber)
    const passwordError = validatePassword(signup.password)
    if (usernameError || phoneError || passwordError) {
      setMessage({ type: 'error', text: usernameError ?? phoneError ?? passwordError ?? '입력값을 확인해 주세요.' })
      return
    }
    if (signup.password !== signup.passwordConfirm) {
      setMessage({ type: 'error', text: '비밀번호 확인이 일치하지 않습니다.' })
      return
    }
    setLoading(true)
    try {
      const result = await onRegister(signup)
      setMessage({ type: result.ok ? 'success' : 'error', text: result.message })
      if (result.ok) setSignup(EMPTY_SIGNUP)
    } catch {
      setMessage({ type: 'error', text: '회원가입 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><Logo /></div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>로그인</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>회원가입</button>
        </div>
        {mode === 'login' ? (
          <div className="auth-form">
            <label><span>아이디</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="아이디 입력" onKeyDown={(event) => { if (event.key === 'Enter') void submitLogin() }} /></label>
            <label><span>비밀번호</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 입력" onKeyDown={(event) => { if (event.key === 'Enter') void submitLogin() }} /></label>
            {message && <p className={`auth-message ${message.type}`}>{message.text}</p>}
            <button className="primary-button auth-submit" disabled={loading} onClick={() => void submitLogin()}>{loading ? '확인 중...' : '로그인'}</button>
            {!serverMode && <div className="demo-credentials"><Icon name="lock" size={13} /><span>관리자: admin / admin1234<br />대행사: agency1 / pass1234<br />총판: dist1 / pass1234</span></div>}
          </div>
        ) : (
          <div className="auth-form">
            <label><span>아이디</span><input autoComplete="username" value={signup.username} onChange={(event) => setSignup((current) => ({ ...current, username: event.target.value }))} placeholder="종류와 관계없이 4자 이상" /></label>
            <label><span>전화번호</span><input type="tel" autoComplete="tel" inputMode="numeric" value={signup.phoneNumber} onChange={(event) => setSignup((current) => ({ ...current, phoneNumber: normalizePhoneNumber(event.target.value).slice(0, 15) }))} placeholder="01012345678" /></label>
            <label><span>비밀번호</span><input type="password" autoComplete="new-password" value={signup.password} onChange={(event) => setSignup((current) => ({ ...current, password: event.target.value }))} placeholder="종류와 관계없이 4자 이상" /></label>
            <label><span>비밀번호 확인</span><input type="password" autoComplete="new-password" value={signup.passwordConfirm} onChange={(event) => setSignup((current) => ({ ...current, passwordConfirm: event.target.value }))} placeholder="비밀번호 다시 입력" /></label>
            <label><span>추천 또는 관리 코드 <small>(선택)</small></span><input value={signup.referralCode} onChange={(event) => setSignup((current) => ({ ...current, referralCode: event.target.value }))} placeholder="추천 또는 관리 코드가 있을 때만 입력" /></label>
            {message && <p className={`auth-message ${message.type}`}>{message.text}</p>}
            <button className="primary-button auth-submit" disabled={loading} onClick={() => void submitSignup()}>{loading ? '처리 중...' : '가입 신청'}</button>
            <p className="auth-help">가입 승인 후 로그인할 수 있습니다.</p>
          </div>
        )}
      </section>
    </main>
  )
}
