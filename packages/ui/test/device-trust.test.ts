/**
 * Unit tests for the three-day device trust store.
 *
 * The interesting behaviour is small and sits at the edges: what counts as
 * young enough, what happens to an expired entry, and the fact that every
 * operation survives a missing or broken `localStorage` — a private window
 * must degrade to manual unlock, never to a crash.
 *
 * @module flomo-ui/test/device-trust
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { clearTrust, loadTrust, saveTrust, TRUST_DAYS } from '../src/device-trust.ts'

/** A storage stand-in backed by a map, handed back for direct seeding. */
function fakeArea(): {
  area: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  backing: Map<string, string>
} {
  const backing = new Map<string, string>()
  return {
    backing,
    area: {
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => void backing.set(key, value),
      removeItem: (key) => void backing.delete(key),
    },
  }
}

describe('device trust', () => {
  it('remembers a key for exactly three days', () => {
    const { area } = fakeArea()
    const now = Date.now()

    saveTrust('abc==', area, now)

    const trust = loadTrust(area)
    assert.ok(trust, 'the entry comes back')
    assert.equal(trust.key, 'abc==')
    assert.equal(trust.expires, now + TRUST_DAYS * 24 * 60 * 60 * 1000)
  })

  it('drops an expired entry instead of returning it', () => {
    const { area, backing } = fakeArea()
    const now = 1_760_000_000_000
    saveTrust('abc==', area, now - TRUST_DAYS * 24 * 60 * 60 * 1000 - 1)

    assert.equal(loadTrust(area), null, 'a lapsed grant is not a grant')
    assert.equal(backing.size, 0, 'and it is gone from storage, not merely stale')
  })

  it('clears on demand', () => {
    const { area } = fakeArea()
    saveTrust('abc==', area)
    clearTrust(area)
    assert.equal(loadTrust(area), null)
  })

  it('treats broken storage as no trust rather than a crash', () => {
    const broken = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('quota')
      },
    }

    assert.doesNotThrow(() => saveTrust('abc==', broken))
    assert.equal(loadTrust(broken), null)
    assert.doesNotThrow(() => clearTrust(broken))
  })

  it('treats a corrupt entry as no trust', () => {
    const { area } = fakeArea()
    area.setItem('flomo-sim:trust:v1', '{not json')

    assert.equal(loadTrust(area), null)
  })

  it('does nothing when there is no storage at all', () => {
    assert.equal(loadTrust(undefined), null)
    assert.doesNotThrow(() => saveTrust('abc==', undefined))
    assert.doesNotThrow(() => clearTrust(undefined))
  })
})
