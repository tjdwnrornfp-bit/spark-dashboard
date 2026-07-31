export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? 'logo-compact' : ''}`}>
      <svg className="logo-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="spark-brand-gradient" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#1554D1" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill="url(#spark-brand-gradient)" />
        <path d="M20 8.5c.68 5.66 4.34 9.32 10 10-5.66.68-9.32 4.34-10 10-.68-5.66-4.34-9.32-10-10 5.66-.68 9.32-4.34 10-10Z" fill="#fff" />
        <circle cx="29.5" cy="9.5" r="1.7" fill="#BFD8FF" />
      </svg>
      {!compact && <strong>SPARK</strong>}
    </div>
  )
}
