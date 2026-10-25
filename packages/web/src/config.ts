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

import type { OAuthSession } from './oauth.ts'

/**
 * The data repository a GitHub sign-in connects to.
 *
 * The owner is never asked for: it is whichever account GitHub says signed in,
 * and the relay has already refused every account but the configured one.
 */
export const DEFAULT_REPO = 'flomo-data'

/** Where the data repository lives and how to authenticate to it. */
export interface WebConfig {
  owner: string
  repo: string
  branch?: string
  token: string
  /**
   * The date the token expires, `YYYY-MM-DD`, as shown on GitHub's token page.
   *
   * Optional: GitHub offers no API to read a PAT's expiry back, so the only
   * moment anyone knows it is while creating the token — the form asks for it
   * there and the UI turns it into a warning banner as the date approaches.
   */
  tokenExpiresAt?: string
  /** Persist across browser restarts, versus only for this tab session. */
  remember: boolean
  /**
   * How the token was obtained.
   *
   * Absent means a pasted PAT — which is what every config written before the
   * GitHub login existed is, so an old entry keeps working untouched and needs
   * no migration.
   */
  auth?: 'pat' | 'oauth'
  /** The GitHub login the token belongs to, for display in settings. */
  login?: string
  /**
   * Refresh token, present only when GitHub issued short-lived tokens.
   *
   * Eight hours is the default lifetime for a new OAuth App, so this is what
   * stops a working session from expiring three times a day.
   */
  refreshToken?: string
  /** Epoch milliseconds when the OAuth token lapses; absent means it does not. */
  expiresAt?: number
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
          ...(typeof parsed.tokenExpiresAt === 'string' && parsed.tokenExpiresAt.length > 0
            ? { tokenExpiresAt: parsed.tokenExpiresAt }
            : {}),
          remember,
          // Carried through only when well formed: a half-written OAuth entry
          // must degrade to "a PAT config", not to a broken one.
          ...(parsed.auth === 'oauth' ? { auth: 'oauth' as const } : {}),
          ...(typeof parsed.login === 'string' && parsed.login.length > 0
            ? { login: parsed.login }
            : {}),
          ...(typeof parsed.refreshToken === 'string' && parsed.refreshToken.length > 0
            ? { refreshToken: parsed.refreshToken }
            : {}),
          ...(typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)
            ? { expiresAt: parsed.expiresAt }
            : {}),
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

/**
 * Turn a signed-in GitHub session into the config to store.
 *
 * The owner is taken from the account the relay resolved rather than from
 * anything the page typed, which is what makes the account lock meaningful: a
 * `code` minted for someone else never becomes an owner here.
 * @param session - what the relay returned.
 * @param previous - an existing config, so a refresh keeps the repository,
 * branch and remember choice instead of resetting them to the defaults.
 * @returns the config.
 */
export function configFromLogin(
  session: OAuthSession,
  previous?: Pick<WebConfig, 'repo' | 'branch' | 'remember'>,
): WebConfig {
  return {
    owner: session.login,
    repo: previous?.repo ?? DEFAULT_REPO,
    ...(previous?.branch !== undefined && previous.branch.length > 0
      ? { branch: previous.branch }
      : {}),
    token: session.token,
    remember: previous?.remember ?? true,
    auth: 'oauth',
    login: session.login,
    ...(session.refreshToken === undefined ? {} : { refreshToken: session.refreshToken }),
    ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
  }
}
