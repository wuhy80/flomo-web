/**
 * Integration tests for the `dsh-flomo` host half.
 *
 * These boot the real {@link FlomoHostService} and the real HTTP routes against
 * an in-memory repository, so the whole host surface is exercised offline:
 * configuration, vault creation, the request guard, the action protocol and the
 * agent tools. Only the DeepSeek Harness services themselves are faked, and
 * only where the plugin merely consumes them.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { memosToJson, monthOf } from '@flomo/core'
import type { Memo } from '@flomo/core'
import { MemoryStore } from '@flomo/core/testing'

import { FlomoHostService, PASSWORD_REF, TOKEN_REF } from '../src/host-service.ts'
import { API_PREFIX } from '../src/protocol.ts'
import { makeFlomoRoutes } from '../src/routes.ts'
import { FLOMO_TOOL_NAMES, buildFlomoTools, identityDefineTool } from '../src/host/tools.ts'

/**
 * A stand-in for the DSH credential store.
 * @returns a credentials face plus its backing map, for assertions.
 */
function fakeCredentials(): {
  store: Map<string, string>
  resolve: (ref: string) => Promise<{ value: string } | undefined>
  set: (ref: string, value: string) => Promise<void>
} {
  const store = new Map<string, string>()
  return {
    store,
    async resolve(ref) {
      const value = store.get(ref)
      return value === undefined ? undefined : { value }
    },
    async set(ref, value) {
      store.set(ref, value)
    },
  }
}

/**
 * Build a service wired to a fresh in-memory repository.
 * @param dir - directory for the settings file.
 * @param backing - the fake repository to write into.
 * @returns the service, its backing store, and its credential store.
 */
async function makeHost(
  dir: string,
  backing: MemoryStore,
): Promise<{
  host: FlomoHostService
  backing: MemoryStore
  credentials: ReturnType<typeof fakeCredentials>
}> {
  const credentials = fakeCredentials()
  const host = new FlomoHostService({
    credentials,
    configPath: join(dir, 'flomo.json'),
    createStore: () => backing,
  })
  await host.ensureStarted()
  return { host, backing, credentials }
}

/**
 * Serve the plugin's routes over a real loopback socket.
 * @param host - the service to expose.
 * @returns the server and its base URL.
 */
async function serve(host: FlomoHostService): Promise<{ server: Server; base: string }> {
  const routes = makeFlomoRoutes(host)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? ''
    const route = routes.find((candidate) => url.startsWith(candidate.path))
    if (!route) {
      res.writeHead(404).end()
      return
    }
    void Promise.resolve(route.handler(req, res))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, base: `http://127.0.0.1:${address.port}` }
}

const temporaryDirs: string[] = []
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true })
})

describe('host lifecycle', () => {
  it('walks unconfigured → locked → unlocked, and persists the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const { host, credentials } = await makeHost(dir, new MemoryStore())

    assert.equal(host.snapshot().status, 'unconfigured')

    const configured = await host.apply({
      kind: 'configure',
      owner: 'me',
      repo: 'flomo-data',
      token: 'ghp_test',
    })
    assert.equal(configured.status, 'locked', 'a token without a password is locked, not unconfigured')
    assert.equal(configured.owner, 'me')
    assert.equal(configured.repo, 'flomo-data')
    assert.equal(credentials.store.get(TOKEN_REF), 'ghp_test', 'the token must be stored, not echoed')

    const created = await host.apply({ kind: 'create', password: 'correct horse' })
    assert.equal(created.status, 'unlocked')
    assert.ok(created.recoveryCode, 'creating a vault must hand back the recovery code')
    assert.equal(created.hasStoredPassword, false, 'the password must not be stored by default')
    assert.equal(credentials.store.has(PASSWORD_REF), false)
  })

  it('locks and reopens with the recovery code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const { host } = await makeHost(dir, new MemoryStore())

    await host.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    const created = await host.apply({ kind: 'create', password: 'pw' })
    const recoveryCode = created.recoveryCode
    assert.ok(recoveryCode)

    await host.apply({ kind: 'lock' })
    assert.equal(host.snapshot().status, 'locked')

    const reopened = await host.apply({ kind: 'recovery', code: recoveryCode })
    assert.equal(reopened.status, 'unlocked')
  })

  it('reports a failure through state rather than throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const { host } = await makeHost(dir, new MemoryStore())

    const state = await host.apply({ kind: 'unlock', password: 'nope' })
    assert.equal(state.status, 'unconfigured')
    assert.match(state.error ?? '', /请先配置|没有/)
  })
})

describe('memos and shards', () => {
  it('adds, encrypts, saves and reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const backing = new MemoryStore()
    const { host } = await makeHost(dir, backing)

    await host.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    await host.apply({ kind: 'create', password: 'pw' })

    await host.apply({ kind: 'add', content: '第一条 #测试' })
    assert.equal(host.memos().length, 1)
    assert.deepEqual(host.memos()[0]?.tags, ['测试'])

    await host.apply({ kind: 'save' })
    const path = `data/${monthOf(new Date())}.json`
    const raw = backing.raw(path)
    assert.ok(raw, `expected a shard at ${path}`)
    assert.ok(!raw.includes('第一条'), 'the shard on disk must be ciphertext')

    // A fresh service reading the same repository sees the memo again.
    const second = new FlomoHostService({
      credentials: fakeCredentials(),
      configPath: join(dir, 'other.json'),
      createStore: () => backing,
    })
    await second.ensureStarted()
    await second.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    await second.apply({ kind: 'unlock', password: 'pw' })
    assert.deepEqual(second.memos().map((m) => m.content), ['第一条 #测试'])
  })
})

describe('import', () => {
  it('merges an exported document, reports what it did, and persists it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const backing = new MemoryStore()
    const { host } = await makeHost(dir, backing)

    await host.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    await host.apply({ kind: 'create', password: 'pw' })
    await host.apply({ kind: 'add', content: '原有的一条 #旧' })
    await host.apply({ kind: 'save' })

    const payload = JSON.parse(memosToJson(host.memos())) as { memos: Memo[] }
    assert.equal(payload.memos.length, 1)
    payload.memos.push({
      id: 'restored',
      content: '从备份恢复的一条 #导入',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: ['假的'],
    })

    const state = await host.apply({ kind: 'import', payload: JSON.stringify(payload) })
    assert.equal(state.error, null)
    assert.equal(host.memos().length, 2)

    const message = host.takeMessage()
    assert.match(message ?? '', /已导入 1 条/)
    assert.match(message ?? '', /跳过 1 条已存在/)

    const imported = host.memos().find((m) => m.id === 'restored')
    assert.deepEqual(imported?.tags, ['导入'], 'tags come from the body, not the payload')

    // One-shot: the same outcome must not be reported by the next call.
    assert.equal(host.takeMessage(), null)

    // Durable, not merely in memory.
    const reopened = new FlomoHostService({
      credentials: fakeCredentials(),
      configPath: join(dir, 'second.json'),
      createStore: () => backing,
    })
    await reopened.ensureStarted()
    await reopened.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    await reopened.apply({ kind: 'unlock', password: 'pw' })
    assert.equal(reopened.memos().length, 2)
  })

  it('refuses an unreadable file without touching the vault', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const { host } = await makeHost(dir, new MemoryStore())
    await host.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    await host.apply({ kind: 'create', password: 'pw' })

    const state = await host.apply({ kind: 'import', payload: '这不是 json' })
    assert.match(state.error ?? '', /合法的 JSON/)
    assert.equal(host.memos().length, 0)
  })
})

describe('agent tools', () => {
  it('registers the documented set and refuses while locked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const { host } = await makeHost(dir, new MemoryStore())

    const tools = buildFlomoTools(host, identityDefineTool)
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...FLOMO_TOOL_NAMES],
    )

    // The registry validates output.schema and refuses the `{ type: 'json' }`
    // shorthand that the Harness's own defineTool would have expanded. A plugin
    // falling back to an identity helper therefore has to hand over a schema that
    // stands on its own — this is what silently disabled every tool in a real
    // install, with nothing but a status string to show for it.
    const allowed = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
    for (const tool of tools) {
      const schema = tool.output.schema as { type?: unknown }
      assert.ok(
        allowed.includes(String(schema.type)),
        `${tool.name} declares an output schema the registry will refuse: ${JSON.stringify(schema)}`,
      )
    }

    const search = tools.find((tool) => tool.name === 'flomo_search')
    assert.ok(search)
    const refused = (await search.execute({ query: 'x' }, {})) as { ok: boolean; code?: string }
    assert.equal(refused.ok, false)
    assert.equal(refused.code, 'unconfigured')
  })

  it('writes through flomo_add and reads back through flomo_search', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const backing = new MemoryStore()
    const { host } = await makeHost(dir, backing)

    await host.apply({ kind: 'configure', owner: 'me', repo: 'r', token: 't' })
    await host.apply({ kind: 'create', password: 'pw' })

    const tools = buildFlomoTools(host, identityDefineTool)
    const byName = (name: string) => {
      const tool = tools.find((candidate) => candidate.name === name)
      if (!tool) throw new Error(`missing tool ${name}`)
      return tool
    }

    const added = (await byName('flomo_add').execute(
      { content: '来自 agent 的一条 #cli' },
      {},
    )) as { ok: boolean; memo?: { tags: string[] } }
    assert.equal(added.ok, true)
    assert.deepEqual(added.memo?.tags, ['cli'])

    // flomo_add is expected to be durable before it returns.
    assert.ok(backing.raw(`data/${monthOf(new Date())}.json`), 'add must flush synchronously')

    const found = (await byName('flomo_search').execute({ query: 'agent' }, {})) as {
      ok: boolean
      count: number
    }
    assert.equal(found.ok, true)
    assert.equal(found.count, 1)

    const tags = (await byName('flomo_tags').execute({}, {})) as {
      ok: boolean
      tags: Array<{ tag: string; count: number }>
    }
    assert.deepEqual(tags.tags, [{ tag: 'cli', count: 1 }])

    const review = (await byName('flomo_daily_review').execute({}, {})) as { ok: boolean }
    assert.equal(review.ok, false, 'a brand-new vault has nothing old enough to review')

    const random = (await byName('flomo_random').execute({}, {})) as { ok: boolean }
    assert.equal(random.ok, true)
  })
})

describe('http surface', () => {
  it('refuses a request with no browser same-origin signal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const { host } = await makeHost(dir, new MemoryStore())
    const { server, base } = await serve(host)
    try {
      const response = await fetch(`${base}${API_PREFIX}/state`)
      assert.equal(response.status, 403)
    } finally {
      server.close()
    }
  })

  it('serves state and applies actions over the wire', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
    temporaryDirs.push(dir)
    const backing = new MemoryStore()
    const { host } = await makeHost(dir, backing)
    host.setToolsStatus(true, null)
    const { server, base } = await serve(host)
    const headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

    try {
      const state = await fetch(`${base}${API_PREFIX}/state`, { headers })
      assert.equal(state.status, 200)
      const stateBody = (await state.json()) as {
        state: { status: string; toolsRegistered: boolean }
      }
      assert.equal(stateBody.state.status, 'unconfigured')
      assert.equal(stateBody.state.toolsRegistered, true)

      const action = await fetch(`${base}${API_PREFIX}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'configure', owner: 'me', repo: 'r', token: 't' }),
      })
      assert.equal(action.status, 200)
      const actionBody = (await action.json()) as { ok: boolean; state: { status: string } }
      assert.equal(actionBody.ok, true)
      assert.equal(actionBody.state.status, 'locked')

      const invalid = await fetch(`${base}${API_PREFIX}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'delete-everything' }),
      })
      assert.equal(invalid.status, 400)

      const wrongMethod = await fetch(`${base}${API_PREFIX}/action`, { method: 'GET', headers })
      assert.equal(wrongMethod.status, 405)
    } finally {
      server.close()
    }
  })
})
