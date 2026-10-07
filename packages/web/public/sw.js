/**
 * flomo-sim service worker: the app shell, offline.
 *
 * The data layer already reads from a local cache of the ciphertext, but that
 * only helps if the page itself loads — so without this, "offline support" means
 * nothing. This is the other half.
 *
 * The strategy is deliberately conservative, because a bad service worker is
 * sticky and its failure mode is an app that looks broken:
 *
 * - **Navigations are network-first.** An online visitor always gets fresh HTML,
 *   so a stale worker can never pin someone to an old build. The cache is only
 *   reached when the network fails.
 * - **Hashed assets are cache-first.** Vite content-hashes their filenames, so a
 *   given URL's bytes never change; there is nothing to go stale.
 * - **Cross-origin requests are never touched.** The vault lives behind
 *   `api.github.com`, and caching API responses here would fight the core's own
 *   cache and produce confusing stale reads. Those requests go straight to the
 *   network, un-intercepted.
 * - **Non-GET is never touched.**
 *
 * This file is copied verbatim from `public/`, so it cannot carry a build hash.
 * Bump CACHE_NAME when the strategy changes; `activate` deletes every other
 * cache, which is also the escape hatch if a bad shell ever gets cached.
 */

/** Bump this when the caching strategy changes, not on every build. */
const CACHE_NAME = 'flomo-shell-v2'

/**
 * Fetched at install so a cold offline start has something to serve.
 *
 * The icons are deliberately absent: they are read by the platform when the app
 * is installed, not by the page, and the browser caches them itself. Precaching
 * them would slow every install to no benefit.
 */
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // Best effort: a missing manifest must not fail the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
      // Take over immediately rather than waiting for every tab to close, so a
      // fix can actually reach a user who is stuck.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/**
 * Whether this request belongs to the app shell at all.
 * @param {Request} request - the request.
 * @param {URL} url - its parsed URL.
 * @returns {boolean} true when the worker may handle it.
 */
function owns(request, url) {
  if (request.method !== 'GET') return false
  if (url.origin !== self.location.origin) return false
  return true
}

/**
 * Whether a URL names a content-hashed build asset.
 * @param {URL} url - the parsed URL.
 * @returns {boolean} true when the bytes at this URL can never change.
 */
function isHashedAsset(url) {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\./.test(url.pathname)
}

/**
 * Try the network, fall back to the cache, then to the shell.
 * @param {Request} request - the request.
 * @returns {Promise<Response>} the response.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    const shell =
      (await cache.match('./index.html')) ?? (await cache.match('./')) ?? null
    if (shell !== null) return shell
    throw error
  }
}

/**
 * Serve from the cache when possible, filling it from the network otherwise.
 * @param {Request} request - the request.
 * @returns {Promise<Response>} the response.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached !== undefined) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!owns(event.request, url)) return

  const navigate = event.request.mode === 'navigate'
  event.respondWith(navigate || !isHashedAsset(url) ? networkFirst(event.request) : cacheFirst(event.request))
})
