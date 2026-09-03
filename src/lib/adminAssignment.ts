import { read, utils, writeFileXLSX } from 'xlsx'
import type { Order, OrderDraft, ProgramType, User } from '../domain/types'
import { normalizeUsername } from './auth'
import { ADMIN_EXCEL_PROGRAM_LABELS } from './adminExcel'
import { earliestOrderStartDate } from './date'
import { validateDraft } from './order'
import { getUserProgramPrice } from './program'

export interface AdminAssignmentRow {
  rowNumber: number
  targetUsername: string
  programLabel: string
  draft: OrderDraft
  parseError?: string
}

export interface AdminAssignmentResult {
  rowNumber: number
  status: 'success' | 'failed'
  order?: Order
  message?: string
}

export const ADMIN_ASSIGNMENT_HEADERS = ['등록자아이디', '프로그램', '상호명', '대표키워드', '플레이스URL', '일일수량', '구동일수', '시작일', '메모']

export function emptyAssignmentDraft(programType: ProgramType, now = new Date()): OrderDraft {
  return { programType, storeName: '', keyword: '', placeUrl: '', dailyShots: '', operationDays: '', startDate: earliestOrderStartDate(now), memo: '' }
}

export function isAssignmentTarget(member: User): boolean {
  return member.active && member.approvalStatus === 'approved' && !member.isOperationsManager && (member.role === 'agency' || member.role === 'distributor')
}

export function assignmentErrors(member: User | undefined, draft: OrderDraft, now = new Date()): string[] {
  const errors = Object.values(validateDraft(draft, now))
  if (!member) errors.unshift('회원을 찾을 수 없습니다.')
  else if (!isAssignmentTarget(member)) errors.unshift('승인된 활성 대행사 또는 총판만 선택할 수 있습니다.')
  else if (getUserProgramPrice(member, draft.programType) <= 0) errors.unshift('해당 회원의 프로그램 승인 단가가 설정되지 않았습니다.')
  return errors
}

export function parseAssignmentProgram(value: string): ProgramType | undefined {
  const normalized = value.normalize('NFKC').replace(/\s/g, '').toLowerCase()
  return (Object.entries(ADMIN_EXCEL_PROGRAM_LABELS) as [ProgramType, string][]).find(([, label]) => label.toLowerCase() === normalized)?.[0]
}

function excelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10)
  const text = String(value ?? '').trim().replace(/[./]/g, '-')
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : text
}

export function readAssignmentWorkbook(data: ArrayBuffer): AdminAssignmentRow[] {
  const workbook = read(data, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('첫 번째 시트에 작업을 입력해 주세요.')
  const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, blankrows: true })
  const header = rows[0]?.map((value) => String(value).normalize('NFKC').replace(/\s/g, ''))
  if (!ADMIN_ASSIGNMENT_HEADERS.every((name, index) => header?.[index] === name)) throw new Error('관리자 전용 양식의 A~I 열 제목을 유지해 주세요.')
  const result: AdminAssignmentRow[] = []
  rows.slice(1).forEach((row, index) => {
    if (!row.some((value) => String(value ?? '').trim())) return
    const cell = (column: number) => String(row[column] ?? '').trim()
    const programLabel = cell(1)
    const programType = parseAssignmentProgram(programLabel)
    result.push({ rowNumber: index + 2, targetUsername: normalizeUsername(cell(0)), programLabel,
      parseError: programType ? undefined : '프로그램은 스파크, 스파크+, 스파크S, 스파크S+ 중 하나여야 합니다.',
      draft: { programType: programType ?? 'spark', storeName: cell(2), keyword: cell(3), placeUrl: cell(4), dailyShots: cell(5), operationDays: cell(6), startDate: excelDate(row[7]), memo: cell(8) } })
  })
  if (!result.length) throw new Error('입력된 작업이 없습니다.')
  if (result.length > 500) throw new Error('한 번에 최대 500건까지 부여할 수 있습니다.')
  return result
}

export function downloadAssignmentTemplate(): void {
  const worksheet = utils.aoa_to_sheet([ADMIN_ASSIGNMENT_HEADERS])
  worksheet['!cols'] = [18, 14, 22, 22, 48, 12, 12, 16, 35].map((wch) => ({ wch }))
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, worksheet, '관리자 작업부여')
  writeFileXLSX(workbook, 'spark-admin-assignment-template.xlsx', { compression: true })
}

export function assignmentErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : '요청을 처리하지 못했습니다.'
}
