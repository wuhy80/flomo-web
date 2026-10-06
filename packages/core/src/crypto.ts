/**
 * Vault cryptography for flomo-sim.
 *
 * The password never leaves the device and is never stored anywhere. It is
 * stretched into a 256-bit AES-GCM key with PBKDF2-HMAC-SHA256, and that key
 * *is* the credential: a wrong password simply fails to authenticate the
 * AES-GCM tag, so there is no separate password hash sitting in the repo for
 * anyone to attack offline.
 *
 * Everything below uses WebCrypto only, so the same code runs unchanged in the
 * browser, in Node (>= 19, where `globalThis.crypto` exists), and inside the
 * DSH host process.
 *
 * @module @flomo/core/crypto
 */

/** Recorded in the vault header so the KDF can be migrated without a rewrite. */
export const KDF_ALGORITHM = 'PBKDF2-SHA256'

/** OWASP-recommended PBKDF2-HMAC-SHA256 work factor (2023 guidance). */
export const DEFAULT_ITERATIONS = 600_000

const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BITS = 256

/**
 * The fixed string sealed into the vault header at creation time. Unlocking
 * means decrypting this and finding it intact, which distinguishes "wrong
 * password" from "empty vault" without needing a shard to already exist.
 */
export const CHECK_PLAINTEXT = 'flomo-vault-v1'

/** KDF parameters. Safe to publish: a salt is not a secret. */
export interface KdfParams {
  /** Always {@link KDF_ALGORITHM} for vaults written by this version. */
  readonly algo: string
  /** PBKDF2 iteration count. */
  readonly iterations: number
  /** Base64-encoded random salt. */
  readonly salt: string
}

/** An AES-GCM ciphertext plus the random IV it was sealed under. */
export interface Sealed {
  /** Base64-encoded 96-bit IV. Never reused for the same key. */
  readonly iv: string
  /** Base64-encoded ciphertext with its 128-bit authentication tag appended. */
  readonly ct: string
}

/** Raised when a sealed payload fails authentication, i.e. the key is wrong. */
export class DecryptError extends Error {
  override readonly name = 'DecryptError'

  constructor(message = '解密失败：密码不正确，或数据已损坏。') {
    super(message)
  }
}

/**
 * Resolve the platform crypto object.
 * @returns the Crypto implementation backing this runtime.
 * @throws when the runtime has no WebCrypto, which in a browser means the page
 * is not a secure context — GitHub Pages is HTTPS, so this only bites on a
 * `file://` preview.
 */
function webcrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (!c?.subtle) {
    throw new Error(
      'WebCrypto 不可用：flomo-sim 需要安全上下文（HTTPS 或 localhost）。',
    )
  }
  return c
}

/**
 * Fill a fresh byte array from the platform CSPRNG.
 * @param length - how many bytes to draw.
 * @returns the random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  webcrypto().getRandomValues(out)
  return out
}

/**
 * Base64-encode bytes. Chunked so that very large payloads cannot blow the
 * argument limit of `String.fromCharCode`.
 * @param bytes - the bytes to encode.
 * @returns standard base64 with padding.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Decode standard base64 into bytes.
 * @param base64 - the encoded text.
 * @returns the decoded bytes.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Derive the raw 256-bit vault key from a password.
 *
 * The raw bytes are returned rather than a `CryptoKey` because the same value
 * doubles as the printable recovery code, which is what lets a user who
 * forgets their password still reach their data.
 * @param password - the user's password.
 * @param params - salt and iteration count from the vault header.
 * @returns the raw key bytes.
 */
export async function deriveRawKey(
  password: string,
  params: KdfParams,
): Promise<Uint8Array> {
  const subtle = webcrypto().subtle
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(params.salt) as unknown as BufferSource,
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    baseKey,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/**
 * Wrap raw key bytes as a non-extractable AES-GCM key.
 * @param raw - 32 raw key bytes, from {@link deriveRawKey} or a recovery code.
 * @returns the AES-GCM key used for sealing and opening shards.
 */
export async function importVaultKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== KEY_BITS / 8) {
    throw new Error(`恢复码长度不正确：期望 ${KEY_BITS / 8} 字节，实际 ${raw.length} 字节。`)
  }
  return webcrypto().subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt a UTF-8 string under the vault key with a fresh random IV.
 * @param key - the AES-GCM vault key.
 * @param plaintext - the text to protect.
 * @returns the IV and ciphertext, both base64.
 */
export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES)
  const ct = await webcrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource,
  )
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) }
}

/**
 * Decrypt a sealed payload, authenticating it in the process.
 * @param key - the AES-GCM vault key.
 * @param sealed - the IV and ciphertext to open.
 * @returns the recovered UTF-8 string.
 * @throws {DecryptError} when the tag does not authenticate.
 */
export async function open(key: CryptoKey, sealed: Sealed): Promise<string> {
  try {
    const plain = await webcrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(sealed.iv) as unknown as BufferSource },
      key,
      base64ToBytes(sealed.ct) as unknown as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new DecryptError()
  }
}

/** A freshly minted vault: its header parameters and the key to use with them. */
export interface NewVault {
  /** KDF parameters to publish in `vault.json`. */
  readonly params: KdfParams
  /** The derived AES-GCM key. Kept in memory only. */
  readonly key: CryptoKey
  /** The password check sealed under the key. */
  readonly check: Sealed
  /** Printable recovery code — the raw key, base64. Show once, store offline. */
  readonly recoveryCode: string
}

/**
 * Mint a new vault from a password.
 *
 * The caller is responsible for showing `recoveryCode` to the user exactly
 * once: it is the only way back into the data if the password is forgotten,
 * and it is never written to the repository.
 * @param password - the chosen password.
 * @param iterations - PBKDF2 work factor; override only for tests.
 * @returns the new vault's header, key, check value and recovery code.
 */
export async function createVault(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<NewVault> {
  const params: KdfParams = {
    algo: KDF_ALGORITHM,
    iterations,
    salt: bytesToBase64(randomBytes(SALT_BYTES)),
  }
  const raw = await deriveRawKey(password, params)
  const key = await importVaultKey(raw)
  return {
    params,
    key,
    check: await seal(key, CHECK_PLAINTEXT),
    recoveryCode: bytesToBase64(raw),
  }
}

/**
 * Decode a recovery code back into raw key bytes.
 *
 * Returns bytes rather than a `CryptoKey` because {@link importVaultKey}
 * deliberately mints non-extractable keys, so a key can never be exported back
 * out again. Callers feed these bytes through `importVaultKey` themselves.
 * @param recoveryCode - base64 of the raw 32-byte key.
 * @returns the raw key bytes.
 * @throws when the code does not decode to exactly 32 bytes.
 */
export function rawKeyFromRecoveryCode(recoveryCode: string): Uint8Array {
  const raw = base64ToBytes(recoveryCode.trim())
  if (raw.length !== KEY_BITS / 8) {
    throw new Error(
      `恢复码长度不正确：期望 ${KEY_BITS / 8} 字节，实际 ${raw.length} 字节。`,
    )
  }
  return raw
}

/**
 * Structural check for a parsed {@link Sealed}.
 * @param value - a value decoded from JSON.
 * @returns whether it is a usable sealed payload.
 */
export function isSealed(value: unknown): value is Sealed {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.iv === 'string' && typeof v.ct === 'string'
}

/**
 * Structural check for parsed {@link KdfParams}.
 * @param value - a value decoded from JSON.
 * @returns whether it is a usable KDF parameter set.
 */
export function isKdfParams(value: unknown): value is KdfParams {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.algo === 'string' &&
    typeof v.iterations === 'number' &&
    v.iterations > 0 &&
    typeof v.salt === 'string'
  )
}
