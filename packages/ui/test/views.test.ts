/**
 * Unit tests for the navigation model — the parts the 日记 feature leans on.
 *
 * @module flomo-ui/test/views
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decodeViewParam, diaryTagOf, encodeViewParam, showsComposer, viewTitle } from '../src/views.ts'
import type { FlomoView } from '../src/views.ts'

describe('diaryTagOf', () => {
  it('turns a day key into the nested diary tag', () => {
    assert.equal(diaryTagOf('2026-10-08'), '日记/2026/10/08')
  })

  it('keeps zero-padded months and days', () => {
    assert.equal(diaryTagOf('2026-02-05'), '日记/2026/02/05')
  })
})

describe('the TODO view', () => {
  it('titles itself TODO', () => {
    assert.equal(viewTitle({ kind: 'todo' }), 'TODO')
  })

  it('offers no composer — writing happens in its own add row', () => {
    assert.equal(showsComposer({ kind: 'todo' }), false)
  })
})

describe('the view hash parameter', () => {
  /** Round-trip a view through URLSearchParams exactly as the address bar does. */
  const throughParams = (view: FlomoView): FlomoView | null => {
    const params = new URLSearchParams()
    const value = encodeViewParam(view)
    if (value === null) throw new Error('encodeViewParam returned null')
    params.set('view', value)
    return decodeViewParam(params.get('view'))
  }

  it('round-trips every parameterless view', () => {
    for (const kind of ['todo', 'all', 'review', 'insight', 'heatmap', 'random', 'settings'] as const) {
      const view = { kind } as FlomoView
      assert.equal(encodeViewParam(view), kind)
      assert.deepEqual(throughParams(view), view)
    }
  })

  it('round-trips tag views with slashes, Chinese and odd characters', () => {
    for (const tag of ['日记/2026/10/08', '开发环境', '大模型', 'a/b c#d 100%']) {
      const view: FlomoView = { kind: 'tag', tag }
      assert.deepEqual(throughParams(view), view)
    }
    assert.equal(encodeViewParam({ kind: 'tag', tag: '开发环境' }), 'tag:%E5%BC%80%E5%8F%91%E7%8E%AF%E5%A2%83')
  })

  it('round-trips day, link and focus payloads', () => {
    assert.deepEqual(throughParams({ kind: 'day', day: '2026-11-04' }), { kind: 'day', day: '2026-11-04' })
    assert.deepEqual(throughParams({ kind: 'link', target: '某些想法' }), { kind: 'link', target: '某些想法' })
    assert.deepEqual(throughParams({ kind: 'focus', id: 'm_abc-123' }), { kind: 'focus', id: 'm_abc-123' })
    assert.equal(encodeViewParam({ kind: 'day', day: '2026-11-04' }), 'day:2026-11-04')
  })

  it('decodes address-bar values a user might type by hand', () => {
    assert.deepEqual(decodeViewParam('todo'), { kind: 'todo' })
    assert.deepEqual(decodeViewParam('review'), { kind: 'review' })
    assert.deepEqual(decodeViewParam('tag:开发环境'), { kind: 'tag', tag: '开发环境' })
    assert.deepEqual(decodeViewParam('day:2026-11-04'), { kind: 'day', day: '2026-11-04' })
  })

  it('refuses values that address nothing', () => {
    assert.equal(decodeViewParam(null), null)
    assert.equal(decodeViewParam(''), null)
    assert.equal(decodeViewParam('bogus'), null)
    assert.equal(decodeViewParam('tag:'), null)
    assert.equal(decodeViewParam('link:'), null)
    assert.equal(decodeViewParam('focus:'), null)
    assert.equal(decodeViewParam('day:not-a-date'), null)
  })
})
