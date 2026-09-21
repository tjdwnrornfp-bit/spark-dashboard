export function Pagination({ page, total, pageSize = 50, disabled = false, onChange }: { page: number; total: number; pageSize?: number; disabled?: boolean; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <nav className="performance-pagination" aria-label="목록 페이지">
    <span>총 {total.toLocaleString('ko-KR')}건 · {page} / {pages}페이지</span>
    <button className="secondary-button small" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>이전</button>
    <button className="secondary-button small" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>다음</button>
  </nav>
}
