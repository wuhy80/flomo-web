/**
 * The three-day device trust.
 *
 * After one successful password entry the *derived key* — never the password —
 * may rest in `localStorage` with an expiry, so a refresh unlocks silently
 * instead of asking again. The key is stored in the recovery code's format,
 * which is the least secret thing that still opens the vault: it unlocks this
 * one repository and nothing else, so a password the user reuses elsewhere is
 * never on disk.
 *
 * The trade-off is stated plainly: with trust on, whoever can read the
 * browser's storage can read the notes. That is the same surface the PAT
 * already lives in, and it is the user's own device — the checkbox on the gate
 * makes it a choice rather than a default they never saw.
 *
 * @module @flomo/ui/device-trust
 */

/** How long one password entry buys, in days. */
export const TRUST_DAYS = 3

/** Milliseconds in {@link TRUST_DAYS}. */
const TRUST_MS = TRUST_DAYS * 24 * 60 * 60 * 1000

/** `localStorage` key holding the trusted entry. */
const STORAGE_KEY = 'flomo-sim:trust:v1'

/** What one remembered unlock looks like on disk. */
export interface DeviceTrust {
  /** Base64 of the raw vault key — the recovery code's format, not the password. */
  key: string
  /** Epoch milliseconds when the trust lapses. */
  expires: number
}

/** The slice of `Storage` this module needs, so a test can inject a stand-in. */
export type TrustArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Read the trusted entry, if it is present and still young.
 *
 * An expired entry is removed on the way out: leaving it behind would make the
 * next `saveTrust` look like a refresh of a dead grant.
 * @param area - storage to read; defaults to the browser's `localStorage`.
 * @returns the trusted key and expiry, or null when absent/expired/unreadable.
 */
export function loadTrust(area: TrustArea | undefined = defaultArea()): DeviceTrust | null {
  if (area === undefined) return null
  try {
    const raw = area.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceTrust>
    if (typeof parsed.key !== 'string' || typeof parsed.expires !== 'number') return null
    if (parsed.expires <= Date.now()) {
      area.removeItem(STORAGE_KEY)
      return null
    }
    return { key: parsed.key, expires: parsed.expires }
  } catch {
    return null
  }
}

/**
 * Remember the derived key until three days from now.
 * @param key - base64 of the raw vault key.
 * @param area - storage to write; defaults to the browser's `localStorage`.
 * @param now - reference instant, for tests.
 */
export function saveTrust(
  key: string,
  area: TrustArea | undefined = defaultArea(),
  now: number = Date.now(),
): void {
  if (area === undefined) return
  try {
    const trust: DeviceTrust = { key, expires: now + TRUST_MS }
    area.setItem(STORAGE_KEY, JSON.stringify(trust))
  } catch {
    // Private browsing quotas and disabled storage simply mean manual unlock.
  }
}

/**
 * Forget the trusted key — used when it no longer opens the vault, and by a
 * host that wants a hard sign-out.
 * @param area - storage to clear; defaults to the browser's `localStorage`.
 */
export function clearTrust(area: TrustArea | undefined = defaultArea()): void {
  if (area === undefined) return
  try {
    area.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do; the entry could not be read in the first place.
  }
}

/**
 * The browser's storage, or undefined where there is none (tests, SSR).
 * @returns the storage area, or undefined.
 */
function defaultArea(): TrustArea | undefined {
  return globalThis.localStorage
}
