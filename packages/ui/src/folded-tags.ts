/**
 * Which tag branches the sidebar has folded, per device.
 *
 * A multi-level tag list can grow tall, so flomo lets a parent tag fold its
 * children away. Which branches are folded is a display preference rather than
 * note data, so it lives in `localStorage` keyed per device: it survives
 * refreshes but does not follow you across machines — the same call
 * {@link module:@flomo/ui/pinned-tags} makes for pins.
 *
 * The shape on disk is a JSON array of tag paths (`读书/认知`); a corrupted or
 * wrongly-shaped entry reads as "nothing folded" rather than an error.
 *
 * @module @flomo/ui/folded-tags
 */

/** `localStorage` key holding the folded tag-path list. */
const STORAGE_KEY = 'flomo-sim:folded-tags:v1'

/** The slice of `Storage` this module needs, so a test can inject a stand-in. */
export type FoldedArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Read the folded tag paths.
 * @param area - storage to read; defaults to the browser's `localStorage`.
 * @returns the folded paths, or an empty list when none or unreadable.
 */
export function loadFoldedTags(area: FoldedArea | undefined = defaultArea()): string[] {
  if (area === undefined) return []
  try {
    const raw = area.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    return []
  }
}

/**
 * Replace the folded list.
 * @param paths - the folded tag paths.
 * @param area - storage to write; defaults to the browser's `localStorage`.
 */
export function saveFoldedTags(paths: readonly string[], area: FoldedArea | undefined = defaultArea()): void {
  if (area === undefined) return
  try {
    area.setItem(STORAGE_KEY, JSON.stringify(paths))
  } catch {
    // Storage unavailable (private browsing): folding just does not persist.
  }
}

/**
 * The browser's storage, or undefined where there is none (tests, SSR).
 * @returns the storage area, or undefined.
 */
function defaultArea(): FoldedArea | undefined {
  return globalThis.localStorage
}
