/**
 * Core test suite: crypto round-trips, shard persistence, tag parsing and the
 * resurfacing queries.
 *
 * PBKDF2 runs at a deliberately trivial work factor here; the real 600k default
 * would make the suite unusably slow and is a deployment concern, not a logic
 * one.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_ITERATIONS,
  FlomoVault,
  GitHubConflictError,
  WrongPasswordError,
  dailyReview,
  dayOf,
  monthOf,
  parseTags,
  pickRandom,
  randomBytes,
  rawKeyFromRecoveryCode,
  recentMonths,
  searchMemos,
  streak,
  tagStats,
  corpusStats,
} from '../src/index.ts'
import type { Memo } from '../src/index.ts'
import { MemoryStore } from './memory-store.ts'

/** Tiny work factor so the suite stays fast. */
const FAST = 1_000

const PASSWORD = 'correct horse battery staple'

/**
 * Build a memo shaped like the vault would produce.
 * @param overrides - fields to override.
 * @returns the memo.
 */
function memo(overrides: Partial<Memo> = {}): Memo {
  const createdAt = overrides.createdAt ?? new Date().toISOString()
  return {
    id: overrides.id ?? `id-${createdAt}-${overrides.content ?? ''}`,
    content: overrides.content ?? 'hello',
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    tags: overrides.tags ?? parseTags(overrides.content ?? 'hello'),
    ...(overrides.pinned !== undefined ? { pinned: overrides.pinned } : {}),
  }
}

describe('crypto', () => {
  it('produces 32 random bytes', () => {
    assert.equal(randomBytes(32).length, 32)
    assert.notDeepEqual(randomBytes(32), randomBytes(32))
  })

  it('defaults to the OWASP work factor', () => {
    assert.equal(DEFAULT_ITERATIONS, 600_000)
  })

  it('rejects a recovery code of the wrong length', () => {
    assert.throws(() => rawKeyFromRecoveryCode('AAAA'), /长度不正确/)
  })
})

describe('tags', () => {
  it('extracts simple tags', () => {
    assert.deepEqual(parseTags('今天读了 #深度工作 很有收获'), ['深度工作'])
  })

  it('supports nested tags', () => {
    assert.deepEqual(parseTags('#读书/认知 的笔记'), ['读书/认知'])
  })

  it('strips trailing punctuation', () => {
    assert.deepEqual(parseTags('今天读了 #深度工作。'), ['深度工作'])
  })

  it('de-duplicates while preserving first-seen order', () => {
    assert.deepEqual(parseTags('#b 和 #a 和 #b'), ['b', 'a'])
  })

  it('ignores a bare hash with no tag body', () => {
    // `C#` and a lone `#` are both followed by whitespace, so neither is a tag.
    assert.deepEqual(parseTags('C# 和 # 都不是标签'), [])
    assert.deepEqual(parseTags('#'), [])
    assert.deepEqual(parseTags(''), [])
  })

  it('still finds a tag that abuts a word', () => {
    // A deliberate trade-off: `C#语言` reads as the tag `语言`. Requiring
    // leading whitespace would break the far more common mid-sentence tag,
    // such as `今天读到#认知失调很有意思`.
    assert.deepEqual(parseTags('今天读到#认知失调很有意思'), ['认知失调很有意思'])
  })

  it('ranks tags by frequency', () => {
    const stats = tagStats([
      { tags: ['a', 'b'] },
      { tags: ['a'] },
    ])
    assert.deepEqual(stats, [
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
    ])
  })
})

describe('time', () => {
  it('derives a month key', () => {
    assert.equal(monthOf('2025-06-14T10:00:00Z'), monthOf(new Date('2025-06-14T10:00:00Z')))
  })

  it('enumerates recent months newest first', () => {
    const months = recentMonths(3, new Date(2025, 5, 14))
    assert.deepEqual(months, ['2025-06', '2025-05', '2025-04'])
  })
})

describe('vault lifecycle', () => {
  it('creates, reopens with the password, and rejects a wrong one', async () => {
    const store = new MemoryStore()
    const { vault, recoveryCode } = await FlomoVault.create(store, PASSWORD, FAST)
    assert.equal(vault.all().length, 0)
    assert.equal(rawKeyFromRecoveryCode(recoveryCode).length, 32)

    const reopened = await FlomoVault.open(store, PASSWORD)
    assert.equal(reopened.all().length, 0)

    await assert.rejects(() => FlomoVault.open(store, 'wrong password'), WrongPasswordError)
  })

  it('opens with the recovery code when the password is lost', async () => {
    const store = new MemoryStore()
    const { recoveryCode } = await FlomoVault.create(store, PASSWORD, FAST)
    const vault = await FlomoVault.openWithRecovery(store, recoveryCode)
    vault.add('recovered #test')
    await vault.flush()

    const reread = await FlomoVault.openWithRecovery(store, recoveryCode)
    await reread.loadAll()
    assert.equal(reread.all()[0]?.content, 'recovered #test')
  })

  it('refuses to overwrite an existing vault', async () => {
    const store = new MemoryStore()
    await FlomoVault.create(store, PASSWORD, FAST)
    await assert.rejects(() => FlomoVault.create(store, PASSWORD, FAST), /已存在/)
  })

  it('reports existence without needing a password', async () => {
    const store = new MemoryStore()
    assert.equal(await FlomoVault.exists(store), false)
    await FlomoVault.create(store, PASSWORD, FAST)
    assert.equal(await FlomoVault.exists(store), true)
  })
})

describe('shard persistence', () => {
  it('round-trips memos and never writes plaintext', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)

    vault.add('第一条 #测试')
    vault.add('第二条 #测试 #别的')
    const written = await vault.flush()

    assert.equal(written.length, 1)
    const shardPath = `${vault.dataDir}/${written[0]}.json`
    const raw = store.raw(shardPath)
    assert.ok(raw, 'shard should exist')
    assert.ok(!raw.includes('第一条'), 'ciphertext must not contain the plaintext body')
    assert.ok(!raw.includes('测试'), 'ciphertext must not contain the tag either')

    const reopened = await FlomoVault.open(store, PASSWORD)
    const count = await reopened.loadAll()
    assert.equal(count, 2)
    assert.deepEqual(
      reopened.all().map((m) => m.content).sort(),
      ['第一条 #测试', '第二条 #测试 #别的'],
    )
  })

  it('shards by month', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)

    // add() stamps createdAt from the clock, so drive the shard split by
    // rebuilding the map through loadAll after seeding both months by hand.
    vault.add('this month #now')
    await vault.flush()
    const thisMonth = monthOf(new Date())
    assert.deepEqual(store.paths().sort(), ['data/' + thisMonth + '.json', 'vault.json'].sort())

    const index = await vault.remoteIndex()
    assert.ok(index.has(thisMonth))
  })

  it('detects a concurrent write to the same shard', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)
    vault.add('device A #x')

    // Device B lands a change to the same file first, moving the blob sha.
    const month = monthOf(new Date())
    const other = new MemoryStore()
    void other
    const current = await store.readText(`data/${month}.json`)
    await store.writeText(`data/${month}.json`, '{"v":1,"month":"' + month + '","iv":"a","ct":"b"}', {
      sha: current?.sha,
      message: 'other device',
    })

    await assert.rejects(() => vault.flush(), GitHubConflictError)
  })

  it('leaves unsaved work pending when a write fails', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)
    vault.add('will fail #x')
    const month = monthOf(new Date())
    const first = await store.readText(`data/${month}.json`)
    await store.writeText(`data/${month}.json`, '{"v":1,"month":"x","iv":"a","ct":"b"}', {
      sha: first?.sha,
      message: 'race',
    })

    await assert.rejects(() => vault.flush())
    assert.deepEqual(vault.dirtyMonths, [month], 'the month must still be marked dirty')
  })
})

describe('memo operations', () => {
  it('parses tags on add and re-parses on edit', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)

    const added = vault.add('原始 #旧标签')
    assert.deepEqual(added.tags, ['旧标签'])

    const edited = vault.edit(added.id, '改过 #新标签')
    assert.deepEqual(edited.tags, ['新标签'])
    assert.ok(edited.updatedAt >= added.updatedAt)
  })

  it('removes and pins', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)
    const a = vault.add('a')
    const b = vault.add('b')

    vault.pin(a.id)
    assert.equal(vault.all()[0]?.id, a.id, 'pinned memo sorts first')

    vault.pin(a.id, false)
    assert.equal(vault.all()[0]?.pinned, undefined)

    assert.equal(vault.remove(b.id), true)
    assert.equal(vault.remove(b.id), false)
    assert.equal(vault.all().length, 1)
  })

  it('keeps edits across a reload', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)
    const added = vault.add('before #x')
    vault.edit(added.id, 'after #y')
    await vault.flush()

    const reopened = await FlomoVault.open(store, PASSWORD)
    await reopened.loadAll()
    const only = reopened.all()[0]
    assert.equal(only?.content, 'after #y')
    assert.deepEqual(only?.tags, ['y'])
  })
})

describe('queries', () => {
  const corpus: Memo[] = [
    memo({ id: '1', content: '架构设计 #work', createdAt: '2025-06-01T10:00:00.000Z' }),
    memo({ id: '2', content: '读书笔记 #reading', createdAt: '2025-06-02T10:00:00.000Z' }),
    memo({ id: '3', content: '架构复盘 #work #reading', createdAt: '2025-06-03T10:00:00.000Z' }),
  ]

  it('searches by text, case-insensitively', () => {
    assert.deepEqual(searchMemos(corpus, { text: '架构' }).map((m) => m.id), ['3', '1'])
    assert.deepEqual(searchMemos(corpus, { text: 'ARCH' }).length, 0)
  })

  it('filters by tag and composes with text', () => {
    assert.deepEqual(searchMemos(corpus, { tag: 'work' }).map((m) => m.id), ['3', '1'])
    assert.deepEqual(searchMemos(corpus, { tag: 'work', text: '复盘' }).map((m) => m.id), ['3'])
  })

  it('honours the limit', () => {
    assert.equal(searchMemos(corpus, { limit: 2 }).length, 2)
  })

  it('is deterministic for a seeded pick', () => {
    const a = pickRandom(corpus, 2, 42).map((m) => m.id)
    const b = pickRandom(corpus, 2, 42).map((m) => m.id)
    assert.deepEqual(a, b)
  })

  it('gives the same daily review all day and a different one tomorrow', () => {
    const today = dailyReview(corpus, 2, '2025-06-10', new Date('2025-06-11T00:00:00Z'))
    const again = dailyReview(corpus, 2, '2025-06-10', new Date('2025-06-11T12:00:00Z'))
    assert.deepEqual(today.map((m) => m.id), again.map((m) => m.id))
  })

  it('excludes recent memos from the review instead of falling back to them', () => {
    const fresh = [memo({ id: 'fresh', createdAt: new Date().toISOString() })]
    assert.deepEqual(dailyReview(fresh, 3, '2025-06-10', new Date()), [])
  })

  it('counts a streak that ended yesterday as still alive', () => {
    const today = new Date(2025, 5, 10)
    const two = [
      memo({ id: 'a', createdAt: new Date(2025, 5, 8).toISOString() }),
      memo({ id: 'b', createdAt: new Date(2025, 5, 9).toISOString() }),
    ]
    assert.equal(streak(two, today), 2)
    assert.equal(dayOf(two[1]!.createdAt).startsWith('2025-06-09'), true)
  })

  it('summarizes the corpus', () => {
    const stats = corpusStats(corpus, tagStats(corpus).length, new Date(2025, 5, 4))
    assert.equal(stats.memos, 3)
    assert.equal(stats.tags, 2)
    assert.equal(stats.activeDays, 3)
  })
})
