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

export { isInsideFence, parseBlocks, proseText } from './blocks.ts'
export type { Block } from './blocks.ts'

export { CachingTextStore, MemoryCacheArea } from './cache.ts'
export type { CacheArea, CachingStoreOptions } from './cache.ts'

export {
  GitHubConflictError,
  GitHubContentsStore,
  GitHubError,
  RECOMMENDED_MAX_BYTES,
  createPrivateRepo,
} from './github.ts'
export type {
  CreateRepoOptions,
  GitHubContentsOptions,
  GitHubDirEntry,
  GitHubFile,
} from './github.ts'

export {
  EXPORT_FORMAT,
  exportFilename,
  memosToJson,
  memosToMarkdown,
} from './export.ts'
export type { ExportPayload } from './export.ts'

export { ImportError, describeImportResult, parseMemosJson } from './import.ts'
export type { ImportResult } from './import.ts'

export { markupOf, tokenizeInline } from './inline.ts'
export type { InlineToken } from './inline.ts'

export {
  backlinks,
  matchesLinkTarget,
  outgoingLinks,
  parseLinks,
  resolveLinkTarget,
} from './links.ts'
export type { Backlink, OutgoingLink } from './links.ts'

export { dailyReview, pickRandom, randomWalk, searchMemos } from './search.ts'
export type { SearchQuery } from './search.ts'

export { corpusStats, heatmap, streak } from './stats.ts'
export type { CorpusStats } from './stats.ts'

export {
  hasTag,
  parseTags,
  suggestTags,
  tagFragmentAtCaret,
  tagKey,
  tagSegments,
  tagStats,
  tokenizeTags,
} from './tags.ts'
export type { TagFragment, TagStat, TagToken } from './tags.ts'

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
