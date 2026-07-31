import sparkIcon from '../assets/spark.png'
import sparkPlusIcon from '../assets/spark-plus.png'
import sparkSIcon from '../assets/spark-s.png'
import type { ProgramType } from '../domain/types'

const SOURCES: Record<ProgramType, string> = {
  spark: sparkIcon,
  spark_plus: sparkPlusIcon,
  spark_s: sparkSIcon,
}

export function ProgramIcon({ programType, size = 36, className = '' }: { programType: ProgramType; size?: number; className?: string }) {
  return <img className={`program-icon ${className}`.trim()} src={SOURCES[programType]} alt="" width={size} height={size} draggable={false} />
}
