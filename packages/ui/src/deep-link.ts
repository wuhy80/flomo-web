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
