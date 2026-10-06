/**
 * The session seam that lets one set of components serve two very different
 * backends.
 *
 * The web app builds a session that talks to GitHub directly from the browser.
 * The DSH panel builds one that talks to its own host half over HTTP, because
 * there the PAT belongs to the host process and must never reach a page. Both
 * satisfy {@link FlomoSession}, so {@link FlomoApp} neither knows nor cares
 * which one it was handed.
 *
 * Snapshots are immutable and cached: `getSnapshot` must return a stable
 * reference between changes or React's `useSyncExternalStore` will spin.
 *
 * @module @flomo/ui/session
 */

import type { Memo, TagStat } from '@flomo/core'

/** Where the session currently is in its lifecycle. */
export type SessionStatus =
  /** Checking the remote for an existing vault. */
  | 'probing'
  /** Reachable, but no repository has been chosen yet. */
  | 'unconfigured'
  /** No vault yet — first run, offer to create one. */
  | 'empty'
  /** A vault exists and is waiting for a password. */
  | 'locked'
  /** Deriving the key. PBKDF2 at 600k iterations is deliberately slow. */
  | 'unlocking'
  /** Open and usable. */
  | 'unlocked'
  /** The remote is unreachable or misconfigured. */
  | 'error'

/** An immutable view of everything the UI renders from. */
export interface SessionSnapshot {
  status: SessionStatus
  memos: readonly Memo[]
  tags: readonly TagStat[]
  /** User-facing failure text, already localized. */
  error: string | null
  /** True while a save is in flight. */
  saving: boolean
  /** ISO timestamp of the last successful save. */
  lastSavedAt: string | null
  /**
   * The recovery code, present only in the window between creating a vault and
   * the user acknowledging it. It is never persisted anywhere.
   */
  recoveryCode: string | null
}

/** The contract {@link FlomoApp} drives. */
export interface FlomoSession {
  subscribe(listener: () => void): () => void
  getSnapshot(): SessionSnapshot

  /** Create a new vault and return its recovery code via the snapshot. */
  create(password: string): Promise<void>
  /** Open the existing vault with a password. */
  unlock(password: string): Promise<void>
  /** Open the existing vault with the recovery code. */
  unlockWithRecovery(code: string): Promise<void>
  /** Clear the just-created recovery code after the user has stored it. */
  dismissRecovery(): void
  /** Re-probe the remote, e.g. after fixing credentials. */
  refresh(): Promise<void>

  /**
   * Record a memo.
   *
   * Returns `void` rather than the memo so that a session backed by an async
   * round trip (the DSH panel's) satisfies the same contract as the in-process
   * one. Consumers read the new memo back through the snapshot.
   */
  add(content: string): void
  /** Replace a memo's body. */
  edit(id: string, content: string): void
  /** Delete a memo. */
  remove(id: string): void
  /** Toggle or set a memo's pinned flag. */
  pin(id: string, pinned?: boolean): void

  /**
   * Merge an exported document into the vault.
   *
   * Additive: memos whose id already exists are left alone, so importing a
   * backup over a live vault can never silently roll back newer edits.
   * @param text - the contents of an exported JSON file.
   * @returns a human-readable summary of what happened.
   */
  importJson(text: string): Promise<string>

  /** Push pending changes now, bypassing the auto-save debounce. */
  save(): Promise<void>
}

/**
 * Turn an unknown thrown value into user-facing Chinese text.
 *
 * React error boundaries and `fetch` rejections hand back all sorts of shapes,
 * and the UI should never render `[object Object]`.
 * @param error - whatever was thrown.
 * @returns a readable message.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TypeError' && /fetch/i.test(error.message)) {
      return '网络请求失败，请检查网络连接后重试。'
    }
    return error.message
  }
  if (typeof error === 'string') return error
  return '发生了未知错误。'
}
