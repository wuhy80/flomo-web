/**
 * `#tag` extraction and aggregation.
 *
 * Tagging is really just one view of the inline tokenizer — see
 * {@link module:@flomo/core/inline} — so this module owns the *policy* about
 * tags (what counts as one, how they group) and nothing about the syntax.
 *
 * @module @flomo/core/tags
 */

import { isInsideFence, proseText } from './blocks.ts'
import { flattenTokens, markupOf, tokenizeInline } from './inline.ts'

/**
 * Extract the distinct tags from a memo body, in first-appearance order.
 *
 * Runs over the body's prose only: a `#` inside a fenced block is code, and
 * indexing `#include` as a tag is how a tag list becomes useless. The walk is
 * depth-first over container marks, so a `#tag` inside bold or italic indexes
 * exactly like a flat one.
 * @param content - the raw memo text.
 * @returns tag names without the leading `#`.
 */
export function parseTags(content: string): string[] {
  const seen = new Set<string>()
  for (const token of flattenTokens(tokenizeInline(proseText(content)))) {
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

/** One node of the tag hierarchy the sidebar renders. */
export interface TagTreeNode {
  /** The node's own segment, as first encountered. */
  name: string
  /** The full path (`读书/认知`) — the tag as it is written on memos. */
  path: string
  /**
   * Memos carrying exactly this tag. A tag that only exists as someone's
   * parent — created by a `#读书/认知` memo without any plain `#读书` memo —
   * has 0: flomo treats every level as its own tag.
   */
  count: number
  /** Sub-tags, siblings sorted alphabetically by name. */
  children: TagTreeNode[]
}

/**
 * Fold the flat tag list into the hierarchy the slash syntax implies.
 *
 * `#读书/认知` makes `读书` a foldable parent whether or not any memo carries
 * it bare, and a tag that is both a parent and written on its own (`#读书` and
 * `#读书/认知`) becomes one node holding its own count *and* its children.
 * Paths merge case-insensitively, matching every other tag comparison; the
 * first casing seen is the one displayed.
 * @param stats - the corpus's tag frequencies.
 * @returns the root nodes, alphabetical by name.
 */
export function tagTree(stats: readonly TagStat[]): TagTreeNode[] {
  const roots: TagTreeNode[] = []
  const index = new Map<string, TagTreeNode>()

  for (const stat of stats) {
    const segments = tagSegments(stat.tag)
    let level = roots
    let path = ''
    for (const [depth, name] of segments.entries()) {
      path = depth === 0 ? name : `${path}/${name}`
      const key = tagKey(path)
      let node = index.get(key)
      if (node === undefined) {
        node = { name, path, count: 0, children: [] }
        index.set(key, node)
        level.push(node)
      }
      if (depth === segments.length - 1) node.count = stat.count
      level = node.children
    }
  }

  const sortLevel = (nodes: TagTreeNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    for (const node of nodes) sortLevel(node.children)
  }
  sortLevel(roots)
  return roots
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

/** A `#` run being typed, located in the text around the caret. */
export interface TagFragment {
  /** Index of the `#`. */
  start: number
  /** What has been typed after it, possibly empty. */
  query: string
}

/**
 * Find the `#` fragment the caret is currently inside.
 *
 * Deliberately does not require whitespace before the `#`: the tokenizer treats
 * `今天读到#认知失调` as a tag, so a completion rule stricter than the parser
 * would offer suggestions in places the parser agrees with and refuse in places
 * it does not. The two must agree.
 * @param text - the field's current value.
 * @param caret - the caret offset.
 * @returns the fragment, or `null` when the caret is not in one.
 */
export function tagFragmentAtCaret(text: string, caret: number): TagFragment | null {
  const from = Math.max(0, Math.min(caret, text.length))
  // A `#` inside a fenced block is code, so completion stays out of it — the
  // field must never offer a tag the parser would refuse to record.
  if (isInsideFence(text, from)) return null
  for (let index = from - 1; index >= 0; index -= 1) {
    const char = text[index]
    if (char === undefined) break
    if (char === '#') return { start: index, query: text.slice(index + 1, from) }
    if (/\s/.test(char)) return null
  }
  return null
}

/**
 * Rank known tags against what is being typed.
 *
 * Prefix matches come before substring matches, and within each group the input
 * order is preserved — which matters because callers pass {@link tagStats}
 * output, already ordered by how often the tag is used. So the most-used prefix
 * match wins, which is almost always the intended completion.
 * @param query - what has been typed after the `#`.
 * @param known - the corpus's tags, ideally frequency-ordered.
 * @param limit - maximum suggestions.
 * @returns the suggestions.
 */
export function suggestTags(
  query: string,
  known: readonly TagStat[],
  limit = 8,
): TagStat[] {
  const needle = query.toLocaleLowerCase()
  const prefix: TagStat[] = []
  const contains: TagStat[] = []

  for (const stat of known) {
    const key = tagKey(stat.tag)
    if (needle === '' || key.startsWith(needle)) prefix.push(stat)
    else if (key.includes(needle)) contains.push(stat)
  }

  return [...prefix, ...contains].slice(0, Math.max(0, limit))
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
 * Every other mark is returned as its source text: this is the tag-only view, and
 * it still covers the whole input so a caller can render it verbatim.
 * @param content - the raw memo body.
 * @returns the alternating tokens.
 */
export function tokenizeTags(content: string): TagToken[] {
  return tokenizeInline(content).map((token) => {
    if (token.type === 'tag') return { type: 'tag' as const, value: token.value }
    return { type: 'text' as const, value: markupOf(token) ?? token.value }
  })
}
