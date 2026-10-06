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
  }
}
