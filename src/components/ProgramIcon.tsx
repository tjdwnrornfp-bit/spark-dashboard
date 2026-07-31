import { useId } from 'react'
import type { ProgramType } from '../domain/types'

interface ProgramIconProps {
  programType: ProgramType
  size?: number
  className?: string
}

export function ProgramIcon({ programType, size = 34, className = '' }: ProgramIconProps) {
  const uid = useId().replaceAll(':', '')
  const classNames = `program-icon program-icon-${programType} ${className}`.trim()

  if (programType === 'spark_plus') {
    const gradientId = `spark-plus-${uid}`
    const glowId = `spark-plus-glow-${uid}`

    return (
      <svg className={classNames} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="4" y1="2" x2="36" y2="39" gradientUnits="userSpaceOnUse">
            <stop stopColor="#69C5FF" />
            <stop offset="0.48" stopColor="#3478F6" />
            <stop offset="1" stopColor="#4B39C8" />
          </linearGradient>
          <radialGradient id={glowId} cx="0" cy="0" r="1" gradientTransform="translate(12 8) rotate(46) scale(28)">
            <stop stopColor="#FFFFFF" stopOpacity="0.34" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${gradientId})`} />
        <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${glowId})`} />
        <rect x="1.6" y="1.6" width="36.8" height="36.8" rx="10.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1.2" />

        <path
          d="M16.2 10.4c.55 4.35 3.35 7.15 7.7 7.7-4.35.55-7.15 3.35-7.7 7.7-.55-4.35-3.35-7.15-7.7-7.7 4.35-.55 7.15-3.35 7.7-7.7Z"
          fill="#FFFFFF"
        />
        <path d="M28.2 18.5v11.1M22.65 24.05h11.1" stroke="#FFFFFF" strokeWidth="2.9" strokeLinecap="round" />
        <circle cx="30.8" cy="10.4" r="1.65" fill="#CFF4FF" />
      </svg>
    )
  }

  if (programType === 'spark_s') {
    const gradientId = `spark-s-${uid}`
    const glowId = `spark-s-glow-${uid}`

    return (
      <svg className={classNames} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="3" y1="3" x2="37" y2="38" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5DD7FF" />
            <stop offset="0.5" stopColor="#2388F0" />
            <stop offset="1" stopColor="#1950BD" />
          </linearGradient>
          <radialGradient id={glowId} cx="0" cy="0" r="1" gradientTransform="translate(12 8) rotate(47) scale(28)">
            <stop stopColor="#FFFFFF" stopOpacity="0.3" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${gradientId})`} />
        <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${glowId})`} />
        <rect x="1.6" y="1.6" width="36.8" height="36.8" rx="10.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1.2" />

        <path
          d="M28.15 12.15c-2.02-1.72-4.47-2.55-7.35-2.55-4.88 0-8.2 2.28-8.2 5.85 0 3.28 2.65 4.77 7.77 5.6 3.7.62 5.1 1.35 5.1 3.05 0 1.87-1.82 3.08-4.75 3.08-3.08 0-5.75-1-7.9-3.08"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M29.8 8.1l.52 1.78 1.78.52-1.78.52-.52 1.78-.52-1.78-1.78-.52 1.78-.52.52-1.78Z" fill="#D9F7FF" />
        <path d="M10.2 29.1l.34 1.16 1.16.34-1.16.34-.34 1.16-.34-1.16-1.16-.34 1.16-.34.34-1.16Z" fill="#CDEBFF" />
      </svg>
    )
  }

  const gradientId = `spark-core-${uid}`
  const glowId = `spark-core-glow-${uid}`

  return (
    <svg className={classNames} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="36" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5AB8FF" />
          <stop offset="0.48" stopColor="#2879F5" />
          <stop offset="1" stopColor="#174AC9" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientTransform="translate(12 8) rotate(46) scale(28)">
          <stop stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${gradientId})`} />
      <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${glowId})`} />
      <rect x="1.6" y="1.6" width="36.8" height="36.8" rx="10.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1.2" />

      <path
        d="M19.4 7.7c.76 6.12 4.68 10.04 10.8 10.8-6.12.76-10.04 4.68-10.8 10.8-.76-6.12-4.68-10.04-10.8-10.8 6.12-.76 10.04-4.68 10.8-10.8Z"
        fill="#FFFFFF"
      />
      <path d="M29.9 8.1l.48 1.64 1.64.48-1.64.48-.48 1.64-.48-1.64-1.64-.48 1.64-.48.48-1.64Z" fill="#D9F4FF" />
      <circle cx="10.35" cy="29.65" r="1.25" fill="#CBE7FF" />
    </svg>
  )
}
