const SEOUL_TIME_ZONE = 'Asia/Seoul'

export interface SeoulDateTimeParts {
  date: string
  hour: number
  minute: number
  second: number
}

export function seoulDateTimeParts(date = new Date()): SeoulDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

export function addDays(dateString: string, amount: number): string {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

export function todayInSeoul(now = new Date()): string {
  return seoulDateTimeParts(now).date
}

export function earliestOrderStartDate(now = new Date()): string {
  return addDays(todayInSeoul(now), 1)
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const checked = new Date(Date.UTC(year, month - 1, day))
  return checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day
}

/**
 * 신규 접수는 최소 익일부터 시작할 수 있습니다.
 * cutoffHour 인자는 이전 버전 호출부와의 호환성을 위해 유지합니다.
 */
export function calculateOperationDates(
  operationDays: number,
  _cutoffHour: number,
  now = new Date(),
  requestedStartDate?: string,
) {
  const minimum = earliestOrderStartDate(now)
  const startDate = requestedStartDate && isIsoDate(requestedStartDate) && requestedStartDate >= minimum
    ? requestedStartDate
    : minimum
  return { startDate, endDate: addDays(startDate, operationDays - 1) }
}

export function hasReachedSeoulTime(targetDate: string, targetHour: number, now = new Date()): boolean {
  const current = seoulDateTimeParts(now)
  if (current.date !== targetDate) return current.date > targetDate
  return current.hour >= targetHour
}

export function seoulTimeIso(dateString: string, hour: number): string {
  return new Date(`${dateString}T${String(hour).padStart(2, '0')}:00:00+09:00`).toISOString()
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(`${dateString}T00:00:00+09:00`))
}

export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SEOUL_TIME_ZONE,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))
}

export function daysRemaining(startDate: string, endDate: string, now = new Date()): number | '만료' {
  const today = todayInSeoul(now)
  if (today < startDate) {
    const start = Date.parse(`${startDate}T00:00:00Z`)
    const end = Date.parse(`${endDate}T00:00:00Z`)
    return Math.floor((end - start) / 86_400_000) + 1
  }
  if (today > endDate) return '만료'
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1
}
