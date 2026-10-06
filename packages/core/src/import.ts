/**
 * Import: reading an export back into a vault.
 *
 * Export without import is only half an escape hatch. Because the vault key is
 * derived from a password stored nowhere, the honest promise this app can make
 * is not "you will never lose the key" but "your words can always leave". That
 * promise needs both directions.
 *
 * The parser is deliberately forgiving about shape and strict about content:
 * it accepts both the `flomo-sim/v1` envelope and a bare array, but refuses
 * anything it cannot turn into a real memo rather than inventing one.
 *
 * @module @flomo/core/import
 */

import { parseTags } from './tags.ts'
import type { Memo } from './types.ts'

/** Raised when the payload cannot be understood at all. */
export class ImportError extends Error {
  override readonly name: string = 'ImportError'
}

/** What an import attempt found. */
export interface ImportResult {
  /** Usable memos, ready to merge. */
  memos: Memo[]
  /** How many entries were dropped as unusable. */
  skipped: number
  /** Distinct reasons entries were dropped, for display. */
  problems: string[]
}

/**
 * Coerce a value into an ISO timestamp, falling back when unusable.
 * @param value - the candidate.
 * @param fallback - the ISO string to use when it is not a parseable date.
 * @returns an ISO timestamp.
 */
function isoOr(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return fallback
}

/**
 * Turn one parsed entry into a memo, or explain why it cannot be one.
 * @param value - the entry.
 * @param now - reference instant for missing timestamps.
 * @param problems - collected reasons, appended to in place.
 * @returns the memo, or `null` when the entry is unusable.
 */
function coerceMemo(value: unknown, now: Date, problems: string[]): Memo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    problems.push('有一项不是对象')
    return null
  }
  const record = value as Record<string, unknown>

  const content = typeof record['content'] === 'string' ? record['content'] : null
  if (content === null || content.trim() === '') {
    problems.push('有一条缺少正文')
    return null
  }

  const nowIso = now.toISOString()
  const createdAt = isoOr(record['createdAt'], nowIso)
  // An edit cannot precede creation; clamping keeps downstream ordering sane
  // even if the file was hand-edited.
  const edited = isoOr(record['updatedAt'], createdAt)

  return {
    id: typeof record['id'] === 'string' && record['id'] !== '' ? record['id'] : crypto.randomUUID(),
    content,
    createdAt,
    updatedAt: edited < createdAt ? createdAt : edited,
    // Re-derived rather than trusted: the tags field is a cache, and a
    // hand-edited or foreign file must not be able to desynchronise the index
    // from the body it is supposed to describe.
    tags: parseTags(content),
    ...(record['pinned'] === true ? { pinned: true } : {}),
  }
}

/**
 * Parse an exported document.
 * @param text - the file contents.
 * @param now - reference instant for missing timestamps.
 * @returns the usable memos and a note of what was dropped.
 * @throws {ImportError} when the payload is not JSON, or has no memo list.
 */
export function parseMemosJson(text: string, now: Date = new Date()): ImportResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    throw new ImportError('这个文件不是合法的 JSON。')
  }

  let list: unknown[]
  if (Array.isArray(decoded)) {
    list = decoded
  } else if (
    typeof decoded === 'object' &&
    decoded !== null &&
    Array.isArray((decoded as { memos?: unknown }).memos)
  ) {
    list = (decoded as { memos: unknown[] }).memos
  } else {
    throw new ImportError('无法识别的结构：期望 flomo 的导出文件，或一个 MEMO 数组。')
  }

  const problems: string[] = []
  const memos: Memo[] = []
  const seen = new Set<string>()

  for (const entry of list) {
    const memo = coerceMemo(entry, now, problems)
    if (memo === null) continue
    if (seen.has(memo.id)) {
      problems.push('有重复的 id，已只保留第一条')
      continue
    }
    seen.add(memo.id)
    memos.push(memo)
  }

  // De-duplicate the reasons while keeping first-seen order, so the summary
  // reads as a short list rather than a hundred identical lines.
  return {
    memos,
    skipped: list.length - memos.length,
    problems: [...new Set(problems)],
  }
}

/**
 * Describe what an import did, for display.
 *
 * Lives here rather than in the UI because the DSH plugin's host half performs
 * imports too, and it must not pull a React-bearing package in to phrase a
 * sentence.
 * @param added - memos newly written.
 * @param duplicates - memos skipped because their id was already present.
 * @param result - the parse result, for its skipped count and reasons.
 * @returns a one-line summary, with any reasons appended below.
 */
export function describeImportResult(
  added: number,
  duplicates: number,
  result: Pick<ImportResult, 'skipped' | 'problems'>,
): string {
  const parts = [`已导入 ${added} 条`]
  if (duplicates > 0) parts.push(`跳过 ${duplicates} 条已存在`)
  if (result.skipped > 0) parts.push(`忽略 ${result.skipped} 条无法识别`)
  const headline = `${parts.join('，')}。`
  return result.problems.length > 0 ? `${headline}\n${result.problems.join('；')}` : headline
}
