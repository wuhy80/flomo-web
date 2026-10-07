/**
 * Unit tests for the per-device pinned tag list.
 *
 * The behaviour worth pinning down (so to speak): the list round-trips in pin
 * order, junk on disk reads as "nothing pinned", and a missing or broken
 * `localStorage` degrades to a no-op — a private window must not crash the
 * sidebar over a display preference.
 *
 * @module flomo-ui/test/pinned-tags
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { loadPinnedTags, savePinnedTags } from '../src/pinned-tags.ts'

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

describe('pinned tags', () => {
  it('round-trips the list in pin order', () => {
    const { area } = fakeArea()
    savePinnedTags(['读书', '架构'], area)
    assert.deepEqual(loadPinnedTags(area), ['读书', '架构'])
  })

  it('overwrites the previous list on every save', () => {
    const { area } = fakeArea()
    savePinnedTags(['读书'], area)
    savePinnedTags(['架构', '读书'], area)
    assert.deepEqual(loadPinnedTags(area), ['架构', '读书'])
  })

  it('treats corrupt or non-array entries as nothing pinned', () => {
    const { area } = fakeArea()
    area.setItem('flomo-sim:pinned-tags:v1', '{oops')
    assert.deepEqual(loadPinnedTags(area), [])
    area.setItem('flomo-sim:pinned-tags:v1', JSON.stringify({ tag: '读书' }))
    assert.deepEqual(loadPinnedTags(area), [])
  })

  it('keeps only the string entries of a mixed array', () => {
    const { area } = fakeArea()
    area.setItem('flomo-sim:pinned-tags:v1', JSON.stringify(['读书', 3, null]))
    assert.deepEqual(loadPinnedTags(area), ['读书'])
  })

  it('does nothing when there is no storage at all', () => {
    assert.deepEqual(loadPinnedTags(undefined), [])
    assert.doesNotThrow(() => savePinnedTags(['读书'], undefined))
  })
})
