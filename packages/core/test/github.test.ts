/**
 * Tests for the real network client, over real HTTP.
 *
 * `MemoryStore` is a fine fake for the vault's logic, but it skips everything
 * `GitHubContentsStore` actually does: URL construction, base64 round-tripping of
 * UTF-8, the blob sha, branch placement, status mapping and message extraction.
 * None of that was covered before this file existed.
 *
 * So the client is driven against a local server that speaks the Contents API —
 * including the two behaviours that are easy to get wrong and impossible to see
 * with an in-memory fake: GitHub wraps base64 at 60 characters, and a write that
 * presents a stale sha is refused.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { after, beforeEach, describe, it } from 'node:test'

import { GitHubConflictError, GitHubContentsStore, GitHubError, RECOMMENDED_MAX_BYTES } from '../src/index.ts'

/** One stored blob. */
interface Entry {
  text: string
  sha: string
}

/** A recorded request, for asserting on what the client actually sent. */
interface Recorded {
  method: string
  url: string
  body: unknown
  auth: string | undefined
}

/**
 * Write a JSON response.
 * @param res - the response.
 * @param status - the status code.
 * @param body - the payload.
 */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Read a request body as JSON.
 * @param req - the request.
 * @returns the parsed body, or undefined.
 */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw === '' ? undefined : JSON.parse(raw)
}

/**
 * Wrap base64 the way GitHub does, so the decoder's whitespace handling is
 * exercised rather than assumed.
 * @param base64 - the unwrapped payload.
 * @returns the payload with a newline every 60 characters.
 */
function wrap(base64: string): string {
  return (base64.match(/.{1,60}/g) ?? []).join('\n')
}

/** A minimal but faithful Contents API. */
class FakeGitHub {
  readonly files = new Map<string, Entry>()
  readonly requests: Recorded[] = []
  base = ''
  private seq = 0
  private server: Server | undefined

  /** @returns the port the server chose. */
  async start(): Promise<void> {
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    this.server = server
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    this.base = `http://127.0.0.1:${address.port}`
  }

  /** Stop listening. */
  stop(): void {
    this.server?.close()
  }

  /** Forget everything, between tests. */
  reset(): void {
    this.files.clear()
    this.requests.length = 0
    this.seq = 0
  }

  /**
   * @param req - the request.
   * @param res - the response.
   */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    this.requests.push({
      method: req.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      body: req.method === 'PUT' ? await readBody(req) : undefined,
      auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    })

    if (/^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      return json(res, 200, { default_branch: 'trunk', private: true })
    }

    const match = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(url.pathname)
    if (match === null) return json(res, 404, { message: 'Not Found' })
    const path = decodeURIComponent(match[3] ?? '')

    if (req.method === 'GET') {
      const entry = this.files.get(path)
      if (entry !== undefined) {
        return json(res, 200, {
          content: wrap(Buffer.from(entry.text, 'utf8').toString('base64')),
          sha: entry.sha,
        })
      }
      const children = [...this.files.entries()].filter(([name]) =>
        name.startsWith(`${path}/`),
      )
      if (children.length === 0) return json(res, 404, { message: 'Not Found' })
      return json(
        res,
        200,
        children.map(([name, child]) => ({
          type: 'file',
          name: name.slice(path.length + 1),
          path: name,
          sha: child.sha,
        })),
      )
    }

    if (req.method === 'PUT') {
      const payload = (this.requests.at(-1)?.body ?? {}) as {
        content?: string
        sha?: string
        branch?: string
      }
      const existing = this.files.get(path)

      if (payload.sha !== undefined) {
        if (existing === undefined || existing.sha !== payload.sha) {
          return json(res, 409, { message: 'sha does not match' })
        }
      } else if (existing !== undefined) {
        return json(res, 422, { message: 'sha was not supplied' })
      }

      this.seq += 1
      const sha = `sha-${this.seq}`
      this.files.set(path, {
        text: Buffer.from(payload.content ?? '', 'base64').toString('utf8'),
        sha,
      })
      return json(res, 200, { content: { sha } })
    }

    return json(res, 405, { message: 'Method Not Allowed' })
  }
}

const github = new FakeGitHub()

/**
 * Build a client pointed at the fake.
 * @param options - branch and fetch overrides.
 * @returns the client.
 */
function client(options: { branch?: string; fetchImpl?: typeof fetch } = {}): GitHubContentsStore {
  return new GitHubContentsStore({
    token: 'ghp_secret',
    owner: 'me',
    repo: 'flomo-data',
    apiBase: github.base,
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
}

beforeEach(() => {
  github.reset()
})
after(() => {
  github.stop()
})
await github.start()

describe('contents client', () => {
  it('returns null for a missing file rather than throwing', async () => {
    assert.equal(await client().readText('vault.json'), null)
  })

  it('decodes GitHub base64, including its line wrapping, as UTF-8', async () => {
    // A body long enough to wrap, with characters that are multi-byte in UTF-8 —
    // the two things a naive atob/btoa round-trip gets wrong.
    const text = `第一条 #标签 ${'很长的正文。'.repeat(30)} 🎉`
    github.files.set('vault.json', { text, sha: 'sha-a' })

    const file = await client().readText('vault.json')
    assert.equal(file?.text, text, 'wrapping must not corrupt the payload')
    assert.equal(file?.sha, 'sha-a')
  })

  it('sends the token on every request', async () => {
    await client().readText('vault.json')
    await client().listDir('data')
    assert.ok(github.requests.length >= 2)
    for (const request of github.requests) {
      assert.equal(request.auth, 'Bearer ghp_secret', `${request.url} carried no credentials`)
    }
  })

  it('creates a file and returns the new sha', async () => {
    const sha = await client().writeText('a.json', '内容', { message: 'flomo: seed' })
    assert.equal(sha, 'sha-1')
    assert.equal(github.files.get('a.json')?.text, '内容', 'the server received real UTF-8')

    const body = github.requests.at(-1)?.body as { message?: string; sha?: string }
    assert.equal(body.message, 'flomo: seed')
    assert.equal(body.sha, undefined, 'a create must not present a sha')
  })

  it('updates a file when the sha matches', async () => {
    const first = await client().writeText('a.json', 'old', { message: 'seed' })
    const second = await client().writeText('a.json', 'new', { sha: first, message: 'edit' })
    assert.equal(second, 'sha-2')
    assert.equal(github.files.get('a.json')?.text, 'new')
  })

  it('reports a lost race as a conflict, not a generic failure', async () => {
    await client().writeText('a.json', 'old', { message: 'seed' })

    // Someone else moved the blob on.
    await assert.rejects(
      () => client().writeText('a.json', 'mine', { sha: 'sha-stale', message: 'edit' }),
      (error: unknown) => {
        assert.ok(error instanceof GitHubConflictError, 'the caller must be able to retry')
        assert.equal(error.status, 409)
        return true
      },
    )
  })

  it('reports creating over an existing file as a conflict too', async () => {
    await client().writeText('a.json', 'old', { message: 'seed' })
    await assert.rejects(
      () => client().writeText('a.json', 'clobber', { message: 'seed' }),
      GitHubConflictError,
    )
  })

  it('lists a directory and returns nothing for a missing one', async () => {
    await client().writeText('data/2026-01.json', 'x', { message: 'seed' })
    await client().writeText('data/2026-02.json', 'y', { message: 'seed' })

    const entries = await client().listDir('data')
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      ['2026-01.json', '2026-02.json'],
    )
    assert.equal(entries[0]?.path, 'data/2026-01.json')

    assert.deepEqual(await client().listDir('nothing-here'), [])
  })

  it('puts the branch in the ref for reads and in the body for writes', async () => {
    const store = client({ branch: 'notes' })
    await store.readText('vault.json')
    await store.listDir('data')
    await store.writeText('a.json', 'x', { message: 'seed' })

    const read = github.requests.find((r) => r.method === 'GET' && r.url.includes('vault.json'))
    assert.match(read?.url ?? '', /\?ref=notes$/, 'reads must select the branch')

    const list = github.requests.find((r) => r.method === 'GET' && r.url.includes('/data'))
    assert.match(list?.url ?? '', /\?ref=notes$/)

    const write = github.requests.find((r) => r.method === 'PUT')
    assert.ok(
      !(write?.url ?? '').includes('ref='),
      'the Contents API takes the branch in the body, not the query',
    )
    assert.equal((write?.body as { branch?: string }).branch, 'notes')
  })

  it('reads repository metadata for the access check', async () => {
    assert.deepEqual(await client().verifyAccess(), {
      defaultBranch: 'trunk',
      private: true,
    })
  })

  it('surfaces the API message rather than only the status', async () => {
    const failing = client({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
        })) as unknown as typeof fetch,
    })

    await assert.rejects(
      () => failing.readText('vault.json'),
      (error: unknown) => {
        assert.ok(error instanceof GitHubError)
        assert.equal(error.status, 401)
        assert.match(error.message, /Bad credentials/, 'the status alone is not actionable')
        return true
      },
    )
  })

  it('refuses an oversized payload without touching the network', async () => {
    const before = github.requests.length
    const huge = 'x'.repeat(RECOMMENDED_MAX_BYTES + 1)

    await assert.rejects(
      () => client().writeText('a.json', huge, { message: 'seed' }),
      (error: unknown) => {
        assert.ok(error instanceof GitHubError)
        assert.equal(error.status, 413)
        return true
      },
    )
    assert.equal(
      github.requests.length,
      before,
      'the shard is checked before it is uploaded, not after',
    )
  })

  it('rejects a response that names a directory where a file was expected', async () => {
    const confusing = client({
      fetchImpl: (async () =>
        new Response(JSON.stringify([{ type: 'file', name: 'x', path: 'x' }]), {
          status: 200,
        })) as unknown as typeof fetch,
    })

    await assert.rejects(
      () => confusing.readText('data'),
      /缺少 content\/sha 字段/,
      'a directory listing must not be silently read as an empty file',
    )
  })
})
