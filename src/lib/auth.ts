export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}


export async function passwordToAuthSecret(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`spark-auth-v1:${password}`))
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `Sp!${hex}`
}

export function normalizeUsername(username: string): string {
  return username.normalize('NFKC').trim().toLocaleLowerCase('ko-KR')
}

function characterLength(value: string): number {
  return Array.from(value).length
}

export function validateUsername(username: string): string | null {
  const value = username.trim()
  const length = characterLength(value)
  if (length < 4) return '아이디는 종류와 관계없이 4자 이상 입력해 주세요.'
  if (length > 40) return '아이디는 40자 이하로 입력해 주세요.'
  if (/\p{Cc}/u.test(value)) return '아이디에 제어 문자는 사용할 수 없습니다.'
  return null
}

export function validatePassword(password: string): string | null {
  if (characterLength(password) < 4) return '비밀번호는 종류와 관계없이 4자 이상 입력해 주세요.'
  if (characterLength(password) > 72) return '비밀번호는 72자 이하로 입력해 주세요.'
  return null
}

export async function usernameToAuthEmail(username: string): Promise<string> {
  const normalized = normalizeUsername(username)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `u_${hex}@spark.invalid`
}

export function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  return (phoneNumber ?? '').replace(/[^0-9]/g, '')
}

export function validatePhoneNumber(phoneNumber: string): string | null {
  const digits = normalizePhoneNumber(phoneNumber)
  if (!digits) return '전화번호를 입력해 주세요.'
  if (digits.length < 8 || digits.length > 15) return '전화번호는 숫자 8~15자리로 입력해 주세요.'
  return null
}

export function formatPhoneNumber(phoneNumber: string | null | undefined): string {
  const digits = normalizePhoneNumber(phoneNumber)
  if (!digits) return '-'
  if (digits.length === 11 && digits.startsWith('010')) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  if (digits.length === 10 && digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 9 && digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
  return digits
}

