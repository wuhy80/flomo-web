/**
 * Unit tests for the per-device list of folded tag branches.
 *
 * The behaviour worth pinning down: the list round-trips, junk on disk reads
 * as "nothing folded", and a missing or broken `localStorage` degrades to a
 * no-op — a private window must not crash the sidebar over a display
 * preference.
 *
 * @module flomo-ui/test/folded-tags
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loadFoldedTags, saveFoldedTags } from '../src/folded-tags.ts'

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

describe('folded tags', () => {
  it('round-trips the folded paths', () => {
    const { area } = fakeArea()
    saveFoldedTags(['读书', '读书/认知'], area)
    assert.deepEqual(loadFoldedTags(area), ['读书', '读书/认知'])
  })

  it('overwrites the previous list on every save', () => {
    const { area } = fakeArea()
    saveFoldedTags(['a'], area)
    saveFoldedTags(['b'], area)
    assert.deepEqual(loadFoldedTags(area), ['b'])
  })

  it('reads junk on disk as nothing folded', () => {
    const { area, backing } = fakeArea()
    backing.set('flomo-sim:folded-tags:v1', '{oops')
    assert.deepEqual(loadFoldedTags(area), [])
    backing.set('flomo-sim:folded-tags:v1', JSON.stringify({ folded: true }))
    assert.deepEqual(loadFoldedTags(area), [])
    backing.set('flomo-sim:folded-tags:v1', JSON.stringify(['a', 3, 'b']))
    assert.deepEqual(loadFoldedTags(area), ['a', 'b'])
  })

  it('reads an empty store as nothing folded', () => {
    const { area } = fakeArea()
    assert.deepEqual(loadFoldedTags(area), [])
  })

  it('survives a missing storage quietly', () => {
    assert.deepEqual(loadFoldedTags(undefined), [])
    assert.doesNotThrow(() => saveFoldedTags(['a'], undefined))
  })

  it('survives a storage that throws', () => {
    const throwing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    assert.deepEqual(loadFoldedTags(throwing), [])
    assert.doesNotThrow(() => saveFoldedTags(['a'], throwing))
  })
})
