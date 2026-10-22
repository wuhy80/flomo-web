/**
 * "Sign in with GitHub", for a site that has no server of its own.
 *
 * GitHub cannot finish an authorization-code exchange from a browser: the token
 * endpoint answers no CORS preflight (github/docs#22270), so the `fetch` never
 * leaves the page. The exchange therefore happens in the relay — see `relay/` —
 * and this module is the other half of that conversation. It builds the
 * authorize URL, keeps the two values that must survive the round trip (`state`
 * and the PKCE verifier), and turns the `code` GitHub hands back into a token.
 *
 * **What it deliberately does not do is decide who may sign in.** The relay
 * refuses every account but the one it is configured for, and it does so before
 * the token appears in any response body. A check here would only be a
 * suggestion: everything this module can see, the person holding the browser
 * can change. So there is no second copy of the account rule to drift out of
 * step with the first.
 *
 * The password is not involved anywhere in this file. Signing in gets you
 * *storage* — the right to read and write a private repository full of
 * ciphertext. Opening the notes still needs the vault password, and always
 * will.
 *
 * @module @flomo/web/oauth
 */

/**
 * The OAuth App's client id.
 *
 * Public by design — it travels in the authorize URL the browser navigates to —
 * so it belongs in source rather than in any kind of secret store. Empty means
 * "no GitHub login configured", and the setup form then behaves exactly as it
 * did before this existed.
 */
export const GITHUB_CLIENT_ID = ''

/**
 * Where the relay is deployed, with no trailing slash.
 *
 * `wrangler deploy` prints this. See `relay/README.md`.
 */
export const RELAY_URL = ''

/** GitHub's authorization screen. */
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'

/**
 * The scope asked for.
 *
 * `repo` is coarse — it is every private repository the account can reach, not
 * just the vault — and there is no finer option for an OAuth App: fine-grained
 * permissions exist for GitHub Apps, whose user-token exchange needs the same
 * secret plus an installation step. Widening from a `flomo-data`-only PAT to
 * `repo` is the real price of "sign in with GitHub", and
 * {@link https://github.com/settings/applications/new the OAuth App} is the
 * only place it is paid.
 */
const SCOPE = 'repo'

/** `sessionStorage` keys for the values that must outlive the redirect. */
const STATE_KEY = 'flomo-sim:oauth:state'
const VERIFIER_KEY = 'flomo-sim:oauth:verifier'

/** What a successful sign-in produced. */
export interface OAuthSession {
  /** The access token, to be used exactly as a PAT was. */
  token: string
  /** The GitHub login the token belongs to; the relay resolved it. */
  login: string
  /** Present when GitHub issued short-lived tokens. */
  refreshToken?: string
  /** Epoch milliseconds when {@link token} lapses; absent means it does not. */
  expiresAt?: number
}

/** The outcome of looking at the current URL for a callback. */
export type CallbackResult =
  /** This is not a callback; carry on. */
  | { kind: 'none' }
  /** Signed in. */
  | { kind: 'ok'; session: OAuthSession }
  /** The callback failed, with something worth showing the user. */
  | { kind: 'error'; message: string }

/**
 * Whether a GitHub login can be attempted at all.
 *
 * Both halves are needed: without a client id GitHub has nothing to authorize,
 * and without a relay there is nowhere to exchange the code.
 * @returns true when the login button should be offered.
 */
export function oauthConfigured(): boolean {
  return GITHUB_CLIENT_ID.trim() !== '' && RELAY_URL.trim() !== ''
}

/**
 * The page's origin, or `''` where there is no document.
 *
 * Guarded twice: server rendering has no `window`, and a test harness may
 * install one with storage but no `location`.
 * @returns `location.origin`, or an empty string.
 */
function currentOrigin(): string {
  try {
    return typeof window === 'undefined' ? '' : (window.location?.origin ?? '')
  } catch {
    return ''
  }
}

/**
 * The URL GitHub sends the browser back to.
 *
 * Derived rather than configured, so the same build works at a domain root and
 * under a Pages project path. It must match what the OAuth App registers as its
 * callback URL.
 * @returns origin plus path, with no query or fragment.
 */
export function redirectUri(): string {
  const location = window.location
  return `${location.origin}${location.pathname}`
}

/**
 * Encode bytes the way PKCE wants them: base64url, unpadded.
 * @param bytes - the bytes to encode.
 * @returns the base64url string.
 */
function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A fresh unguessable string, for a `state` or a verifier.
 * @returns 32 random bytes as base64url.
 */
function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

/**
 * The S256 challenge for a verifier.
 * @param verifier - the PKCE verifier.
 * @returns base64url(SHA-256(verifier)).
 */
async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

/**
 * Read and consume a `sessionStorage` entry.
 *
 * Consumed rather than merely read: a `state` that lingers is a `state` that can
 * be replayed by a second callback.
 * @param key - the entry to take.
 * @returns the value, or null.
 */
function take(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key)
    window.sessionStorage.removeItem(key)
    return value
  } catch {
    return null
  }
}

/**
 * Write a `sessionStorage` entry, tolerating a storage that refuses.
 * @param key - the entry to set.
 * @param value - the value.
 */
function put(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Private-browsing quotas simply mean the round trip will not verify, which
    // is reported as a mismatch rather than as a crash.
  }
}

/**
 * Send one JSON request to the relay.
 * @param path - relay path, e.g. `/exchange`.
 * @param body - the payload.
 * @returns the parsed response, or a failure with something to display.
 */
async function postToRelay(
  path: string,
  body: Record<string, string>,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(`${RELAY_URL.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: '无法连接登录中转，请检查网络后重试。' }
  }

  let payload: Record<string, unknown>
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    return { ok: false, message: `登录中转返回了异常响应（HTTP ${response.status}）。` }
  }

  if (!response.ok) return { ok: false, message: describeRelayError(payload) }
  return { ok: true, value: payload }
}

/**
 * Turn a relay error payload into something a person can act on.
 *
 * The relay echoes the account it saw precisely so this can name it: "wrong
 * account" without saying which one is not something a user can act on.
 * @param payload - the decoded error body.
 * @param allowedOrigin - the site's own origin, for the origin-mismatch case.
 * @returns the message.
 */
export function describeRelayError(
  payload: Record<string, unknown>,
  allowedOrigin = currentOrigin(),
): string {
  const code = typeof payload['error'] === 'string' ? payload['error'] : ''
  switch (code) {
    case 'account-not-allowed':
      return `这个 GitHub 账号是 ${String(payload['login'])}，而本站只允许 ${String(
        payload['allowed'],
      )} 使用。请换用正确的账号登录。`
    case 'account-unknown':
      return '无法确认这个令牌属于哪个账号，请稍后重试。'
    case 'origin-not-allowed':
      return `登录中转没有放行本站来源（${allowedOrigin}）。请检查中转的 ALLOWED_ORIGIN 配置。`
    case 'exchange-failed':
      return `GitHub 拒绝了这次登录：${String(payload['detail'])}`
    case 'upstream-unreachable':
      return '登录中转连不上 GitHub，请稍后重试。'
    case 'invalid-body':
    case 'missing-code':
    case 'missing-refresh-token':
      return '登录请求不完整，请从「用 GitHub 登录」重新开始。'
    default:
      return '登录失败，请稍后重试。'
  }
}

/**
 * Send the browser to GitHub's authorization screen.
 *
 * Both anti-tampering values are generated here and kept in `sessionStorage`
 * until the callback: `state` is compared on return, and the PKCE verifier is
 * handed to the relay so a code intercepted in transit is useless without it.
 * @returns a promise that resolves once the navigation has been requested.
 */
export async function beginLogin(): Promise<void> {
  const state = randomToken()
  const verifier = randomToken()
  put(STATE_KEY, state)
  put(VERIFIER_KEY, verifier)

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`)
}

/**
 * Turn a token payload from the relay into an {@link OAuthSession}.
 * @param value - the decoded relay response.
 * @returns the session, or null when the payload is missing its token.
 */
function sessionFrom(value: Record<string, unknown>): OAuthSession | null {
  const token = value['token']
  const login = value['login']
  if (typeof token !== 'string' || token === '' || typeof login !== 'string') return null

  const refreshToken = value['refreshToken']
  const expiresIn = value['expiresIn']
  return {
    token,
    login,
    ...(typeof refreshToken === 'string' && refreshToken !== '' ? { refreshToken } : {}),
    ...(typeof expiresIn === 'number' && expiresIn > 0
      ? { expiresAt: Date.now() + expiresIn * 1000 }
      : {}),
  }
}

/**
 * Look for an OAuth callback in a query string and finish it.
 *
 * Called on every load, and cheap when there is nothing to do: no `code` and no
 * `error` means the URL is an ordinary one.
 * @param search - the raw `location.search`, leading `?` included.
 * @returns what happened, if anything.
 */
export async function takeCallback(search: string): Promise<CallbackResult> {
  if (!search.startsWith('?')) return { kind: 'none' }
  const params = new URLSearchParams(search.slice(1))

  const denied = params.get('error')
  if (denied !== null) {
    return {
      kind: 'error',
      message:
        denied === 'access_denied'
          ? '你取消了 GitHub 授权。'
          : `GitHub 返回了错误：${params.get('error_description') ?? denied}`,
    }
  }

  const code = params.get('code')
  if (code === null || code === '') return { kind: 'none' }

  // Checked before the code is spent: a callback that cannot prove it started
  // here is not ours, and forwarding its code would be doing a stranger's
  // exchange for them.
  const expected = take(STATE_KEY)
  if (expected === null || params.get('state') !== expected) {
    return { kind: 'error', message: '这次登录的校验值对不上，已忽略。请重新点一次「用 GitHub 登录」。' }
  }

  const verifier = take(VERIFIER_KEY)
  const answer = await postToRelay('/exchange', {
    code,
    redirectUri: redirectUri(),
    ...(verifier === null ? {} : { codeVerifier: verifier }),
  })
  if (!answer.ok) return { kind: 'error', message: answer.message }

  const session = sessionFrom(answer.value)
  if (session === null) return { kind: 'error', message: '登录中转没有返回令牌，请稍后重试。' }

  return { kind: 'ok', session }
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * GitHub turned on eight-hour tokens for OAuth Apps, so a session that never
 * refreshes logs the user out three times a day. Turning that setting off in
 * the app is the simpler answer and the one the documentation recommends; this
 * exists so the default setting is survivable rather than broken.
 * @param refreshToken - the token GitHub issued alongside the access token.
 * @returns the new session, or null when the refresh did not work.
 */
export async function refreshSession(refreshToken: string): Promise<OAuthSession | null> {
  const answer = await postToRelay('/refresh', { refreshToken })
  if (!answer.ok) return null
  return sessionFrom(answer.value)
}

/**
 * Remove the OAuth parameters from the address bar.
 *
 * A `code` left in the URL is a `code` in the next screenshot, bookmark and
 * shared link — and it is already spent, so keeping it can only mislead.
 * Only the OAuth parameters are dropped, so a share-target query survives.
 */
export function clearCallbackFromUrl(): void {
  const url = new URL(window.location.href)
  for (const key of ['code', 'state', 'error', 'error_description', 'error_uri', 'scope']) {
    url.searchParams.delete(key)
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
