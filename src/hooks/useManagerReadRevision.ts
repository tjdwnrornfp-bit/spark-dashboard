import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

/** Only a visible manager dashboard/work list polls; no full snapshots or root clock. */
export function useManagerReadRevision(userId: string | undefined, enabled: boolean, invalidate: () => void) {
  useEffect(() => {
    if (!enabled || !userId || !supabase) return
    const client = supabase
    let active = true
    let revision: string | undefined
    let failed = false
    let running = false
    let controller: AbortController | undefined
    const check = async () => {
      if (!active || running || document.visibilityState === 'hidden') return
      running = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10_000)
      try {
        const { data, error } = await client.rpc('get_manager_read_revision_v1013').abortSignal(controller.signal)
        if (error) throw error
        if (typeof data !== 'string' || !/^[a-f0-9]{32}$/.test(data)) throw new Error('Invalid manager revision')
        if (!active) return
        if (failed || (revision !== undefined && revision !== data)) invalidate()
        revision = data
        failed = false
      } catch {
        if (active && !failed) { failed = true; invalidate() }
      } finally {
        clearTimeout(timeout)
        running = false
      }
    }
    const visible = () => { void check() }
    const timer = setInterval(visible, 30_000)
    window.addEventListener('focus', visible)
    window.addEventListener('online', visible)
    document.addEventListener('visibilitychange', visible)
    void check()
    return () => {
      active = false
      controller?.abort()
      clearInterval(timer)
      window.removeEventListener('focus', visible)
      window.removeEventListener('online', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [enabled, userId, invalidate])
}
