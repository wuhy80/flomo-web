/**
 * The `#compose=` deep link.
 *
 * Quick-capture from outside the app — an iOS/Android shortcut fed from the
 * WeChat share sheet, a launcher, any tool that can open a URL. The text rides
 * in the URL fragment: it never reaches a server (the app has none, and
 * fragments are not sent in requests), and the app consumes it on arrival, so
 * a refresh does not paste the same note twice.
 *
 * @module @flomo/ui/deep-link
 */

/**
 * Read the compose preset from a location hash.
 *
 * Parsed as a query string so `encodeURIComponent` output and `+`-for-space
 * both decode the way the sender meant them. Anything that is not a compose
 * link — or an empty one — is simply not a preset.
 * @param hash - the raw `location.hash`, leading `#` included.
 * @returns the preset text, or null when absent.
 */
export function readComposeDeepLink(hash: string): string | null {
  if (!hash.startsWith('#')) return null
  const value = new URLSearchParams(hash.slice(1)).get('compose')
  if (value === null || value.trim() === '') return null
  return value
}

/**
 * Read a Web Share Target payload from the query string.
 *
 * An installed PWA registered as a system share target receives
 * `?title=&text=&url=` when the user shares into it — WeChat articles arrive as
 * title plus link, plain chat text as text alone. The parts assemble into one
 * preset, newest-context first; a title the text already begins with is not
 * repeated.
 * @param search - the raw `location.search`, leading `?` included.
 * @returns the preset text, or null when the query carries nothing usable.
 */
export function readShareTarget(search: string): string | null {
  if (!search.startsWith('?')) return null
  const params = new URLSearchParams(search.slice(1))
  const text = params.get('text')?.trim() ?? ''
  const title = params.get('title')?.trim() ?? ''
  const url = params.get('url')?.trim() ?? ''
  const parts: string[] = []
  if (title !== '' && (text === '' || !text.startsWith(title))) parts.push(title)
  if (text !== '') parts.push(text)
  if (url !== '') parts.push(url)
  const joined = parts.join('\n\n')
  return joined === '' ? null : joined
}

/**
 * Read a single-memo deep link from a location hash.
 *
 * `#memo=<id>` opens the note's own page — the target of the more-menu's
 * 复制链接. Like the compose preset it is consumed on arrival, so a shared
 * bookmark starts clean.
 * @param hash - the raw `location.hash`, leading `#` included.
 * @returns the memo id, or null when absent.
 */
export function readMemoDeepLink(hash: string): string | null {
  if (!hash.startsWith('#')) return null
  const value = new URLSearchParams(hash.slice(1)).get('memo')
  if (value === null || value.trim() === '') return null
  return value
}
