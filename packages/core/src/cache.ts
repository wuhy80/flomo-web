/**
 * A read-through cache in front of a {@link TextStore}.
 *
 * This is what makes the app usable offline, and the shape of the solution is
 * dictated by the security model rather than by convenience: what gets cached is
 * the **ciphertext**, never the memos. A cached shard is exactly as unreadable as
 * the copy sitting in the Git repository, so keeping it in `localStorage` costs
 * nothing in secrecy — whereas caching decrypted notes would quietly undo the
 * whole point of the design.
 *
 * Writes are not queued. A write that cannot reach the network is reported as a
 * failure, because pretending to have saved something the user cannot see in
 * their repository is the one failure mode worse than an error message.
 *
 * @module @flomo/core/cache
 */

import type { GitHubDirEntry } from './github.ts'
import type { TextStore } from './vault.ts'

/**
 * The key/value area the cache lives in.
 *
 * Deliberately narrower than the DOM's `Storage`, so the core stays free of
 * browser types and a test can supply a `Map`.
 */
export interface CacheArea {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** Every key currently held, so one namespace can be cleared wholesale. */
  keys(): readonly string[]
}

/** A `CacheArea` backed by a Map, for tests and for runtimes without storage. */
export class MemoryCacheArea implements CacheArea {
  private readonly entries = new Map<string, string>()

  /**
   * @param key - the cache key.
   * @returns the stored value, or `null`.
   */
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  /**
   * @param key - the cache key.
   * @param value - the value to store.
   */
  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }

  /**
   * @param key - the cache key.
   */
  removeItem(key: string): void {
    this.entries.delete(key)
  }

  /** @returns every key held. */
  keys(): readonly string[] {
    return [...this.entries.keys()]
  }

  /** @returns how many entries are held. */
  get size(): number {
    return this.entries.size
  }
}

/** How to build a caching store. */
export interface CachingStoreOptions {
  /** The store that actually talks to the network. */
  inner: TextStore
  /** Where cached ciphertext lives. */
  area: CacheArea
  /**
   * Namespace for every key.
   *
   * Keyed per repository, so switching to a different vault never surfaces the
   * previous one's blobs. Ciphertext is safe to mix — a wrong-vault shard simply
   * fails to authenticate — but a shared namespace would turn a clean "no cache"
   * into a confusing decryption error.
   */
  prefix: string
  /** Called when the store enters or leaves offline mode. */
  onMode?: (offline: boolean) => void
}

/** A file as cached: the same shape the store returns. */
interface CachedFile {
  text: string
  sha: string
}

/**
 * A {@link TextStore} that keeps a copy of everything it reads.
 *
 * Reads are network-first: the cache is a fallback, never the primary source, so
 * a device that is online always sees the current repository state. Only a
 * network *failure* falls back — a successful 404 is the truth and evicts.
 */
export class CachingTextStore implements TextStore {
  private readonly inner: TextStore
  private readonly area: CacheArea
  private readonly prefix: string
  private readonly onMode: ((offline: boolean) => void) | undefined
  private offline = false

  /**
   * @param options - the inner store, the cache area, and the key namespace.
   */
  constructor(options: CachingStoreOptions) {
    this.inner = options.inner
    this.area = options.area
    this.prefix = options.prefix
    this.onMode = options.onMode
  }

  /** @returns whether the last read had to be served from the cache. */
  get isOffline(): boolean {
    return this.offline
  }

  /**
   * Record the online/offline transition, notifying only on a change.
   * @param next - the new mode.
   */
  private setOffline(next: boolean): void {
    if (this.offline === next) return
    this.offline = next
    this.onMode?.(next)
  }

  /**
   * Build the file key for a path.
   * @param path - the repository path.
   * @returns the cache key.
   */
  private fileKey(path: string): string {
    return `${this.prefix}:file:${path}`
  }

  /**
   * Build the listing key for a directory.
   * @param dir - the repository directory.
   * @returns the cache key.
   */
  private dirKey(dir: string): string {
    return `${this.prefix}:dir:${dir}`
  }

  /**
   * Store a value, tolerating a full or unavailable storage area.
   *
   * A quota error must degrade to "no cache", never to a failed read: the fetch
   * already succeeded, and throwing here would turn a working online session
   * into a broken one.
   * @param key - the cache key.
   * @param value - the serialized value.
   */
  private remember(key: string, value: string): void {
    try {
      this.area.setItem(key, value)
    } catch {
      // Best effort by design.
    }
  }

  /**
   * Forget a key, tolerating a storage failure.
   * @param key - the cache key.
   */
  private forget(key: string): void {
    try {
      this.area.removeItem(key)
    } catch {
      // Best effort by design.
    }
  }

  /**
   * Read a value, or `null` when absent or unreadable.
   * @param key - the cache key.
   * @returns the parsed value.
   */
  private recall<T>(key: string): T | null {
    try {
      const raw = this.area.getItem(key)
      return raw === null ? null : (JSON.parse(raw) as T)
    } catch {
      // A corrupt entry is treated as a miss rather than as a hard failure.
      return null
    }
  }

  /** {@inheritDoc TextStore.readText} */
  async readText(path: string): Promise<CachedFile | null> {
    try {
      const file = await this.inner.readText(path)
      if (file === null) this.forget(this.fileKey(path))
      else this.remember(this.fileKey(path), JSON.stringify(file))
      this.setOffline(false)
      return file
    } catch (error) {
      const cached = this.recall<CachedFile>(this.fileKey(path))
      if (cached === null) throw error
      this.setOffline(true)
      return cached
    }
  }

  /** {@inheritDoc TextStore.writeText} */
  async writeText(
    path: string,
    text: string,
    options: { sha?: string; message: string },
  ): Promise<string> {
    // Deliberately not caught: an unsaved write must surface, and the cache is
    // only updated once the repository actually holds the new content.
    const sha = await this.inner.writeText(path, text, options)
    this.remember(this.fileKey(path), JSON.stringify({ text, sha }))
    this.setOffline(false)
    return sha
  }

  /**
   * Media passes straight through, never cached: the ciphertext of a photo is
   * far past what `localStorage` can hold, and an `CachingTextStore` that
   * silently dropped images to satisfy a quota would be worse than one that
   * simply does not pretend to serve them offline.
   */
  async readBlob(path: string): Promise<{ bytes: Uint8Array; sha: string } | null> {
    if (this.inner.readBlob === undefined) return null
    return this.inner.readBlob(path)
  }

  async writeBlob(
    path: string,
    bytes: Uint8Array,
    options: { sha?: string; message: string },
  ): Promise<string> {
    if (this.inner.writeBlob === undefined) {
      throw new Error('该存储不支持二进制文件。')
    }
    return this.inner.writeBlob(path, bytes, options)
  }

  /** {@inheritDoc TextStore.listDir} */
  async listDir(dir: string): Promise<GitHubDirEntry[]> {
    try {
      const entries = await this.inner.listDir(dir)
      this.remember(this.dirKey(dir), JSON.stringify(entries))
      this.setOffline(false)
      return entries
    } catch (error) {
      const cached = this.recall<GitHubDirEntry[]>(this.dirKey(dir))
      if (cached === null) throw error
      this.setOffline(true)
      return cached
    }
  }

  /**
   * Drop every entry belonging to this store's namespace.
   *
   * Called when the user disconnects a device: cached ciphertext is harmless,
   * but leaving it behind would be surprising for an action described as
   * clearing local credentials.
   */
  clear(): void {
    let keys: readonly string[]
    try {
      keys = this.area.keys()
    } catch {
      return
    }
    const own = `${this.prefix}:`
    for (const key of keys) if (key.startsWith(own)) this.forget(key)
  }
}
