/**
 * Tests for the read-through ciphertext cache.
 *
 * The interesting failures are all about what happens when the network is gone:
 * whether a read degrades, whether a *write* refuses to pretend, and whether a
 * successful 404 evicts rather than leaving a tombstone behind.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MemoryStore } from '@flomo/core/testing'
import { CachingTextStore, MemoryCacheArea } from '../src/cache.ts'
import type { CacheArea } from '../src/cache.ts'
import type { GitHubDirEntry } from '../src/github.ts'
import type { TextStore } from '../src/vault.ts'

/** A store whose network can be cut, without losing what it already holds. */
class FlakyStore implements TextStore {
  private readonly inner: MemoryStore
  offline = false

  /**
   * @param inner - the store that holds the data.
   */
  constructor(inner: MemoryStore) {
    this.inner = inner
  }

  /**
   * Simulate the network being unreachable.
   */
  private gate(): void {
    if (this.offline) throw new Error('network down')
  }

  /**
   * @param path - repository path.
   * @returns the file.
   */
  async readText(path: string): Promise<{ text: string; sha: string } | null> {
    this.gate()
    return this.inner.readText(path)
  }

  /**
   * @param path - repository path.
   * @param text - contents.
   * @param options - expected sha and message.
   * @returns the new sha.
   */
  async writeText(
    path: string,
    text: string,
    options: { sha?: string; message: string },
  ): Promise<string> {
    this.gate()
    return this.inner.writeText(path, text, options)
  }

  /**
   * @param dir - directory path.
   * @returns the entries.
   */
  async listDir(dir: string): Promise<GitHubDirEntry[]> {
    this.gate()
    return this.inner.listDir(dir)
  }

  /**
   * Delete a file, standing in for someone removing it upstream.
   * @param path - repository path.
   */
  remove(path: string): void {
    this.inner.remove(path)
  }
}

/** A cache area that refuses to store anything, like a full quota. */
class FullCacheArea implements CacheArea {
  getItem(): string | null {
    return null
  }
  setItem(): void {
    throw new Error('QuotaExceededError')
  }
  removeItem(): void {}
  keys(): readonly string[] {
    return []
  }
}

/**
 * Build a caching store over a fresh flaky backend.
 * @param options - the prefix and cache area to use.
 * @returns the caching store, the backend, and the area.
 */
function makeSubject(options: { prefix?: string; area?: CacheArea } = {}): {
  store: CachingTextStore
  backend: FlakyStore
  area: CacheArea
} {
  const area = options.area ?? new MemoryCacheArea()
  const backend = new FlakyStore(new MemoryStore())
  const store = new CachingTextStore({
    inner: backend,
    area,
    prefix: options.prefix ?? 'ns',
  })
  return { store, backend, area }
}

describe('caching store', () => {
  it('serves a read from the cache once the network is gone', async () => {
    const { store, backend } = makeSubject()

    await store.writeText('data/2026-01.json', 'CIPHERTEXT', { message: 'seed' })
    assert.equal((await store.readText('data/2026-01.json'))?.text, 'CIPHERTEXT')

    backend.offline = true
    const cached = await store.readText('data/2026-01.json')
    assert.equal(cached?.text, 'CIPHERTEXT', 'the cached ciphertext is still readable')
    assert.equal(store.isOffline, true)
  })

  it('caches what it read, not just what it wrote', async () => {
    const area = new MemoryCacheArea()
    const backend = new FlakyStore(new MemoryStore())
    // Seeded straight into the backend, so the cache has never seen this file.
    await backend.writeText('remote.json', 'REMOTE', { message: 'seed' })

    const store = new CachingTextStore({ inner: backend, area, prefix: 'ns' })
    assert.equal((await store.readText('remote.json'))?.text, 'REMOTE')

    backend.offline = true
    assert.equal(
      (await store.readText('remote.json'))?.text,
      'REMOTE',
      'the online read is what populated the cache',
    )
  })

  it('keeps the cached sha so an offline reader still sees the blob version', async () => {
    const { store, backend } = makeSubject()
    const sha = await store.writeText('a.json', 'ONE', { message: 'seed' })
    backend.offline = true
    assert.equal((await store.readText('a.json'))?.sha, sha)
  })

  it('evicts on a successful miss rather than leaving a tombstone', async () => {
    const { store, backend } = makeSubject()
    await store.writeText('a.json', 'GONE SOON', { message: 'seed' })
    assert.equal((await store.readText('a.json'))?.text, 'GONE SOON')

    // Deleted upstream while online: the 404 is the truth and must clear the cache.
    backend.remove('a.json')
    assert.equal(await store.readText('a.json'), null)

    backend.offline = true
    await assert.rejects(() => store.readText('a.json'), /network down/)
  })

  it('never pretends a failed write succeeded', async () => {
    const { store, backend } = makeSubject()
    await store.writeText('a.json', 'OLD', { message: 'seed' })

    backend.offline = true
    await assert.rejects(() => store.writeText('a.json', 'NEW', { message: 'edit' }))

    // And the cache still holds the last thing the repository actually accepted.
    assert.equal((await store.readText('a.json'))?.text, 'OLD')
  })

  it('updates the cache on a successful write', async () => {
    const { store, backend } = makeSubject()
    const first = await store.writeText('a.json', 'OLD', { message: 'seed' })
    const second = await store.writeText('a.json', 'NEW', {
      sha: first,
      message: 'edit',
    })
    backend.offline = true
    const cached = await store.readText('a.json')
    assert.equal(cached?.text, 'NEW')
    assert.equal(cached?.sha, second)
  })

  it('caches directory listings too', async () => {
    const { store, backend } = makeSubject()
    await store.writeText('data/2026-01.json', 'X', { message: 'seed' })
    const online = await store.listDir('data')
    assert.equal(online.length, 1)

    backend.offline = true
    const offline = await store.listDir('data')
    assert.deepEqual(
      offline.map((entry) => entry.name),
      ['2026-01.json'],
    )
  })

  it('reports the mode change once, in both directions', async () => {
    const area = new MemoryCacheArea()
    const backend = new FlakyStore(new MemoryStore())
    const modes: boolean[] = []
    const store = new CachingTextStore({
      inner: backend,
      area,
      prefix: 'ns',
      onMode: (offline) => modes.push(offline),
    })

    await store.writeText('a.json', 'X', { message: 'seed' })
    backend.offline = true
    await store.readText('a.json')
    await store.readText('a.json')
    backend.offline = false
    await store.readText('a.json')

    assert.deepEqual(modes, [true, false], 'no duplicate notifications')
  })

  it('treats a corrupt cache entry as a miss', async () => {
    const area = new MemoryCacheArea()
    const { store, backend } = makeSubject({ area })
    await store.writeText('a.json', 'X', { message: 'seed' })
    backend.offline = true

    area.setItem('ns:file:a.json', 'not json at all')
    await assert.rejects(() => store.readText('a.json'), /network down/)
  })

  it('degrades to no cache when storage refuses writes', async () => {
    const { store } = makeSubject({ area: new FullCacheArea() })
    // The online path must be unaffected by a storage failure.
    await store.writeText('a.json', 'X', { message: 'seed' })
    assert.equal((await store.readText('a.json'))?.text, 'X')
  })

  it('clears only its own namespace', async () => {
    const area = new MemoryCacheArea()
    const a = makeSubject({ area, prefix: 'repo-a' })
    const b = makeSubject({ area, prefix: 'repo-b' })

    await a.store.writeText('x.json', 'A', { message: 'seed' })
    await b.store.writeText('x.json', 'B', { message: 'seed' })

    a.store.clear()

    a.backend.offline = true
    b.backend.offline = true
    await assert.rejects(() => a.store.readText('x.json'), /network down/)
    assert.equal((await b.store.readText('x.json'))?.text, 'B', 'the other vault is untouched')
  })
})
