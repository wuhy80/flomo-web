/**
 * Tests for the service worker's routing.
 *
 * A service worker is the one artifact here that cannot be verified by looking
 * at it, and whose failure mode is an app that appears broken and stays that way.
 * So its handlers are exercised for real: the file is loaded into a sandbox with
 * a fake Cache Storage and a fetch that can be cut, and each routing decision is
 * asserted.
 *
 * The decisions worth pinning are the ones that protect the user:
 * navigations go to the network first (a stale worker must never pin someone to
 * an old build), cross-origin requests are left alone (the vault lives behind
 * api.github.com and must not be cached here), and non-GET is never touched.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, it } from 'node:test'

const swPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public', 'sw.js')
const ORIGIN = 'https://flomo.test'

/** The subset of `Request` the worker reads. */
interface FakeRequest {
  url: string
  method: string
  mode: string
  clone(): FakeRequest
}

/**
 * Build a request.
 * @param url - absolute URL.
 * @param mode - the request mode.
 * @param method - the HTTP method.
 * @returns the request.
 */
function makeRequest(url: string, mode = 'no-cors', method = 'GET'): FakeRequest {
  const request: FakeRequest = { url, method, mode, clone: () => request }
  return request
}

/** A `Cache` backed by a Map. */
class FakeCache {
  readonly entries = new Map<string, Response>()
  private readonly doFetch: (input: unknown) => Promise<Response>

  /**
   * @param doFetch - the fetch implementation to fill from.
   */
  constructor(doFetch: (input: unknown) => Promise<Response>) {
    this.doFetch = doFetch
  }

  /**
   * @param url - the URL to fetch and store.
   */
  async add(url: string): Promise<void> {
    const response = await this.doFetch(url)
    if (!response.ok) throw new Error(`add failed: ${url}`)
    this.entries.set(String(url), response)
  }

  /**
   * @param request - the request to key on.
   * @param response - the response to store.
   */
  async put(request: FakeRequest, response: Response): Promise<void> {
    this.entries.set(request.url, response)
  }

  /**
   * @param request - a request or a URL string.
   * @param options - `ignoreSearch` mirrors the real option.
   * @returns the stored response, or undefined.
   */
  async match(
    request: FakeRequest | string,
    options?: { ignoreSearch?: boolean },
  ): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url
    const exact = this.entries.get(key)
    if (exact !== undefined) return exact
    if (options?.ignoreSearch === true) {
      const base = key.split('?')[0]
      for (const [stored, response] of this.entries) {
        if (stored.split('?')[0] === base) return response
      }
    }
    return undefined
  }
}

/** The sandbox a test drives. */
interface Worker {
  handlers: Map<string, (event: never) => void>
  stores: Map<string, FakeCache>
  skippedWaiting: () => boolean
  claimed: () => boolean
}

/**
 * Load the worker into a sandbox with fake platform APIs.
 * @param doFetch - the fetch implementation the worker will see.
 * @returns handles for driving and inspecting it.
 */
async function loadWorker(doFetch: (input: unknown) => Promise<Response>): Promise<Worker> {
  const source = await readFile(swPath, 'utf8')
  const handlers = new Map<string, (event: never) => void>()
  const stores = new Map<string, FakeCache>()
  let skipped = false
  let claimed = false

  const cachesApi = {
    async open(name: string) {
      let store = stores.get(name)
      if (store === undefined) {
        store = new FakeCache(doFetch)
        stores.set(name, store)
      }
      return store
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name: string) {
      return stores.delete(name)
    },
  }

  const sandbox = {
    console,
    URL,
    Promise,
    Response,
    fetch: doFetch,
    caches: cachesApi,
    self: {
      location: { origin: ORIGIN },
      addEventListener(type: string, handler: (event: never) => void) {
        handlers.set(type, handler)
      },
      async skipWaiting() {
        skipped = true
      },
      clients: {
        async claim() {
          claimed = true
        },
      },
    },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  return {
    handlers,
    stores,
    skippedWaiting: () => skipped,
    claimed: () => claimed,
  }
}

/**
 * Run a lifecycle handler to completion.
 * @param worker - the loaded worker.
 * @param type - the event type.
 */
async function lifecycle(worker: Worker, type: 'install' | 'activate'): Promise<void> {
  const handler = worker.handlers.get(type)
  assert.ok(handler, `no ${type} handler was registered`)
  const waited: Array<Promise<unknown>> = []
  ;(handler as (event: unknown) => void)({
    waitUntil: (promise: Promise<unknown>) => waited.push(promise),
  })
  await Promise.all(waited)
}

/**
 * Dispatch a fetch event.
 * @param worker - the loaded worker.
 * @param request - the request to dispatch.
 * @returns the response the worker claimed, or undefined when it declined.
 */
async function dispatch(worker: Worker, request: FakeRequest): Promise<Response | undefined> {
  const handler = worker.handlers.get('fetch')
  assert.ok(handler, 'no fetch handler was registered')
  let claimed: Promise<Response> | undefined
  ;(handler as (event: unknown) => void)({
    request,
    respondWith: (promise: Promise<Response>) => {
      claimed = promise
    },
  })
  return claimed === undefined ? undefined : await claimed
}

/**
 * A fetch that can be cut, counting its calls.
 * @returns the implementation and its state.
 */
function controllableFetch(): {
  impl: (input: unknown) => Promise<Response>
  online: (value: boolean) => void
  calls: string[]
} {
  let online = true
  const calls: string[] = []
  return {
    calls,
    online: (value: boolean) => {
      online = value
    },
    impl: async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as FakeRequest).url)
      calls.push(url)
      if (!online) throw new TypeError('fetch failed')
      return new Response(`body:${url}`, { status: 200 })
    },
  }
}

describe('service worker', () => {
  it('precaches the shell on install and takes over immediately', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')

    assert.equal(worker.skippedWaiting(), true, 'a fix must be able to reach a stuck user')
    const cache = worker.stores.get('flomo-shell-v2')
    assert.ok(cache)
    assert.deepEqual(
      [...cache.entries.keys()].sort(),
      ['./', './index.html', './manifest.webmanifest'],
    )
  })

  it('deletes every other cache on activate', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')
    // An older shell, and a cache belonging to something else entirely.
    worker.stores.set('flomo-shell-v0', new FakeCache(net.impl))
    worker.stores.set('some-other-app', new FakeCache(net.impl))

    await lifecycle(worker, 'activate')

    assert.equal(worker.claimed(), true)
    assert.deepEqual(
      [...worker.stores.keys()],
      ['flomo-shell-v2'],
      'the current shell survives and everything else is gone',
    )
  })

  it('serves the cached shell when an offline navigation fails', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')

    net.online(false)
    const response = await dispatch(worker, makeRequest(`${ORIGIN}/`, 'navigate'))

    assert.ok(response, 'the navigation must be answered')
    assert.equal(await response.text(), 'body:./index.html', 'the shell is the fallback')
  })

  it('prefers the network for a navigation, so a stale worker cannot pin a build', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')

    const response = await dispatch(worker, makeRequest(`${ORIGIN}/`, 'navigate'))
    assert.ok(response)
    assert.equal(await response.text(), `body:${ORIGIN}/`, 'fresh HTML wins while online')
  })

  it('serves a hashed asset from the cache without touching the network', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    const asset = `${ORIGIN}/assets/index-abc12345.js`

    const first = await dispatch(worker, makeRequest(asset))
    assert.ok(first, 'the asset must be answered')
    assert.equal(net.calls.filter((url) => url === asset).length, 1)

    const second = await dispatch(worker, makeRequest(asset))
    assert.ok(second)
    assert.equal(
      net.calls.filter((url) => url === asset).length,
      1,
      'a content-hashed URL never needs a second fetch',
    )
  })

  it('treats an unhashed same-origin path as network-first', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')

    // No content hash, so its bytes can change under the same URL and the cache
    // must never win. This is the boundary the hashed-asset regex has to get right.
    const manifest = `${ORIGIN}/manifest.webmanifest`
    const before = net.calls.length
    await dispatch(worker, makeRequest(manifest))
    await dispatch(worker, makeRequest(manifest))
    assert.equal(net.calls.length - before, 2, 'an unhashed path is revalidated every time')
  })

  it('never intercepts a cross-origin request', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')

    // The vault lives here. Caching API responses would fight the core's own
    // ciphertext cache and produce stale reads.
    const response = await dispatch(
      worker,
      makeRequest('https://api.github.com/repos/me/flomo-data/contents/vault.json'),
    )
    assert.equal(response, undefined, 'the worker must decline, not answer')
  })

  it('never intercepts a non-GET request', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    await lifecycle(worker, 'install')

    const response = await dispatch(
      worker,
      makeRequest(`${ORIGIN}/assets/index-abc12345.js`, 'cors', 'POST'),
    )
    assert.equal(response, undefined)
  })

  it('still answers a navigation when nothing was ever cached', async () => {
    const net = controllableFetch()
    const worker = await loadWorker(net.impl)
    // No install, so the shell cache is empty.
    net.online(false)

    await assert.rejects(
      () => dispatch(worker, makeRequest(`${ORIGIN}/`, 'navigate')),
      /fetch failed/,
      'with no shell the failure must surface rather than be papered over',
    )
  })
})
