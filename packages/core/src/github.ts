/**
 * A thin, dependency-free client for the GitHub Contents API.
 *
 * This is the only place flomo-sim talks to the network. It is deliberately
 * dumb: it moves UTF-8 text in and out of one repository and knows nothing
 * about vaults, shards or memos. The vault layer above it owns all of that.
 *
 * A fine-grained PAT scoped to a single private repository's *Contents* is all
 * that is ever needed. Even if that token leaks, the repository only ever holds
 * ciphertext, so the notes stay unreadable without the password.
 *
 * @module @flomo/core/github
 */

const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'

/** Soft ceiling past which the Contents API gets slow; shards should stay under it. */
export const RECOMMENDED_MAX_BYTES = 1_000_000

/** Any non-2xx response from GitHub. */
export class GitHubError extends Error {
  override readonly name: string = 'GitHubError'

  /** The HTTP status code. */
  readonly status: number

  /** The repository path involved. */
  readonly path: string

  /**
   * @param message - human-readable summary.
   * @param status - the HTTP status code.
   * @param path - the repository path involved.
   */
  constructor(message: string, status: number, path: string) {
    super(message)
    this.status = status
    this.path = path
  }
}

/**
 * A write lost a race: the blob changed since we read its sha.
 *
 * With a single user this is rare, and it only ever happens when two devices
 * save within the same moment. Re-reading and retrying is the correct fix.
 */
export class GitHubConflictError extends GitHubError {
  override readonly name: string = 'GitHubConflictError'
}

/** One entry in a repository directory listing. */
export interface GitHubDirEntry {
  name: string
  path: string
  sha: string
}

/** A file's decoded contents together with the blob sha needed to update it. */
export interface GitHubFile {
  text: string
  sha: string
}

/** Connection settings for one repository. */
export interface GitHubContentsOptions {
  /** Fine-grained PAT. */
  token: string
  /** Repository owner, user or organization. */
  owner: string
  /** Repository name. */
  repo: string
  /** Target branch; omitted lets GitHub use the repository default. */
  branch?: string
  /** Injection point for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Encode UTF-8 text as GitHub wants it: base64 of the raw bytes.
 * @param text - the text to encode.
 * @returns padded base64 with no line breaks.
 */
function encodeContent(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Decode the base64 GitHub returns, which may contain embedded newlines.
 * @param base64 - the API payload.
 * @returns the decoded UTF-8 text.
 */
function decodeContent(base64: string): string {
  const clean = base64.replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Text in and out of one GitHub repository. */
export class GitHubContentsStore {
  private readonly token: string
  private readonly owner: string
  private readonly repo: string
  private readonly branch: string | undefined
  private readonly doFetch: typeof fetch

  /**
   * @param options - token, repository coordinates and branch.
   */
  constructor(options: GitHubContentsOptions) {
    this.token = options.token
    this.owner = options.owner
    this.repo = options.repo
    this.branch = options.branch
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /** @returns the repository coordinates as `owner/repo`. */
  get slug(): string {
    return `${this.owner}/${this.repo}`
  }

  /**
   * Build the request headers for one call.
   * @returns GitHub's required headers.
   */
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
    }
  }

  /**
   * Build an absolute API URL, appending the branch ref when set.
   * @param path - API path below the base, e.g. `/repos/o/r/contents/a.json`.
   * @returns the full URL.
   */
  private url(path: string): string {
    const base = `${API_BASE}${path}`
    if (!this.branch) return base
    return `${base}${path.includes('?') ? '&' : '?'}ref=${encodeURIComponent(this.branch)}`
  }

  /**
   * Pull a readable message out of a failed response.
   * @param response - the failed response.
   * @returns GitHub's `message` field when present.
   */
  private async describe(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) return body.message
    } catch {
      /* body was not JSON; fall through to the status text */
    }
    return response.statusText || `HTTP ${response.status}`
  }

  /**
   * Read a file's text and blob sha.
   * @param path - repository path, e.g. `vault.json`.
   * @returns the file, or `null` when it does not exist yet.
   */
  async readText(path: string): Promise<GitHubFile | null> {
    const response = await this.doFetch(
      this.url(`/repos/${this.owner}/${this.repo}/contents/${path}`),
      { headers: this.headers() },
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new GitHubError(await this.describe(response), response.status, path)
    }
    const body = (await response.json()) as { content?: string; sha?: string }
    if (typeof body.content !== 'string' || typeof body.sha !== 'string') {
      throw new GitHubError('响应缺少 content/sha 字段，可能指向了目录而非文件。', response.status, path)
    }
    return { text: decodeContent(body.content), sha: body.sha }
  }

  /**
   * Create or overwrite a file.
   * @param path - repository path.
   * @param text - new UTF-8 contents.
   * @param options - `sha` of the blob being replaced (omit when creating), and
   * the commit message.
   * @returns the new blob sha.
   * @throws {GitHubConflictError} when the file changed under us.
   */
  async writeText(
    path: string,
    text: string,
    options: { sha?: string; message: string },
  ): Promise<string> {
    const bytes = new TextEncoder().encode(text).length
    if (bytes > RECOMMENDED_MAX_BYTES) {
      throw new GitHubError(
        `文件体积 ${bytes} 字节，超过 Contents API 的建议上限；请检查分片逻辑。`,
        413,
        path,
      )
    }
    const payload: Record<string, unknown> = {
      message: options.message,
      content: encodeContent(text),
    }
    if (options.sha) payload.sha = options.sha
    if (this.branch) payload.branch = this.branch

    const response = await this.doFetch(
      `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${path}`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify(payload) },
    )
    if (response.status === 409 || response.status === 422) {
      throw new GitHubConflictError(
        '写入冲突：远端文件已被其他设备修改。',
        response.status,
        path,
      )
    }
    if (!response.ok) {
      throw new GitHubError(await this.describe(response), response.status, path)
    }
    const body = (await response.json()) as { content?: { sha?: string } }
    const sha = body.content?.sha
    if (!sha) throw new GitHubError('写入成功但响应缺少 sha。', response.status, path)
    return sha
  }

  /**
   * List a directory's files.
   * @param dir - repository directory path, e.g. `data`.
   * @returns its entries, or an empty array when the directory is absent.
   */
  async listDir(dir: string): Promise<GitHubDirEntry[]> {
    const response = await this.doFetch(
      this.url(`/repos/${this.owner}/${this.repo}/contents/${dir}`),
      { headers: this.headers() },
    )
    if (response.status === 404) return []
    if (!response.ok) {
      throw new GitHubError(await this.describe(response), response.status, dir)
    }
    const body = (await response.json()) as unknown
    if (!Array.isArray(body)) {
      throw new GitHubError('期望目录列表，却收到了文件内容。', response.status, dir)
    }
    return body.flatMap((entry) => {
      const e = entry as { name?: unknown; path?: unknown; sha?: unknown; type?: unknown }
      if (e.type !== 'file' || typeof e.name !== 'string' || typeof e.path !== 'string') {
        return []
      }
      return [{ name: e.name, path: e.path, sha: typeof e.sha === 'string' ? e.sha : '' }]
    })
  }

  /**
   * Confirm the token can actually reach this repository.
   * @returns the repository's default branch and whether it is private.
   */
  async verifyAccess(): Promise<{ defaultBranch: string; private: boolean }> {
    const response = await this.doFetch(
      `${API_BASE}/repos/${this.owner}/${this.repo}`,
      { headers: this.headers() },
    )
    if (!response.ok) {
      throw new GitHubError(await this.describe(response), response.status, this.slug)
    }
    const body = (await response.json()) as { default_branch?: string; private?: boolean }
    return {
      defaultBranch: body.default_branch ?? 'main',
      private: body.private === true,
    }
  }
}

/**
 * Create a private repository for a user account, if it does not exist yet.
 *
 * Used only by first-run onboarding, so that setting up a data store is one
 * click rather than a manual trip to github.com.
 * @param token - a PAT with `Administration` write or `repo` scope.
 * @param name - repository name.
 * @param fetchImpl - injection point for tests.
 * @returns the repository coordinates.
 */
export async function createPrivateRepo(
  token: string,
  name: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ owner: string; repo: string }> {
  const response = await fetchImpl(`${API_BASE}/user/repos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      private: true,
      auto_init: true,
      description: 'flomo-sim encrypted memo store',
    }),
  })
  if (!response.ok) {
    let message = response.statusText
    try {
      message = ((await response.json()) as { message?: string }).message ?? message
    } catch {
      /* not JSON */
    }
    throw new GitHubError(message, response.status, name)
  }
  const body = (await response.json()) as { owner?: { login?: string }; name?: string }
  const owner = body.owner?.login
  const repo = body.name
  if (!owner || !repo) {
    throw new GitHubError('仓库已创建，但响应缺少 owner/name。', response.status, name)
  }
  return { owner, repo }
}
