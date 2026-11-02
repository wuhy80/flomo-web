/**
 * Archive-page grouping: month buckets and the text filter over a completed
 * tree.
 *
 * The behaviour worth pinning down: days arrive newest-first and leave the
 * same way, months are keyed by the local `YYYY-MM` prefix, a match on a
 * subtask keeps its parent visible, and a query drops months that end up
 * empty rather than rendering an empty header.
 *
 * @module flomo-ui/test/archive
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { groupArchivedByMonth, matchesTodoQuery } from '../src/archive.ts'
import type { CompletedDayGroup, Todo } from '@flomo/core'

/** A completed task with an optional subtree. */
function task(id: string, content: string, children?: Todo[]): Todo {
  return {
    id,
    content,
    createdAt: '2026-10-01T00:00:00.000Z',
    completedAt: '2026-10-02T08:00:00.000Z',
    ...(children === undefined ? {} : { children }),
  }
}

/** A day bucket as the completed list hands it to the archive page. */
function day(dayKey: string, items: Todo[]): CompletedDayGroup {
  return { day: dayKey, label: dayKey, items }
}

describe('groupArchivedByMonth', () => {
  it('buckets days into months newest-first and keeps the day order', () => {
    const months = groupArchivedByMonth([
      day('2026-11-01', [task('a', '写周报')]),
      day('2026-10-30', [task('b', '回邮件'), task('c', '修样式')]),
      day('2026-09-12', [task('d', '旧任务')]),
    ])

    assert.deepEqual(months.map((month) => month.key), ['2026-11', '2026-10', '2026-09'])
    assert.deepEqual(months.map((month) => month.count), [1, 2, 1])
    assert.equal(months[1]?.label, '2026年10月')
    assert.deepEqual(months[1]?.days.map((group) => group.day), ['2026-10-30'])
  })

  it('filters by task text and keeps a parent whose subtask matches', () => {
    const parent = task('p', '整理房间', [task('c', '把书放回书架')])
    const months = groupArchivedByMonth([day('2026-10-20', [parent, task('x', '买牛奶')])], '书架')

    assert.deepEqual(months.map((month) => month.key), ['2026-10'])
    assert.deepEqual(months[0]?.days[0]?.items.map((todo) => todo.id), ['p'])
    assert.equal(months[0]?.count, 1)
  })

  it('drops months that lose every task to the filter, and survives empty input', () => {
    const months = groupArchivedByMonth([day('2026-10-20', [task('x', '买牛奶')])], '不存在')
    assert.deepEqual(months, [])
    assert.deepEqual(groupArchivedByMonth([]), [])
  })

  it('matches case-insensitively and ignores surrounding spaces in the query', () => {
    const months = groupArchivedByMonth([day('2026-10-20', [task('x', 'Write REPORT')])], '  report ')
    assert.equal(months.length, 1)
    assert.equal(matchesTodoQuery(task('y', 'Write REPORT'), 'report'), true)
  })
})
