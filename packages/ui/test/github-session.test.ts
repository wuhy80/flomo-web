/**
 * Tests for the browser session's caching wiring.
 *
 * The cache decorator itself is covered in core; what is checked here is that
 * the session actually puts it in the request path and reports the resulting
 * mode, which is the part a wiring mistake would silently break.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { MemoryCacheArea } from '@flomo/core'

import { GitHubVaultSession } from '../src/github-session.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/**
 * Replace the global fetch for the duration of one test.
 * @param handler - maps a URL to a response.
 */
function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: unknown) =>
    handler(String(input))) as unknown as typeof fetch
}

/**
 * Build a JSON response.
 * @param body - the payload.
 * @returns the response.
 */
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A minimal but structurally valid `vault.json`, base64-encoded as GitHub sends it. */
function vaultFile(): Response {
  const header = {
    v: 1,
    kdf: { algo: 'PBKDF2-SHA256', iterations: 1_000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
    check: { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA==' },
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  return json({ content: btoa(JSON.stringify(header)), sha: 'sha-vault' })
}

describe('cached session', () => {
  it('keeps working from the cache once the network is gone', async () => {
    const area = new MemoryCacheArea()
    let online = true
    stubFetch((url) => {
      if (!online) throw new TypeError('fetch failed')
      if (url.includes('/contents/vault.json')) return vaultFile()
      return json([])
    })

    const session = new GitHubVaultSession({
      owner: 'me',
      repo: 'flomo-data',
      token: 'ghp_x',
      cache: area,
    })

    await session.refresh()
    assert.equal(session.getSnapshot().status, 'locked', 'a vault exists upstream')
    assert.equal(session.getSnapshot().offline, false)
    assert.ok(area.size > 0, 'the read populated the cache')

    online = false
    await session.refresh()
    assert.equal(session.getSnapshot().status, 'locked', 'the cached header still answers')
    assert.equal(session.getSnapshot().offline, true, 'and the session says it is offline')
  })

  it('reports an error, not a stale success, when nothing was ever cached', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })

    const session = new GitHubVaultSession({
      owner: 'me',
      repo: 'flomo-data',
      token: 'ghp_x',
      cache: new MemoryCacheArea(),
    })

    await session.refresh()
    assert.equal(session.getSnapshot().status, 'error')
    assert.equal(session.getSnapshot().offline, false)
  })

  it('drops the cache when the device is disconnected', async () => {
    const area = new MemoryCacheArea()
    let online = true
    stubFetch((url) => {
      if (!online) throw new TypeError('fetch failed')
      if (url.includes('/contents/vault.json')) return vaultFile()
      return json([])
    })

    const session = new GitHubVaultSession({
      owner: 'me',
      repo: 'flomo-data',
      token: 'ghp_x',
      cache: area,
    })

    await session.refresh()
    assert.ok(area.size > 0)

    session.clearCache()
    assert.equal(area.size, 0, 'nothing of this repository is left behind')

    online = false
    await session.refresh()
    assert.equal(session.getSnapshot().status, 'error', 'with no cache, offline is a real failure')
  })

  it('runs online-only when no cache is supplied', async () => {
    let offline = false
    stubFetch((url) => {
      if (offline) throw new TypeError('fetch failed')
      if (url.includes('/contents/vault.json')) return vaultFile()
      return json([])
    })

    const session = new GitHubVaultSession({
      owner: 'me',
      repo: 'flomo-data',
      token: 'ghp_x',
    })

    await session.refresh()
    assert.equal(session.getSnapshot().status, 'locked')

    offline = true
    await session.refresh()
    assert.equal(session.getSnapshot().status, 'error')
    assert.equal(session.getSnapshot().offline, false, 'there is no offline mode to report')
  })
})
