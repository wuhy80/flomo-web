/**
 * Tests for turning a recorded token expiry date into banner terms.
 *
 * The dates are computed relative to "now", because the module under test reads
 * the clock: an absolute fixture would start failing the day it was written.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeTokenExpiry, tokenDaysLeft } from '../src/token-status.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A `YYYY-MM-DD` date some days from today.
 * @param offsetDays - days into the future; negative for the past.
 * @returns the date as GitHub's token page writes it.
 */
function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

describe('token expiry', () => {
  it('calls the date expired once it is past', () => {
    const notice = describeTokenExpiry(isoDate(-3))
    assert.ok(notice)
    assert.equal(notice.level, 'expired')
    assert.match(notice.label, /过期/)
  })

  it('warns inside the window and stays quiet far from it', () => {
    const soon = describeTokenExpiry(isoDate(5))
    assert.ok(soon)
    assert.equal(soon.level, 'soon')
    // The whole expiry day counts as remaining, so the exact count depends on
    // the hour the test runs at; the date is what must come through.
    assert.match(soon.label, /天过期（/)

    assert.equal(describeTokenExpiry(isoDate(40)), null, 'no banner with more than two weeks left')
    assert.equal(describeTokenExpiry(null), null, 'no date recorded, no banner')
    assert.equal(describeTokenExpiry('not a date'), null, 'garbage in, no banner')
    assert.equal(describeTokenExpiry('2027-13-99'), null, 'an impossible date is garbage too')
  })

  it('counts the whole expiry day as remaining, the way GitHub does', () => {
    const today = tokenDaysLeft(isoDate(0))
    assert.ok(today !== null && today >= 1, 'a token valid today is not yet expired')

    const yesterday = tokenDaysLeft(isoDate(-1))
    assert.ok(yesterday !== null && yesterday <= 0, 'the day after expiry is expired')
  })
})
