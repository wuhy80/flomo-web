/**
 * 批注与引用：memo-to-memo references by id.
 *
 * flomo connects cards two ways — text wikilinks (our `[[...]]`) and explicit
 * references to a specific note (批注/快速引用). The reference is stored in the
 * content as `@[<memo-id>]` and rendered as a clickable `MEMO>` chip; the
 * connection is by id, so it survives the referenced note being renamed or
 * re-tagged.
 *
 * @module @flomo/core/mentions
 */

import { tokenizeInline } from './inline.ts'
import type { Memo } from './types.ts'

/**
 * Extract the memo ids referenced in a body, in first-appearance order.
 * @param content - the raw memo text.
 * @returns the referenced memo ids.
 */
export function parseMemoRefs(content: string): string[] {
  const seen = new Set<string>()
  for (const token of tokenizeInline(content)) {
    if (token.type === 'memoref') seen.add(token.value)
  }
  return [...seen]
}

/**
 * Memos that reference `id` through a `@[...]` reference — the 批注 list.
 * @param id - the referenced memo's id.
 * @param memos - the corpus, any order; results keep the corpus order.
 * @returns the referencing memos.
 */
export function annotationsOf(id: string, memos: readonly Memo[]): Memo[] {
  return memos.filter((memo) => parseMemoRefs(memo.content).includes(id))
}

/**
 * The `@`-mention fragment under a caret, for the composer's quick-quote menu.
 *
 * `@` starts a fragment; it stays open until whitespace or a newline — so the
 * user can type `@付费` to search, but a finished sentence after an @ closes it.
 * @param content - the field's value.
 * @param offset - the caret position.
 * @returns the fragment start and the query after `@`, or null when no open fragment.
 */
export function memoFragmentAtCaret(
  content: string,
  offset: number,
): { start: number; query: string } | null {
  const clamped = Math.max(0, Math.min(offset, content.length))
  const before = content.slice(0, clamped)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const query = before.slice(at + 1)
  if (/[\s]/.test(query)) return null
  return { start: at, query }
}
