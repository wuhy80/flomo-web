/**
 * Tests for the web app's own shell — the first thing anyone sees.
 *
 * `packages/web` is the one package the artifact tests do not cover: they load
 * the DSH plugin's bundles, which share `FlomoApp` but none of the connection
 * and configuration handling that wraps it.
 *
 * Node can strip types but cannot transform JSX, so the entry is bundled with
 * esbuild first and the *built* module is rendered — which also means these
 * assertions hold for what Vite would actually ship.
 *
 * The bundle is written inside `packages/web/node_modules` so that the
 * externalized React resolves to the very same instance `react-dom/server`
 * renders with; a copy in the OS temp directory would resolve to nothing, or
 * worse, to a second React.
 */

import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'

import * as esbuild from 'esbuild'
import * as React from 'react'
import { renderToString } from 'react-dom/server'

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(webRoot, 'node_modules', '.flomo-web-test')

after(async () => {
  await rm(outDir, { recursive: true, force: true })
  delete (globalThis as { window?: unknown }).window
})

/** Bundle and load the web entry exactly once. */
let bundlePromise: Promise<Record<string, unknown>> | undefined

/**
 * Build `src/App.tsx` and load it as CommonJS.
 * @returns the module's exports.
 */
async function loadWebEntry(): Promise<Record<string, unknown>> {
  bundlePromise ??= (async () => {
    await mkdir(outDir, { recursive: true })
    const outfile = join(outDir, 'app.cjs')
    await esbuild.build({
      entryPoints: [join(webRoot, 'src', 'App.tsx')],
      outfile,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
      alias: {
        '@flomo/core': join(webRoot, '..', 'core', 'src', 'index.ts'),
        '@flomo/ui': join(webRoot, '..', 'ui', 'src', 'index.ts'),
      },
      define: { 'process.env.NODE_ENV': '"test"' },
      logLevel: 'silent',
    })
    return createRequire(import.meta.url)(outfile) as Record<string, unknown>
  })()
  return bundlePromise
}

/** A `Storage` backed by a Map, for driving the config store. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

/**
 * Install a fake `window` for the duration of one render.
 * @param seed - initial storage contents.
 */
function useWindow(seed: Record<string, string> = {}): void {
  ;(globalThis as { window?: unknown }).window = {
    localStorage: fakeStorage(seed),
    sessionStorage: fakeStorage(),
  }
}

describe('web app shell', () => {
  it('asks for a repository on first run', async () => {
    delete (globalThis as { window?: unknown }).window
    const module = await loadWebEntry()
    const App = module['App'] as React.ComponentType

    const html = renderToString(React.createElement(App))

    assert.match(html, /连接你的数据仓库/, 'the first screen explains what it wants')
    assert.match(html, /GitHub 用户名/)
    assert.match(html, /私有仓库名/)
    assert.match(html, /细粒度访问令牌/)
    assert.match(html, /Contents: Read and write/, 'it must say which scope to grant')
    assert.match(html, /type="password"/, 'the token field is masked')
    assert.match(html, /在这台设备上记住/)
  })

  it('offers to create the repository, and names what that costs', async () => {
    delete (globalThis as { window?: unknown }).window
    const module = await loadWebEntry()
    const App = module['App'] as React.ComponentType

    const html = renderToString(React.createElement(App))

    assert.match(html, /在我的账号下创建这个私有仓库/)
    // The extra scope has to be stated: this is the one place the app asks for
    // more than it will ever use, so the user can decline it knowingly.
    assert.match(html, /Administration: Read and write/)
    assert.match(html, /可选。这一步需要令牌额外具备/)
    assert.match(html, /不要<\/strong>授予这个权限/)
  })

  it('goes straight to the vault gate when a repository is already stored', async () => {
    useWindow({
      'flomo-sim:config:v1': JSON.stringify({
        owner: 'me',
        repo: 'flomo-data',
        token: 'ghp_x',
        remember: true,
      }),
    })

    const module = await loadWebEntry()
    const App = module['App'] as React.ComponentType

    const html = renderToString(React.createElement(App))

    assert.ok(!html.includes('连接你的数据仓库'), 'the setup form must not reappear')
    assert.match(html, /正在连接保险库/, 'App hands off to FlomoApp, which probes the remote')
  })

  it('treats a malformed stored config as absent', async () => {
    useWindow({ 'flomo-sim:config:v1': '{"owner":"me"}' })

    const module = await loadWebEntry()
    const App = module['App'] as React.ComponentType

    const html = renderToString(React.createElement(App))
    assert.match(html, /连接你的数据仓库/, 'a half-written config must not be trusted')
  })

  it('does not touch storage when there is no window at all', async () => {
    delete (globalThis as { window?: unknown }).window
    const module = await loadWebEntry()
    const App = module['App'] as React.ComponentType

    assert.doesNotThrow(() => renderToString(React.createElement(App)))
  })
})
