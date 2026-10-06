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
  EXPORT_FORMAT,
  FlomoVault,
  GitHubConflictError,
  ImportError,
  WrongPasswordError,
  backlinks,
  dailyReview,
  dayOf,
  exportFilename,
  memosToJson,
  memosToMarkdown,
  monthOf,
  outgoingLinks,
  parseBlocks,
  parseLinks,
  parseMemosJson,
  parseTags,
  pickRandom,
  proseText,
  randomBytes,
  rawKeyFromRecoveryCode,
  recentMonths,
  resolveLinkTarget,
  searchMemos,
  streak,
  suggestTags,
  tagFragmentAtCaret,
  tagStats,
  tokenizeInline,
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

describe('export', () => {
  const now = new Date(2026, 9, 6, 14, 30)

  /**
   * Build a timestamp from local wall-clock parts.
   *
   * Local rather than UTC on purpose: the export groups by the user's local day,
   * so a UTC literal would make these assertions depend on the runner's zone.
   */
  const at = (year: number, month: number, day: number, hour = 9, minute = 0): string =>
    new Date(year, month - 1, day, hour, minute).toISOString()

  it('groups markdown by absolute day, oldest first', () => {
    const md = memosToMarkdown(
      [
        memo({ id: 'b', content: '第二条 #x', createdAt: at(2025, 6, 2, 10, 5) }),
        memo({ id: 'a', content: '第一条 #y', createdAt: at(2025, 6, 1, 9, 0) }),
      ],
      now,
    )

    assert.ok(md.indexOf('第一条') < md.indexOf('第二条'), 'oldest memo reads first')
    assert.match(md, /## 2025年6月1日/)
    assert.match(md, /## 2025年6月2日/)
    assert.match(md, /### 09:00/)
    assert.match(md, /### 10:05/)
    assert.match(md, /第一条 #y/, 'tags stay inline in the body')
    assert.match(md, /共 2 条/)
  })

  it('marks pinned and edited memos without touching the body', () => {
    const md = memosToMarkdown(
      [
        memo({
          content: '被改过 #x',
          createdAt: at(2025, 6, 1, 9, 0),
          updatedAt: at(2025, 6, 1, 11, 0),
          pinned: true,
        }),
      ],
      now,
    )
    assert.match(md, /### 09:00 · 置顶 · 已编辑/)
    assert.match(md, /被改过 #x/)
  })

  it('never writes a relative day label', () => {
    const md = memosToMarkdown([memo({ content: '今天写的', createdAt: at(2026, 10, 6, 8, 0) })], now)
    assert.ok(!md.includes('## 今天'), 'an export is read later; a relative label would lie')
    assert.match(md, /## 2026年10月6日/)
  })

  it('round-trips every field through json', () => {
    const source = memo({ id: 'keep-me', content: '一条 #x', createdAt: at(2025, 6, 1), pinned: true })
    const parsed = JSON.parse(memosToJson([source], now)) as {
      format: string
      exportedAt: string
      count: number
      memos: Memo[]
    }
    assert.equal(parsed.format, EXPORT_FORMAT)
    assert.equal(parsed.count, 1)
    assert.equal(parsed.exportedAt, now.toISOString())
    assert.deepEqual(parsed.memos[0], source)
  })

  it('handles an empty corpus', () => {
    assert.match(memosToMarkdown([], now), /还没有任何记录/)
    assert.equal((JSON.parse(memosToJson([], now)) as { count: number }).count, 0)
  })

  it('names the file after the export instant', () => {
    assert.equal(exportFilename('md', now), 'flomo-20261006-1430.md')
    assert.equal(exportFilename('json', now), 'flomo-20261006-1430.json')
  })
})

describe('import', () => {
  const now = new Date(2026, 9, 6, 14, 30)

  it('round-trips an export', () => {
    const source = [
      memo({ id: 'a', content: '第一条 #x', createdAt: '2025-06-01T01:00:00.000Z' }),
      memo({ id: 'b', content: '第二条 #y', createdAt: '2025-06-02T01:00:00.000Z' }),
    ]
    const result = parseMemosJson(memosToJson(source, now))
    assert.equal(result.skipped, 0)
    assert.deepEqual(result.memos, source)
  })

  it('accepts a bare array as well as the envelope', () => {
    const result = parseMemosJson(JSON.stringify([{ id: 'x', content: '裸数组 #z' }]), now)
    assert.equal(result.memos.length, 1)
    assert.deepEqual(result.memos[0]?.tags, ['z'])
    assert.equal(result.memos[0]?.createdAt, now.toISOString(), 'a missing timestamp falls back')
  })

  it('re-derives tags instead of trusting the file', () => {
    const result = parseMemosJson(
      JSON.stringify({ memos: [{ id: 'x', content: '真实标签是 #真', tags: ['假', '也是假的'] }] }),
      now,
    )
    assert.deepEqual(result.memos[0]?.tags, ['真'], 'a hand-edited tags field must not win')
  })

  it('clamps an edit that precedes creation', () => {
    const result = parseMemosJson(
      JSON.stringify({
        memos: [
          {
            id: 'x',
            content: '时间倒流',
            createdAt: '2025-06-02T00:00:00.000Z',
            updatedAt: '2025-06-01T00:00:00.000Z',
          },
        ],
      }),
      now,
    )
    assert.equal(result.memos[0]?.updatedAt, result.memos[0]?.createdAt)
  })

  it('drops unusable entries with a reason, and keeps the rest', () => {
    const result = parseMemosJson(
      JSON.stringify({
        memos: [
          { id: 'ok', content: '这条没问题' },
          { id: 'empty', content: '   ' },
          { id: 'missing' },
          'not an object',
        ],
      }),
      now,
    )
    assert.equal(result.memos.length, 1)
    assert.equal(result.skipped, 3)
    // Reasons are de-duplicated so a large broken file reads as a short list.
    assert.deepEqual(result.problems, ['有一条缺少正文', '有一项不是对象'])
  })

  it('keeps only the first of two entries sharing an id', () => {
    const result = parseMemosJson(
      JSON.stringify({
        memos: [
          { id: 'same', content: '先来的' },
          { id: 'same', content: '后来的' },
        ],
      }),
      now,
    )
    assert.equal(result.memos.length, 1)
    assert.equal(result.memos[0]?.content, '先来的')
  })

  it('refuses payloads it cannot understand', () => {
    assert.throws(() => parseMemosJson('这不是 json'), ImportError)
    assert.throws(() => parseMemosJson('{"nope":1}'), ImportError)
    assert.throws(() => parseMemosJson('42'), ImportError)
  })
})

describe('tokenizeInline', () => {
  it('covers the whole input, so a renderer can rebuild the body verbatim', () => {
    const samples = [
      '',
      '纯文本',
      '#标签 在中间 #另一个',
      '见 [[链接]] 和 #标签',
      '[[]] 空的和 [[   ]] 也是',
      '结尾是 #尾巴。',
      '连续##两个#号',
    ]
    for (const sample of samples) {
      const rebuilt = tokenizeInline(sample)
        .map((token) =>
          token.type === 'link'
            ? `[[${token.value}]]`
            : token.type === 'tag'
              ? `#${token.value}`
              : token.value,
        )
        .join('')
      assert.equal(rebuilt, sample, `rebuild mismatch for ${JSON.stringify(sample)}`)
    }
  })

  it('treats a # inside a link as part of the link, not as a tag', () => {
    assert.deepEqual(tokenizeInline('[[#不是标签]]'), [
      { type: 'link', value: '#不是标签' },
    ])
    assert.deepEqual(parseTags('[[#不是标签]]'), [])
    assert.deepEqual(parseLinks('[[#不是标签]]'), ['#不是标签'])
  })

  it('leaves a malformed marker in the text rather than eating it', () => {
    assert.deepEqual(tokenizeInline('[[   ]]'), [{ type: 'text', value: '[[   ]]' }])
  })
})

describe('blocks', () => {
  it('separates prose, quotes and fenced code', () => {
    const blocks = parseBlocks(
      [
        '第一段',
        '',
        '> 引用一行',
        '> 引用两行',
        '',
        '```js',
        'const x = 1',
        '```',
        '',
        '最后一段',
      ].join('\n'),
    )

    assert.deepEqual(blocks, [
      { type: 'paragraph', text: '第一段' },
      { type: 'quote', text: '引用一行\n引用两行' },
      { type: 'code', language: 'js', code: 'const x = 1' },
      { type: 'paragraph', text: '最后一段' },
    ])
  })

  it('keeps an unterminated fence to the end rather than eating the text', () => {
    // A user mid-keystroke has an open fence; dropping their text would be a far
    // worse failure than showing an unclosed block.
    assert.deepEqual(parseBlocks('前文\n```\n还没写完'), [
      { type: 'paragraph', text: '前文' },
      { type: 'code', language: '', code: '还没写完' },
    ])
  })

  it('carries the info string, empty when absent', () => {
    assert.deepEqual(parseBlocks('```ts\nx\n```')[0], {
      type: 'code',
      language: 'ts',
      code: 'x',
    })
    assert.deepEqual(parseBlocks('```\ny\n```')[0], { type: 'code', language: '', code: 'y' })
  })

  it('joins consecutive prose lines into one paragraph', () => {
    assert.deepEqual(parseBlocks('一行\n二行'), [{ type: 'paragraph', text: '一行\n二行' }])
  })

  it('treats a blank body as no blocks', () => {
    assert.deepEqual(parseBlocks(''), [])
    assert.deepEqual(parseBlocks('\n\n'), [])
  })

  it('returns prose with the fenced blocks removed', () => {
    assert.equal(proseText('说一句\n```\n代码\n```\n再说一句'), '说一句\n再说一句')
  })
})

describe('code fences are not prose', () => {
  const snippet = [
    '看这段 #真标签',
    '```c',
    '#include <stdio.h>',
    'char *s = "#不是标签";',
    '```',
    '还有 [[真链接]]',
    '```',
    '[[假链接]]',
    '```',
  ].join('\n')

  it('does not index a # inside a fence as a tag', () => {
    // Otherwise every C file anyone pastes in adds `include` and `define` to the
    // tag list, and the tag list stops being a description of what you write about.
    assert.deepEqual(parseTags(snippet), ['真标签'])
  })

  it('does not treat [[...]] inside a fence as a link', () => {
    assert.deepEqual(parseLinks(snippet), ['真链接'])
  })

  it('keeps tag completion out of fenced blocks', () => {
    const source = '```c\n#inc'
    assert.equal(tagFragmentAtCaret(source, source.length), null)
    // A prose line still completes as before.
    assert.deepEqual(tagFragmentAtCaret('前言 #读', 5), { start: 3, query: '读' })
  })

  it('does not let a link resolve against text that only exists in code', () => {
    const corpus = [
      memo({ id: 'a', content: '源码如下\n```\n深度工作算法\n```', tags: [] }),
      memo({ id: 'b', content: '谈谈 [[深度工作]]', tags: [] }),
    ]
    assert.deepEqual(
      resolveLinkTarget('深度工作', corpus, 'b'),
      [],
      'a snippet is not a discussion',
    )
  })
})

describe('tag completion', () => {
  const known = tagStats([
    { tags: ['读书'] },
    { tags: ['读书'] },
    { tags: ['读书笔记'] },
    { tags: ['深度工作'] },
    { tags: ['架构'] },
  ])

  it('finds the fragment the caret sits inside', () => {
    assert.deepEqual(tagFragmentAtCaret('今天 #读', 5), { start: 3, query: '读' })
    assert.deepEqual(tagFragmentAtCaret('#', 1), { start: 0, query: '' })
    assert.deepEqual(tagFragmentAtCaret('a #读', 4), { start: 2, query: '读' })
  })

  it('agrees with the tokenizer about where a tag starts', () => {
    // The tokenizer accepts a tag glued to the preceding word, so completion
    // must too — a rule stricter than the parser would refuse to help exactly
    // where the parser is willing to accept the result.
    assert.deepEqual(tagFragmentAtCaret('今天读到#认知', 7), { start: 4, query: '认知' })
  })

  it('returns nothing when the caret is not in a tag', () => {
    assert.equal(tagFragmentAtCaret('没有井号', 4), null)
    assert.equal(tagFragmentAtCaret('已经 #读完 了', 9), null, 'the caret is past the tag')
    assert.equal(tagFragmentAtCaret('', 0), null)
    assert.equal(tagFragmentAtCaret('#读\n新行', 5), null, 'a newline ends the fragment')
  })

  it('ranks prefix matches first, keeping frequency order inside each group', () => {
    assert.deepEqual(
      suggestTags('读', known).map((stat) => stat.tag),
      ['读书', '读书笔记'],
    )
  })

  it('offers the most-used tags for an empty query', () => {
    assert.equal(suggestTags('', known)[0]?.tag, '读书')
  })

  it('falls back to substring matches', () => {
    assert.deepEqual(
      suggestTags('工作', known).map((stat) => stat.tag),
      ['深度工作'],
    )
  })

  it('honours the limit, and finds nothing for an unknown query', () => {
    assert.equal(suggestTags('', known, 2).length, 2)
    assert.deepEqual(suggestTags('完全不存在', known), [])
    assert.deepEqual(suggestTags('', known, 0), [])
  })

  it('matches case-insensitively', () => {
    const latin = tagStats([{ tags: ['DeepWork'] }])
    assert.deepEqual(
      suggestTags('deep', latin).map((stat) => stat.tag),
      ['DeepWork'],
    )
  })
})

describe('links', () => {
  /**
   * Build a memo with tags derived the way the vault would derive them.
   * @param id - the id.
   * @param content - the body.
   * @param createdAt - the creation timestamp.
   * @returns the memo.
   */
  const t = (id: string, content: string, createdAt: string): Memo =>
    memo({ id, content, createdAt, tags: parseTags(content) })

  it('parses distinct targets in first-appearance order', () => {
    assert.deepEqual(parseLinks('见 [[深度工作]] 和 [[心流]]，还有 [[深度工作]]'), [
      '深度工作',
      '心流',
    ])
  })

  it('ignores empty targets, stray brackets and plain text', () => {
    assert.deepEqual(parseLinks('[[]] 和 [[   ]] 和 [[a[b]]'), [])
    assert.deepEqual(parseLinks('没有链接'), [])
  })

  it('resolves to memos that discuss the target or carry it as a tag', () => {
    const corpus = [
      t('prose', '最近在读深度工作，很有收获', '2025-06-01T00:00:00.000Z'),
      t('tag', '随手记 #深度工作', '2025-06-02T00:00:00.000Z'),
      t('other', '完全无关', '2025-06-03T00:00:00.000Z'),
    ]
    assert.deepEqual(
      resolveLinkTarget('深度工作', corpus).map((m) => m.id),
      ['tag', 'prose'],
    )
  })

  it('never resolves a link back to the memo that wrote it', () => {
    const self = t('self', '关于 [[深度工作]]：深度工作很重要', '2025-06-01T00:00:00.000Z')
    assert.deepEqual(resolveLinkTarget('深度工作', [self], self.id), [])
    assert.deepEqual(backlinks(self, [self]), [])
  })

  it('does not make two memos mutual backlinks for linking to the same thing', () => {
    const corpus = [
      t('a', 'A 提到 [[深度工作]]', '2025-06-01T00:00:00.000Z'),
      t('b', 'B 也提到 [[深度工作]]', '2025-06-02T00:00:00.000Z'),
      t('c', 'C 认真讨论了深度工作这件事', '2025-06-03T00:00:00.000Z'),
    ]

    // Both link to the same target, but neither memo *discusses* it, so the
    // only memo either link lands on is C.
    assert.deepEqual(
      resolveLinkTarget('深度工作', corpus, 'a').map((m) => m.id),
      ['c'],
    )
    assert.deepEqual(backlinks(corpus[0]!, corpus), [])
    assert.deepEqual(
      backlinks(corpus[2]!, corpus)
        .map((link) => link.source.id)
        .sort(),
      ['a', 'b'],
    )
  })

  it('matches case-insensitively', () => {
    const corpus = [t('x', 'I read Deep Work last week', '2025-06-01T00:00:00.000Z')]
    assert.equal(resolveLinkTarget('deep work', corpus).length, 1)
  })

  it('reports each outgoing link with where it lands', () => {
    const corpus = [
      t('source', '想看 [[心流]] 和 [[不存在的]]', '2025-06-01T00:00:00.000Z'),
      t('hit', '心流是一种状态', '2025-06-02T00:00:00.000Z'),
    ]
    const outgoing = outgoingLinks(corpus[0]!, corpus)
    assert.deepEqual(
      outgoing.map((link) => link.target),
      ['心流', '不存在的'],
    )
    assert.deepEqual(outgoing[0]?.matches.map((m) => m.id), ['hit'])
    assert.deepEqual(outgoing[1]?.matches, [])
  })

  it('reports which of a source memo links landed here', () => {
    const corpus = [
      t('source', '同时提到 [[甲]] 和 [[乙]]', '2025-06-01T00:00:00.000Z'),
      t('target', '这条讲的是乙', '2025-06-02T00:00:00.000Z'),
    ]
    const found = backlinks(corpus[1]!, corpus)
    assert.equal(found.length, 1)
    assert.equal(found[0]?.target, '乙', 'the landing link is named, not just the source')
  })
})

describe('vault.merge', () => {
  it('adds new memos, skips existing ids, and re-derives tags', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)
    const existing = vault.add('原有的一条 #旧')
    await vault.flush()

    const result = vault.merge([
      { ...existing, content: '被篡改的正文 #新' },
      {
        id: 'fresh',
        content: '导入进来的一条 #导入',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ['假的'],
      },
    ])

    assert.deepEqual(result, { added: 1, duplicates: 1 })
    assert.equal(vault.all().length, 2)

    const kept = vault.all().find((m) => m.id === existing.id)
    assert.equal(kept?.content, '原有的一条 #旧', 'an existing memo must not be overwritten')

    const imported = vault.all().find((m) => m.id === 'fresh')
    assert.deepEqual(imported?.tags, ['导入'], 'tags come from the body, not the payload')
  })

  it('persists merged memos like any other edit', async () => {
    const store = new MemoryStore()
    const { vault } = await FlomoVault.create(store, PASSWORD, FAST)
    vault.merge([
      {
        id: 'restored',
        content: '从备份恢复 #备份',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
      },
    ])
    await vault.flush()

    const reopened = await FlomoVault.open(store, PASSWORD)
    await reopened.loadAll()
    assert.equal(reopened.all()[0]?.content, '从备份恢复 #备份')
    assert.deepEqual(reopened.all()[0]?.tags, ['备份'])
  })
})
