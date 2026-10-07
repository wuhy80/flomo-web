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
 * Alongside the flomo marks, the inline half of Markdown is recognised —
 * `**bold**`, `*italic*`, `_italic_`, `~~strike~~`, `` `code` ``,
 * `[text](url)`, `![alt](url)` and bare URLs — with the same single-pass
 * alternation, so priority is positional and unambiguous. Container marks
 * (bold, italic, strike, link text) carry their inner runs as `children`, which
 * makes one level of nesting — a tag inside a bold run, a link inside an
 * italic one — render and index exactly like the flat case.
 *
 * @module @flomo/core/inline
 */

/**
 * The combined matcher.
 *
 * Alternation order is priority: image before link (the `!` prefix), strong
 * before italic (both start with `*`), and the bare URL last but one so a
 * `#fragment` inside an address is consumed as part of it rather than indexed
 * as a tag.
 *
 * Built fresh per call rather than shared, so no code path can be affected by a
 * `lastIndex` another one left behind.
 * @returns the pattern.
 */
function inlinePattern(): RegExp {
  return new RegExp(
    [
      '\\[\\[([^[\\]\\n]+)\\]\\]',
      '@\\[([^\\]@\\s]+)\\]',
      '<u>([^<\\n]+)</u>',
      '!\\[([^\\]\\n]*)\\]\\((https?://[^)\\s]+)\\)',
      '\\[([^\\]\\n]+)\\]\\((https?://[^)\\s]+)\\)',
      '\\*\\*([^*\\n]+)\\*\\*',
      '~~([^~\\n]+)~~',
      '==([^=\\n]+)==',
      '`([^`\\n]+)`',
      '(?<![\\w\\\\])_([^_\\n]+)_(?!\\w)',
      '\\*([^*\\n]+)\\*',
      '(https?://[^\\s<>()\\[\\]{}"\'，。！？；：、…（）【】《》]+)',
      '#([^\\s#]+)',
    ].join('|'),
    'gu',
  )
}

/**
 * Punctuation that terminates a tag when it directly abuts one. Without this,
 * `今天读了 #深度工作。` would yield the tag `深度工作。`.
 */
const TRAILING_PUNCTUATION = /[，。！？；：、,.!?;:)\]）】》"'”’…]+$/u

/**
 * ASCII punctuation that ends a bare URL. Only these are trimmed from the
 * match — a domain like `pypi.io` keeps its dot, while `看 https://x.com/a。`
 * keeps its full stop out of the address.
 */
const URL_TRAILING = /[.,;:!?]+$/

/** A run of body text, or one of the inline marks. */
export interface InlineToken {
  type:
    | 'text'
    | 'tag'
    /** A `[[wikilink]]` to another note. */
    | 'link'
    /** An `@[id]` reference to a specific memo (批注/引用). */
    | 'memoref'
    | 'strong'
    | 'em'
    | 'strike'
    /** `<u>underline</u>`, from the composer's format menu. */
    | 'underline'
    /** `==highlight==`, from the composer's format menu. */
    | 'mark'
    | 'code'
    /** A `[text](url)` Markdown link. */
    | 'mdlink'
    /** An `![alt](url)` image. */
    | 'image'
    /** A bare URL, autolinked. */
    | 'url'
  /** For `text`, the literal run; otherwise the content without its markup. */
  value: string
  /** The target of an `mdlink` or `image`. Renderers must still vet the scheme. */
  url?: string
  /** Inner tokens of a container mark, so nesting renders and indexes uniformly. */
  children?: InlineToken[]
}

/**
 * The inner tokens of a container mark, or undefined when the content is plain.
 *
 * Populated lazily so the overwhelming case — emphasis around plain words —
 * stays a flat token with no children to walk or render.
 * @param value - the container's inner text.
 * @returns the inner tokens when they contain a mark, else undefined.
 */
function innerTokens(value: string): InlineToken[] | undefined {
  const tokens = tokenizeInline(value)
  return tokens.length === 1 && tokens[0] !== undefined && tokens[0].type === 'text' ? undefined : tokens
}

/**
 * The `children` field for a container: present only when the inner run
 * actually contains a mark, so a plain-word emphasis stays keyless.
 */
function childrenField(value: string): { children?: InlineToken[] } {
  const children = innerTokens(value)
  return children === undefined ? {} : { children }
}

/**
 * Split a memo body into text and inline marks.
 *
 * The tokens cover the entire input, so a renderer can concatenate them and get
 * the original body back. A malformed marker such as `[[   ]]` is left inside
 * the surrounding text rather than dropped, since silently eating the user's
 * characters would be worse than showing them.
 *
 * Every mark is recognised here rather than by the renderer for the same reason
 * tags and links are: one pattern means the highlighter, the tag index and the
 * link resolver can never disagree about what a run of text is.
 * @param content - the raw body.
 * @returns the alternating tokens.
 */
export function tokenizeInline(content: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0

  for (const match of content.matchAll(inlinePattern())) {
    const start = match.index ?? 0
    if (start < cursor) continue

    const [wikilink, memoref, underline, imageAlt, imageUrl, mdText, mdUrl, strong, strike, mark, code, emUnder, emStar, url, tag] =
      match.slice(1)

    let token: InlineToken | null = null

    if (wikilink !== undefined) {
      token = { type: 'link', value: wikilink.trim() }
    } else if (memoref !== undefined) {
      token = { type: 'memoref', value: memoref }
    } else if (underline !== undefined) {
      token = { type: 'underline', value: underline, ...childrenField(underline) }
    } else if (imageUrl !== undefined) {
      token = { type: 'image', value: imageAlt ?? '', url: imageUrl }
    } else if (mdUrl !== undefined) {
      const text = mdText ?? ''
      token = { type: 'mdlink', value: text, url: mdUrl, ...childrenField(text) }
    } else if (strong !== undefined) {
      token = { type: 'strong', value: strong, ...childrenField(strong) }
    } else if (strike !== undefined) {
      token = { type: 'strike', value: strike, ...childrenField(strike) }
    } else if (mark !== undefined) {
      token = { type: 'mark', value: mark, ...childrenField(mark) }
    } else if (code !== undefined) {
      token = { type: 'code', value: code }
    } else if (emUnder !== undefined) {
      token = { type: 'em', value: emUnder, ...childrenField(emUnder) }
    } else if (emStar !== undefined) {
      token = { type: 'em', value: emStar, ...childrenField(emStar) }
    } else if (url !== undefined) {
      const address = url.replace(URL_TRAILING, '')
      if (address.length > 0) token = { type: 'url', value: address }
    } else if (tag !== undefined) {
      const value = tag.replace(TRAILING_PUNCTUATION, '')
      // Only the tag itself is consumed: trailing punctuation stays in the text,
      // so `#深度工作。` keeps its full stop.
      if (value.length > 0) token = { type: 'tag', value }
    }

    if (token === null) continue
    // A marker with no body (`[[ ]]`) stays in the text instead of vanishing.
    if (token.value.length === 0 && token.url === undefined) continue

    if (start > cursor) tokens.push({ type: 'text', value: content.slice(cursor, start) })
    tokens.push(token)
    cursor =
      token.type === 'tag'
        ? start + 1 + token.value.length
        : token.type === 'url'
          ? start + token.value.length
          : start + match[0].length
  }

  if (cursor < content.length) tokens.push({ type: 'text', value: content.slice(cursor) })
  return tokens
}

/**
 * The source text a token was written as.
 *
 * Used by callers that need the original markup back — a renderer that only
 * understands some marks, or a prose test that must not see any of them.
 * Container marks rebuild their children, so nesting round-trips.
 * @param token - the token.
 * @returns the literal source, or `null` for plain text.
 */
export function markupOf(token: InlineToken): string | null {
  const inner = (value: string, children?: InlineToken[]): string =>
    children === undefined ? value : children.map((child) => markupOf(child) ?? child.value).join('')

  switch (token.type) {
    case 'text':
      return null
    case 'tag':
      return `#${token.value}`
    case 'link':
      return `[[${token.value}]]`
    case 'memoref':
      return `@[${token.value}]`
    case 'strong':
      return `**${inner(token.value, token.children)}**`
    case 'em':
      return `*${inner(token.value, token.children)}*`
    case 'strike':
      return `~~${inner(token.value, token.children)}~~`
    case 'underline':
      return `<u>${inner(token.value, token.children)}</u>`
    case 'mark':
      return `==${inner(token.value, token.children)}==`
    case 'code':
      return `\`${token.value}\``
    case 'mdlink':
      return `[${inner(token.value, token.children)}](${token.url})`
    case 'image':
      return `![${token.value}](${token.url})`
    case 'url':
      return token.value
  }
}

/**
 * Every token in a stream, depth-first.
 *
 * Consumers that index content — the tag extractor, the link resolver — walk
 * this, so a `#tag` inside a bold run or an emphasis inside link text is
 * indexed exactly like its flat counterpart.
 * @param tokens - the top-level tokens.
 * @returns the tokens with every nested run inlined after its container.
 */
export function flattenTokens(tokens: readonly InlineToken[]): InlineToken[] {
  const out: InlineToken[] = []
  for (const token of tokens) {
    out.push(token)
    if (token.children !== undefined) out.push(...flattenTokens(token.children))
  }
  return out
}
