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

/** A memo plus the bookkeeping needed to know which shard owns it. */
export interface ShardRef {
  month: string
  sha: string
}

/** Result of a repository scan: which months exist and their blob shas. */
export type ShardIndex = Map<string, ShardRef>
