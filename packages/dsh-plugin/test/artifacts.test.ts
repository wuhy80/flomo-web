/**
 * Tests over the **built artifacts**, not the sources.
 *
 * The two halves fail in ways the source-level tests cannot see: the host half
 * has to survive a runtime where `@deepseek-ai/dsh-tools` cannot be resolved,
 * and the browser half has to arrive as a `window.__ModuleLoader__.load`
 * envelope that draws React from the `require` it is handed. Both are
 * verified here against the real `lib/index.js` and `lib/client.js`.
 *
 * The panel is then rendered with `react-dom/server`, which is the strongest
 * check available without a browser: it exercises the same component tree the
 * DeepSeek Harness mounts into its center column.
 *
 * `lib/` is gitignored, so this suite builds it first. Two reasons, and the
 * second is the important one: a clean clone has no `lib/` at all, and a stale
 * one would let these tests pass against output that no longer matches the
 * source — which is exactly how a corrupted bundle once went unnoticed here.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { after, before, describe, it } from 'node:test'

import * as React from 'react'
import { renderToString } from 'react-dom/server'

import type { Memo } from '@flomo/core'
import type { SessionSnapshot } from '@flomo/ui'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { FLOMO_TOOL_NAMES } from '../src/host/tools.ts'
import { API_PREFIX } from '../src/protocol.ts'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const hostBundlePath = join(pluginRoot, 'lib', 'index.js')
const clientBundlePath = join(pluginRoot, 'lib', 'client.js')

const temporaryDirs: string[] = []
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true })
})

// Built through the real build script rather than a copy of its configuration,
// so this cannot drift from what actually ships.
before(async () => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [join(pluginRoot, 'build.mjs')], {
      cwd: pluginRoot,
      stdio: 'inherit',
    })
    child.once('error', rejectPromise)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : rejectPromise(new Error(`build.mjs exited with ${String(code)}`)),
    )
  })
})

/** Let queued microtasks and the lazy tool import settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

/** The shape the built host bundle exports. */
interface HostBundle {
  name: string
  inject: readonly string[]
  apply: (ctx: unknown) => void
}

/**
 * The scratch directory the plugin's settings file lands in.
 *
 * `DEFAULT_CONFIG_PATH` is read once at import time, so the env override has to
 * be in place before the *first* import of the bundle and every test shares the
 * result — hence one memoized loader rather than a per-test import.
 */
let scratchDir = ''
let hostBundlePromise: Promise<HostBundle> | undefined

/**
 * Import the built host bundle against a scratch settings file.
 * @returns the bundle, imported exactly once per test process.
 */
async function loadHostBundle(): Promise<HostBundle> {
  if (hostBundlePromise === undefined) {
    scratchDir = await mkdtemp(join(tmpdir(), 'flomo-artifact-'))
    temporaryDirs.push(scratchDir)
    process.env['FLOMO_CONFIG_PATH'] = join(scratchDir, 'flomo.json')
    hostBundlePromise = import(pathToFileURL(hostBundlePath).href) as Promise<HostBundle>
  }
  return hostBundlePromise
}

/** A stand-in for the DSH credential store. */
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

/** The slice of the Cordis host context the plugin touches. */
function fakeHostContext(credentials: ReturnType<typeof fakeCredentials>): {
  ctx: Record<string, unknown>
  routes: WebRoute[]
  tools: ToolDefinition[]
  dispose: () => void
} {
  const routes: WebRoute[] = []
  const tools: ToolDefinition[] = []
  const disposers: Array<() => void> = []

  const ctx: Record<string, unknown> = {
    // Injected services are properties on the context, which is how the rest of the
    // profile reads them and the path `apply` prefers. Provided here so the test
    // exercises that path rather than only the `get` fallback.
    credentials,
    get(name: string) {
      if (name === 'credentials') return credentials
      if (name === 'tools') {
        return {
          register(definition: ToolDefinition) {
            tools.push(definition)
            return () => {}
          },
        }
      }
      return undefined
    },
    effect(callback: () => (() => void) | void) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    webServer: {
      register(route: WebRoute) {
        routes.push(route)
        return () => {}
      },
    },
    inject(_names: readonly string[], callback: (scoped: unknown) => unknown) {
      return callback(ctx)
    },
  }

  return {
    ctx,
    routes,
    tools,
    dispose: () => {
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

/**
 * Serve the plugin's routes on a real loopback socket.
 * @param routes - the routes the plugin registered.
 * @returns the server and its base URL.
 */
async function serveRoutes(routes: WebRoute[]): Promise<{ server: Server; base: string }> {
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

/** One slot registration the client half made. */
interface Registration {
  name: string
  options: Record<string, unknown>
  component: unknown
}

/**
 * Load the built browser bundle the way the web shell does: through a
 * `window.__ModuleLoader__.load` envelope that hands the factory a `require`.
 * @returns the bundle's exports and the slot registrations it made.
 */
async function loadClientBundle(): Promise<{
  id: string
  exports: Record<string, unknown>
  registrations: Registration[]
}> {
  const source = await readFile(clientBundlePath, 'utf8')
  const nodeRequire = createRequire(import.meta.url)

  let loaded: { id: string; exports: Record<string, unknown> } | undefined
  const registrations: Registration[] = []

  const sandbox = {
    console,
    // FlomoApp injects its stylesheet on mount; without a document that is a
    // documented no-op, so the render below stays headless.
    document: undefined,
    window: {
      __ModuleLoader__: {
        load(definition: {
          id: string
          factory: (require: (name: string) => unknown) => Record<string, unknown>
        }) {
          loaded = {
            id: definition.id,
            exports: definition.factory((name: string) => nodeRequire(name)),
          }
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  assert.ok(loaded, 'the bundle must register itself with window.__ModuleLoader__')
  const bundle = loaded as { id: string; exports: Record<string, unknown> }

  const ctx = {
    slots: {
      inject(key: string, callback: () => () => void) {
        assert.ok(
          key === 'sidebar.panellist' || key === 'main',
          `unexpected slot seat: ${key}`,
        )
        return callback()
      },
      register(options: Record<string, unknown>, component: unknown) {
        registrations.push({ name: String(options.name), options, component })
        return () => {}
      },
    },
    effect(callback: () => (() => void) | void) {
      callback()
    },
  }

  const apply = bundle.exports['apply']
  assert.equal(typeof apply, 'function', 'the client bundle must export apply')
  ;(apply as (c: unknown) => void)(ctx)

  return { id: bundle.id, exports: bundle.exports, registrations }
}

/** A {@link SessionSnapshot} plus the mutation surface the panel calls. */
function fakeSession(overrides: Partial<SessionSnapshot> = {}): {
  session: Record<string, unknown>
  calls: string[]
} {
  const snapshot: SessionSnapshot = {
    status: 'unlocked',
    memos: [],
    tags: [],
    error: null,
    saving: false,
    offline: false,
    lastSavedAt: null,
    recoveryCode: null,
    ...overrides,
  }
  const calls: string[] = []
  const session: Record<string, unknown> = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    refresh: async () => {
      calls.push('refresh')
    },
    create: async () => {},
    unlock: async () => {},
    unlockWithRecovery: async () => {},
    dismissRecovery: () => {},
    add: (content: string) => {
      calls.push(`add:${content}`)
    },
    edit: () => {},
    remove: () => {},
    pin: () => {},
    save: async () => {},
  }
  return { session, calls }
}

/** A memo shaped exactly as the vault stores one. */
function memo(overrides: Partial<Memo> = {}): Memo {
  const createdAt = overrides.createdAt ?? new Date().toISOString()
  return {
    id: overrides.id ?? 'memo-1',
    content: overrides.content ?? '一条笔记 #测试',
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    tags: overrides.tags ?? ['测试'],
    ...(overrides.pinned !== undefined ? { pinned: overrides.pinned } : {}),
  }
}

describe('built host bundle', () => {
  it('registers both routes and all six tools without the Harness tool package', async () => {
    const bundle = await loadHostBundle()
    assert.equal(bundle.name, 'flomo')

    // `credentials` is declared, not merely pulled. Cordis only guarantees a
    // service is available for the ones you inject, so listing only `webServer` and
    // then calling `ctx.get('credentials')` returned undefined — and the panel
    // reported that the deployment had no credentials service, which was false.
    assert.deepEqual([...bundle.inject].sort(), ['credentials', 'webServer'].sort())

    const credentials = fakeCredentials()
    const { ctx, routes, tools } = fakeHostContext(credentials)
    bundle.apply(ctx)
    await settle()

    assert.deepEqual(
      routes.map((route) => route.path).sort(),
      [`${API_PREFIX}/action`, `${API_PREFIX}/state`].sort(),
    )
    // The identity fallback is what makes this pass: `@deepseek-ai/dsh-tools`
    // is not resolvable from a `link:`-installed plugin, and a static import
    // would have taken the whole plugin down instead.
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...FLOMO_TOOL_NAMES],
    )

    // Every tool's arguments must be a JSON Schema of `type: "object"`, not the
    // property map they are written as. `defineTool` converts it and the fallback
    // has to as well: the registry accepts either — it only validates
    // `output.schema` — so a raw property map registers fine and then fails at the
    // model API, which is where this was finally caught:
    //
    //   Invalid schema for function 'flomo_add':
    //   schema must be a JSON Schema of 'type: "object"', got 'type: null'.
    //
    // The tool is unusable in that state, and nothing before this point notices.
    for (const tool of tools) {
      const parameters = tool.parameters as { type?: unknown; properties?: unknown }
      assert.equal(
        parameters.type,
        'object',
        `${tool.name} must declare an object schema, or the model API rejects it`,
      )
      assert.ok(
        parameters.properties !== undefined,
        `${tool.name} must declare its properties as a JSON Schema`,
      )
    }

    // And the declared arguments survive the conversion: a converter that dropped
    // `required` would pass the check above and lose the one thing the model needs.
    const add = tools.find((tool) => tool.name === 'flomo_add')
    const addSchema = add?.parameters as {
      properties?: Record<string, { type?: string }>
      required?: string[]
    }
    assert.equal(addSchema.properties?.content?.type, 'string')
    assert.deepEqual(addSchema.required, ['content'])
  })

  it('serves state, reports the tool status, and drives actions over HTTP', async () => {
    const bundle = await loadHostBundle()
    const credentials = fakeCredentials()
    const { ctx, routes, tools } = fakeHostContext(credentials)
    bundle.apply(ctx)
    await settle()

    const { server, base } = await serveRoutes(routes)
    const headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
    try {
      const state = await fetch(`${base}${API_PREFIX}/state`, { headers })
      assert.equal(state.status, 200)
      const stateBody = (await state.json()) as {
        state: { status: string; toolsRegistered: boolean; toolsError: string | null }
      }
      assert.equal(stateBody.state.status, 'unconfigured')
      assert.equal(stateBody.state.toolsRegistered, true)
      assert.equal(stateBody.state.toolsError, null)

      // A tool called before any configuration must refuse, not throw.
      const search = tools.find((tool) => tool.name === 'flomo_search')
      assert.ok(search)
      const refusal = (await search.execute({ query: 'x' }, {})) as {
        ok: boolean
        code?: string
      }
      assert.equal(refusal.ok, false)
      assert.equal(refusal.code, 'unconfigured')

      // Configure through the wire; the token lands in the credential store and
      // the settings file, never in a response.
      const configure = await fetch(`${base}${API_PREFIX}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'configure', owner: 'me', repo: 'flomo-data', token: 'ghp_x' }),
      })
      assert.equal(configure.status, 200)
      const configured = (await configure.json()) as {
        state: { status: string; owner: string; repo: string }
      }
      // `locked`, not `empty`, and for a reason worth stating: this host has no
      // injected store, so the vault probe cannot reach a repository and the answer
      // stays unknown. Unknown deliberately reads as "there is one" — offering to
      // unlock is recoverable, offering to create over an existing vault is not.
      assert.equal(configured.state.status, 'locked')
      assert.equal(configured.state.owner, 'me')
      assert.equal(credentials.store.get('FLOMO_GITHUB_TOKEN'), 'ghp_x')
      assert.ok(!JSON.stringify(configured).includes('ghp_x'), 'the token must never be echoed')

      const stored = JSON.parse(await readFile(join(scratchDir, 'flomo.json'), 'utf8')) as {
        owner: string
        repo: string
      }
      assert.deepEqual(stored, { owner: 'me', repo: 'flomo-data' })

      // Now that a repository is configured but no password is set, the tools
      // report the vault as locked rather than unconfigured.
      const locked = (await search.execute({ query: 'x' }, {})) as {
        ok: boolean
        code?: string
      }
      assert.equal(locked.code, 'locked')
    } finally {
      server.close()
    }
  })
})

describe('built client bundle', () => {
  it('arrives as a module-loader envelope with the right id and exports', async () => {
    const { id, exports } = await loadClientBundle()
    assert.equal(id, 'dsh-flomo')
    assert.equal(typeof exports['apply'], 'function')
    assert.deepEqual([...((exports['inject'] as readonly string[]) ?? [])], ['slots'])
  })

  it('registers a sidebar row and a keyed main-slot page', async () => {
    const { registrations } = await loadClientBundle()
    assert.equal(registrations.length, 2, 'exactly one row and one page')

    const row = registrations.find((r) => r.name === 'sidebar.panellist')
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(row, 'a sidebar.panellist row is required')
    assert.ok(page, 'a main-slot page is required')

    assert.equal(row.options['id'], 'flomo')
    assert.equal(typeof row.options['order'], 'number')
    assert.equal(typeof row.options['label'], 'function')
    assert.equal((row.options['label'] as () => string)(), 'flomo')

    assert.equal(page.options['key'], 'flomo')
    // The registered face carries the live host session, which is how the page
    // reaches the vault without ever holding a secret itself.
    const inject = page.options['inject'] as () => { session: Record<string, unknown> }
    const face = inject()
    assert.equal(typeof face.session['getSnapshot'], 'function')
    assert.equal(typeof face.session['subscribe'], 'function')
  })

  it('renders the sidebar glyph', async () => {
    const { registrations } = await loadClientBundle()
    const row = registrations.find((r) => r.name === 'sidebar.panellist')
    assert.ok(row)
    const Icon = row.component as React.ComponentType<{ size: number; active: boolean }>
    const html = renderToString(React.createElement(Icon, { size: 16, active: false }))
    assert.match(html, /<svg/)
    assert.match(html, /data-dsh-panel-entry="flomo"/)
  })

  it('renders the unlocked flomo UI with a composer, timestamps, tags and links', async () => {
    const { registrations } = await loadClientBundle()
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(page)
    const Panel = page.component as React.ComponentType<{ session: unknown }>

    const { session } = fakeSession({
      status: 'unlocked',
      memos: [
        memo({
          content:
            '读完《深度工作》很有收获 #读书，顺便想到 [[心流]]。**专注不是意志力问题**，比如 `split("\\n")`。',
          tags: ['读书'],
        }),
      ],
      tags: [{ tag: '读书', count: 1 }],
      lastSavedAt: new Date().toISOString(),
    })

    const html = renderToString(React.createElement(Panel, { session }))
    assert.match(html, /fl-root/)
    assert.match(html, /fl-sidebar/)
    assert.match(html, /fl-composer/, 'the capture box is the point of the app')
    assert.match(html, /读完《深度工作》很有收获/)
    assert.match(html, /#读书/)
    assert.match(html, /fl-memo-stamp/, 'each memo opens with its own full timestamp')
    assert.ok(!html.includes('fl-day'), 'the feed does not group by day, like flomo')
    assert.match(html, /每日回顾/)
    assert.match(html, /随机漫步/)
    // Both inline markers are interactive, so both carry the click affordance.
    assert.match(html, /class="fl-memo-tag"[^>]*role="button"/, 'tags are clickable')
    assert.match(html, /class="fl-memo-link"[^>]*role="button"/, 'links are clickable')
    assert.match(html, /\[\[心流\]\]/, 'the link keeps its markup in the body')
    assert.match(html, /fl-shortcut-hint/, 'the shortcuts are discoverable')
    assert.match(html, /<kbd>\/<\/kbd>/, 'and the hint names the search key')
    assert.match(html, /placeholder="搜索…"/, 'the search box stays terse')
    // Bold and inline code are marks too, not literal asterisks and backticks.
    assert.match(html, /<strong>专注不是意志力问题<\/strong>/)
    assert.match(html, /<code>split\(/)
    assert.ok(
      !html.includes('**') && !html.includes('`'),
      'no markup may leak into the rendered body',
    )
  })

  it('says so when the vault is being read from the local cache', async () => {
    const { registrations } = await loadClientBundle()
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(page)
    const Panel = page.component as React.ComponentType<{ session: unknown }>

    const { session } = fakeSession({
      status: 'unlocked',
      offline: true,
      memos: [memo({ content: '离线也能读到这一条 #缓存', tags: ['缓存'] })],
    })

    const html = renderToString(React.createElement(Panel, { session }))
    assert.match(html, /离线中/, 'the user must know the copy is local')
    assert.match(html, /改动要等联网后才会写进仓库/)
    assert.match(html, /离线也能读到这一条/, 'and the cached content still renders')
  })

  it('renders fenced code verbatim and quotes as quotes', async () => {
    const { registrations } = await loadClientBundle()
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(page)
    const Panel = page.component as React.ComponentType<{ session: unknown }>

    const { session } = fakeSession({
      status: 'unlocked',
      memos: [
        memo({
          content: '看这段 #真标签\n```c\n#include <stdio.h>\n```\n> 一句引用',
          tags: ['真标签'],
        }),
      ],
    })

    const html = renderToString(React.createElement(Panel, { session }))

    assert.match(html, /<pre class="fl-code"/, 'a fence becomes a code block')
    assert.match(html, /#include/, 'the snippet is shown')
    assert.match(html, /stdio\.h/, 'and escaped rather than interpreted')
    assert.match(html, /<blockquote class="fl-quote"/, 'a > run becomes a quote')
    assert.match(html, /一句引用/)

    // The decisive assertion: `#include` must never appear as a tag mark.
    const marks = [...html.matchAll(/class="fl-memo-tag"[^>]*>([^<]*)</g)].map(
      (match) => match[1],
    )
    assert.deepEqual(
      [...new Set(marks)],
      ['#真标签'],
      'only the prose tag is a tag; the C directive is not',
    )
  })

  it('renders markdown blocks, links, tasks and vetoes unsafe URLs', async () => {
    const { registrations } = await loadClientBundle()
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(page)
    const Panel = page.component as React.ComponentType<{ session: unknown }>

    const body = [
      '## 计划',
      '- [ ] 未完成的一项',
      '- [x] 已完成的一项',
      '',
      '[官网](https://flomo.app) 与 [坏](javascript:alert(1))',
      '',
      '~~过期了~~',
    ].join('\n')

    const { session } = fakeSession({
      status: 'unlocked',
      memos: [memo({ content: body, tags: [] })],
    })

    const html = renderToString(React.createElement(Panel, { session }))
    assert.match(html, /<h2 class="fl-md-h" data-level="2"><span>计划<\/span><\/h2>/)
    assert.match(html, /fl-task-done/, 'the ticked task renders done')
    assert.match(html, /<a class="fl-md-a" href="https:\/\/flomo\.app" target="_blank"/, 'links open out')
    assert.match(html, /<del>过期了<\/del>/)
    assert.ok(!/href="javascript:/i.test(html) && !/src="javascript:/i.test(html), 'a non-http URL must not become a link target')
  })

  it('renders the password gate when the vault is locked', async () => {
    const { registrations } = await loadClientBundle()
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(page)
    const Panel = page.component as React.ComponentType<{ session: unknown }>

    const { session } = fakeSession({ status: 'locked' })
    const html = renderToString(React.createElement(Panel, { session }))
    assert.match(html, /fl-gate/)
    assert.match(html, /解锁/)
    assert.match(html, /type="password"/)
    assert.ok(!html.includes('fl-composer'), 'the feed must not render behind the gate')
  })

  it('renders the connection form when no repository is configured', async () => {
    const { registrations } = await loadClientBundle()
    const page = registrations.find((r) => r.name === 'main')
    assert.ok(page)
    const Panel = page.component as React.ComponentType<{ session: unknown }>

    const { session } = fakeSession({ status: 'unconfigured' })
    const html = renderToString(React.createElement(Panel, { session }))
    assert.match(html, /连接 flomo 数据仓库/)
    assert.match(html, /GitHub 用户名/)
    assert.match(html, /私有仓库名/)
  })
})
