/**
 * `#tag` extraction and aggregation.
 *
 * flomo's tags live inline in the body rather than in a separate field, so the
 * canonical form is whatever the user typed. We cache the parsed list on each
 * memo for listing, but always re-parse from `content` on write.
 *
 * @module @flomo/core/tags
 */

/** A `#` followed by at least one non-space, non-`#` run. */
const TAG_PATTERN = /#([^\s#]+)/g

/**
 * Punctuation that terminates a tag when it directly abuts one. Without this,
 * the sentence `今天读了 #深度工作。` would yield the tag `深度工作。`.
 */
const TRAILING_PUNCTUATION = /[，。！？；：、,.!?;:)\]）】》"'”’…]+$/u

/**
 * Extract the distinct tags from a memo body, in first-appearance order.
 * @param content - the raw memo text.
 * @returns tag names without the leading `#`.
 */
export function parseTags(content: string): string[] {
  const seen = new Set<string>()
  for (const match of content.matchAll(TAG_PATTERN)) {
    const raw = (match[1] ?? '').replace(TRAILING_PUNCTUATION, '')
    if (raw.length > 0) seen.add(raw)
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
 * Split a memo body into literal text and tag runs, for rendering.
 *
 * The renderer uses this rather than a regex of its own so that what the UI
 * highlights can never disagree with what {@link parseTags} stores.
 * @param content - the raw memo body.
 * @returns the alternating tokens, covering the entire input.
 */
export function tokenizeTags(content: string): TagToken[] {
  const tokens: TagToken[] = []
  let cursor = 0

  for (const match of content.matchAll(TAG_PATTERN)) {
    const cleaned = (match[1] ?? '').replace(TRAILING_PUNCTUATION, '')
    if (cleaned.length === 0) continue

    const start = match.index ?? 0
    if (start > cursor) tokens.push({ type: 'text', value: content.slice(cursor, start) })
    tokens.push({ type: 'tag', value: cleaned })
    cursor = start + 1 + cleaned.length
  }

  if (cursor < content.length) tokens.push({ type: 'text', value: content.slice(cursor) })
  return tokens
}
