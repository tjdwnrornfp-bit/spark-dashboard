import { useEffect, useState } from 'react'

// Matches the existing CSS breakpoint; hidden layouts are not mounted.
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return mobile
}
