import { Modal } from '../components/Modal'
import { useRemoteRead } from '../hooks/useRemoteRead'
import type { OrderDateRange } from '../lib/orderDateFilter'
import { fetchOrdersForExport } from '../lib/performance'
import { AdminOrdersExportModal } from './AdminOrdersExportModal'

export function RemoteAdminOrdersExportModal({ userId, dateRange, now, onClose }: { userId: string; dateRange: OrderDateRange; now: Date; onClose: () => void }) {
  const request = useRemoteRead(`export:${userId}:${JSON.stringify(dateRange)}`, () => fetchOrdersForExport({ p_created_from: dateRange.from || null, p_created_to: dateRange.to || null, p_sort: 'asc' }))
  if (!request.data) return <Modal title="통합 엑셀" onClose={onClose} footer={null}><p role="status">{request.error ?? '전체 내보내기 데이터를 조회하고 있습니다.'}</p>{request.error && <button className="secondary-button" onClick={request.reload}>다시 조회</button>}</Modal>
  return <AdminOrdersExportModal orders={request.data} dateRange={dateRange} now={now} onClose={onClose} />
}
