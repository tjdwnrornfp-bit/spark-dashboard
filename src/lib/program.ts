import type { Order, Page, ProgramPriceMap, ProgramType, User } from '../domain/types'

export const PROGRAMS: Array<{ type: ProgramType; label: string; shortLabel: string; page: Page; orderPrefix: string; sheetName: string }> = [
  { type: 'spark', label: '스파크', shortLabel: 'SPARK', page: 'sparkOrders', orderPrefix: 'SPK', sheetName: '스파크접수' },
  { type: 'spark_plus', label: '스파크 +', shortLabel: 'SPARK+', page: 'sparkPlusOrders', orderPrefix: 'SPP', sheetName: '스파크플러스접수' },
  { type: 'spark_s', label: '스파크S', shortLabel: 'SPARK S', page: 'sparkSOrders', orderPrefix: 'SPS', sheetName: '스파크S접수' },
  { type: 'spark_s_plus', label: '스파크S+', shortLabel: 'SPARK S+', page: 'sparkSPlusOrders', orderPrefix: 'SPSP', sheetName: '스파크S플러스접수' },
]

export const PROGRAM_PAGE_MAP: Record<Page, ProgramType | null> = {
  dashboard: null,
  notifications: null,
  managedOrders: null,
  sparkOrders: 'spark',
  sparkPlusOrders: 'spark_plus',
  sparkSOrders: 'spark_s',
  sparkSPlusOrders: 'spark_s_plus',
  settlement: null,
  members: null,
  operations: null,
  myinfo: null,
  notices: null,
}

export function programMeta(programType: ProgramType) {
  return PROGRAMS.find((item) => item.type === programType)!
}

export function pageForProgram(programType: ProgramType): Page {
  return programMeta(programType).page
}

export function labelForProgram(programType: ProgramType): string {
  return programMeta(programType).label
}

export function orderPrefixForProgram(programType: ProgramType): string {
  return programMeta(programType).orderPrefix
}

export function unitLabelForProgram(programType: ProgramType): '타' | '건' {
  return programType === 'spark_s' || programType === 'spark_s_plus' ? '건' : '타'
}

export function unitPriceLabelForProgram(programType: ProgramType): string {
  return programType === 'spark_s' || programType === 'spark_s_plus' ? '1건당 단가' : '1타당 단가'
}

export function getProgramPriceMap(user: User): ProgramPriceMap {
  return {
    spark: user.sparkPricePerShot ?? user.pricePerShot ?? 0,
    spark_plus: user.sparkPlusPricePerShot || 0,
    spark_s: user.sparkSPricePerShot || 0,
    spark_s_plus: user.sparkSPlusPricePerShot ?? 0,
  }
}

export function getUserProgramPrice(user: User, programType: ProgramType): number {
  const prices = getProgramPriceMap(user)
  return prices[programType]
}

export function applyProgramPrices(user: User, prices: ProgramPriceMap): User {
  return {
    ...user,
    pricePerShot: prices.spark,
    sparkPricePerShot: prices.spark,
    sparkPlusPricePerShot: prices.spark_plus,
    sparkSPricePerShot: prices.spark_s,
    sparkSPlusPricePerShot: prices.spark_s_plus,
  }
}

export function formatProgramPrices(user: User): string {
  const prices = getProgramPriceMap(user)
  return `스파크 ${prices.spark.toLocaleString('ko-KR')}원 · 스파크 + ${prices.spark_plus.toLocaleString('ko-KR')}원 · 스파크S ${prices.spark_s.toLocaleString('ko-KR')}원 · 스파크S+ ${prices.spark_s_plus.toLocaleString('ko-KR')}원`
}

export function programOrders(orders: Order[], programType: ProgramType): Order[] {
  return orders.filter((order) => (order.programType ?? 'spark') === programType)
}
