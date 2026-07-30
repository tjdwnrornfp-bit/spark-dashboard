import type { Order } from '../domain/types'
import { getDailyProgress } from '../lib/progress'

export function ProgressGauge({ order, now, compact = false }: { order: Order; now: Date; compact?: boolean }) {
  const progress = getDailyProgress(order, now)
  return (
    <div className={`progress-box ${compact ? 'progress-compact' : ''}`}>
      <div className="progress-labels"><span>{progress.completedShots.toLocaleString('ko-KR')} / {progress.targetShots.toLocaleString('ko-KR')}타</span><strong>{progress.percent.toFixed(2)}%</strong></div>
      <div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div>
    </div>
  )
}
