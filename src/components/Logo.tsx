export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? 'logo-compact' : ''}`}>
      <span className="logo-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c.7 4.6 3.4 7.3 8 8-4.6.7-7.3 3.4-8 8-.7-4.6-3.4-7.3-8-8 4.6-.7 7.3-3.4 8-8Z" fill="currentColor"/></svg></span>
      {!compact && <strong>SPARK</strong>}
    </div>
  )
}
