/**
 * Archive-page grouping: turn the completed days into month buckets and narrow
 * them by a text query.
 *
 * The TODO panel keeps the last three days inline; everything older lives on
 * the archive page. That page can carry years of history, so it indexes by
 * month first and only then by day, and a search matches task text at any
 * depth so a parent whose subtask matches still shows up.
 *
 * @module @flomo/ui/archive
 */

import type { CompletedDayGroup, Todo } from '@flomo/core'

/** One `YYYY-MM` bucket on the archive page. */
export interface ArchiveMonth {
  /** `YYYY-MM` in local time. */
  key: string
  /** `2026年10月`. */
  label: string
  /** The matching days, newest first. */
  days: CompletedDayGroup[]
  /** How many tasks — subtrees included — matched in this month. */
  count: number
}

/**
 * Does a task or any of its subtasks contain the query?
 * @param todo - the completed root.
 * @param query - already lower-cased and trimmed.
 * @returns whether the tree matches.
 */
export function matchesTodoQuery(todo: Todo, query: string): boolean {
  if (todo.content.toLowerCase().includes(query)) return true
  return (todo.children ?? []).some((child) => matchesTodoQuery(child, query))
}

/**
 * Bucket archived days by month and apply an optional text filter.
 * @param groups - archived day groups, newest first.
 * @param query - raw search text; empty keeps everything.
 * @returns months newest first, with empty months dropped.
 */
export function groupArchivedByMonth(groups: readonly CompletedDayGroup[], query = ''): ArchiveMonth[] {
  const needle = query.trim().toLowerCase()
  const months = new Map<string, ArchiveMonth>()
  for (const group of groups) {
    const items = needle === '' ? group.items : group.items.filter((todo) => matchesTodoQuery(todo, needle))
    if (items.length === 0) continue
    const key = group.day.slice(0, 7)
    const month = months.get(key) ?? { key, label: monthLabel(key), days: [], count: 0 }
    month.days.push({ ...group, items })
    month.count += items.length
    months.set(key, month)
  }
  return [...months.values()]
}

/**
 * Format a `YYYY-MM` key for the archive header.
 * @param key - the month key.
 * @returns `2026年10月`.
 */
function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${year}年${Number(month)}月`
}
