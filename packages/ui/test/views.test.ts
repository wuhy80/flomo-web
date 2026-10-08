/**
 * Unit tests for the navigation model — the parts the 日记 feature leans on.
 *
 * @module flomo-ui/test/views
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diaryTagOf } from '../src/views.ts'

describe('diaryTagOf', () => {
  it('turns a day key into the nested diary tag', () => {
    assert.equal(diaryTagOf('2026-10-08'), '日记/2026/10/08')
  })

  it('keeps zero-padded months and days', () => {
    assert.equal(diaryTagOf('2026-02-05'), '日记/2026/02/05')
  })
})
