/**
 * `[[双向链接]]`: parsing link targets, and resolving them to memos.
 *
 * The hard part is not the syntax but the resolution rule, because memos have no
 * titles to link to. The rule chosen here is:
 *
 * > `[[X]]` points at every memo that mentions `X` **in prose** — by tag, or as
 * > a substring of the body with all link markup removed — and never at the
 * > linking memo itself.
 *
 * The "with link markup removed" clause is what makes it behave. Without it,
 * two memos that both say `[[深度工作]]` would each contain the literal text
 * `深度工作`, so each would resolve as a target of the other's link and the two
 * would become mutual backlinks merely for pointing at the same thing. Stripping
 * the markup first means a link points at notes that *discuss* the topic, not at
 * notes that link to it.
 *
 * Resolution is computed on demand for one memo rather than as a whole-corpus
 * index. Backlinks are only ever asked for the note in focus, and a lazy scan is
 * O(n) against an index that would cost O(n·t·n) to build for a corpus most of
 * which nobody will ever open.
 *
 * @module @flomo/core/links
 */

import { proseText } from './blocks.ts'
import { markupOf, tokenizeInline } from './inline.ts'
import { hasTag } from './tags.ts'
import type { Memo } from './types.ts'

/**
 * The distinct link targets in a memo body, in first-appearance order.
 *
 * Runs over the body's prose only: `[[x]]` inside a fenced block is bracket
 * syntax in someone's snippet, not a link to a note.
 * @param content - the raw body.
 * @returns the targets, trimmed and without brackets.
 */
export function parseLinks(content: string): string[] {
  const seen = new Set<string>()
  for (const token of tokenizeInline(proseText(content))) {
    if (token.type === 'link') seen.add(token.value)
  }
  return [...seen]
}

/**
 * Rebuild a body's prose with every link blanked.
 *
 * Two jobs at once: it keeps link text out of the "does this memo discuss X"
 * test, and it drops fenced blocks so a snippet cannot match either.
 * @param content - the raw body.
 * @returns the prose with link targets replaced by a space.
 */
function withoutLinks(content: string): string {
  return tokenizeInline(proseText(content))
    .map((token) => {
      if (token.type === 'link') return ' '
      // Every other mark is restored to its source form, so no markup leaks into
      // the prose comparison.
      return markupOf(token) ?? token.value
    })
    .join('')
}

/**
 * Whether one memo is a target of a link.
 * @param memo - the candidate.
 * @param target - the link target.
 * @returns true when the memo carries the tag, or mentions it in prose.
 */
export function matchesLinkTarget(memo: Memo, target: string): boolean {
  const trimmed = target.trim()
  if (trimmed === '') return false
  if (hasTag(memo, trimmed)) return true
  return withoutLinks(memo.content).toLocaleLowerCase().includes(trimmed.toLocaleLowerCase())
}

/**
 * Every memo a link points at.
 * @param target - the link target.
 * @param memos - the corpus.
 * @param excludeId - a memo id to exclude, normally the linking memo's own.
 * @returns the matching memos, newest first.
 */
export function resolveLinkTarget(
  target: string,
  memos: readonly Memo[],
  excludeId?: string,
): Memo[] {
  const matches = memos.filter(
    (memo) => memo.id !== excludeId && matchesLinkTarget(memo, target),
  )
  matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return matches
}

/** One of a memo's outgoing links and where it lands. */
export interface OutgoingLink {
  /** The target as written, without brackets. */
  target: string
  /** The memos it resolves to, newest first. */
  matches: Memo[]
}

/**
 * A memo's outgoing links, each with its resolved targets.
 * @param memo - the memo.
 * @param memos - the corpus.
 * @returns the links, in the order they first appear.
 */
export function outgoingLinks(memo: Memo, memos: readonly Memo[]): OutgoingLink[] {
  return parseLinks(memo.content).map((target) => ({
    target,
    matches: resolveLinkTarget(target, memos, memo.id),
  }))
}

/** A memo that links to the one in focus. */
export interface Backlink {
  /** The linking memo. */
  source: Memo
  /** Which of its links landed here. */
  target: string
}

/**
 * The memos that link to this one.
 * @param memo - the memo in focus.
 * @param memos - the corpus.
 * @returns the backlinks, newest source first.
 */
export function backlinks(memo: Memo, memos: readonly Memo[]): Backlink[] {
  const found: Backlink[] = []

  for (const other of memos) {
    if (other.id === memo.id) continue
    for (const target of parseLinks(other.content)) {
      if (matchesLinkTarget(memo, target)) {
        found.push({ source: other, target })
        break
      }
    }
  }

  found.sort((a, b) => (a.source.createdAt < b.source.createdAt ? 1 : -1))
  return found
}
