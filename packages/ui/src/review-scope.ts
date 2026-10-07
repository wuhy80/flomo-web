/**
 * 每日回顾 scope settings, persisted per device.
 *
 * flomo's review draws from a configurable pool — content filter, time range,
 * notes per day — with 全部内容 + 全部时间 + 8 条/天 as the default. The scope
 * is a display preference, so like the pinned tags it lives in localStorage
 * rather than in the vault.
 *
 * @module @flomo/ui/review-scope
 */

import type { ReviewScope } from '@flomo/core'

/** `localStorage` key holding the review scope. */
const STORAGE_KEY = 'flomo-sim:review-scope:v1'

/** The slice of `Storage` this module needs, so a test can inject a stand-in. */
export type ScopeArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Read the review scope, with defaults filled in.
 * @param area - storage to read; defaults to the browser's `localStorage`.
 * @returns the effective scope (never partial).
 */
export function loadReviewScope(area: ScopeArea | undefined = defaultArea()): ReviewScope {
  if (area === undefined) {
    return { tagMode: 'all', tag: '', months: null, count: 8 }
  }
  try {
    const raw = area.getItem(STORAGE_KEY)
    const parsed = raw === null ? {} : (JSON.parse(raw) as Partial<ReviewScope>)
    return {
      tagMode: isTagMode(parsed.tagMode) ? parsed.tagMode : 'all',
      tag: typeof parsed.tag === 'string' ? parsed.tag : '',
      months: typeof parsed.months === 'number' ? parsed.months : null,
      count: typeof parsed.count === 'number' && parsed.count > 0 ? parsed.count : 8,
    }
  } catch {
    return { tagMode: 'all', tag: '', months: null, count: 8 }
  }
}

/**
 * Persist the review scope.
 * @param scope - the scope to store.
 * @param area - storage to write; defaults to the browser's `localStorage`.
 */
export function saveReviewScope(scope: ReviewScope, area: ScopeArea | undefined = defaultArea()): void {
  if (area === undefined) return
  try {
    area.setItem(STORAGE_KEY, JSON.stringify(scope))
  } catch {
    // Storage unavailable: the scope just does not persist.
  }
}

function isTagMode(value: unknown): value is ReviewScope['tagMode'] {
  return value === 'all' || value === 'include' || value === 'exclude' || value === 'untagged'
}

function defaultArea(): ScopeArea | undefined {
  return globalThis.localStorage
}
