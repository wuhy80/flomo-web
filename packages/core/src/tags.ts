/**
 * `#tag` extraction and aggregation.
 *
 * Tagging is really just one view of the inline tokenizer — see
 * {@link module:@flomo/core/inline} — so this module owns the *policy* about
 * tags (what counts as one, how they group) and nothing about the syntax.
 *
 * @module @flomo/core/tags
 */

import { tokenizeInline } from './inline.ts'

/**
 * Extract the distinct tags from a memo body, in first-appearance order.
 * @param content - the raw memo text.
 * @returns tag names without the leading `#`.
 */
export function parseTags(content: string): string[] {
  const seen = new Set<string>()
  for (const token of tokenizeInline(content)) {
    if (token.type === 'tag') seen.add(token.value)
  }
  return [...seen]
}

/**
 * Case-insensitive grouping key for a tag.
 * @param tag - a tag name.
 * @returns the comparison key.
 */
export function tagKey(tag: string): string {
  return tag.toLocaleLowerCase()
}

/** One tag and how often it appears across the corpus. */
export interface TagStat {
  /** The tag as first encountered, with original casing. */
  tag: string
  /** Number of memos carrying it. */
  count: number
}

/**
 * Aggregate tag frequencies across memos.
 * @param memos - the corpus.
 * @returns stats sorted by descending count, then by name.
 */
export function tagStats(memos: readonly { tags: readonly string[] }[]): TagStat[] {
  const counts = new Map<string, TagStat>()
  for (const memo of memos) {
    for (const tag of memo.tags) {
      const key = tagKey(tag)
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'),
  )
}

/**
 * Whether a memo carries a given tag, ignoring case.
 * @param memo - the memo to test.
 * @param tag - the tag to look for.
 * @returns true when present.
 */
export function hasTag(memo: { tags: readonly string[] }, tag: string): boolean {
  const key = tagKey(tag)
  return memo.tags.some((t) => tagKey(t) === key)
}

/**
 * Split a tag into its hierarchy segments, for future nested-tag navigation.
 * @param tag - a tag such as `读书/认知`.
 * @returns the segments, outermost first.
 */
export function tagSegments(tag: string): string[] {
  return tag.split('/').filter((segment) => segment.length > 0)
}

/** A run of body text, or a tag found inside it. */
export interface TagToken {
  type: 'text' | 'tag'
  /** For `text`, the literal run; for `tag`, the name without its `#`. */
  value: string
}

/**
 * Split a memo body into literal text and tag runs.
 *
 * Links are returned as text: this is the tag-only view, and it still covers the
 * whole input so a caller can render it verbatim.
 * @param content - the raw memo body.
 * @returns the alternating tokens.
 */
export function tokenizeTags(content: string): TagToken[] {
  return tokenizeInline(content).map((token) =>
    token.type === 'link'
      ? { type: 'text' as const, value: `[[${token.value}]]` }
      : { type: token.type, value: token.value },
  )
}
