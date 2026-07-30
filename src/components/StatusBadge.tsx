import type { ApprovalStatus, OrderStatus } from '../domain/types'

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${status}`}>{status}</span>
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const label = status === 'approved' ? '승인' : status === 'pending' ? '승인대기' : '반려'
  return <span className={`approval-badge approval-${status}`}>{label}</span>
}
