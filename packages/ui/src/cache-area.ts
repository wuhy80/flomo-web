/**
 * A {@link CacheArea} over the browser's local storage.
 *
 * @module @flomo/ui/cache-area
 */

import type { CacheArea } from '@flomo/core'

/**
 * Wrap a `Storage` as a cache area.
 *
 * Every operation is guarded, because `localStorage` can throw on access alone
 * (private-browsing modes) and on write (quota). None of those may break a
 * session: a cache that cannot be written is simply no cache.
 * @param storage - the storage to wrap; defaults to `window.localStorage`.
 * @returns the cache area.
 */
export function browserCacheArea(storage?: Storage): CacheArea {
  const target =
    storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)

  return {
    getItem(key) {
      try {
        return target?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        target?.setItem(key, value)
      } catch {
        // Best effort by design.
      }
    },
    removeItem(key) {
      try {
        target?.removeItem(key)
      } catch {
        // Best effort by design.
      }
    },
    keys() {
      try {
        return target ? Object.keys(target) : []
      } catch {
        return []
      }
    },
  }
}
