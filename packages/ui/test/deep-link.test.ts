/**
 * Unit tests for the `#compose=` deep link parser.
 *
 * The interesting cases are the encodings a sender might produce — percent
 * escapes, plus-for-space — and everything that must quietly read as "no
 * preset" so a shared bookmark or a plain refresh never opens with junk.
 *
 * @module flomo-ui/test/deep-link
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { readComposeDeepLink } from '../src/deep-link.ts'

describe('compose deep link', () => {
  it('reads a plain preset', () => {
    assert.equal(readComposeDeepLink('#compose=hello'), 'hello')
  })

  it('decodes percent escapes and plus-for-space', () => {
    assert.equal(readComposeDeepLink('#compose=%E5%BE%AE%E4%BF%A1%E6%B5%8B%E8%AF%95'), '微信测试')
    assert.equal(readComposeDeepLink('#compose=%E4%B8%A4%E5%8F%A5+%E8%AF%9D'), '两句 话')
    assert.equal(readComposeDeepLink('#compose=%E4%B8%A4%E5%8F%A5%20%E8%AF%9D'), '两句 话')
  })

  it('keeps newlines, which the composer accepts as paragraphs', () => {
    assert.equal(readComposeDeepLink('#compose=%E4%B8%80%0A%E4%BA%8C'), '一\n二')
  })

  it('reads a preset alongside other fragment params', () => {
    assert.equal(readComposeDeepLink('#from=wechat&compose=abc'), 'abc')
  })

  it('reads as no preset for anything that is not a compose link', () => {
    assert.equal(readComposeDeepLink(''), null)
    assert.equal(readComposeDeepLink('#'), null)
    assert.equal(readComposeDeepLink('#from=wechat'), null)
  })

  it('reads an empty or blank compose value as no preset', () => {
    assert.equal(readComposeDeepLink('#compose='), null)
    assert.equal(readComposeDeepLink('#compose=%20'), null)
  })
})
