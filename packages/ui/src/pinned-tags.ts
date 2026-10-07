/**
 * Pinned tags, per device.
 *
 * flomo lets you pin tags so the ones you live in float above the rest. The
 * pin list is a display preference rather than note data, so it lives in
 * `localStorage` keyed per device: it survives refreshes but does not follow
 * you across machines. Promoting it into the vault would mean a metadata file
 * with its own write-conflict story — a different scale of feature.
 *
 * The shape on disk is a JSON array of tag names, in the order they were
 * pinned; a corrupted or wrongly-shaped entry is treated as "nothing pinned"
 * rather than an error.
 *
 * @module @flomo/ui/pinned-tags
 */

/** `localStorage` key holding the pinned tag list. */
const STORAGE_KEY = 'flomo-sim:pinned-tags:v1'

/** The slice of `Storage` this module needs, so a test can inject a stand-in. */
export type PinnedArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Read the pinned tags, in pin order.
 * @param area - storage to read; defaults to the browser's `localStorage`.
 * @returns the pinned tag names, or an empty list when none or unreadable.
 */
export function loadPinnedTags(area: PinnedArea | undefined = defaultArea()): string[] {
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
 * Replace the pinned list.
 * @param tags - the pinned tag names, in display order.
 * @param area - storage to write; defaults to the browser's `localStorage`.
 */
export function savePinnedTags(tags: readonly string[], area: PinnedArea | undefined = defaultArea()): void {
  if (area === undefined) return
  try {
    area.setItem(STORAGE_KEY, JSON.stringify(tags))
  } catch {
    // Storage unavailable (private browsing): pinning just does not persist.
  }
}

/**
 * The browser's storage, or undefined where there is none (tests, SSR).
 * @returns the storage area, or undefined.
 */
function defaultArea(): PinnedArea | undefined {
  return globalThis.localStorage
}
