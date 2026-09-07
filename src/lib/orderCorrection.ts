import type { OrderDraft } from '../domain/types'

export type CorrectionDraft = Omit<OrderDraft, 'programType'>
export interface CorrectionPreview {
  allowed: boolean
  blockReason: string | null
  financialImpact: 'financial_neutral' | 'increase' | 'decrease'
  differenceAmount: number
  before: Record<string, string | number | null>
  after: Record<string, string | number | null>
}

export function intakeWarning(draft: Pick<OrderDraft, 'programType' | 'dailyShots' | 'operationDays'>): string | null {
  const daily = Number(draft.dailyShots), days = Number(draft.operationDays)
  if (!['spark', 'spark_plus'].includes(draft.programType) || !Number.isInteger(daily) || daily < 1 || daily > 10 || !Number.isInteger(days) || days < 30) return null
  return `일일수량 ${daily}타 / 구동일수 ${days}일입니다. 수량과 기간을 반대로 입력한 값인지 확인해 주세요.`
}
