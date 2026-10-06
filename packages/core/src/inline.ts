/**
 * The one tokenizer for inline markup.
 *
 * Both `#tags` and `[[links]]` are written inside the memo body rather than in
 * separate fields, so something has to walk the text and decide what each run
 * is. That something lives here, and *only* here: the tag index, the link
 * resolver and the renderer all read the same token stream, which is what makes
 * it structurally impossible for what the UI highlights to disagree with what
 * the index stored.
 *
 * Recognising both forms in a single alternation (rather than scanning twice and
 * reconciling overlaps) means a `#` inside a `[[link]]` is unambiguously part of
 * the link.
 *
 * @module @flomo/core/inline
 */

/**
 * The combined matcher: group 1 is a link target, group 2 a tag name.
 *
 * Built fresh per call rather than shared, so no code path can be affected by a
 * `lastIndex` another one left behind.
 * @returns the pattern.
 */
function inlinePattern(): RegExp {
  return /\[\[([^[\]\n]+)\]\]|#([^\s#]+)/g
}

/**
 * Punctuation that terminates a tag when it directly abuts one. Without this,
 * `今天读了 #深度工作。` would yield the tag `深度工作。`.
 */
const TRAILING_PUNCTUATION = /[，。！？；：、,.!?;:)\]）】》"'”’…]+$/u

/** A run of body text, a tag, or a link. */
export interface InlineToken {
  type: 'text' | 'tag' | 'link'
  /** For `text`, the literal run; for `tag`/`link`, the name without markup. */
  value: string
}

/**
 * Split a memo body into text, tag and link runs.
 *
 * The tokens cover the entire input, so a renderer can concatenate them and get
 * the original body back. A malformed marker such as `[[   ]]` is left inside
 * the surrounding text rather than dropped, since silently eating the user's
 * characters would be worse than showing them.
 * @param content - the raw body.
 * @returns the alternating tokens.
 */
export function tokenizeInline(content: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0

  for (const match of content.matchAll(inlinePattern())) {
    const start = match.index ?? 0
    const isLink = match[1] !== undefined
    const raw = (isLink ? match[1] : match[2]) ?? ''
    const value = isLink ? raw.trim() : raw.replace(TRAILING_PUNCTUATION, '')
    if (value.length === 0) continue

    if (start > cursor) tokens.push({ type: 'text', value: content.slice(cursor, start) })
    tokens.push({ type: isLink ? 'link' : 'tag', value })
    // Advance past the whole match, including whichever delimiters it carried.
    cursor = start + (isLink ? raw.length + 4 : 1 + value.length)
  }

  if (cursor < content.length) tokens.push({ type: 'text', value: content.slice(cursor) })
  return tokens
}
