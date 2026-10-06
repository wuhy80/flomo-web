/**
 * The vault: password-derived key, monthly shards, and the memo operations the
 * UI and the DSH plugin both drive.
 *
 * Layout inside the (private) repository:
 *
 * ```
 * vault.json          KDF params + a sealed known plaintext — safe to publish
 * data/2025-06.json   one month of memos, sealed under the vault key
 * data/2025-07.json
 * ```
 *
 * `vault.json` holds no secrets. The salt and iteration count are public by
 * design, and the `check` field is a known string sealed under the key, which
 * is how a wrong password is reported as such without there being any password
 * hash to attack.
 *
 * There is deliberately no index file listing the shards: the month list comes
 * from a directory listing, so two devices writing different months never fight
 * over a shared mutable file.
 *
 * @module @flomo/core/vault
 */

import {
  DecryptError,
  createVault,
  deriveRawKey,
  importVaultKey,
  isKdfParams,
  isSealed,
  rawKeyFromRecoveryCode,
  open as openSealed,
  seal,
  CHECK_PLAINTEXT,
} from './crypto.ts'
import type { GitHubDirEntry } from './github.ts'
import { monthOf } from './time.ts'
import { parseTags } from './tags.ts'
import type { Memo, Shard, ShardIndex, VaultHeader } from './types.ts'

/** Default directory holding the monthly shards. */
export const DATA_DIR = 'data'

/** Filename of the vault header. */
export const HEADER_FILE = 'vault.json'

/**
 * The storage surface the vault needs. {@link GitHubContentsStore} satisfies it;
 * tests use an in-memory implementation.
 */
export interface TextStore {
  readText(path: string): Promise<{ text: string; sha: string } | null>
  writeText(
    path: string,
    text: string,
    options: { sha?: string; message: string },
  ): Promise<string>
  listDir(dir: string): Promise<GitHubDirEntry[]>
}

/** Raised when a vault already exists where one was about to be created. */
export class VaultExistsError extends Error {
  override readonly name: string = 'VaultExistsError'
}

/** Raised when `vault.json` is missing or malformed. */
export class VaultHeaderError extends Error {
  override readonly name: string = 'VaultHeaderError'
}

/** Raised by {@link FlomoVault.open} when the password does not authenticate. */
export class WrongPasswordError extends Error {
  override readonly name: string = 'WrongPasswordError'

  constructor() {
    super('密码不正确。')
  }
}

/**
 * Parse and validate a `vault.json` payload.
 * @param text - the raw file text.
 * @returns the validated header.
 * @throws {VaultHeaderError} when the shape is wrong.
 */
function parseHeader(text: string): VaultHeader {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new VaultHeaderError('vault.json 不是合法 JSON。')
  }
  const candidate = parsed as Partial<VaultHeader>
  if (candidate.v !== 1 || !isKdfParams(candidate.kdf) || !isSealed(candidate.check)) {
    throw new VaultHeaderError('vault.json 结构无法识别，可能来自不兼容的版本。')
  }
  return {
    v: 1,
    kdf: candidate.kdf,
    check: candidate.check,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
  }
}

/**
 * Parse and validate a shard payload.
 * @param text - the raw file text.
 * @param month - the month the filename implies.
 * @returns the validated shard.
 */
function parseShard(text: string, month: string): Shard {
  const parsed = JSON.parse(text) as Partial<Shard>
  if (parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') {
    throw new VaultHeaderError(`分片 ${month}.json 结构无法识别。`)
  }
  return {
    v: 1,
    month,
    iv: parsed.iv,
    ct: parsed.ct,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
  }
}

/** Result of creating a vault: the instance plus the one-time recovery code. */
export interface CreatedVault {
  vault: FlomoVault
  /** Base64 of the raw key. Show once; it is the only password-loss escape hatch. */
  recoveryCode: string
}

/** An unlocked vault bound to one repository. */
export class FlomoVault {
  private readonly store: TextStore
  private readonly header: VaultHeader
  private readonly key: CryptoKey
  private readonly memos = new Map<string, Memo>()
  private readonly shardShas = new Map<string, string>()
  private readonly dirty = new Set<string>()
  /** Serializes writes so two saves can never interleave their round trips. */
  private writeChain: Promise<void> = Promise.resolve()

  private constructor(store: TextStore, header: VaultHeader, key: CryptoKey) {
    this.store = store
    this.header = header
    this.key = key
  }

  /**
   * Create a brand-new vault in an empty repository.
   * @param store - the backing repository.
   * @param password - the chosen password.
   * @param iterations - PBKDF2 work factor; override only for tests.
   * @returns the vault and its recovery code.
   * @throws {VaultExistsError} when `vault.json` is already there.
   */
  static async create(
    store: TextStore,
    password: string,
    iterations?: number,
  ): Promise<CreatedVault> {
    if (await store.readText(HEADER_FILE)) {
      throw new VaultExistsError('该仓库已存在 vault.json，请改用「打开已有保险库」。')
    }
    const minted = await createVault(password, iterations)
    const header: VaultHeader = {
      v: 1,
      kdf: minted.params,
      check: minted.check,
      createdAt: new Date().toISOString(),
    }
    await store.writeText(HEADER_FILE, `${JSON.stringify(header, null, 2)}\n`, {
      message: 'flomo: create vault',
    })
    return {
      vault: new FlomoVault(store, header, minted.key),
      recoveryCode: minted.recoveryCode,
    }
  }

  /**
   * Derive the key and prove it against the header's check value.
   * @param store - the backing repository.
   * @param rawKey - the derived (or recovered) raw key bytes.
   * @param header - the parsed header.
   * @returns an unlocked vault.
   * @throws {WrongPasswordError} when the check value does not authenticate.
   */
  private static async finishOpen(
    store: TextStore,
    rawKey: Uint8Array,
    header: VaultHeader,
  ): Promise<FlomoVault> {
    const key = await importVaultKey(rawKey)
    try {
      const probe = await openSealed(key, header.check)
      if (probe !== CHECK_PLAINTEXT) throw new DecryptError()
    } catch {
      throw new WrongPasswordError()
    }
    return new FlomoVault(store, header, key)
  }

  /**
   * Read the header and unlock with a password.
   * @param store - the backing repository.
   * @param password - the user's password.
   * @returns an unlocked vault.
   * @throws {VaultHeaderError} when the repository holds no usable vault.
   * @throws {WrongPasswordError} when the password is wrong.
   */
  static async open(store: TextStore, password: string): Promise<FlomoVault> {
    const file = await store.readText(HEADER_FILE)
    if (!file) throw new VaultHeaderError('仓库里没有 vault.json。')
    const header = parseHeader(file.text)
    const raw = await deriveRawKey(password, header.kdf)
    return FlomoVault.finishOpen(store, raw, header)
  }

  /**
   * Unlock with the recovery code instead of the password.
   * @param store - the backing repository.
   * @param recoveryCode - base64 of the raw 32-byte key.
   * @returns an unlocked vault.
   * @throws {WrongPasswordError} when the code does not match this vault.
   */
  static async openWithRecovery(
    store: TextStore,
    recoveryCode: string,
  ): Promise<FlomoVault> {
    const file = await store.readText(HEADER_FILE)
    if (!file) throw new VaultHeaderError('仓库里没有 vault.json。')
    const header = parseHeader(file.text)
    return FlomoVault.finishOpen(store, rawKeyFromRecoveryCode(recoveryCode), header)
  }

  /**
   * Check whether a repository already holds a vault.
   * @param store - the backing repository.
   * @returns true when `vault.json` exists.
   */
  static async exists(store: TextStore): Promise<boolean> {
    return (await store.readText(HEADER_FILE)) !== null
  }

  /** @returns the public header, safe to display in a settings panel. */
  get publicHeader(): VaultHeader {
    return this.header
  }

  /** @returns the shard directory name. */
  get dataDir(): string {
    return DATA_DIR
  }

  /**
   * Decrypt every shard in the repository into memory.
   *
   * Personal note volumes are small enough that loading everything up front is
   * simpler and faster than a lazy per-month scheme, and it makes global search
   * and tag aggregation trivially correct.
   * @returns how many memos were loaded.
   */
  async loadAll(): Promise<number> {
    const entries = await this.store.listDir(DATA_DIR)
    this.memos.clear()
    this.shardShas.clear()

    const shardFiles = entries
      .filter((entry) => /^\d{4}-\d{2}\.json$/.test(entry.name))
      .sort((a, b) => (a.name < b.name ? 1 : -1))

    for (const entry of shardFiles) {
      const month = entry.name.replace(/\.json$/, '')
      const file = await this.store.readText(entry.path)
      if (!file) continue
      const shard = parseShard(file.text, month)
      const plain = await openSealed(this.key, { iv: shard.iv, ct: shard.ct })
      const parsed = JSON.parse(plain) as Memo[]
      for (const memo of parsed) this.memos.set(memo.id, memo)
      this.shardShas.set(month, file.sha)
    }
    this.dirty.clear()
    return this.memos.size
  }

  /**
   * All memos, newest first, with pinned notes hoisted to the top.
   * @returns a fresh sorted array.
   */
  all(): Memo[] {
    return [...this.memos.values()].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return a.createdAt < b.createdAt ? 1 : -1
    })
  }

  /**
   * Mints a memo id. Kept as a method so tests can stub it.
   * @returns a v4 UUID.
   */
  private newId(): string {
    return crypto.randomUUID()
  }

  /**
   * Record a new memo.
   * @param content - the raw body, tags included.
   * @returns the stored memo.
   */
  add(content: string): Memo {
    const now = new Date().toISOString()
    const memo: Memo = {
      id: this.newId(),
      content,
      createdAt: now,
      updatedAt: now,
      tags: parseTags(content),
    }
    this.memos.set(memo.id, memo)
    this.dirty.add(monthOf(now))
    return memo
  }

  /**
   * Replace a memo's body, re-parsing its tags.
   * @param id - the memo to edit.
   * @param content - the new body.
   * @returns the updated memo.
   * @throws when the id is unknown.
   */
  edit(id: string, content: string): Memo {
    const existing = this.memos.get(id)
    if (!existing) throw new Error(`找不到 memo：${id}`)
    const updated: Memo = {
      ...existing,
      content,
      tags: parseTags(content),
      updatedAt: new Date().toISOString(),
    }
    this.memos.set(id, updated)
    this.dirty.add(monthOf(existing.createdAt))
    return updated
  }

  /**
   * Toggle or set a memo's pinned flag.
   * @param id - the memo to change.
   * @param pinned - the new value; omitted toggles.
   * @returns the updated memo.
   */
  pin(id: string, pinned?: boolean): Memo {
    const existing = this.memos.get(id)
    if (!existing) throw new Error(`找不到 memo：${id}`)
    const updated: Memo = { ...existing, pinned: pinned ?? !existing.pinned }
    if (!updated.pinned) delete updated.pinned
    this.memos.set(id, updated)
    this.dirty.add(monthOf(existing.createdAt))
    return updated
  }

  /**
   * Delete a memo.
   * @param id - the memo to remove.
   * @returns true when something was removed.
   */
  remove(id: string): boolean {
    const existing = this.memos.get(id)
    if (!existing) return false
    this.memos.delete(id)
    this.dirty.add(monthOf(existing.createdAt))
    return true
  }

  /** @returns the shard months with unsaved changes. */
  get dirtyMonths(): string[] {
    return [...this.dirty].sort()
  }

  /**
   * Seal and push every dirty shard.
   *
   * Writes are chained so overlapping calls cannot interleave. The dirty set is
   * snapshotted up front and cleared only after a shard lands, so a failure
   * leaves the unsaved work pending rather than silently dropping it.
   * @returns the months that were written.
   */
  async flush(): Promise<string[]> {
    if (this.dirty.size === 0) return []

    const run = async (): Promise<string[]> => {
      // Recomputed inside the chained run, so a flush queued behind another
      // one writes only what is still pending rather than re-writing what the
      // previous run already landed.
      const months = this.dirtyMonths
      const written: string[] = []
      for (const month of months) {
        const inMonth = [...this.memos.values()].filter(
          (memo) => monthOf(memo.createdAt) === month,
        )
        inMonth.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        const plain = JSON.stringify(inMonth)
        const body = await seal(this.key, plain)
        const shard: Shard = {
          v: 1,
          month,
          iv: body.iv,
          ct: body.ct,
          updatedAt: new Date().toISOString(),
        }
        const sha = await this.store.writeText(
          `${DATA_DIR}/${month}.json`,
          `${JSON.stringify(shard)}\n`,
          {
            sha: this.shardShas.get(month),
            message: `flomo: update ${month}`,
          },
        )
        this.shardShas.set(month, sha)
        this.dirty.delete(month)
        written.push(month)
      }
      return written
    }

    const result = this.writeChain.then(run, run)
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /**
   * List the shard months that exist remotely, without downloading them.
   * @returns month keys and their blob shas.
   */
  async remoteIndex(): Promise<ShardIndex> {
    const entries = await this.store.listDir(DATA_DIR)
    const index: ShardIndex = new Map()
    for (const entry of entries) {
      const match = /^(\d{4}-\d{2})\.json$/.exec(entry.name)
      if (match?.[1]) index.set(match[1], { month: match[1], sha: entry.sha })
    }
    return index
  }
}
