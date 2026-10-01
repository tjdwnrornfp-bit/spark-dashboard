import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignupDraft } from '../domain/types'
import { normalizePhoneNumber, normalizeUsername, passwordToAuthSecret, usernameToAuthEmail } from './auth'

export const INVALID_SIGNUP_CODE_MESSAGE = '추천 또는 관리 코드를 잘못 입력했거나 사용할 수 없습니다. 전달받은 코드를 빠짐없이 입력했는지 확인해 주세요.'
export const SIGNUP_UNAVAILABLE_MESSAGE = '회원가입을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.'

function signupErrorMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const message = [typeof error === 'string' ? error : '', record.message, record.code].filter(value => typeof value === 'string').join(' ')
  if (/유효한 추천 또는 관리 코드를 찾을 수 없습니다/.test(message)) return INVALID_SIGNUP_CODE_MESSAGE
  if (/user already registered|user_already_exists|email_exists|이미 사용 중/i.test(message)) return '이미 사용 중이거나 가입 신청된 아이디입니다.'
  if (/over_.*rate_limit|too many requests|rate limit/i.test(message)) return '가입 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  return SIGNUP_UNAVAILABLE_MESSAGE
}

export async function registerRemoteMember(client: Pick<SupabaseClient, 'rpc' | 'auth'>, draft: SignupDraft): Promise<{ ok: boolean; message: string }> {
  const username = draft.username.normalize('NFKC').trim()
  const referral = draft.referralCode.normalize('NFKC').trim()
  try {
    // Auth intentionally hides trigger details. Check only code validity before signup;
    // the existing signup trigger remains the authority for relationships and approval.
    if (referral) {
      const { data, error } = await client.rpc('is_signup_referral_code_valid_v10131', { p_code: referral })
      if (error) throw error
      if (data === false) return { ok: false, message: INVALID_SIGNUP_CODE_MESSAGE }
      if (data !== true) return { ok: false, message: SIGNUP_UNAVAILABLE_MESSAGE }
    }
    const { error } = await client.auth.signUp({
      email: await usernameToAuthEmail(username),
      password: await passwordToAuthSecret(draft.password),
      options: { data: {
        username,
        username_key: normalizeUsername(username),
        phone_number: normalizePhoneNumber(draft.phoneNumber),
        referral_code: referral,
      } },
    })
    if (error) throw error
    await client.auth.signOut()
    return { ok: true, message: '가입 신청이 완료되었습니다. 승인 후 로그인할 수 있습니다.' }
  } catch (error) {
    return { ok: false, message: signupErrorMessage(error) }
  }
}
