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

        <g transform="translate(10 30.8) scale(0.015 -0.015)">
          <path
            d="M675 -24C1042 -24 1266 153 1266 440C1266 664 1125 795 807 862L664 893C481 933 407 984 407 1076C407 1185 514 1261 666 1261C826 1261 931 1174 942 1033H1230C1221 1333 1008 1514 665 1514C326 1514 99 1332 99 1061C99 848 242 711 537 647L694 613C883 572 961 516 961 420C961 304 848 229 677 229C486 229 371 325 367 489H70C70 165 293 -24 675 -24Z"
            fill="#FFFFFF"
          />
        </g>
        <path d="M30.2 7.6l.48 1.64 1.64.48-1.64.48-.48 1.64-.48-1.64-1.64-.48 1.64-.48.48-1.64Z" fill="#D9F7FF" />
        <circle cx="9.7" cy="30.3" r="1.05" fill="#CDEBFF" />
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
