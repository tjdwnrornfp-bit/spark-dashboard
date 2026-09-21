// Pending reads only, never cached results. Callers include actor, filters and
// invalidation generation in the key, so writes cannot reuse pre-write reads.
let epoch = 0
export function invalidateReadRequests(): void { epoch += 1 }
const pending = new Map<string, Promise<unknown>>()
export function singleFlight<T>(identity: string, load: () => Promise<T>): Promise<T> {
  const key = `${epoch}:${identity}`
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  const promise = Promise.resolve().then(load)
  pending.set(key, promise)
  const clear = () => { if (pending.get(key) === promise) pending.delete(key) }
  void promise.then(clear, clear)
  return promise
}
