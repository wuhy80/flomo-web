/**
 * Tests for the browser half of the GitHub login.
 *
 * The properties worth pinning are the ones that fail *quietly*: a `state` that
 * is not compared still produces a working login, and a token obtained from
 * `?code=` still arrives — right up until someone else's `code` is replayed into
 * the page. So the assertions here are mostly about refusals, and about which
 * value ends up as the repository owner.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { configFromLogin } from '../src/config.ts'
import { describeRelayError, oauthConfigured, takeCallback } from '../src/oauth.ts'
import type { OAuthSession } from '../src/oauth.ts'

const originalFetch = globalThis.fetch
const ORIGIN = 'https://wuhy80.github.io'
const PAGE = `${ORIGIN}/flomo-web/`

/** Storage backing the fake `sessionStorage`, so a test can seed or inspect it. */
const backing = new Map<string, string>()

/** Every fetch the code under test performed. */
interface RecordedCall {
  url: string
  body: Record<string, unknown>
}

let calls: RecordedCall[] = []

/**
 * Install a fake browser: a location, a `sessionStorage` over {@link backing},
 * and a `fetch` that answers as the relay would.
 * @param relayAnswer - what the relay returns, and with which status.
 * @param search - the page's query string.
 */
function useBrowser(
  relayAnswer: { status: number; body: unknown } = { status: 200, body: {} },
  search = '?code=the-code&state=the-state',
): void {
  calls = []
  backing.clear()
  ;(globalThis as { window?: unknown }).window = {
    location: {
      origin: ORIGIN,
      pathname: '/flomo-web/',
      search,
      href: `${PAGE}${search}`,
      assign: () => {
        // Navigating away is asserted through `calls`; nothing to do here.
      },
    },
    sessionStorage: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    },
    history: { replaceState: () => undefined },
  }
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    return new Response(JSON.stringify(relayAnswer.body), { status: relayAnswer.status })
  }) as unknown as typeof fetch
}

/** Put the OAuth round-trip values in place, as {@link beginLogin} would. */
function seedRoundTrip(state = 'the-state', verifier = 'the-verifier'): void {
  backing.set('flomo-sim:oauth:state', state)
  backing.set('flomo-sim:oauth:verifier', verifier)
}

afterEach(() => {
  globalThis.fetch = originalFetch
  delete (globalThis as { window?: unknown }).window
  backing.clear()
  calls = []
})

describe('callback handling', () => {
  it('exchanges a code for a token and reports the account', async () => {
    useBrowser({ status: 200, body: { token: 'gho_x', login: 'wuhy80' } })
    seedRoundTrip()

    const result = await takeCallback('?code=the-code&state=the-state')

    assert.equal(result.kind, 'ok')
    assert.equal(result.kind === 'ok' ? result.session.token : '', 'gho_x')
    assert.equal(result.kind === 'ok' ? result.session.login : '', 'wuhy80')
    assert.equal(calls.length, 1, 'exactly one relay call')
    assert.equal(calls[0]?.body['code'], 'the-code')
  })

  it('sends the PKCE verifier, so an intercepted code is useless without it', async () => {
    useBrowser({ status: 200, body: { token: 'gho_x', login: 'wuhy80' } })
    seedRoundTrip('the-state', 'the-verifier')

    await takeCallback('?code=the-code&state=the-state')

    assert.equal(calls[0]?.body['codeVerifier'], 'the-verifier')
    assert.equal(calls[0]?.body['redirectUri'], PAGE)
  })

  it('refuses a callback whose state does not match, without spending the code', async () => {
    useBrowser({ status: 200, body: { token: 'gho_x', login: 'wuhy80' } })
    seedRoundTrip('the-real-state')

    const result = await takeCallback('?code=the-code&state=forged')

    assert.equal(result.kind, 'error')
    // The point of `state`: a callback that did not start here is not ours, and
    // forwarding its code would be doing a stranger's exchange for them.
    assert.equal(calls.length, 0, 'the code must not reach the relay')
  })

  it('refuses a callback when nothing was ever started', async () => {
    useBrowser()
    // No seeded state: a bare ?code= arriving out of nowhere.
    const result = await takeCallback('?code=the-code&state=anything')

    assert.equal(result.kind, 'error')
    assert.equal(calls.length, 0)
  })

  it('consumes the state, so the same callback cannot be replayed', async () => {
    useBrowser({ status: 200, body: { token: 'gho_x', login: 'wuhy80' } })
    seedRoundTrip()

    await takeCallback('?code=the-code&state=the-state')
    const second = await takeCallback('?code=the-code&state=the-state')

    assert.equal(second.kind, 'error', 'a spent state must not verify twice')
  })

  it('ignores an ordinary URL', async () => {
    useBrowser({ status: 200, body: {} }, '')
    const result = await takeCallback('')

    assert.equal(result.kind, 'none')
    assert.equal(calls.length, 0)
  })

  it('reports a cancellation as such, not as a failure', async () => {
    useBrowser()
    const result = await takeCallback('?error=access_denied&state=the-state')

    assert.equal(result.kind, 'error')
    assert.match(result.kind === 'error' ? result.message : '', /取消/)
  })

  it('names the account when the relay refuses it', async () => {
    useBrowser({ status: 403, body: { error: 'account-not-allowed', login: 'someone-else', allowed: 'wuhy80' } })
    seedRoundTrip()

    const result = await takeCallback('?code=the-code&state=the-state')

    assert.equal(result.kind, 'error')
    const message = result.kind === 'error' ? result.message : ''
    // "Wrong account" without saying which one cannot be acted on.
    assert.match(message, /someone-else/)
    assert.match(message, /wuhy80/)
  })

  it('reports an unreachable relay rather than throwing', async () => {
    useBrowser()
    seedRoundTrip()
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const result = await takeCallback('?code=the-code&state=the-state')

    assert.equal(result.kind, 'error')
    assert.match(result.kind === 'error' ? result.message : '', /中转/)
  })

  it('reports a relay that answers 200 with no token', async () => {
    useBrowser({ status: 200, body: { login: 'wuhy80' } })
    seedRoundTrip()

    const result = await takeCallback('?code=the-code&state=the-state')

    assert.equal(result.kind, 'error', 'a body without a token is not a login')
  })
})

describe('error messages', () => {
  it('turns each relay error into something a person can act on', () => {
    assert.match(describeRelayError({ error: 'origin-not-allowed' }, ORIGIN), /ALLOWED_ORIGIN/)
    assert.match(describeRelayError({ error: 'account-unknown' }), /确认/)
    assert.match(describeRelayError({ error: 'upstream-unreachable' }), /GitHub/)
    assert.match(describeRelayError({ error: 'missing-code' }), /重新开始/)
    assert.match(describeRelayError({ error: 'something-new' }), /登录失败/)
  })

  it('passes GitHub\'s own explanation through when there is one', () => {
    const message = describeRelayError({ error: 'exchange-failed', detail: 'code expired' })
    assert.match(message, /code expired/)
  })
})

describe('configuration from a login', () => {
  const session: OAuthSession = { token: 'gho_x', login: 'wuhy80' }

  it('takes the owner from the account GitHub resolved', () => {
    const config = configFromLogin(session)

    // This is what makes the account lock meaningful: nothing typed in the page
    // becomes the owner, only what the relay verified.
    assert.equal(config.owner, 'wuhy80')
    assert.equal(config.repo, 'flomo-data')
    assert.equal(config.auth, 'oauth')
    assert.equal(config.token, 'gho_x')
  })

  it('keeps the repository, branch and remember choice on a re-login', () => {
    const config = configFromLogin(session, {
      repo: 'my-vault',
      branch: 'notes',
      remember: false,
    })

    assert.equal(config.repo, 'my-vault', 'a re-login must not move the vault')
    assert.equal(config.branch, 'notes')
    assert.equal(config.remember, false)
  })

  it('carries a refresh token and its expiry through', () => {
    const config = configFromLogin({ ...session, refreshToken: 'ghr_x', expiresAt: 123 })

    assert.equal(config.refreshToken, 'ghr_x')
    assert.equal(config.expiresAt, 123)
  })

  it('omits the refresh fields when GitHub did not issue them', () => {
    const config = configFromLogin(session)

    assert.ok(!('refreshToken' in config))
    assert.ok(!('expiresAt' in config))
  })
})

describe('availability', () => {
  it('is off until a client id and a relay are configured', () => {
    // The shipped defaults are empty, so a fork gets the PAT form and no dead
    // button. Filling these in is what turns the login on.
    assert.equal(
      oauthConfigured(),
      false,
      'unconfigured builds must not offer a login that cannot work',
    )
  })
})
