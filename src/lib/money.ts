export function calculateAmount(dailyShots: number, operationDays: number, pricePerShot: number) {
  const supplyAmount = Math.round(dailyShots * operationDays * pricePerShot)
  const vatAmount = Math.round(supplyAmount * 0.1)
  return { supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount }
}

export function formatWon(value: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`
}
