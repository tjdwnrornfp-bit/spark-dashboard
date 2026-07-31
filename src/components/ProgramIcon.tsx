import type { ProgramType } from '../domain/types'

export function ProgramIcon({ programType, size = 34, className = '' }: { programType: ProgramType; size?: number; className?: string }) {
  const classNames = `program-icon program-icon-${programType} ${className}`.trim()

  if (programType === 'spark_plus') {
    return (
      <svg className={classNames} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="spark-plus-gradient" x1="4" y1="3" x2="36" y2="37" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4C9AFF" />
            <stop offset="1" stopColor="#1556D8" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill="url(#spark-plus-gradient)" />
        <path d="M20 10.5v19M10.5 20h19" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M10.5 10.5l2.3 2.3M29.5 10.5l-2.3 2.3M10.5 29.5l2.3-2.3M29.5 29.5l-2.3-2.3" stroke="#CBE0FF" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }

  if (programType === 'spark_s') {
    return (
      <svg className={classNames} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="spark-s-gradient" x1="5" y1="3" x2="35" y2="38" gradientUnits="userSpaceOnUse">
            <stop stopColor="#45A5F5" />
            <stop offset="1" stopColor="#1761C9" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill="url(#spark-s-gradient)" />
        <path d="M27.2 12.4c-1.8-1.5-4.2-2.3-6.9-2.3-4.5 0-7.5 2.1-7.5 5.4 0 3 2.3 4.4 7.1 5.2 3.4.6 4.7 1.2 4.7 2.8 0 1.7-1.7 2.8-4.4 2.8-2.8 0-5.2-.9-7.2-2.8" fill="none" stroke="#fff" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M28.6 8.7l.45 1.55 1.55.45-1.55.45-.45 1.55-.45-1.55-1.55-.45 1.55-.45.45-1.55Z" fill="#D4E8FF" />
      </svg>
    )
  }

  return (
    <svg className={classNames} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="spark-program-gradient" x1="5" y1="4" x2="35" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#398BFF" />
          <stop offset="1" stopColor="#1559D7" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#spark-program-gradient)" />
      <path d="M20 8.7c.7 5.72 4.38 9.4 10.1 10.1-5.72.7-9.4 4.38-10.1 10.1-.7-5.72-4.38-9.4-10.1-10.1 5.72-.7 9.4-4.38 10.1-10.1Z" fill="#fff" />
    </svg>
  )
}
