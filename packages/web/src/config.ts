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
 * Read the stored config.
 * @returns the config, or `null` when absent or malformed.
 */
export function loadConfig(): WebConfig | null {
  for (const remember of [true, false]) {
    const storage = storageFor(remember)
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) continue
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
  const storage = storageFor(config.remember)
  storage?.setItem(STORAGE_KEY, JSON.stringify(config))
}

/** Remove every stored copy of the config. */
export function clearConfig(): void {
  storageFor(true)?.removeItem(STORAGE_KEY)
  storageFor(false)?.removeItem(STORAGE_KEY)
}
