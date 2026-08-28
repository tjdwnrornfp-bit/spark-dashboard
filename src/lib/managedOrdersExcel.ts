import { utils, writeFileXLSX } from 'xlsx'
import type { ManagedOrderRow, ProgramType } from '../domain/types'

const PROGRAM_LABELS: Record<ProgramType, string> = {
  spark: '스파크',
  spark_plus: '스파크+',
  spark_s: '스파크s',
  spark_s_plus: '스파크s+',
}

const HEADERS = [
  '대행사 아이디',
  '프로그램',
  '대표키워드',
  '미드값',
  '상호명',
  '플레이스URL',
  '적용단가',
  '일일수량',
  '시작날짜',
  '종료날짜',
  '구동일 수',
  '작업상태',
  '정산상태',
  '총금액',
]

function isoDateToExcelSerial(value: string): number | string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000) + 25_569
}

function displayWidth(value: string | number | null | undefined): number {
  return Array.from(String(value ?? '')).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0)
}

export function downloadManagedOrdersExcel(rows: ManagedOrderRow[], fileName: string) {
  const values: Array<Array<string | number>> = [
    HEADERS,
    ...[...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => [
      row.registrantUsername,
      PROGRAM_LABELS[row.programType],
      row.keyword,
      row.mid,
      row.storeName,
      row.placeUrl,
      row.pricePerShot,
      row.dailyShots,
      isoDateToExcelSerial(row.startDate),
      isoDateToExcelSerial(row.endDate),
      row.operationDays,
      row.orderStatus,
      row.settlementStatus,
      row.totalAmount,
    ]),
  ]
  const worksheet = utils.aoa_to_sheet(values)
  const minWidths = [14, 10, 16, 14, 18, 24, 10, 10, 12, 12, 10, 10, 12, 12]
  const maxWidths = [24, 14, 32, 22, 30, 48, 14, 14, 14, 14, 12, 12, 16, 16]
  worksheet['!cols'] = HEADERS.map((_, columnIndex) => ({
    wch: Math.max(minWidths[columnIndex], Math.min(maxWidths[columnIndex], Math.max(...values.map((row) => displayWidth(row[columnIndex]))) + 2)),
  }))
  worksheet['!autofilter'] = { ref: `A1:N${values.length}` }

  for (let rowIndex = 2; rowIndex <= values.length; rowIndex += 1) {
    for (const column of ['G', 'H', 'K', 'N']) {
      if (worksheet[`${column}${rowIndex}`]) worksheet[`${column}${rowIndex}`].z = '#,##0'
    }
    for (const column of ['I', 'J']) {
      if (worksheet[`${column}${rowIndex}`]) worksheet[`${column}${rowIndex}`].z = 'yyyy-mm-dd'
    }
  }

  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, worksheet, '관리작업')
  writeFileXLSX(workbook, fileName, { compression: true, cellStyles: true })
}
