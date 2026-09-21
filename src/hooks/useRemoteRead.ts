import { useEffect, useRef, useState } from 'react'
import { singleFlight } from '../lib/singleFlight'

// Keys must include the current actor and data revision. Tagging the result also
// hides old-filter data during the render before effect cleanup takes place.
export function useRemoteRead<T>(key: string, load: () => Promise<T>, enabled = true, delay = 0) {
  const loader = useRef(load)
  loader.current = load
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${key}:${attempt}`
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' })
  useEffect(() => {
    if (!enabled) return
    let active = true
    const timer = setTimeout(() => {
      void singleFlight(requestKey, () => loader.current()).then(
        (data) => { if (active) setState({ key: requestKey, data }) },
        (error: unknown) => { if (active) setState({ key: requestKey, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? '데이터를 불러오지 못했습니다.') }) },
      )
    }, delay)
    return () => { active = false; clearTimeout(timer) }
  }, [requestKey, enabled, delay])
  const current = state.key === requestKey ? state : undefined
  return { data: enabled ? current?.data : undefined, error: enabled ? current?.error : undefined, loading: enabled && !current, reload: () => setAttempt((value) => value + 1) }
}
