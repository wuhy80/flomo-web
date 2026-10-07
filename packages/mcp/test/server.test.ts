/**
 * Tests for the MCP server: the protocol surface on a fake vault, and one
 * real spawn answering over stdio.
 *
 * The tool handlers are exercised against `MemoryStore` from
 * `@flomo/core/testing` — the same encrypted-shard round trip the browser
 * does, minus GitHub. The spawn test proves the wire format (one JSON-RPC
 * message per line, responses in order) without touching the network: with
 * no credentials configured, a tool call answers `isError` with the setup
 * hint instead of reaching for GitHub.
 *
 * @module flomo-mcp/test/server
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { FlomoVault } from '@flomo/core'
import { MemoryStore } from '@flomo/core/testing'

import { createState, handleMessage } from '../server.ts'
import type { IncomingMessage } from '../server.ts'

/** One unlock round trip over an in-memory store. */
async function memoryState(): Promise<ReturnType<typeof createState>> {
  const store = new MemoryStore()
  await FlomoVault.create(store, '演示密码', 1000)
  return createState({ env: { FLOMO_PASSWORD: '演示密码' }, store })
}

/** Send one message and read the `result` payload back. */
async function call(state: ReturnType<typeof createState>, message: IncomingMessage) {
  const outgoing = await handleMessage(state, message)
  assert.ok(outgoing !== null, 'expected a response')
  return outgoing
}

describe('mcp protocol', () => {
  it('answers initialize with server info and the tools capability', async () => {
    const outgoing = await call(createState({ env: {} }), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })
    const result = outgoing.result as Record<string, unknown>
    assert.equal(result.protocolVersion, '2025-06-18')
    assert.deepEqual(result.capabilities, { tools: {} })
    const info = result.serverInfo as Record<string, unknown>
    assert.equal(info.name, 'flomo-mcp')
  })

  it('echoes the client protocol version when given one', async () => {
    const outgoing = await call(createState({ env: {} }), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2030-01-01' },
    })
    assert.equal((outgoing.result as Record<string, unknown>).protocolVersion, '2030-01-01')
  })

  it('answers nothing for notifications', async () => {
    const state = createState({ env: {} })
    assert.equal(await handleMessage(state, { jsonrpc: '2.0', method: 'notifications/initialized' }), null)
    assert.equal(await handleMessage(state, { jsonrpc: '2.0', method: 'notifications/whatever' }), null)
  })

  it('lists five tools, every input schema an object', async () => {
    const outgoing = await call(createState({ env: {} }), { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (outgoing.result as Record<string, unknown>).tools as Array<Record<string, unknown>>
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['flomo_add', 'flomo_recent', 'flomo_search', 'flomo_daily_review', 'flomo_tags'],
    )
    for (const tool of tools) {
      assert.equal((tool.inputSchema as Record<string, unknown>).type, 'object')
      assert.equal(typeof tool.description, 'string')
    }
  })

  it('answers unknown methods with -32601', async () => {
    const outgoing = await call(createState({ env: {} }), { jsonrpc: '2.0', id: 3, method: 'resources/list' })
    const failure = outgoing.error as Record<string, unknown>
    assert.equal(failure.code, -32601)
  })

  it('rejects a request without a method', async () => {
    const outgoing = await call(createState({ env: {} }), { jsonrpc: '2.0', id: 4 })
    const failure = outgoing.error as Record<string, unknown>
    assert.equal(failure.code, -32600)
  })
})

describe('mcp tools', () => {
  it('adds a memo and reads it back through recent and search', async () => {
    const state = await memoryState()
    const added = await call(state, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'flomo_add', arguments: { content: '读完《深度工作》 #读书/认知' } },
    })
    const addResult = (added.result as Record<string, unknown>) as {
      content: Array<{ text: string }>
      isError?: boolean
    }
    assert.notEqual(addResult.isError, true)
    const saved = JSON.parse(addResult.content[0]?.text ?? '{}') as {
      saved: { tags: string[]; content: string }
      written: string[]
    }
    assert.deepEqual(saved.saved.tags, ['读书/认知'])
    assert.equal(saved.written.length, 1)

    const recent = await call(state, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'flomo_recent', arguments: { limit: 5 } },
    })
    const listed = JSON.parse(
      ((recent.result as Record<string, unknown>).content as Array<{ text: string }>)[0]?.text ?? '{}',
    ) as { memos: Array<{ content: string }>; total: number }
    assert.equal(listed.total, 1)
    assert.equal(listed.memos[0]?.content, '读完《深度工作》 #读书/认知')

    const search = await call(state, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'flomo_search', arguments: { query: '深度工作' } },
    })
    const found = JSON.parse(
      ((search.result as Record<string, unknown>).content as Array<{ text: string }>)[0]?.text ?? '{}',
    ) as { memos: Array<{ id: string }> }
    assert.equal(found.memos.length, 1)
  })

  it('aggregates tags across the corpus', async () => {
    const state = await memoryState()
    await call(state, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'flomo_add', arguments: { content: '一条 #a' } },
    })
    await call(state, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'flomo_add', arguments: { content: '两条 #a #b' } },
    })
    const tags = await call(state, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'flomo_tags', arguments: {} },
    })
    const listed = JSON.parse(
      ((tags.result as Record<string, unknown>).content as Array<{ text: string }>)[0]?.text ?? '{}',
    ) as { tags: Array<{ tag: string; count: number }> }
    assert.deepEqual(listed.tags, [
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
    ])
  })

  it('fails a tool call as isError, not as a protocol error', async () => {
    const state = createState({ env: {} })
    const outgoing = await call(state, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'flomo_recent', arguments: {} },
    })
    const result = outgoing.result as { isError?: boolean; content: Array<{ text: string }> }
    assert.equal(result.isError, true)
    assert.match(result.content[0]?.text ?? '', /缺少环境变量/)
  })

  it('rejects an empty memo and an empty search', async () => {
    const state = await memoryState()
    const empty = await call(state, {
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: { name: 'flomo_add', arguments: { content: '   ' } },
    })
    assert.equal(((empty.result as Record<string, unknown>).isError as boolean), true)

    const vague = await call(state, {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: { name: 'flomo_search', arguments: {} },
    })
    assert.equal(((vague.result as Record<string, unknown>).isError as boolean), true)
  })
})

describe('mcp over stdio', () => {
  it('answers initialize, tools/list and a tool call in order', async () => {
    const serverPath = fileURLToPath(new URL('../server.ts', import.meta.url))
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, FLOMO_GITHUB_TOKEN: '', FLOMO_REPO: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines: string[] = []
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        lines.push(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
    })

    const send = (message: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const until = async (count: number): Promise<void> => {
      for (let attempt = 0; attempt < 100 && lines.length < count; attempt += 1) {
        await new Promise((ready) => setTimeout(ready, 50))
      }
      assert.ok(lines.length >= count, `wanted ${count} responses, got ${lines.length}`)
    }

    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      await until(1)
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'flomo_recent', arguments: {} },
      })
      await until(3)

      const init = JSON.parse(lines[0] ?? '{}') as { id: number; result: { serverInfo: { name: string } } }
      assert.equal(init.id, 1)
      assert.equal(init.result.serverInfo.name, 'flomo-mcp')
      const list = JSON.parse(lines[1] ?? '{}') as { id: number; result: { tools: unknown[] } }
      assert.equal(list.id, 2)
      assert.equal(list.result.tools.length, 5)
      const call = JSON.parse(lines[2] ?? '{}') as {
        id: number
        result: { isError?: boolean; content: Array<{ text: string }> }
      }
      assert.equal(call.id, 3)
      assert.equal(call.result.isError, true)
      assert.match(call.result.content[0]?.text ?? '', /缺少环境变量/)
    } finally {
      child.kill()
    }
  })
})
