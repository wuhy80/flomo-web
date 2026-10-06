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
 * The combined matcher: group 1 a link target, group 2 a tag name, group 3 bold
 * text, group 4 inline code.
 *
 * Built fresh per call rather than shared, so no code path can be affected by a
 * `lastIndex` another one left behind.
 * @returns the pattern.
 */
function inlinePattern(): RegExp {
  return /\[\[([^[\]\n]+)\]\]|#([^\s#]+)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
}

/**
 * Punctuation that terminates a tag when it directly abuts one. Without this,
 * `今天读了 #深度工作。` would yield the tag `深度工作。`.
 */
const TRAILING_PUNCTUATION = /[，。！？；：、,.!?;:)\]）】》"'”’…]+$/u

/** A run of body text, or one of the inline marks. */
export interface InlineToken {
  type: 'text' | 'tag' | 'link' | 'strong' | 'code'
  /** For `text`, the literal run; otherwise the content without its markup. */
  value: string
}

/**
 * Split a memo body into text and inline marks.
 *
 * The tokens cover the entire input, so a renderer can concatenate them and get
 * the original body back. A malformed marker such as `[[   ]]` is left inside
 * the surrounding text rather than dropped, since silently eating the user's
 * characters would be worse than showing them.
 *
 * Bold and inline code are recognised here rather than by the renderer for the
 * same reason tags and links are: one pattern means the highlighter, the tag
 * index and the link resolver can never disagree about what a run of text is.
 * @param content - the raw body.
 * @returns the alternating tokens.
 */
export function tokenizeInline(content: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0

  for (const match of content.matchAll(inlinePattern())) {
    const start = match.index ?? 0
    const link = match[1]
    const tag = match[2]
    const strong = match[3]
    const code = match[4]

    let type: InlineToken['type']
    let value: string
    let consumed: number

    if (link !== undefined) {
      type = 'link'
      value = link.trim()
      consumed = link.length + 4
    } else if (tag !== undefined) {
      type = 'tag'
      value = tag.replace(TRAILING_PUNCTUATION, '')
      // Only the tag itself is consumed: trailing punctuation stays in the text,
      // so `#深度工作。` keeps its full stop.
      consumed = 1 + value.length
    } else if (strong !== undefined) {
      type = 'strong'
      value = strong
      consumed = strong.length + 4
    } else {
      type = 'code'
      value = code ?? ''
      consumed = value.length + 2
    }

    if (value.length === 0) continue

    if (start > cursor) tokens.push({ type: 'text', value: content.slice(cursor, start) })
    tokens.push({ type, value })
    cursor = start + consumed
  }

  if (cursor < content.length) tokens.push({ type: 'text', value: content.slice(cursor) })
  return tokens
}

/**
 * The source text a token was written as.
 *
 * Used by callers that need the original markup back — a renderer that only
 * understands some marks, or a prose test that must not see any of them.
 * @param token - the token.
 * @returns the literal source, or `null` for plain text.
 */
export function markupOf(token: InlineToken): string | null {
  switch (token.type) {
    case 'text':
      return null
    case 'tag':
      return `#${token.value}`
    case 'link':
      return `[[${token.value}]]`
    case 'strong':
      return `**${token.value}**`
    case 'code':
      return `\`${token.value}\``
  }
}
