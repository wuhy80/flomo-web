/**
 * A {@link CacheArea} over the browser's local storage.
 *
 * @module @flomo/ui/cache-area
 */

import type { CacheArea } from '@flomo/core'

/**
 * Resolve the storage to wrap, tolerating a browser that refuses to hand it over.
 *
 * The guard has to cover the property access, not only the operations. Private
 * modes and locked-down iframes throw from `window.localStorage` itself, and this
 * runs during render — so an unguarded throw here is a blank page, not a missing
 * cache. The same mistake was fixed in the web app's config store.
 * @param storage - an explicit storage, or `undefined` to use the browser's.
 * @returns the storage, or `undefined` when there is none to be had.
 */
function resolveStorage(storage?: Storage): Storage | undefined {
  if (storage !== undefined) return storage
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

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
  const target = resolveStorage(storage)

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
      // Through the `Storage` interface rather than `Object.keys`. The real
      // `localStorage` happens to expose its entries as enumerable properties, so
      // `Object.keys` works there and returns the method names on anything else —
      // which means a conforming implementation would silently enumerate nothing.
      try {
        if (target === undefined) return []
        const out: string[] = []
        for (let index = 0; index < target.length; index += 1) {
          const key = target.key(index)
          if (key !== null) out.push(key)
        }
        return out
      } catch {
        return []
      }
    },
  }
}
