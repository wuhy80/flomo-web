/**
 * The OAuth relay: the one piece of server this project has.
 *
 * It exists for exactly one reason. GitHub's authorization-code exchange is not
 * CORS-enabled — github/docs#22270 states it plainly ("CORS pre-flights are not
 * supported on this endpoint"), and neither installing PKCE nor waiting for
 * GitHub to add it changes that. A purely static page therefore cannot turn a
 * `code` into a token, so something with a `client_secret` has to. That is this
 * Worker, and nothing else is.
 *
 * What it deliberately does *not* do matters as much as what it does:
 *
 * - **It never sees the password or the derived key.** Notes stay end-to-end
 *   encrypted; a token obtained here buys ciphertext and nothing more, which is
 *   the same guarantee a leaked PAT gives.
 * - **It does not proxy the Contents API.** The browser keeps talking to
 *   `api.github.com` directly, exactly as it does with a PAT, so no part of the
 *   storage layer changes because this exists.
 * - **It stores nothing.** Every request carries its own `code` or
 *   `refresh_token`. There is no session table, no database, no cookie — which
 *   is also why `wrangler.toml` has no bindings.
 *
 * The one check worth calling out is {@link assertAllowedAccount}: a token is
 * only ever handed back after GitHub has said which login it belongs to. "Only
 * wuhy80" is enforced *here*, before the token reaches the browser, rather than
 * in the page — a check in the page would be a suggestion, since anyone can
 * edit the page.
 *
 * @module flomo-oauth-relay/handler
 */

/** Everything the relay needs from its environment. */
export interface RelayEnv {
  /** OAuth App client id. Public: the same value ships in the web bundle. */
  GITHUB_CLIENT_ID: string
  /** OAuth App client secret. Set with `wrangler secret put`; never committed. */
  GITHUB_CLIENT_SECRET: string
  /**
   * The one origin allowed to call this relay, e.g. `https://wuhy80.github.io`.
   *
   * An exact string rather than a pattern on purpose. This header is the whole
   * cross-origin fence, and a prefix or substring match would accept
   * `https://wuhy80.github.io.evil.example` while looking just as strict.
   */
  ALLOWED_ORIGIN: string
  /** The only GitHub login accepted. Defaults to `wuhy80`. */
  ALLOWED_LOGIN?: string
  /** Injection point for tests. */
  fetchImpl?: typeof fetch
}

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const API_VERSION = '2022-11-28'

/** The account this deployment is for. Overridable per environment. */
export const DEFAULT_ALLOWED_LOGIN = 'wuhy80'

/**
 * How long to wait on GitHub before giving up.
 *
 * A Worker that hangs holds the caller's request open; a login that never
 * settles is worse for the user than one that fails and says so.
 */
const UPSTREAM_TIMEOUT_MS = 15_000

/** Largest request body accepted. These payloads are three short strings. */
const BODY_LIMIT = 8 * 1024

/**
 * Write a JSON response with CORS headers for the configured origin.
 * @param body - the payload.
 * @param status - HTTP status.
 * @param env - supplies the allowed origin.
 * @returns the response.
 */
function json(body: unknown, status: number, env: RelayEnv): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(env),
    },
  })
}

/**
 * The CORS headers this relay answers with.
 *
 * `Vary: Origin` is not optional: without it a cache may serve one origin's
 * allowance to another.
 * @param env - supplies the allowed origin.
 * @returns the headers.
 */
function corsHeaders(env: RelayEnv): Record<string, string> {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

/**
 * Whether a request comes from the one origin this relay serves.
 *
 * Browsers always attach `Origin` to a cross-origin `POST`, so requiring it
 * costs a legitimate caller nothing. A caller that omits it is not a browser
 * and has no `code` worth exchanging.
 * @param request - the incoming request.
 * @param env - supplies the allowed origin.
 * @returns true when the origin matches exactly.
 */
function originAllowed(request: Request, env: RelayEnv): boolean {
  return request.headers.get('origin') === env.ALLOWED_ORIGIN
}

/**
 * Read and validate a JSON body.
 * @param request - the incoming request.
 * @returns the parsed object, or `undefined` when it is missing or malformed.
 */
async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > BODY_LIMIT) return undefined
  try {
    const text = await request.text()
    if (text.length > BODY_LIMIT) return undefined
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Pull a non-empty string field out of a parsed body.
 * @param body - the parsed body.
 * @param key - the field name.
 * @returns the value, or `undefined` when absent or the wrong type.
 */
function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** What GitHub's token endpoint answered. */
interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * POST to GitHub's token endpoint.
 *
 * `Accept: application/json` is what stops GitHub answering as form-encoded,
 * which is its default and a genuinely easy way to build something that only
 * works by accident.
 * @param params - the form fields to send.
 * @param env - supplies credentials and the fetch implementation.
 * @returns the parsed token response.
 * @throws when GitHub is unreachable or answers with something unusable.
 */
async function postToGitHub(
  params: Record<string, string>,
  env: RelayEnv,
): Promise<TokenResponse> {
  const doFetch = env.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const response = await doFetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'flomo-oauth-relay',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      ...params,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })

  const body = (await response.json()) as TokenResponse
  if (!response.ok && body.error === undefined) {
    throw new Error(`GitHub 返回 HTTP ${response.status}`)
  }
  return body
}

/**
 * Ask GitHub which account a token belongs to.
 * @param token - the access token.
 * @param env - supplies the fetch implementation.
 * @returns the login, or `undefined` when GitHub would not say.
 */
async function fetchLogin(token: string, env: RelayEnv): Promise<string | undefined> {
  const doFetch = env.fetchImpl ?? globalThis.fetch.bind(globalThis)
  try {
    const response = await doFetch(GITHUB_USER_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': API_VERSION,
        'user-agent': 'flomo-oauth-relay',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as { login?: unknown }
    return typeof body.login === 'string' ? body.login : undefined
  } catch {
    return undefined
  }
}

/**
 * The account gate, and the reason this relay is worth having at all.
 *
 * Returning the token and *then* letting the page decide would be theatre:
 * whatever the page checks, the token is already in the browser and anyone can
 * read it out of the network tab. So the check happens before the token is
 * written into a response, and a token that fails it is simply dropped.
 * @param token - the freshly minted access token.
 * @param env - supplies the allowed login.
 * @returns the login when it is the allowed one, else a refusal response.
 */
async function assertAllowedAccount(
  token: string,
  env: RelayEnv,
): Promise<{ login: string } | { refusal: Response }> {
  const allowed = env.ALLOWED_LOGIN ?? DEFAULT_ALLOWED_LOGIN
  const login = await fetchLogin(token, env)
  if (login === undefined) {
    return { refusal: json({ error: 'account-unknown' }, 502, env) }
  }
  if (login.toLowerCase() !== allowed.toLowerCase()) {
    // The login is echoed so the user can see *which* account they picked —
    // "wrong account" without saying which one is unactionable.
    return { refusal: json({ error: 'account-not-allowed', login, allowed }, 403, env) }
  }
  return { login }
}

/**
 * Turn a GitHub token response into our own, or an error response.
 * @param body - GitHub's answer.
 * @param env - supplies the allowed origin.
 * @returns a success or error response.
 */
async function finishExchange(
  body: TokenResponse,
  env: RelayEnv,
): Promise<Response> {
  if (body.error !== undefined || typeof body.access_token !== 'string') {
    return json(
      {
        error: 'exchange-failed',
        detail: body.error_description ?? body.error ?? '响应里没有 access_token',
      },
      400,
      env,
    )
  }

  const gate = await assertAllowedAccount(body.access_token, env)
  if ('refusal' in gate) return gate.refusal

  return json(
    {
      token: body.access_token,
      login: gate.login,
      ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
      ...(typeof body.expires_in === 'number' ? { expiresIn: body.expires_in } : {}),
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
    },
    200,
    env,
  )
}

/**
 * Exchange an authorization code for an access token.
 * @param request - the incoming request.
 * @param env - supplies credentials.
 * @returns the token, or a refusal.
 */
export async function handleExchange(request: Request, env: RelayEnv): Promise<Response> {
  const body = await readBody(request)
  if (body === undefined) return json({ error: 'invalid-body' }, 400, env)

  const code = stringField(body, 'code')
  if (code === undefined) return json({ error: 'missing-code' }, 400, env)

  const params: Record<string, string> = { code }
  // Sent when the client used PKCE. GitHub only demands it when the authorize
  // request carried a challenge, so passing it through unconditionally is safe.
  const verifier = stringField(body, 'codeVerifier')
  if (verifier !== undefined) params.code_verifier = verifier
  const redirectUri = stringField(body, 'redirectUri')
  if (redirectUri !== undefined) params.redirect_uri = redirectUri

  try {
    return await finishExchange(await postToGitHub(params, env), env)
  } catch (error) {
    return json(
      { error: 'upstream-unreachable', detail: error instanceof Error ? error.message : 'unknown' },
      502,
      env,
    )
  }
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * Needed because GitHub enabled short-lived tokens (eight hours) by default for
 * OAuth Apps in 2026, and an app that never refreshes would log the user out
 * three times a day. Disabling expiring tokens in the app settings is the
 * simpler fix and the one the documentation recommends; this path is what makes
 * the default setting survivable rather than broken.
 * @param request - the incoming request.
 * @param env - supplies credentials.
 * @returns the new token, or a refusal.
 */
export async function handleRefresh(request: Request, env: RelayEnv): Promise<Response> {
  const body = await readBody(request)
  if (body === undefined) return json({ error: 'invalid-body' }, 400, env)

  const refreshToken = stringField(body, 'refreshToken')
  if (refreshToken === undefined) return json({ error: 'missing-refresh-token' }, 400, env)

  try {
    const answer = await postToGitHub(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      env,
    )
    return await finishExchange(answer, env)
  } catch (error) {
    return json(
      { error: 'upstream-unreachable', detail: error instanceof Error ? error.message : 'unknown' },
      502,
      env,
    )
  }
}

/**
 * Route one request.
 *
 * Two endpoints, no state, and a CORS preflight — that is the whole surface.
 * @param request - the incoming request.
 * @param env - the environment.
 * @returns the response.
 */
export async function handleRequest(request: Request, env: RelayEnv): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    // Answer the preflight only for the origin we serve; anything else gets a
    // bare 204 with no allow headers, which the browser turns into a failure.
    const headers = originAllowed(request, env) ? corsHeaders(env) : { vary: 'Origin' }
    return new Response(null, { status: 204, headers })
  }

  // Deliberately readable without credentials: it is how you confirm a deploy
  // landed and which account it is configured for, without needing a code.
  if (request.method === 'GET' && url.pathname === '/') {
    return json(
      {
        service: 'flomo-oauth-relay',
        allowedLogin: env.ALLOWED_LOGIN ?? DEFAULT_ALLOWED_LOGIN,
        allowedOrigin: env.ALLOWED_ORIGIN,
      },
      200,
      env,
    )
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, env)
  if (!originAllowed(request, env)) return json({ error: 'origin-not-allowed' }, 403, env)

  if (url.pathname === '/exchange') return handleExchange(request, env)
  if (url.pathname === '/refresh') return handleRefresh(request, env)
  return json({ error: 'not-found' }, 404, env)
}
