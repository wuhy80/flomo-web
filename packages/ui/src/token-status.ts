/**
 * Where a personal access token stands in its life, and where to get a new one.
 *
 * GitHub's fine-grained tokens carry a mandatory expiration, and an expired
 * token is the one failure a retry can never fix — every request answers 401
 * until a new token is pasted in. So the expiry date, once the user records it,
 * turns into a warning banner before the cliff and the auth-failure banner
 * names the token rather than the network afterwards.
 *
 * @module @flomo/ui/token-status
 */

/** GitHub's page for creating a fine-grained personal access token. */
export const GITHUB_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** How a token's expiry reads for the banner. */
export interface TokenExpiry {
  /** `expired` once the date is past, `soon` inside the warning window. */
  level: 'expired' | 'soon'
  /** The banner line, already localized. */
  label: string
}

/** Warn this many days out; close to GitHub's own expiry reminder email. */
const WARNING_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Days until the token dies, counted through the end of the expiry day —
 * GitHub keeps a token valid for the whole date it names.
 * @param expiresAt - the recorded date, `YYYY-MM-DD`.
 * @returns whole days left, negative once expired, or `null` when unknown.
 */
export function tokenDaysLeft(expiresAt: string | null | undefined): number | null {
  const match = expiresAt === null || expiresAt === undefined ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt.trim())
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const endOfDay = Date.UTC(year, month - 1, day + 1)
  return Math.ceil((endOfDay - Date.now()) / DAY_MS)
}

/**
 * Read the recorded expiry into banner terms.
 * @param expiresAt - the recorded date, `YYYY-MM-DD`, when the user entered one.
 * @returns the banner level and text, or `null` when far away, absent or unparseable.
 */
export function describeTokenExpiry(expiresAt: string | null | undefined): TokenExpiry | null {
  const days = tokenDaysLeft(expiresAt)
  if (days === null || expiresAt === null || expiresAt === undefined) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt.trim())
  if (match === null) return null
  const date = `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
  if (days <= 0) {
    return { level: 'expired', label: `GitHub 令牌已于 ${date} 过期，保存会一直失败。` }
  }
  if (days <= WARNING_DAYS) {
    return {
      level: 'soon',
      label:
        days === 1
          ? `GitHub 令牌明天（${date}）过期。`
          : `GitHub 令牌还有 ${days} 天过期（${date}）。`,
    }
  }
  return null
}
