/**
 * Public surface of the flomo-sim core.
 *
 * Both consumers depend on exactly this: the Vite web app, and the DSH plugin's
 * host and client halves. Keeping them on one API is what stops the two
 * surfaces from drifting apart.
 *
 * @module @flomo/core
 */

export {
  CHECK_PLAINTEXT,
  DEFAULT_ITERATIONS,
  DecryptError,
  KDF_ALGORITHM,
  base64ToBytes,
  bytesToBase64,
  createVault,
  deriveRawKey,
  importVaultKey,
  isKdfParams,
  isSealed,
  open,
  randomBytes,
  rawKeyFromRecoveryCode,
  seal,
} from './crypto.ts'
export type { KdfParams, NewVault, Sealed } from './crypto.ts'

export {
  GitHubConflictError,
  GitHubContentsStore,
  GitHubError,
  RECOMMENDED_MAX_BYTES,
  createPrivateRepo,
} from './github.ts'
export type { GitHubContentsOptions, GitHubDirEntry, GitHubFile } from './github.ts'

export {
  EXPORT_FORMAT,
  exportFilename,
  memosToJson,
  memosToMarkdown,
} from './export.ts'
export type { ExportPayload } from './export.ts'

export { dailyReview, pickRandom, randomWalk, searchMemos } from './search.ts'
export type { SearchQuery } from './search.ts'

export { corpusStats, heatmap, streak } from './stats.ts'
export type { CorpusStats } from './stats.ts'

export { hasTag, parseTags, tagKey, tagSegments, tagStats, tokenizeTags } from './tags.ts'
export type { TagStat, TagToken } from './tags.ts'

export {
  absoluteDayLabel,
  clockOf,
  dayLabel,
  dayOf,
  fileStamp,
  monthOf,
  recentMonths,
} from './time.ts'

export {
  DATA_DIR,
  FlomoVault,
  HEADER_FILE,
  VaultExistsError,
  VaultHeaderError,
  WrongPasswordError,
} from './vault.ts'
export type { CreatedVault, TextStore } from './vault.ts'

export type { Memo, Shard, ShardIndex, ShardRef, VaultHeader } from './types.ts'
