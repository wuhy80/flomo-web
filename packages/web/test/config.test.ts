/**
 * Tests for the stored connection settings.
 *
 * This decides whether the PAT is remembered, which storage area it goes to, and
 * what happens when storage is unavailable. The last is why it is worth testing:
 * a browser in private mode throws on write, and an unguarded throw here means
 * the app fails to boot rather than failing to remember a token.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { clearConfig, loadConfig, saveConfig } from '../src/config.ts'
import type { WebConfig } from '../src/config.ts'

const KEY = 'flomo-sim:config:v1'

/** How a fake storage should misbehave. */
interface StorageFaults {
  failOnRead?: boolean
  failOnWrite?: boolean
}

/**
 * Build a `Storage` over a Map, optionally throwing like a locked-down browser.
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
 * @param local - the local storage, or `null` when absent.
 * @param session - the session storage, or `null` when absent.
 */
function useWindow(local: Storage | null, session: Storage | null): void {
  ;(globalThis as { window?: unknown }).window = { localStorage: local, sessionStorage: session }
}

/** A config as the setup form would produce it. */
const SAMPLE: WebConfig = {
  owner: 'me',
  repo: 'flomo-data',
  token: 'ghp_x',
  remember: true,
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('stored config', () => {
  it('round-trips through local storage when the user asks to be remembered', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    useWindow(local.storage, session.storage)

    saveConfig(SAMPLE)

    assert.ok(local.map.has(KEY), 'a remembered config belongs in local storage')
    assert.equal(session.map.size, 0)
    assert.deepEqual(loadConfig(), SAMPLE)
  })

  it('uses session storage when the user declines', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    useWindow(local.storage, session.storage)

    saveConfig({ ...SAMPLE, remember: false })

    assert.equal(local.map.size, 0, 'declining must not leave a copy behind')
    assert.ok(session.map.has(KEY))
    assert.deepEqual(loadConfig(), { ...SAMPLE, remember: false })
  })

  it('clears the other area, so exactly one copy ever exists', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    useWindow(local.storage, session.storage)

    saveConfig(SAMPLE)
    assert.ok(local.map.has(KEY))

    // Switching the checkbox must not leave the old copy to win on next load.
    saveConfig({ ...SAMPLE, remember: false })
    assert.equal(local.map.size, 0)
    assert.equal(loadConfig()?.remember, false)
  })

  it('lets the storage area decide remember, not the stored field', () => {
    const local = fakeStorage()
    useWindow(local.storage, fakeStorage().storage)

    // The location is the real fact: it is what determines persistence. The field
    // is redundant, and this pins which one wins if they ever disagree.
    local.map.set(KEY, JSON.stringify({ ...SAMPLE, remember: false }))
    assert.equal(loadConfig()?.remember, true)
  })

  it('returns null for malformed or incomplete entries', () => {
    const local = fakeStorage()
    useWindow(local.storage, fakeStorage().storage)

    local.map.set(KEY, 'not json')
    assert.equal(loadConfig(), null)

    local.map.set(KEY, JSON.stringify({ owner: 'me', repo: 'r' }))
    assert.equal(loadConfig(), null, 'a config with no token is not a config')

    local.map.set(KEY, JSON.stringify({ owner: '', repo: 'r', token: 't' }))
    assert.equal(loadConfig(), null, 'an empty owner is not a config')
  })

  it('drops a branch that is present but empty', () => {
    const local = fakeStorage()
    useWindow(local.storage, fakeStorage().storage)

    saveConfig({ ...SAMPLE, branch: '' })
    const loaded = loadConfig()
    assert.ok(loaded)
    assert.ok(!('branch' in loaded), 'an empty branch must not be carried through')
  })

  it('survives having no window at all', () => {
    delete (globalThis as { window?: unknown }).window
    assert.equal(loadConfig(), null)
    assert.doesNotThrow(() => saveConfig(SAMPLE))
    assert.doesNotThrow(() => clearConfig())
  })

  it('survives a browser that refuses access to storage outright', () => {
    // Private modes have thrown on mere property access, which is the case the
    // existing guard already covers.
    ;(globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error('blocked')
      },
      get sessionStorage(): Storage {
        throw new Error('blocked')
      },
    }

    assert.equal(loadConfig(), null)
    assert.doesNotThrow(() => saveConfig(SAMPLE))
    assert.doesNotThrow(() => clearConfig())
  })

  it('survives a browser that throws on read', () => {
    // The guard has to cover the operation, not just the property access: this is
    // what a locked-down iframe or an evicted origin does.
    useWindow(fakeStorage({ failOnRead: true }).storage, fakeStorage().storage)
    assert.equal(loadConfig(), null, 'an unreadable store must read as absent, not throw')
  })

  it('survives a browser that throws on write', () => {
    // QuotaExceededError is the classic one, and it arrives from setItem — so a
    // guard around `window.localStorage` alone does not catch it.
    useWindow(fakeStorage({ failOnWrite: true }).storage, fakeStorage().storage)
    assert.doesNotThrow(
      () => saveConfig(SAMPLE),
      'failing to remember a token must not fail the connect action',
    )
    assert.doesNotThrow(() => clearConfig())
  })
})
