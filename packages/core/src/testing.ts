/**
 * Test doubles for the core.
 *
 * Exported as the `@flomo/core/testing` subpath so the plugin's suite can use
 * the same fake repository as the core's own, without either package reaching
 * into the other's test directory.
 *
 * @module @flomo/core/testing
 */

import { GitHubConflictError } from './github.ts'
import type { GitHubDirEntry } from './github.ts'
import type { TextStore } from './vault.ts'

interface StoredFile {
  text: string
  sha: string
}

/**
 * An in-memory {@link TextStore}.
 *
 * It mirrors the two GitHub Contents API behaviours the vault actually depends
 * on: a blob sha that changes on every write, and a conflict when a write
 * presents a sha that is no longer current.
 */
export class MemoryStore implements TextStore {
  private readonly files = new Map<string, StoredFile>()
  private seq = 0

  /**
   * @param path - repository path.
   * @returns the stored file, or `null`.
   */
  async readText(path: string): Promise<{ text: string; sha: string } | null> {
    const file = this.files.get(path)
    return file ? { text: file.text, sha: file.sha } : null
  }

  /**
   * Write a file, enforcing the optimistic-concurrency contract.
   * @param path - repository path.
   * @param text - new contents.
   * @param options - expected blob sha and commit message.
   * @returns the new blob sha.
   */
  async writeText(
    path: string,
    text: string,
    options: { sha?: string; message: string },
  ): Promise<string> {
    const existing = this.files.get(path)
    if (options.sha && (!existing || existing.sha !== options.sha)) {
      throw new GitHubConflictError('写入冲突：远端文件已被其他设备修改。', 409, path)
    }
    if (!options.sha && existing) {
      throw new GitHubConflictError('文件已存在。', 422, path)
    }
    this.seq += 1
    const sha = `sha-${this.seq}`
    this.files.set(path, { text, sha })
    return sha
  }

  /**
   * List the immediate children of a directory.
   * @param dir - directory path.
   * @returns matching entries.
   */
  async listDir(dir: string): Promise<GitHubDirEntry[]> {
    const prefix = `${dir}/`
    const out: GitHubDirEntry[] = []
    for (const [path, file] of this.files) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest.includes('/')) continue
      out.push({ name: rest, path, sha: file.sha })
    }
    return out
  }

  /**
   * Raw access for assertions.
   * @param path - repository path.
   * @returns the stored text, or `undefined`.
   */
  raw(path: string): string | undefined {
    return this.files.get(path)?.text
  }

  /**
   * Delete a file, standing in for someone removing it upstream.
   * @param path - repository path.
   * @returns whether anything was removed.
   */
  remove(path: string): boolean {
    return this.files.delete(path)
  }

  /** @returns every stored path, sorted. */
  paths(): string[] {
    return [...this.files.keys()].sort()
  }
}
