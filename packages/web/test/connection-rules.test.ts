/**
 * The connection form's shape rules.
 *
 * These are the checks that run before a token is spent on a network round trip
 * and, more importantly, before a malformed connection is written to
 * `localStorage` where it would keep failing on every later visit.
 *
 * @module @flomo/web/test/connection-rules
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatProblem, looksLikeToken } from '../src/connection-rules.ts'

describe('looksLikeToken', () => {
  it('accepts a fine-grained token', () => {
    assert.equal(looksLikeToken(`github_pat_${'a'.repeat(60)}`), true)
  })

  it('accepts the classic and app prefixes', () => {
    for (const prefix of ['ghp', 'gho', 'ghu', 'ghs', 'ghr']) {
      assert.equal(looksLikeToken(`${prefix}_${'b'.repeat(36)}`), true, prefix)
    }
  })

  it('rejects a truncated token', () => {
    assert.equal(looksLikeToken('github_pat_short'), false)
    assert.equal(looksLikeToken('ghp_abc'), false)
  })

  it('rejects a token with a space or newline in it', () => {
    assert.equal(looksLikeToken(`ghp_${'c'.repeat(20)} ${'c'.repeat(10)}`), false)
    assert.equal(looksLikeToken(`ghp_${'c'.repeat(20)}\n`), false)
  })

  it('rejects an empty field and a bare prefix', () => {
    assert.equal(looksLikeToken(''), false)
    assert.equal(looksLikeToken('github_pat_'), false)
  })
})

describe('formatProblem', () => {
  const token = `github_pat_${'d'.repeat(40)}`

  it('passes a well-formed connection', () => {
    assert.equal(formatProblem('wuhy80', 'flomo-data', token), null)
  })

  it('rejects an owner with a leading hyphen', () => {
    assert.match(String(formatProblem('-wuhy80', 'flomo-data', token)), /用户名/)
  })

  it('rejects an owner with an underscore or a space', () => {
    assert.match(String(formatProblem('wu hy', 'flomo-data', token)), /用户名/)
    assert.match(String(formatProblem('wu_hy', 'flomo-data', token)), /用户名/)
  })

  it('rejects a repository name with a slash or a leading dot', () => {
    assert.match(String(formatProblem('wuhy80', 'me/data', token)), /仓库名/)
    assert.match(String(formatProblem('wuhy80', '.flomo', token)), /仓库名/)
    assert.match(String(formatProblem('wuhy80', 'flomo data', token)), /仓库名/)
  })

  it('rejects a malformed token last, so the field order is the hint order', () => {
    assert.match(String(formatProblem('wuhy80', 'flomo-data', 'oops')), /令牌/)
  })
})
