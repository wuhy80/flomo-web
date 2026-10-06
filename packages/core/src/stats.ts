/**
 * Aggregate statistics: the heatmap, the streak counter, and corpus totals.
 *
 * @module @flomo/core/stats
 */

import { dayOf } from './time.ts'
import type { Memo } from './types.ts'

/**
 * Count memos per day, for the contribution heatmap.
 * @param memos - the corpus.
 * @returns day key to memo count.
 */
export function heatmap(memos: readonly Memo[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const memo of memos) {
    const day = dayOf(memo.createdAt)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}

/**
 * The current run of consecutive days with at least one memo.
 *
 * A run that ended yesterday still counts, so the streak does not visually
 * reset before the user has had a chance to write today.
 * @param memos - the corpus.
 * @param today - reference instant.
 * @returns the streak length in days.
 */
export function streak(memos: readonly Memo[], today: Date = new Date()): number {
  const days = heatmap(memos)
  if (days.size === 0) return 0

  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!days.has(dayOf(cursor))) cursor.setDate(cursor.getDate() - 1)

  let count = 0
  while (days.has(dayOf(cursor))) {
    count += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}

/** Headline numbers shown in the stats strip. */
export interface CorpusStats {
  /** How many memos exist. */
  memos: number
  /** Total body characters across all memos. */
  characters: number
  /** Number of distinct tags. */
  tags: number
  /** Current consecutive-day streak. */
  streak: number
  /** Number of distinct days with at least one memo. */
  activeDays: number
  /**
   * Days from the first memo to today, inclusive.
   *
   * Distinct from {@link activeDays}, and the difference is the point: flomo shows
   * this one beside the note and tag counts, and it is the span of the whole record
   * rather than how many of those days were written in. It is always at least the
   * number of days on which anything was written, and usually far more.
   */
  span: number
}

/**
 * Days from the first memo's day to today, inclusive.
 * @param memos - the corpus.
 * @param today - reference instant.
 * @returns the span in days, or 0 for an empty corpus.
 */
function span(memos: readonly Memo[], today: Date): number {
  const days = [...heatmap(memos).keys()].sort()
  const first = days[0]
  if (first === undefined) return 0

  const [y, m, d] = first.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) return 0

  const start = new Date(y, m - 1, d).getTime()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  // Rounded rather than floored: a DST shift makes the difference a fraction off.
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1)
}

/**
 * Summarize the corpus.
 * @param memos - the corpus.
 * @param distinctTags - tag count, passed in so the caller reuses its own stats.
 * @param today - reference instant.
 * @returns the headline numbers.
 */
export function corpusStats(
  memos: readonly Memo[],
  distinctTags: number,
  today: Date = new Date(),
): CorpusStats {
  let characters = 0
  for (const memo of memos) characters += memo.content.length
  return {
    memos: memos.length,
    characters,
    tags: distinctTags,
    streak: streak(memos, today),
    activeDays: heatmap(memos).size,
    span: span(memos, today),
  }
}
