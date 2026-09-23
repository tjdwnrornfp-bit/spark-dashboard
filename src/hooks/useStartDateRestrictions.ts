import { useEffect, useRef, useState } from 'react'
import { fetchStartDateRestrictions, RESTRICTION_CHANGED_EVENT } from '../lib/startDateRestrictions'
import type { RestrictionState, StartDateRestriction } from '../lib/startDateRestrictions'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export function useStartDateRestrictions(admin = false): RestrictionState {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ rules?: StartDateRestriction[]; loading: boolean; error: string }>({ loading: isSupabaseConfigured, error: '' })
  const sequence = useRef(0)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    const client = supabase
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const request = ++sequence.current
      setState({ loading: true, error: '' })
      try {
        const rules = await fetchStartDateRestrictions(admin)
        if (!disposed && request === sequence.current) setState({ rules, loading: false, error: '' })
      } catch (e) {
        if (!disposed && request === sequence.current) setState({ loading: false, error: e && typeof e === 'object' && 'message' in e ? String(e.message) : '접수 제한 설정을 불러오지 못했습니다.' })
      }
    }
    const schedule = () => {
      // Invalidate immediately, so a response from before this notification cannot win.
      ++sequence.current
      setState({ loading: true, error: '' })
      clearTimeout(timer); timer = setTimeout(() => void load(), 120)
    }
    const visible = () => { if (document.visibilityState === 'visible') schedule() }
    const channel = client.channel(`start-restrictions-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_start_restrictions' }, schedule)
      .subscribe((status) => { if (status === 'SUBSCRIBED') schedule() })
    window.addEventListener('focus', visible)
    window.addEventListener('online', schedule)
    window.addEventListener(RESTRICTION_CHANGED_EVENT, schedule)
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => {
      disposed = true; ++sequence.current; clearTimeout(timer)
      window.removeEventListener('focus', visible); window.removeEventListener('online', schedule)
      window.removeEventListener(RESTRICTION_CHANGED_EVENT, schedule); document.removeEventListener('visibilitychange', visible)
      void client.removeChannel(channel)
    }
  }, [admin, attempt])
  return { rules: isSupabaseConfigured ? state.rules : [], loading: isSupabaseConfigured && state.loading, error: state.error, reload: () => setAttempt((v) => v + 1) }
}
