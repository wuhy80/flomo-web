/**
 * Querying, ranking and resurfacing memos.
 *
 * The "resurface" half is what makes flomo more than a text file: a daily
 * review that hands back a few old notes, and a random walk for browsing. Both
 * live here so the web app and the DSH plugin resurface the *same* notes on the
 * same day.
 *
 * @module @flomo/core/search
 */

import { hasTag } from './tags.ts'
import { dayOf } from './time.ts'
import type { Memo } from './types.ts'

/** A search/filter request. All fields are optional and compose with AND. */
export interface SearchQuery {
  /** Case-insensitive substring to match against the body. */
  text?: string
  /** Tag to require, without the leading `#`. */
  tag?: string
  /** Restrict to memos created on this `YYYY-MM-DD` day. */
  day?: string
  /** Cap the result count. */
  limit?: number
}

/**
 * Filter and rank memos.
 *
 * Matching is a plain case-insensitive substring test rather than anything
 * fuzzy: with a personal corpus the user usually remembers a literal word, and
 * a predictable match beats a clever one.
 * @param memos - the corpus, any order.
 * @param query - the filter to apply.
 * @returns matching memos, newest first.
 */
export function searchMemos(
  memos: readonly Memo[],
  query: SearchQuery = {},
): Memo[] {
  const needle = query.text?.trim().toLocaleLowerCase()
  const results = memos.filter((memo) => {
    if (query.tag && !hasTag(memo, query.tag)) return false
    if (query.day && dayOf(memo.createdAt) !== query.day) return false
    if (needle && !memo.content.toLocaleLowerCase().includes(needle)) return false
    return true
  })
  results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return query.limit !== undefined ? results.slice(0, query.limit) : results
}

/**
 * FNV-1a hash of a string, used to seed the daily review.
 * @param text - the seed material.
 * @returns a 32-bit unsigned seed.
 */
function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Build a deterministic PRNG.
 *
 * Determinism is the point: the daily review must hand back the same notes all
 * day, no matter how many times the page is reloaded.
 * @param seed - the 32-bit seed.
 * @returns a function yielding floats in `[0, 1)`.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pick `count` memos at random, without replacement.
 * @param memos - the corpus.
 * @param count - how many to pick.
 * @param seed - deterministic seed; omit for true randomness.
 * @returns the chosen memos.
 */
export function pickRandom(
  memos: readonly Memo[],
  count: number,
  seed?: number,
): Memo[] {
  const pool = [...memos]
  const random = seed === undefined ? Math.random : mulberry32(seed)
  const taken: Memo[] = []
  const wanted = Math.min(count, pool.length)
  for (let i = 0; i < wanted; i += 1) {
    const index = Math.floor(random() * pool.length)
    const [picked] = pool.splice(index, 1)
    if (picked) taken.push(picked)
  }
  return taken
}

/**
 * The daily review: a stable set of older notes for a given day.
 *
 * Memos from the last two days are excluded, since the point of a review is to
 * meet something you have already half-forgotten. There is deliberately no
 * fallback to the whole corpus: a vault with nothing old enough returns an
 * empty list, and both callers say so rather than passing off today's notes as
 * a rediscovery.
 *
 * The set is stable for a given day, and so is its order — newest first.
 * @param memos - the corpus.
 * @param count - how many notes to surface.
 * @param dayKey - the `YYYY-MM-DD` day to seed from.
 * @param now - reference instant, for the recency exclusion.
 * @returns the chosen memos, newest first, possibly empty.
 */
export function dailyReview(
  memos: readonly Memo[],
  count = 3,
  dayKey: string = dayOf(new Date()),
  now: Date = new Date(),
): Memo[] {
  const cutoff = new Date(now.getTime() - 2 * 86_400_000).toISOString()
  const eligible = memos.filter((memo) => memo.createdAt < cutoff)
  const picked = pickRandom(eligible, count, hashSeed(dayKey))

  // Returned newest first. The draw is random, so without this the day headings
  // the feed adds around these notes appear in an order that reads as a bug —
  // 10月1日, then 9月27日, then 10月4日.
  picked.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return picked
}

/**
 * One memo at random for the "random walk" view.
 * @param memos - the corpus.
 * @param exclude - ids to avoid, so consecutive draws feel like a walk.
 * @returns a single memo, or `null` when the corpus is empty.
 */
export function randomWalk(memos: readonly Memo[], exclude: readonly string[] = []): Memo | null {
  const skip = new Set(exclude)
  const pool = memos.filter((memo) => !skip.has(memo.id))
  const usable = pool.length > 0 ? pool : memos
  if (usable.length === 0) return null
  return usable[Math.floor(Math.random() * usable.length)] ?? null
}
