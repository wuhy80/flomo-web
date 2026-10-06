/**
 * Tests for the browser cache area.
 *
 * The same shape of bug was just fixed in the web app's config store: a guard
 * around the storage *operations* is not enough if the property access that
 * produces the storage is itself outside the guard. Private modes and locked-down
 * iframes throw on the access, and this function is called during render — so an
 * unguarded throw here does not lose a cache, it takes the app down.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { browserCacheArea } from '../src/cache-area.ts'

/** How a fake storage should misbehave. */
interface StorageFaults {
  failOnRead?: boolean
  failOnWrite?: boolean
}

/**
 * Build a `Storage` over a Map.
 * @param faults - which operations should throw.
 * @returns the storage and the map behind it.
 */
function fakeStorage(faults: StorageFaults = {}): {
  storage: Storage
  map: Map<string, string>
} {
  const map = new Map<string, string>()
  const storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => {
      if (faults.failOnRead === true) throw new Error('read blocked')
      return map.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (faults.failOnWrite === true) throw new Error('QuotaExceededError')
      map.set(key, value)
    },
    removeItem: (key: string) => {
      if (faults.failOnWrite === true) throw new Error('write blocked')
      map.delete(key)
    },
  }
  return { storage: storage as Storage, map }
}

/**
 * Install a `window` for the duration of one test.
 * @param local - the local storage, or a getter that throws.
 */
function useWindow(local: Storage | 'throws'): void {
  ;(globalThis as { window?: unknown }).window =
    local === 'throws'
      ? {
          get localStorage(): Storage {
            throw new Error('access blocked')
          },
        }
      : { localStorage: local }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('browserCacheArea', () => {
  it('wraps a storage it is handed', () => {
    const { storage, map } = fakeStorage()
    const area = browserCacheArea(storage)

    area.setItem('k', 'v')
    assert.equal(map.get('k'), 'v')
    assert.equal(area.getItem('k'), 'v')
    area.removeItem('k')
    assert.equal(area.getItem('k'), null)
  })

  it('falls back to window.localStorage', () => {
    const { storage, map } = fakeStorage()
    useWindow(storage)

    const area = browserCacheArea()
    area.setItem('k', 'v')
    assert.equal(map.get('k'), 'v')
  })

  it('is a no-op with no window at all', () => {
    delete (globalThis as { window?: unknown }).window
    const area = browserCacheArea()

    assert.equal(area.getItem('k'), null)
    assert.doesNotThrow(() => area.setItem('k', 'v'))
    assert.doesNotThrow(() => area.removeItem('k'))
    assert.deepEqual(area.keys(), [])
  })

  it('survives a browser that refuses access to storage outright', () => {
    // The case that matters: this runs during render, so throwing here is a blank
    // page rather than a missing cache.
    useWindow('throws')

    let created: ReturnType<typeof browserCacheArea> | undefined
    assert.doesNotThrow(() => {
      created = browserCacheArea()
    })

    // Captured into a const because TypeScript will not keep the narrowing on a
    // `let` that a closure assigns.
    const area = created
    assert.ok(area)
    assert.equal(area.getItem('k'), null)
    assert.doesNotThrow(() => area.setItem('k', 'v'))
    assert.deepEqual(area.keys(), [])
  })

  it('treats a throwing read as a miss', () => {
    const area = browserCacheArea(fakeStorage({ failOnRead: true }).storage)
    assert.equal(area.getItem('k'), null)
  })

  it('swallows a throwing write', () => {
    const area = browserCacheArea(fakeStorage({ failOnWrite: true }).storage)
    assert.doesNotThrow(() => area.setItem('k', 'v'))
    assert.doesNotThrow(() => area.removeItem('k'))
  })

  it('enumerates the keys it can see', () => {
    const { storage, map } = fakeStorage()
    map.set('a', '1')
    map.set('b', '2')
    assert.deepEqual([...browserCacheArea(storage).keys()].sort(), ['a', 'b'])
  })

  it('treats a throwing enumeration as empty', () => {
    const area = browserCacheArea({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      // The implementation enumerates through `length`/`key`, so this is the
      // access a hostile storage would refuse.
      get length(): number {
        throw new Error('blocked')
      },
    } as unknown as Storage)

    assert.deepEqual(area.keys(), [])
  })
})
