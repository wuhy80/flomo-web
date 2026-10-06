/**
 * React bindings for a {@link FlomoSession}.
 *
 * @module @flomo/ui/useFlomoSession
 */

import { useCallback, useSyncExternalStore } from 'react'

import type { FlomoSession, SessionSnapshot } from './session.ts'

/**
 * Read a session's snapshot, re-rendering on every change.
 *
 * The subscribe and snapshot callbacks are memoized on the session so React
 * does not tear down and rebuild its subscription on every render — which
 * `useSyncExternalStore` would otherwise do, since a fresh closure is a
 * different function identity each time.
 * @param session - the session to observe.
 * @returns the current snapshot.
 */
export function useFlomoSession(session: FlomoSession): SessionSnapshot {
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribe(onStoreChange),
    [session],
  )
  const getSnapshot = useCallback(() => session.getSnapshot(), [session])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
