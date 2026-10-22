/**
 * Tests for the OAuth relay.
 *
 * The relay is the only place in this project that holds a `client_secret`, and
 * the only place where "only wuhy80" is enforced rather than merely displayed.
 * Both of those are properties that fail *silently* if they regress: a relay
 * that hands out tokens to the wrong account still answers 200, and a browser
 * can read a token out of a response the page then refuses to use. So the
 * assertions here are mostly about what does *not* come back.
 *
 * GitHub itself is stubbed at the `fetch` boundary — the relay builds its own
 * requests, so stubbing any lower would skip the very thing under test.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { handleRequest, DEFAULT_ALLOWED_LOGIN } from '../src/handler.ts'
import type { RelayEnv } from '../src/handler.ts'

/** The origin the fixture relay serves. */
const ORIGIN = 'https://wuhy80.github.io'

/** One upstream call, recorded so a test can assert on the wire format. */
interface UpstreamCall {
  url: string
  method: string
  body: string
  headers: Record<string, string>
}

/**
 * A stand-in for GitHub's token and user endpoints.
 *
 * Answers by URL rather than by call order, because "the second call is the
 * user lookup" is exactly the assumption that breaks when the flow changes.
 */
class FakeGitHub {
  /** What the token endpoint answers with. */
  tokenAnswer: unknown = {
    access_token: 'gho_the_token',
    token_type: 'bearer',
    scope: 'repo',
  }
  /** Status for the token endpoint. */
  tokenStatus = 200
  /** The login the user endpoint reports. */
  login = 'wuhy80'
  /** Status for the user endpoint. */
  userStatus = 200
  /** Every upstream request, in order. */
  readonly calls: UpstreamCall[] = []

  /** A `fetch` bound to this fake. */
  readonly fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    this.calls.push({
      url,
      method: init?.method ?? 'GET',
      body: String(init?.body ?? ''),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    if (url.includes('/login/oauth/access_token')) {
      return new Response(JSON.stringify(this.tokenAnswer), { status: this.tokenStatus })
    }
    if (url.endsWith('/user')) {
      return new Response(JSON.stringify({ login: this.login }), { status: this.userStatus })
    }
    return new Response('not found', { status: 404 })
  }
}

/**
 * Build an environment around a fake GitHub.
 * @param github - the upstream fake.
 * @param overrides - environment fields to replace.
 * @returns the environment.
 */
function envWith(github: FakeGitHub, overrides: Partial<RelayEnv> = {}): RelayEnv {
  return {
    GITHUB_CLIENT_ID: 'cid',
    GITHUB_CLIENT_SECRET: 'the-secret',
    ALLOWED_ORIGIN: ORIGIN,
    fetchImpl: github.fetch as unknown as typeof fetch,
    ...overrides,
  }
}

/**
 * Build a request against the relay.
 * @param path - the relay path, e.g. `/exchange`.
 * @param body - the JSON payload; omitted for a GET.
 * @param origin - the `Origin` header; `null` omits it entirely.
 * @returns the request.
 */
function relayRequest(
  path: string,
  body?: unknown,
  origin: string | null = ORIGIN,
): Request {
  const headers: Record<string, string> = {}
  if (origin !== null) headers['origin'] = origin
  if (body === undefined) return new Request(`https://relay.example${path}`, { headers })
  headers['content-type'] = 'application/json'
  return new Request(`https://relay.example${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('relay CORS fence', () => {
  it('answers a preflight from the configured origin with the allow headers', async () => {
    const env = envWith(new FakeGitHub())
    const response = await handleRequest(
      new Request('https://relay.example/exchange', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
      env,
    )

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN)
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /POST/)
    // Without `Vary`, a shared cache may hand one origin's allowance to another.
    assert.equal(response.headers.get('vary'), 'Origin')
  })

  it('does not extend the allowance to a neighbouring origin', async () => {
    const env = envWith(new FakeGitHub())
    const response = await handleRequest(
      new Request('https://relay.example/exchange', {
        method: 'OPTIONS',
        headers: { origin: `${ORIGIN}.evil.example` },
      }),
      env,
    )

    assert.equal(response.status, 204)
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      null,
      'a prefix match here would be the whole fence, and a prefix is not a fence',
    )
  })

  it('refuses a POST that carries no Origin at all, before touching GitHub', async () => {
    const github = new FakeGitHub()
    const response = await handleRequest(
      relayRequest('/exchange', { code: 'abc' }, null),
      envWith(github),
    )

    assert.equal(response.status, 403)
    assert.equal(github.calls.length, 0, 'a refused caller must not reach the token endpoint')
  })

  it('refuses a POST from another origin', async () => {
    const github = new FakeGitHub()
    const response = await handleRequest(
      relayRequest('/exchange', { code: 'abc' }, 'https://not-wuhy80.github.io'),
      envWith(github),
    )

    assert.equal(response.status, 403)
    assert.equal(github.calls.length, 0)
  })
})

describe('code exchange', () => {
  it('returns the token and the login for the allowed account', async () => {
    const github = new FakeGitHub()
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    assert.equal(response.status, 200)
    const body = (await response.json()) as { token?: string; login?: string }
    assert.equal(body.token, 'gho_the_token')
    assert.equal(body.login, 'wuhy80')
  })

  it('posts the code, the client id and the secret to GitHub as JSON', async () => {
    const github = new FakeGitHub()
    await handleRequest(
      relayRequest('/exchange', { code: 'abc', codeVerifier: 'verifier', redirectUri: 'https://x/' }),
      envWith(github),
    )

    const call = github.calls[0]
    assert.ok(call, 'the exchange must have called GitHub')
    assert.equal(call.method, 'POST')
    assert.match(call.url, /github\.com\/login\/oauth\/access_token/)
    const sent = JSON.parse(call.body) as Record<string, string>
    assert.equal(sent['client_id'], 'cid')
    assert.equal(sent['client_secret'], 'the-secret')
    assert.equal(sent['code'], 'abc')
    assert.equal(sent['code_verifier'], 'verifier')
    assert.equal(sent['redirect_uri'], 'https://x/')
  })

  it('never echoes the client secret back to the caller', async () => {
    const github = new FakeGitHub()
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    // A secret in a response body is a secret in a browser's network tab, a
    // proxy log and a screenshot.
    assert.ok(!(await response.text()).includes('the-secret'))
  })

  it('rejects a request with no code', async () => {
    const github = new FakeGitHub()
    const response = await handleRequest(relayRequest('/exchange', {}), envWith(github))

    assert.equal(response.status, 400)
    assert.equal(github.calls.length, 0)
  })

  it('reports a malformed body rather than throwing', async () => {
    const github = new FakeGitHub()
    const request = new Request('https://relay.example/exchange', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: 'not json',
    })
    const response = await handleRequest(request, envWith(github))

    assert.equal(response.status, 400)
    assert.equal(github.calls.length, 0)
  })

  it('surfaces GitHub saying no, with its own explanation', async () => {
    const github = new FakeGitHub()
    github.tokenAnswer = { error: 'bad_verification_code', error_description: 'code expired' }
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    assert.equal(response.status, 400)
    const body = (await response.json()) as { error?: string; detail?: string }
    assert.equal(body.error, 'exchange-failed')
    assert.equal(body.detail, 'code expired')
  })
})

describe('the account gate', () => {
  it('refuses another account, and does not leak the token while doing it', async () => {
    const github = new FakeGitHub()
    github.login = 'someone-else'
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    assert.equal(response.status, 403)
    const text = await response.text()
    const body = JSON.parse(text) as { error?: string; login?: string }
    assert.equal(body.error, 'account-not-allowed')
    // Naming the account is the difference between an actionable refusal and a
    // dead end: the user picked the wrong account and needs to know which.
    assert.equal(body.login, 'someone-else')
    // The whole reason the check lives here: by the time a page could check, the
    // token is already in the browser.
    assert.ok(!text.includes('gho_the_token'), 'a refused token must never be returned')
  })

  it('accepts the allowed login whatever its capitalisation', async () => {
    const github = new FakeGitHub()
    github.login = 'WuHy80'
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    assert.equal(response.status, 200, 'GitHub logins are case-insensitive')
  })

  it('honours an ALLOWED_LOGIN override', async () => {
    const github = new FakeGitHub()
    github.login = 'someone-else'
    const response = await handleRequest(
      relayRequest('/exchange', { code: 'abc' }),
      envWith(github, { ALLOWED_LOGIN: 'someone-else' }),
    )

    assert.equal(response.status, 200)
  })

  it('refuses when GitHub will not say who the token belongs to', async () => {
    const github = new FakeGitHub()
    github.userStatus = 401
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    // An unanswerable check is a failed check. Defaulting to "allow" here would
    // turn a GitHub hiccup into an open door.
    assert.equal(response.status, 502)
    assert.ok(!(await response.text()).includes('gho_the_token'))
  })

  it('checks the account before returning, not after', async () => {
    const github = new FakeGitHub()
    await handleRequest(relayRequest('/exchange', { code: 'abc' }), envWith(github))

    // The user lookup must happen as part of the exchange. A relay that returned
    // first and checked later would hand the token over regardless of the answer.
    const urls = github.calls.map((call) => call.url)
    assert.ok(
      urls.some((url) => url.endsWith('/user')),
      'the exchange must resolve the account',
    )
  })
})

describe('refresh', () => {
  it('trades a refresh token for a new access token', async () => {
    const github = new FakeGitHub()
    github.tokenAnswer = { access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 }
    const response = await handleRequest(
      relayRequest('/refresh', { refreshToken: 'ghr_old' }),
      envWith(github),
    )

    assert.equal(response.status, 200)
    const body = (await response.json()) as { token?: string; refreshToken?: string; expiresIn?: number }
    assert.equal(body.token, 'gho_new')
    assert.equal(body.refreshToken, 'ghr_new')
    assert.equal(body.expiresIn, 28800)

    const sent = JSON.parse(github.calls[0]?.body ?? '{}') as Record<string, string>
    assert.equal(sent['grant_type'], 'refresh_token')
    assert.equal(sent['refresh_token'], 'ghr_old')
  })

  it('applies the same account gate to a refresh', async () => {
    const github = new FakeGitHub()
    github.login = 'someone-else'
    const response = await handleRequest(
      relayRequest('/refresh', { refreshToken: 'ghr_old' }),
      envWith(github),
    )

    // A refresh is a second way in, so it needs the same lock as the first.
    assert.equal(response.status, 403)
  })

  it('asks for a refresh token before spending a request on GitHub', async () => {
    const github = new FakeGitHub()
    const response = await handleRequest(relayRequest('/refresh', {}), envWith(github))

    assert.equal(response.status, 400)
    assert.equal(github.calls.length, 0)
  })
})

describe('routing', () => {
  it('describes itself on GET / without needing an origin', async () => {
    const response = await handleRequest(relayRequest('/', undefined, null), envWith(new FakeGitHub()))

    assert.equal(response.status, 200)
    const body = (await response.json()) as { allowedLogin?: string; allowedOrigin?: string }
    assert.equal(body.allowedLogin, DEFAULT_ALLOWED_LOGIN)
    assert.equal(body.allowedOrigin, ORIGIN)
  })

  it('reports a method it does not implement', async () => {
    // `GET /exchange` cannot mean anything — exchanging needs a body — so it is
    // a method error rather than a 404, which would suggest a wrong path.
    const response = await handleRequest(
      new Request('https://relay.example/exchange', { headers: { origin: ORIGIN } }),
      envWith(new FakeGitHub()),
    )
    assert.equal(response.status, 405)
  })

  it('reports an unknown path', async () => {
    const response = await handleRequest(
      relayRequest('/nope', { code: 'x' }),
      envWith(new FakeGitHub()),
    )
    assert.equal(response.status, 404)
  })

  it('turns an unreachable GitHub into a 502 rather than a rejection', async () => {
    const env = envWith(new FakeGitHub(), {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    })
    const response = await handleRequest(relayRequest('/exchange', { code: 'abc' }), env)

    // 502, not 400: our relay could not complete the exchange, and the caller
    // should retry rather than conclude their code was bad.
    assert.equal(response.status, 502)
  })
})
