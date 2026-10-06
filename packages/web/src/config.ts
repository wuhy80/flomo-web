/**
 * Persisted connection settings for the web app.
 *
 * The PAT lives in `localStorage` (or `sessionStorage` when the user opts out
 * of remembering). That is acceptable here specifically because the repository
 * only ever holds ciphertext: a stolen token buys an attacker encrypted blobs,
 * not notes. The password is never persisted in any form.
 *
 * @module @flomo/web/config
 */

/** Where the data repository lives and how to authenticate to it. */
export interface WebConfig {
  owner: string
  repo: string
  branch?: string
  token: string
  /** Persist across browser restarts, versus only for this tab session. */
  remember: boolean
}

const STORAGE_KEY = 'flomo-sim:config:v1'

/**
 * Pick the storage area for a config.
 * @param remember - whether the config should survive a browser restart.
 * @returns the matching `Storage`, or `null` when unavailable.
 */
function storageFor(remember: boolean): Storage | null {
  try {
    return remember ? window.localStorage : window.sessionStorage
  } catch {
    // Private-browsing modes can throw on mere access.
    return null
  }
}

/**
 * Read a key, tolerating a storage that refuses.
 *
 * The guard has to wrap the operation and not just the property access: a
 * locked-down iframe throws from `getItem`, and an unguarded throw here happens
 * inside a `useState` initializer, so it takes the whole app down rather than
 * merely losing a setting.
 * @param storage - the area to read, or `null`.
 * @param key - the key to read.
 * @returns the stored value, or `null`.
 */
function read(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/**
 * Write a key, tolerating a storage that refuses.
 * @param storage - the area to write, or `null`.
 * @param key - the key to write.
 * @param value - the value to store.
 */
function write(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Best effort: failing to *remember* a token must never fail the action that
    // is trying to use it.
  }
}

/**
 * Remove a key, tolerating a storage that refuses.
 * @param storage - the area to clear, or `null`.
 * @param key - the key to remove.
 */
function remove(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Best effort by design.
  }
}

/**
 * Read the stored config.
 *
 * The area a config is found in decides `remember`, not the field inside it: the
 * location is what actually determines persistence, so it is the fact and the
 * field is redundant.
 * @returns the config, or `null` when absent or malformed.
 */
export function loadConfig(): WebConfig | null {
  for (const remember of [true, false]) {
    const raw = read(storageFor(remember), STORAGE_KEY)
    if (raw === null || raw === '') continue
    try {
      const parsed = JSON.parse(raw) as Partial<WebConfig>
      if (
        typeof parsed.owner === 'string' &&
        parsed.owner.length > 0 &&
        typeof parsed.repo === 'string' &&
        parsed.repo.length > 0 &&
        typeof parsed.token === 'string' &&
        parsed.token.length > 0
      ) {
        return {
          owner: parsed.owner,
          repo: parsed.repo,
          ...(typeof parsed.branch === 'string' && parsed.branch.length > 0
            ? { branch: parsed.branch }
            : {}),
          token: parsed.token,
          remember,
        }
      }
    } catch {
      // Corrupt entry: fall through and treat it as absent.
    }
  }
  return null
}

/**
 * Persist a config, clearing the other storage area so exactly one copy exists.
 * @param config - the config to write.
 */
export function saveConfig(config: WebConfig): void {
  clearConfig()
  write(storageFor(config.remember), STORAGE_KEY, JSON.stringify(config))
}

/** Remove every stored copy of the config. */
export function clearConfig(): void {
  remove(storageFor(true), STORAGE_KEY)
  remove(storageFor(false), STORAGE_KEY)
}
