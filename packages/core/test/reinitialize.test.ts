/**
 * Re-initialization: the recovery path for a vault nobody can open.
 *
 * @module @flomo/core/test/reinitialize
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DATA_DIR,
  FlomoVault,
  GitHubConflictError,
  HEADER_FILE,
  TODO_FILE,
  VaultHeaderError,
  WrongPasswordError,
} from '../src/index.ts'
import type { GitHubDirEntry, TextStore } from '../src/index.ts'
import { MemoryStore } from '@flomo/core/testing'

const FAST = 1_000
const OLD_PASSWORD = 'old password 123'
const NEW_PASSWORD = 'new password 456'

/**
 * A store that refuses the header write, standing in for a second device that
 * replaced the vault between this one's read and its write.
 */
class HeaderConflictStore implements TextStore {
  private readonly inner = new MemoryStore()
  private armed = false

  /** Start refusing the header write, as a second device would. */
  arm(): void {
    this.armed = true
  }

  readText(path: string): Promise<{ text: string; sha: string } | null> {
    return this.inner.readText(path)
  }

  writeText(
    path: string,
    text: string,
    options: { sha?: string; message: string },
  ): Promise<string> {
    if (this.armed && path === HEADER_FILE) {
      return Promise.reject(new GitHubConflictError('写入冲突：远端文件已被其他设备修改。', 409, path))
    }
    return this.inner.writeText(path, text, options)
  }

  deleteText(path: string, options: { sha: string; message: string }): Promise<void> {
    return this.inner.deleteText(path, options)
  }

  listDir(dir: string): Promise<GitHubDirEntry[]> {
    return this.inner.listDir(dir)
  }

  /** @returns the underlying fake, for assertions. */
  raw(path: string): string | undefined {
    return this.inner.raw(path)
  }
}

describe('FlomoVault.reinitialize', () => {
  it('moves the old shard into a backup directory and mints a new header', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, OLD_PASSWORD, FAST)
    const memo = vault.add('keep me #archive')
    await vault.flush()

    const month = memo.createdAt.slice(0, 7)
    const live = `${DATA_DIR}/${month}.json`
    assert.ok(store.raw(live), 'the shard should have been written')

    const reinit = await FlomoVault.reinitialize(
      store,
      NEW_PASSWORD,
      FAST,
      new Date('2026-10-22T09:00:00Z'),
    )

    assert.equal(reinit.archived, 1)
    assert.equal(reinit.archiveDir, 'data/bak-20261022-090000')
    assert.equal(reinit.vault.all().length, 0)

    // The old ciphertext survives, under the backup path, and is no longer on
    // the live path that loadAll() walks.
    assert.ok(store.raw(`${reinit.archiveDir}/${month}.json`), 'archived shard should be readable')
    assert.equal(store.raw(live), undefined)
  })

  it('leaves the old password unable to open the new vault, and the new one working', async () => {
    const store = new MemoryStore()
    const created = await FlomoVault.create(store, OLD_PASSWORD, FAST)
    created.vault.add('old memo')
    await created.vault.flush()

    const { recoveryCode } = await FlomoVault.reinitialize(store, NEW_PASSWORD, FAST)

    await assert.rejects(() => FlomoVault.open(store, OLD_PASSWORD), WrongPasswordError)
    const reopened = await FlomoVault.open(store, NEW_PASSWORD)
    assert.equal(reopened.all().length, 0)

    // The new recovery code opens the new vault, not the old one.
    const viaRecovery = await FlomoVault.openWithRecovery(store, recoveryCode)
    assert.equal(viaRecovery.all().length, 0)
  })

  it('archives todo.json too, so the new vault loads clean', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, OLD_PASSWORD, FAST)
    vault.addTodo('old task')
    await vault.flush()
    assert.ok(store.raw(TODO_FILE))

    const reinit = await FlomoVault.reinitialize(
      store,
      NEW_PASSWORD,
      FAST,
      new Date('2026-10-22T10:00:00Z'),
    )
    assert.ok(store.raw(`${reinit.archiveDir}/todo.json`))
    assert.equal(store.raw(TODO_FILE), undefined)

    const loaded = await reinit.vault.loadAll()
    assert.equal(loaded, 0)
    assert.deepEqual(reinit.vault.todos(), [])
  })

  it('propagates a header conflict instead of reporting success', async () => {
    const store = new HeaderConflictStore()
    await FlomoVault.create(store, OLD_PASSWORD, FAST)
    const before = store.raw(HEADER_FILE)
    assert.ok(before)
    store.arm()

    await assert.rejects(() => FlomoVault.reinitialize(store, NEW_PASSWORD, FAST), GitHubConflictError)

    // The header was left alone, so the old password still opens the vault.
    assert.equal(store.raw(HEADER_FILE), before)
    const stillOpens = await FlomoVault.open(store, OLD_PASSWORD)
    assert.equal(stillOpens.all().length, 0)
  })

  it('refuses when there is no vault to replace', async () => {
    const store = new MemoryStore()
    await assert.rejects(() => FlomoVault.reinitialize(store, NEW_PASSWORD, FAST), VaultHeaderError)
  })
})
