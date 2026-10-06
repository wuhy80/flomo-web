/**
 * The browser-side session: it owns a {@link FlomoVault} and talks to GitHub
 * directly with a fine-grained PAT held in local storage.
 *
 * The PAT is the only long-lived secret in the browser. It is worth being
 * explicit about the blast radius: a stolen token yields *ciphertext only*,
 * because the vault key is derived from the password on demand and is never
 * persisted. That is what makes storing a token in `localStorage` acceptable
 * here, where it would not be for a plaintext note store.
 *
 * @module @flomo/ui/github-session
 */

import {
  FlomoVault,
  GitHubContentsStore,
  describeImportResult,
  parseMemosJson,
  tagStats,
  WrongPasswordError,
} from '@flomo/core'
import type { Memo, TagStat } from '@flomo/core'

import { describeError } from './session.ts'
import type { FlomoSession, SessionSnapshot } from './session.ts'

/** How to reach the data repository. */
export interface GitHubSessionOptions {
  owner: string
  repo: string
  token: string
  branch?: string
  /** Debounce window for auto-save, in milliseconds. */
  autoSaveMs?: number
}

/** Default debounce: long enough to batch a burst of typing, short enough to feel safe. */
export const DEFAULT_AUTOSAVE_MS = 1500

/**
 * A {@link FlomoSession} backed by a git repository.
 */
export class GitHubVaultSession implements FlomoSession {
  private readonly store: GitHubContentsStore
  private readonly autoSaveMs: number
  private readonly listeners = new Set<() => void>()

  private vault: FlomoVault | null = null
  private snapshot: SessionSnapshot = {
    status: 'probing',
    memos: [],
    tags: [],
    error: null,
    saving: false,
    lastSavedAt: null,
    recoveryCode: null,
  }

  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param options - repository coordinates, token and debounce window.
   */
  constructor(options: GitHubSessionOptions) {
    this.store = new GitHubContentsStore({
      token: options.token,
      owner: options.owner,
      repo: options.repo,
      ...(options.branch ? { branch: options.branch } : {}),
    })
    this.autoSaveMs = options.autoSaveMs ?? DEFAULT_AUTOSAVE_MS
  }

  /** @returns the repository slug, for display in the UI. */
  get slug(): string {
    return this.store.slug
  }

  /**
   * Subscribe to snapshot changes.
   * @param listener - called after every state transition.
   * @returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** @returns the current snapshot; stable between changes. */
  getSnapshot(): SessionSnapshot {
    return this.snapshot
  }

  /**
   * Replace part of the snapshot and notify subscribers.
   * @param patch - fields to merge in.
   */
  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /**
   * Rebuild the memo and tag views from the vault.
   * @param patch - additional snapshot fields to set alongside.
   */
  private syncFromVault(patch: Partial<SessionSnapshot> = {}): void {
    const memos: Memo[] = this.vault ? this.vault.all() : []
    const tags: TagStat[] = tagStats(memos)
    this.update({ memos, tags, ...patch })
  }

  /** {@inheritDoc FlomoSession.refresh} */
  async refresh(): Promise<void> {
    this.update({ status: 'probing', error: null })
    try {
      const exists = await FlomoVault.exists(this.store)
      this.vault = null
      this.syncFromVault({
        status: exists ? 'locked' : 'empty',
        error: null,
        lastSavedAt: null,
      })
    } catch (error) {
      this.update({ status: 'error', error: describeError(error) })
    }
  }

  /** {@inheritDoc FlomoSession.create} */
  async create(password: string): Promise<void> {
    this.update({ status: 'unlocking', error: null })
    try {
      const { vault, recoveryCode } = await FlomoVault.create(this.store, password)
      this.vault = vault
      this.syncFromVault({ status: 'unlocked', error: null, recoveryCode })
    } catch (error) {
      this.vault = null
      this.update({ status: 'empty', error: describeError(error) })
    }
  }

  /** {@inheritDoc FlomoSession.unlock} */
  async unlock(password: string): Promise<void> {
    this.update({ status: 'unlocking', error: null })
    try {
      const vault = await FlomoVault.open(this.store, password)
      await vault.loadAll()
      this.vault = vault
      this.syncFromVault({ status: 'unlocked', error: null })
    } catch (error) {
      const message =
        error instanceof WrongPasswordError ? error.message : describeError(error)
      this.update({ status: 'locked', error: message })
    }
  }

  /** {@inheritDoc FlomoSession.unlockWithRecovery} */
  async unlockWithRecovery(code: string): Promise<void> {
    this.update({ status: 'unlocking', error: null })
    try {
      const vault = await FlomoVault.openWithRecovery(this.store, code)
      await vault.loadAll()
      this.vault = vault
      this.syncFromVault({ status: 'unlocked', error: null })
    } catch (error) {
      const message =
        error instanceof WrongPasswordError ? '恢复码与该保险库不匹配。' : describeError(error)
      this.update({ status: 'locked', error: message })
    }
  }

  /** {@inheritDoc FlomoSession.dismissRecovery} */
  dismissRecovery(): void {
    this.update({ recoveryCode: null })
  }

  /**
   * Run a mutation against the vault and re-render.
   * @param mutate - the change to apply.
   * @returns whatever the mutation produced.
   */
  private mutate<T>(mutate: (vault: FlomoVault) => T): T {
    if (!this.vault) throw new Error('保险库尚未解锁。')
    const result = mutate(this.vault)
    this.syncFromVault()
    this.scheduleAutoSave()
    return result
  }

  /** {@inheritDoc FlomoSession.add} */
  add(content: string): Memo {
    return this.mutate((vault) => vault.add(content))
  }

  /** {@inheritDoc FlomoSession.edit} */
  edit(id: string, content: string): void {
    this.mutate((vault) => vault.edit(id, content))
  }

  /** {@inheritDoc FlomoSession.remove} */
  remove(id: string): void {
    this.mutate((vault) => vault.remove(id))
  }

  /** {@inheritDoc FlomoSession.pin} */
  pin(id: string, pinned?: boolean): void {
    this.mutate((vault) => vault.pin(id, pinned))
  }

  /** {@inheritDoc FlomoSession.importJson} */
  async importJson(text: string): Promise<string> {
    if (!this.vault) throw new Error('保险库尚未解锁。')
    const result = parseMemosJson(text)
    const { added, duplicates } = this.vault.merge(result.memos)
    this.syncFromVault()
    this.scheduleAutoSave()
    // Import is the one edit worth persisting eagerly: the user just handed us
    // a file and will expect it to be safe without waiting out the debounce.
    await this.save()
    return describeImportResult(added, duplicates, result)
  }

  /**
   * Arm the debounced auto-save, replacing any pending timer.
   *
   * The write is optimistic: the UI already shows the edit, and a failure
   * surfaces as the error banner while the dirty shard stays pending.
   */
  private scheduleAutoSave(): void {
    if (this.autoSaveTimer !== null) clearTimeout(this.autoSaveTimer)
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null
      void this.save()
    }, this.autoSaveMs)
  }

  /** {@inheritDoc FlomoSession.save} */
  async save(): Promise<void> {
    if (!this.vault || this.vault.dirtyMonths.length === 0) return
    this.update({ saving: true })
    try {
      await this.vault.flush()
      this.update({ saving: false, error: null, lastSavedAt: new Date().toISOString() })
    } catch (error) {
      this.update({ saving: false, error: `保存失败：${describeError(error)}` })
    }
  }

  /** Stop the auto-save timer; call on unmount. */
  dispose(): void {
    if (this.autoSaveTimer !== null) clearTimeout(this.autoSaveTimer)
    this.autoSaveTimer = null
    this.listeners.clear()
  }
}
