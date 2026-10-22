/**
 * The create-form password rules: the part that stops a typo from becoming the
 * only key to someone's notes.
 *
 * @module @flomo/ui/test/password-policy
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MIN_PASSWORD_LENGTH, canSubmitUnlock, checkNewPassword } from '../src/password-policy.ts'

describe('checkNewPassword', () => {
  it('accepts a password that is long enough, has no edge whitespace, and matches', () => {
    const verdict = checkNewPassword('correct horse', 'correct horse')
    assert.equal(verdict.ok, true)
    assert.deepEqual(verdict.problems, [])
    assert.ok(verdict.rules.every((rule) => rule.ok))
  })

  it('rejects anything shorter than the floor, and says how short', () => {
    const verdict = checkNewPassword('short', 'short')
    assert.equal(verdict.ok, false)
    assert.deepEqual(verdict.problems, [`至少 ${MIN_PASSWORD_LENGTH} 个字符`])
  })

  it('counts characters, so one emoji does not buy two', () => {
    // Seven emoji are seven characters, not the fourteen UTF-16 units that would
    // otherwise let a seven-character password through.
    const seven = '🙂'.repeat(7)
    assert.equal(MIN_PASSWORD_LENGTH, 8)
    assert.equal(checkNewPassword(seven, seven).ok, false)
    assert.equal(checkNewPassword('🙂'.repeat(8), '🙂'.repeat(8)).ok, true)
  })

  it('rejects leading or trailing whitespace, the classic invisible typo', () => {
    const verdict = checkNewPassword(' correct horse ', ' correct horse ')
    assert.equal(verdict.ok, false)
    assert.ok(verdict.problems.includes('首尾没有空格'))
  })

  it('rejects a mismatch even when both fields are long enough', () => {
    const verdict = checkNewPassword('correct horse', 'correct horsf')
    assert.equal(verdict.ok, false)
    assert.deepEqual(verdict.problems, ['两次输入一致'])
  })

  it('does not pass while the confirmation is still empty', () => {
    const verdict = checkNewPassword('correct horse', '')
    assert.equal(verdict.ok, false)
    assert.deepEqual(verdict.problems, ['两次输入一致'])
  })

  it('rejects a password made only of whitespace', () => {
    const verdict = checkNewPassword('        ', '        ')
    assert.equal(verdict.ok, false)
    assert.ok(verdict.problems.includes('首尾没有空格'))
  })

  it('reports every unmet rule, in display order', () => {
    const verdict = checkNewPassword('short ', 'different')
    assert.deepEqual(verdict.problems, ['至少 8 个字符', '首尾没有空格', '两次输入一致'])
    assert.deepEqual(
      verdict.rules.map((rule) => rule.id),
      ['length', 'edges', 'match'],
    )
  })
})

describe('canSubmitUnlock', () => {
  it('lets any non-empty password through, because old vaults may be shorter', () => {
    assert.equal(canSubmitUnlock('x'), true)
  })

  it('refuses the empty field', () => {
    assert.equal(canSubmitUnlock(''), false)
  })
})
