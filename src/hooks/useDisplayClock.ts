import { useEffect, useState } from 'react'
import { addDays, todayInSeoul } from '../lib/date'

// Only subscribers (gauges) render on a tick. The application root never subscribes.
const listeners = new Set<(now: Date) => void>()
let timer: ReturnType<typeof setInterval> | undefined
function tick() { const now = new Date(); listeners.forEach((listener) => listener(now)) }
function syncTimer() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  if (listeners.size && document.visibilityState !== 'hidden') {
    tick()
    timer = setInterval(tick, 5_000)
  }
}
export function useGaugeClock(controlled?: Date, enabled = true): Date {
  const [now, setNow] = useState(() => controlled ?? new Date())
  useEffect(() => {
    if (controlled || !enabled) return
    listeners.add(setNow)
    if (listeners.size === 1) {
      document.addEventListener('visibilitychange', syncTimer)
      syncTimer()
    } else setNow(new Date())
    return () => {
      listeners.delete(setNow)
      if (!listeners.size) {
        if (timer !== undefined) clearInterval(timer)
        timer = undefined
        document.removeEventListener('visibilitychange', syncTimer)
      }
    }
  }, [controlled, enabled])
  return controlled ?? now
}

// Date-sensitive labels and demo scheduled transitions update at Korean midnight.
export function useSeoulDayClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      clearTimeout(timer)
      const current = new Date()
      setNow((previous) => todayInSeoul(previous) === todayInSeoul(current) ? previous : current)
      const midnight = Date.parse(`${addDays(todayInSeoul(current), 1)}T00:00:00+09:00`)
      timer = setTimeout(schedule, Math.max(1, midnight - current.getTime() + 25))
    }
    const onVisible = () => { if (document.visibilityState !== 'hidden') schedule() }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return now
}
