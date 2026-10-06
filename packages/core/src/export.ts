/**
 * Export formats: the data escape hatch.
 *
 * This exists because of a real property of the design rather than as a
 * checkbox feature. The vault key is derived from a password that is never
 * stored anywhere, so forgetting the password means losing the notes. A
 * recovery code mitigates that, but the only thing that makes the risk
 * genuinely acceptable is being able to get everything back out in a form that
 * outlives this application.
 *
 * Both formats are deliberately plain: Markdown for reading and grepping, JSON
 * for round-tripping.
 *
 * @module @flomo/core/export
 */

import { absoluteDayLabel, clockOf, dayOf } from './time.ts'
import type { Memo } from './types.ts'

/** Discriminator stamped into the JSON payload so an importer can trust it. */
export const EXPORT_FORMAT = 'flomo-sim/v1'

/**
 * Order memos oldest-first, which is how a document reads.
 * @param memos - the corpus.
 * @returns a new sorted array.
 */
function chronological(memos: readonly Memo[]): Memo[] {
  return [...memos].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
}

/**
 * Render the corpus as Markdown, grouped by day.
 *
 * Day headings are absolute dates rather than "今天"/"昨天": an exported file is
 * read later, possibly much later, and a relative label would be a lie by then.
 * @param memos - the corpus.
 * @param now - reference instant for the header.
 * @returns the document.
 */
export function memosToMarkdown(memos: readonly Memo[], now: Date = new Date()): string {
  const ordered = chronological(memos)
  const lines: string[] = [
    '# flomo 备忘录',
    '',
    `导出时间：${now.toISOString()}`,
    `共 ${ordered.length} 条`,
    '',
  ]

  if (ordered.length === 0) {
    lines.push('（还没有任何记录）', '')
    return lines.join('\n')
  }

  let currentDay = ''
  for (const memo of ordered) {
    const day = dayOf(memo.createdAt)
    if (day !== currentDay) {
      currentDay = day
      lines.push('---', '', `## ${absoluteDayLabel(day)}`, '')
    }
    const marks = [clockOf(memo.createdAt)]
    if (memo.pinned) marks.push('置顶')
    if (memo.updatedAt !== memo.createdAt) marks.push('已编辑')
    lines.push(`### ${marks.join(' · ')}`, '', memo.content, '')
  }

  return lines.join('\n')
}

/** The shape of {@link memosToJson}'s payload. */
export interface ExportPayload {
  format: typeof EXPORT_FORMAT
  exportedAt: string
  count: number
  memos: Memo[]
}

/**
 * Render the corpus as a JSON document.
 *
 * Every field is preserved, including `id` and both timestamps, so an import
 * can restore the corpus rather than merely re-create its text.
 * @param memos - the corpus.
 * @param now - reference instant for the header.
 * @returns the JSON document, newline-terminated.
 */
export function memosToJson(memos: readonly Memo[], now: Date = new Date()): string {
  const payload: ExportPayload = {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    count: memos.length,
    memos: chronological(memos),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * A filename carrying the export stamp.
 * @param extension - `md` or `json`.
 * @param now - reference instant.
 * @returns the filename.
 */
export function exportFilename(extension: string, now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `flomo-${stamp}.${extension}`
}
