/**
 * The memo data model and the vault document shapes that get persisted.
 *
 * @module @flomo/core/types
 */

import type { KdfParams, Sealed } from './crypto.ts'

/** A single note, the unit flomo calls a MEMO. */
export interface Memo {
  /** Stable unique id, minted client-side. */
  id: string
  /** Raw markdown-ish body, tags included inline exactly as typed. */
  content: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** ISO-8601 last-edit timestamp. */
  updatedAt: string
  /** Tags extracted from `content`, cached so listings need no re-parse. */
  tags: string[]
  /** Pinned memos sort to the top of the feed. */
  pinned?: boolean
  /**
   * Attached images as media refs (`YYYY-MM-DD/name`), in attachment order.
   * The bytes live encrypted under `media/<day>/<name>`; the ref is the path
   * fragment both systems agree on.
   */
  images?: string[]
}

/** Everything the browser needs to open a vault, minus the secret itself. */
export interface VaultHeader {
  /** Format version, for forward migration. */
  v: 1
  /** KDF parameters shared by every shard in this vault. */
  kdf: KdfParams
  /** A known plaintext sealed under the key, used to verify the password. */
  check: Sealed
  /** ISO-8601 creation timestamp. */
  createdAt: string
}

/**
 * One month of memos, sealed as a single blob.
 *
 * Sharding by month keeps each write small, keeps git diffs readable, and
 * sidesteps the GitHub Contents API's practical size ceiling on large files.
 */
export interface Shard {
  /** Format version. */
  v: 1
  /** `YYYY-MM`, matching the filename. */
  month: string
  /** IV and ciphertext of the memo array. */
  iv: string
  ct: string
  /** ISO-8601 timestamp of the last write to this shard. */
  updatedAt: string
}

/** A task's priority. P1 is the hottest; absent means the task carries none. */
export type TodoPriority = 'P1' | 'P2' | 'P3'

/**
 * One entry of the standalone TODO list — a task that may carry subtasks.
 *
 * Todos deliberately share nothing with {@link Memo}: no tags, no shards, no
 * feed. They live in their own encrypted document so the checklist stays a
 * checklist, and completion is carried by `completedAt` rather than a boolean —
 * the field's presence *is* the done state, the same trick `pinned` uses.
 *
 * A task is a tree node: `children` nests subtasks to any depth, each with the
 * same shape. The detail fields are all optional so a checklist raised on the
 * older flat format reads back without any migration — a bare id/content/createdAt
 * entry is still a complete task.
 */
export interface Todo {
  /** Stable unique id, minted client-side. */
  id: string
  /** The task title, plain — no tag or link syntax is parsed out of it. */
  content: string
  /** The task description, markdown rendered like a memo body. */
  notes?: string
  /** How hot the task is; absent when the user has not ranked it. */
  priority?: TodoPriority
  /** The desired end date, `YYYY-MM-DD`. */
  due?: string
  /** Subtasks, in display order; a task with none omits the field. */
  children?: Todo[]
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** ISO-8601 completion timestamp; absent while the task is open. */
  completedAt?: string
}

/**
 * The fields an edit may rewrite. Identity and timestamps are not editable;
 * `undefined` leaves a field untouched, `null` clears it — a patch that only
 * ever set values could never un-set a description or a date.
 */
export type TodoPatch = {
  content?: string
  notes?: string | null
  priority?: TodoPriority | null
  due?: string | null
}

/** A memo plus the bookkeeping needed to know which shard owns it. */
export interface ShardRef {
  month: string
  sha: string
}

/** Result of a repository scan: which months exist and their blob shas. */
export type ShardIndex = Map<string, ShardRef>
