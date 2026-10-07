/**
 * Unit tests for AI 洞察's pure parts: corpus assembly, config storage, and the
 * history list. The network call itself is exercised in the browser run.
 *
 * @module flomo-ui/test/ai-insights
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Memo } from '@flomo/core'

import {
  DEFAULT_AI_CONFIG,
  PERSPECTIVES,
  addHistory,
  buildCorpus,
  loadAiConfig,
  loadHistory,
  removeHistory,
  saveAiConfig,
} from '../src/ai-insights.ts'

/** A memo with just the fields the corpus builder reads. */
function memo(content: string, tags: string[] = [], createdAt = '2026-10-07T10:00:00.000Z'): Memo {
  return { id: content, content, tags, createdAt, updatedAt: createdAt }
}

/** A storage stand-in backed by a map. */
function fakeArea() {
  const backing = new Map<string, string>()
  return {
    backing,
    area: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    },
  }
}

describe('buildCorpus', () => {
  const memos = [
    memo('最新一条 #工作', ['工作'], '2026-10-07T10:00:00.000Z'),
    memo('中间一条', [], '2026-10-06T10:00:00.000Z'),
    memo('最早一条 #读书', ['读书'], '2026-10-05T10:00:00.000Z'),
  ]

  it('formats each note with its day and tags, newest first', () => {
    const corpus = buildCorpus(memos, null)
    assert.ok(corpus.startsWith('以下是用户'))
    assert.ok(corpus.includes('#### 2026-10-07 #工作\n最新一条 #工作'))
    assert.ok(corpus.includes('#### 2026-10-05 #读书\n最早一条 #读书'))
  })

  it('applies the limit to the newest notes', () => {
    const corpus = buildCorpus(memos, 1)
    assert.ok(corpus.includes('最新一条'))
    assert.ok(!corpus.includes('最早一条'), 'older notes are cut by the limit')
  })

  it('filters by tag before the limit', () => {
    const corpus = buildCorpus(memos, 1, '读书')
    assert.ok(corpus.includes('最早一条'))
    assert.ok(!corpus.includes('最新一条'))
  })

  it('truncates an over-long note', () => {
    const long = memo('x'.repeat(3000))
    const corpus = buildCorpus([long], null)
    assert.ok(corpus.includes('（本条过长已截断）'))
    assert.ok(corpus.length < 3000)
  })

  it('returns empty for an empty pool', () => {
    assert.equal(buildCorpus([], null), '')
    assert.equal(buildCorpus(memos, 5, '不存在的标签'), '')
  })
})

describe('perspectives', () => {
  it('offers the six built-in perspectives with unique prompts', () => {
    assert.equal(PERSPECTIVES.length, 6)
    const ids = new Set(PERSPECTIVES.map((p) => p.id))
    const prompts = new Set(PERSPECTIVES.map((p) => p.prompt))
    assert.equal(ids.size, 6)
    assert.equal(prompts.size, 6)
    for (const perspective of PERSPECTIVES) {
      assert.ok(perspective.name.length > 0)
      assert.ok(perspective.prompt.length > 40, `${perspective.id} carries a real prompt`)
    }
  })
})

describe('ai config storage', () => {
  it('round-trips and falls back to defaults', () => {
    const { area } = fakeArea()
    assert.deepEqual(loadAiConfig(area), DEFAULT_AI_CONFIG)

    saveAiConfig({ baseUrl: 'https://gw.example.com', apiKey: 'sk-x', model: 'deepseek-reasoner' }, area)
    assert.deepEqual(loadAiConfig(area), {
      baseUrl: 'https://gw.example.com',
      apiKey: 'sk-x',
      model: 'deepseek-reasoner',
    })
  })

  it('fills missing fields with defaults and tolerates broken storage', () => {
    const { area, backing } = fakeArea()
    backing.set('flomo-sim:ai:v1', JSON.stringify({ apiKey: 'only-key' }))
    assert.deepEqual(loadAiConfig(area), { ...DEFAULT_AI_CONFIG, apiKey: 'only-key' })

    backing.set('flomo-sim:ai:v1', '{broken')
    assert.deepEqual(loadAiConfig(area), DEFAULT_AI_CONFIG)
    assert.deepEqual(loadAiConfig(undefined), DEFAULT_AI_CONFIG)
  })
})

describe('insight history', () => {
  const run = (id: number): Parameters<typeof addHistory>[0] => ({
    id,
    perspectiveId: 'default',
    perspectiveName: '默认洞察',
    scopeLabel: '最近 50 条',
    content: `结果 ${id}`,
  })

  it('prepends new runs and caps the list', () => {
    const { area } = fakeArea()
    for (let id = 1; id <= 12; id += 1) addHistory(run(id), area)
    const history = loadHistory(area)
    assert.equal(history.length, 10)
    assert.equal(history[0]?.id, 12, 'newest first')
  })

  it('removes one entry by id', () => {
    const { area } = fakeArea()
    addHistory(run(1), area)
    addHistory(run(2), area)
    const history = removeHistory(1, area)
    assert.deepEqual(history.map((item) => item.id), [2])
  })

  it('survives broken storage and junk on disk', () => {
    const { area, backing } = fakeArea()
    backing.set('flomo-sim:insights:v1', '{oops')
    assert.deepEqual(loadHistory(area), [])
    assert.doesNotThrow(() => addHistory(run(1), {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }))
    assert.deepEqual(loadHistory(undefined), [])
  })
})
