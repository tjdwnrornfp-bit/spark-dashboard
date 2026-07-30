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
