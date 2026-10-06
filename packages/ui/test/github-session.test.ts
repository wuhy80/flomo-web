/**
 * Tests for the browser session.
 *
 * Two halves. The cache wiring is checked against a stubbed `fetch` that answers
 * only what the probe needs. The editing half runs against an in-memory Contents
 * API, so the real network client and a real encrypted vault are in the path —
 * which is the point, because that is the route every note takes.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { MemoryCacheArea } from '@flomo/core'

import { GitHubVaultSession } from '../src/github-session.ts'

const originalFetch = globalThis.fetch

/**
 * Every session a test built, so cleanup cannot depend on the test reaching its
 * last line.
 *
 * This is not tidiness. A session with a pending auto-save holds a live timer, and
 * a failing assertion throws past the `dispose()` at the end of the test — so the
 * runner then waits out the whole debounce before it can exit. The first version
 * of these tests reported a 60-second duration for that exact reason, which turns
 * one broken assertion into a stalled CI job.
 */
const liveSessions: GitHubVaultSession[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const session of liveSessions.splice(0)) session.dispose()
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

/**
 * An in-memory stand-in for the GitHub Contents API.
 *
 * Deliberately not a stub of `GitHubContentsStore`: the session builds its own,
 * so replacing the layer below would skip the code under test. This speaks the
 * wire protocol instead, base64 and sha and all.
 */
class FakeGitHub {
  /** Path to the base64 payload, exactly as the API would hold it. */
  readonly files = new Map<string, string>()
  /** Paths written, in order, so a test can count them. */
  readonly writes: string[] = []
  /** When true, every write answers 500. */
  failWrites = false

  private readonly shas = new Map<string, string>()

  /** A `fetch` bound to this server. */
  readonly fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const match = /\/contents\/(.+)$/.exec(url.pathname)
    if (match === null) return new Response('not found', { status: 404 })
    const path = decodeURIComponent(match[1] ?? '')
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'GET') {
      const content = this.files.get(path)
      if (content === undefined) return new Response('not found', { status: 404 })
      return json({ content, sha: this.shas.get(path) ?? 'sha-0', path })
    }

    if (method === 'PUT') {
      if (this.failWrites) return new Response('boom', { status: 500 })
      const body = JSON.parse(String(init?.body)) as { content: string; sha?: string }
      const current = this.shas.get(path)
      // Optimistic concurrency, so a lost update is reported the way GitHub
      // reports it rather than silently overwriting.
      if (body.sha !== undefined && current !== undefined && body.sha !== current) {
        return new Response('conflict', { status: 409 })
      }
      this.writes.push(path)
      this.files.set(path, body.content)
      const sha = `sha-${this.writes.length}`
      this.shas.set(path, sha)
      return json({ content: { sha, path } })
    }

    return new Response('method not allowed', { status: 405 })
  }
}

/**
 * Create a vault through a session, against a fake API.
 * @param autoSaveMs - the debounce window to use.
 * @returns the fake API and the unlocked session.
 */
async function unlockedSession(
  autoSaveMs = 60_000,
): Promise<{ api: FakeGitHub; session: GitHubVaultSession }> {
  const api = new FakeGitHub()
  globalThis.fetch = api.fetch as unknown as typeof fetch

  const session = new GitHubVaultSession({
    owner: 'me',
    repo: 'flomo-data',
    token: 'ghp_x',
    autoSaveMs,
  })
  liveSessions.push(session)
  await session.create('pw')
  assert.equal(session.getSnapshot().status, 'unlocked', 'the fixture must actually unlock')
  return { api, session }
}

/** Wait for a debounce window to elapse. */
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('editing through the session', () => {
  it('adds a memo, updates the view, and does not write immediately', async () => {
    const { api, session } = await unlockedSession()
    const before = api.writes.length

    const memo = session.add('新想法 #测试')
    assert.equal(memo.content, '新想法 #测试')
    assert.deepEqual(memo.tags, ['测试'], 'tags are parsed on the way in')

    const snapshot = session.getSnapshot()
    assert.equal(snapshot.memos.length, 1)
    assert.deepEqual(snapshot.tags, [{ tag: '测试', count: 1 }])
    // Optimistic: the edit is visible at once, the write waits out the debounce.
    assert.equal(api.writes.length, before, 'nothing may be written before the debounce')

    session.dispose()
  })

  it('coalesces a burst of edits into one write', async () => {
    const { api, session } = await unlockedSession(30)
    const before = api.writes.length

    session.add('一')
    session.add('二')
    session.add('三')
    await settle(120)

    assert.equal(session.getSnapshot().memos.length, 3)
    // One shard write, not three: the timer is replaced, not stacked.
    assert.equal(api.writes.length - before, 1, 'a burst must collapse into one write')
    session.dispose()
  })

  it('edits, pins and removes', async () => {
    const { session } = await unlockedSession()
    const memo = session.add('原文')

    session.edit(memo.id, '改过')
    assert.equal(session.getSnapshot().memos[0]?.content, '改过')

    session.pin(memo.id, true)
    assert.equal(session.getSnapshot().memos[0]?.pinned, true)
    session.pin(memo.id, false)
    // Unpinning drops the field rather than storing `false`: `pinned` is optional,
    // and an absent flag is what keeps a serialized memo small. The behaviour to
    // pin is that it reads as not pinned, not that it equals false.
    assert.ok(!session.getSnapshot().memos[0]?.pinned, 'unpinning must stick')

    session.remove(memo.id)
    assert.deepEqual(session.getSnapshot().memos, [])
    session.dispose()
  })

  it('refuses to mutate while locked', () => {
    stubFetch(() => new Response('not found', { status: 404 }))
    const session = new GitHubVaultSession({ owner: 'me', repo: 'r', token: 't' })
    liveSessions.push(session)

    // A silent no-op here would look like a successful capture that vanished.
    assert.throws(() => session.add('x'), /尚未解锁/)
    assert.throws(() => session.edit('id', 'x'), /尚未解锁/)
    assert.throws(() => session.remove('id'), /尚未解锁/)
    assert.throws(() => session.pin('id'), /尚未解锁/)
  })

  it('does nothing when there is nothing to save', async () => {
    const { api, session } = await unlockedSession()
    const before = api.writes.length

    await session.save()

    assert.equal(api.writes.length, before, 'a clean vault must not be rewritten')
    assert.equal(session.getSnapshot().saving, false)
    session.dispose()
  })

  it('stamps the save time on success', async () => {
    const { session } = await unlockedSession()
    session.add('一条')
    assert.equal(session.getSnapshot().lastSavedAt, null)

    await session.save()

    const snapshot = session.getSnapshot()
    assert.equal(snapshot.saving, false)
    assert.equal(snapshot.error, null)
    assert.ok(snapshot.lastSavedAt, 'the UI shows when it last saved')
    session.dispose()
  })

  it('surfaces a failed save without losing the edit', async () => {
    const { api, session } = await unlockedSession()
    session.add('一条')
    api.failWrites = true

    await session.save()

    const snapshot = session.getSnapshot()
    assert.equal(snapshot.saving, false)
    assert.match(snapshot.error ?? '', /保存失败/)
    // The edit is still on screen and still pending, so a retry can succeed.
    assert.equal(snapshot.memos.length, 1)

    api.failWrites = false
    await session.save()
    assert.equal(session.getSnapshot().error, null, 'a retry clears the banner')
    session.dispose()
  })

  it('cancels a pending save on dispose', async () => {
    const { api, session } = await unlockedSession(30)
    const before = api.writes.length

    session.add('一条')
    session.dispose()
    await settle(120)

    // A timer left armed would write after the component is gone, and notify
    // listeners that no longer exist.
    assert.equal(api.writes.length, before, 'dispose must disarm the debounce')
  })

  it('saves an import eagerly rather than waiting out the debounce', async () => {
    const { api, session } = await unlockedSession(60_000)
    const before = api.writes.length

    const payload = JSON.stringify({
      memos: [
        {
          id: 'imported',
          content: '导入的一条 #导入',
          tags: ['导入'],
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
          pinned: false,
        },
      ],
    })
    const message = await session.importJson(payload)

    assert.match(message, /1/)
    assert.equal(session.getSnapshot().memos.length, 1)
    // The user just handed us a file; waiting 60s to persist it would be wrong.
    assert.ok(api.writes.length > before, 'an import must be persisted before it returns')
    session.dispose()
  })

  it('reports an unreadable import instead of throwing', async () => {
    const { session } = await unlockedSession()
    await assert.rejects(() => session.importJson('not json'))
    session.dispose()
  })
})
