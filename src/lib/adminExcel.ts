import { utils, writeFileXLSX } from 'xlsx'
import type { Order, ProgramType } from '../domain/types'

export const ADMIN_EXCEL_PROGRAM_LABELS: Record<ProgramType, string> = {
  spark: '스파크',
  spark_plus: '스파크+',
  spark_s: '스파크s',
}

const ADMIN_EXCEL_HEADERS = [
  '등록자',
  '그룹명',
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
  '상태',
]

function isoDateToExcelSerial(value: string): number | string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000) + 25_569
}

function excelDisplayWidth(value: string | number | null | undefined): number {
  const text = String(value ?? '')
  return Array.from(text).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0)
}

function autoFitExcelColumns(rows: Array<Array<string | number>>) {
  const minWidths = [10, 10, 9, 12, 12, 12, 22, 9, 9, 11, 11, 10, 9]
  const maxWidths = [18, 20, 14, 28, 20, 26, 40, 14, 14, 13, 13, 12, 12]
  return ADMIN_EXCEL_HEADERS.map((_, columnIndex) => {
    const contentWidth = rows.reduce((maximum, row) => Math.max(maximum, excelDisplayWidth(row[columnIndex])), 0) + 2
    return { wch: Math.max(minWidths[columnIndex], Math.min(maxWidths[columnIndex], Math.ceil(contentWidth))) }
  })
}

export function createAdminOrdersWorkbook({
  orders,
  sheetName,
}: {
  orders: Order[]
  sheetName: string
}) {
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const rows: Array<Array<string | number>> = [
    ADMIN_EXCEL_HEADERS,
    ...sorted.map((order) => [
      order.creatorUsername,
      order.creatorGroupName || '-',
      ADMIN_EXCEL_PROGRAM_LABELS[order.programType ?? 'spark'],
      order.keyword,
      order.mid,
      order.storeName,
      order.placeUrl,
      order.pricePerShot,
      order.dailyShots,
      isoDateToExcelSerial(order.startDate),
      isoDateToExcelSerial(order.endDate),
      order.operationDays,
      order.status,
    ]),
  ]

  const worksheet = utils.aoa_to_sheet(rows)
  worksheet['!cols'] = autoFitExcelColumns(rows)
  worksheet['!autofilter'] = { ref: `A1:M${rows.length}` }

  for (let rowIndex = 2; rowIndex <= rows.length; rowIndex += 1) {
    const priceCell = worksheet[`H${rowIndex}`]
    const quantityCell = worksheet[`I${rowIndex}`]
    const startDateCell = worksheet[`J${rowIndex}`]
    const endDateCell = worksheet[`K${rowIndex}`]
    const daysCell = worksheet[`L${rowIndex}`]
    if (priceCell) priceCell.z = '#,##0'
    if (quantityCell) quantityCell.z = '#,##0'
    if (startDateCell) startDateCell.z = 'yyyy-mm-dd'
    if (endDateCell) endDateCell.z = 'yyyy-mm-dd'
    if (daysCell) daysCell.z = '0'
  }

  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, worksheet, sheetName)
  return workbook
}

export function downloadAdminOrdersExcel({
  orders,
  fileName,
  sheetName,
}: {
  orders: Order[]
  fileName: string
  sheetName: string
}) {
  writeFileXLSX(createAdminOrdersWorkbook({ orders, sheetName }), fileName, { compression: true, cellStyles: true })
}
