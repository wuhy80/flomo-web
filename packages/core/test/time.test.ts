/**
 * Tests for the shared date helpers.
 *
 * These decide the feed's group headers and the shard keys, and both surfaces have
 * to agree about them. The interesting cases are all boundaries — a year that rolls
 * over, a month that rolls over, and a key that is not a date at all.
 *
 * Everything here is local time by construction, so the fixtures use
 * `new Date(y, m, d)` rather than ISO strings and the assertions hold in any zone.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  absoluteDayLabel,
  clockOf,
  dayLabel,
  dayOf,
  fileStamp,
  monthOf,
  recentMonths,
} from '../src/time.ts'

describe('shard and day keys', () => {
  it('keys a month and a day in local time', () => {
    const at = new Date(2026, 2, 4, 23, 30)
    assert.equal(monthOf(at), '2026-03')
    assert.equal(dayOf(at), '2026-03-04')
    assert.equal(monthOf(at.toISOString()), '2026-03', 'an ISO string is accepted too')
    assert.equal(dayOf(at.toISOString()), '2026-03-04')
  })

  it('pads single-digit months and days', () => {
    assert.equal(monthOf(new Date(2026, 0, 9)), '2026-01')
    assert.equal(dayOf(new Date(2026, 0, 9)), '2026-01-09')
  })

  it('enumerates months newest first, across a year boundary', () => {
    // Four months back from February lands in the previous year.
    assert.deepEqual(recentMonths(4, new Date(2026, 1, 15)), [
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ])
  })

  it('counts the current month even on its last day', () => {
    assert.equal(recentMonths(1, new Date(2026, 11, 31))[0], '2026-12')
  })
})

describe('dayLabel', () => {
  const today = new Date(2026, 6, 15)

  it('names today and yesterday', () => {
    assert.equal(dayLabel('2026-07-15', today), '今天')
    assert.equal(dayLabel('2026-07-14', today), '昨天')
  })

  it('names an earlier day this year with its weekday', () => {
    // 2026-07-10 is a Friday.
    assert.equal(dayLabel('2026-07-10', today), '7月10日 周五')
  })

  it('drops the weekday for another year', () => {
    // A relative "周五" a year away is noise, so the year is what matters.
    assert.equal(dayLabel('2025-07-10', today), '2025年7月10日')
  })

  it('handles yesterday being in the previous year', () => {
    const newYear = new Date(2026, 0, 1)
    assert.equal(dayLabel('2026-01-01', newYear), '今天')
    assert.equal(dayLabel('2025-12-31', newYear), '昨天')
  })

  it('handles yesterday being in the previous month', () => {
    const firstOfMarch = new Date(2026, 2, 1)
    assert.equal(dayLabel('2026-02-28', firstOfMarch), '昨天')
  })

  it('handles a leap day', () => {
    const firstOfMarch = new Date(2028, 2, 1)
    assert.equal(dayLabel('2028-02-29', firstOfMarch), '昨天')
  })

  it('returns an unparseable key unchanged', () => {
    // A malformed key parses to NaN rather than undefined, so a guard written as an
    // undefined check never fires and the caller gets NaN年NaN月NaN日 back.
    assert.equal(dayLabel('not-a-day', today), 'not-a-day')
    assert.equal(dayLabel('2026-', today), '2026-')
  })
})

describe('absoluteDayLabel', () => {
  it('never says today or yesterday', () => {
    // Exports are read back later, when "今天" would be meaningless — and a test
    // elsewhere enforces that no export contains a relative label.
    assert.equal(absoluteDayLabel('2026-07-10'), '2026年7月10日 周五')
    assert.ok(!absoluteDayLabel(dayOf(new Date())).includes('今天'))
  })

  it('returns an unparseable key unchanged', () => {
    assert.equal(absoluteDayLabel('nope'), 'nope')
  })
})

describe('fileStamp', () => {
  it('pads every field to a sortable stamp', () => {
    assert.equal(fileStamp(new Date(2026, 0, 9, 7, 5)), '2026-01-09-0705')
  })

  it('does not pad past two digits', () => {
    assert.equal(fileStamp(new Date(2026, 11, 31, 23, 59)), '2026-12-31-2359')
  })

  it('is usable as a filename', () => {
    const stamp = fileStamp(new Date(2026, 5, 1, 0, 0))
    assert.equal(stamp, '2026-06-01-0000')
    assert.ok(!/[/\\:]/.test(stamp), 'no character that a path would reject')
  })
})

describe('clockOf', () => {
  it('prints a zero-padded local time', () => {
    assert.equal(clockOf(new Date(2026, 6, 15, 9, 5).toISOString()), '09:05')
    assert.equal(clockOf(new Date(2026, 6, 15, 23, 59).toISOString()), '23:59')
  })
})
