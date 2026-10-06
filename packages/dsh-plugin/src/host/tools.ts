/**
 * Agent tools for flomo.
 *
 * These are the DSH-native counterpart of the panel: every one drives the same
 * {@link FlomoHostService} the browser drives, so a memo captured in chat shows
 * up in the sidebar immediately. Reads are open; the only write is
 * `flomo_add`, because editing and deleting are better done by eye.
 *
 * @module dsh-flomo/host/tools
 */

import type { ToolDefinition, ToolJson } from '@deepseek-ai/dsh-tools'

import type { Memo } from '@flomo/core'

import { DEFAULT_LIST_LIMIT } from '../host-service.ts'
import type { FlomoHostService } from '../host-service.ts'

/**
 * The `defineTool` helper, threaded in rather than imported.
 *
 * The tool package is resolved by the Harness at runtime and is not always
 * reachable from a plugin's own directory, so it is loaded lazily by the host
 * entry and passed down. A deployment that cannot resolve it loses the agent
 * tools and keeps the panel.
 */
export type DefineTool = (definition: ToolDefinition) => ToolDefinition

/**
 * Fallback used when the Harness tool package is not resolvable.
 *
 * The tool package is delivered by the Harness rather than by npm, and a
 * hot-pluggable install (a `link:` into the profile) can end up somewhere that
 * cannot resolve it. `defineTool` is a declaration helper — it fixes the
 * accepted shape and its types — so an identity implementation produces an
 * equivalent definition, and the tools keep working instead of silently
 * disappearing.
 */
export const identityDefineTool: DefineTool = (definition) => definition

/** Tool names this module registers, in registration order. */
export const FLOMO_TOOL_NAMES = [
  'flomo_add',
  'flomo_search',
  'flomo_recent',
  'flomo_daily_review',
  'flomo_tags',
  'flomo_random',
] as const

/**
 * Render a tool's value as pretty JSON for the model.
 * @param _args - the call arguments, unused.
 * @param value - the tool's canonical value.
 * @returns the content blocks.
 */
function renderJson(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * Assert a value is JSON-safe for the tool contract.
 * @param value - the value to return.
 * @returns the same value, typed.
 */
function json(value: unknown): ToolJson {
  return value as ToolJson
}

/**
 * A refusal the model is expected to read and act on, rather than an exception.
 * @param code - a stable machine-readable reason.
 * @param message - human-readable guidance.
 * @returns the refusal value.
 */
function refused(code: string, message: string): ToolJson {
  return json({ ok: false, code, message })
}

/**
 * Project a memo for the model, trimming the body when a listing is long.
 * @param memo - the memo.
 * @param maxChars - body budget; the remainder is elided.
 * @returns the projection.
 */
function memoView(memo: Memo, maxChars = 4000): Record<string, unknown> {
  const truncated = memo.content.length > maxChars
  return {
    id: memo.id,
    content: truncated ? `${memo.content.slice(0, maxChars)}…` : memo.content,
    ...(truncated ? { truncated: true } : {}),
    tags: memo.tags,
    createdAt: memo.createdAt,
    ...(memo.pinned ? { pinned: true } : {}),
  }
}

/**
 * The standard locked/unconfigured preamble every tool shares.
 * @param host - the host service.
 * @returns a refusal, or `undefined` when the vault is usable.
 */
function requireUnlocked(host: FlomoHostService): ToolJson | undefined {
  const state = host.snapshot()
  if (state.status === 'unconfigured') {
    return refused(
      'unconfigured',
      '尚未配置数据仓库。请在 DSH Web GUI 的 flomo 面板里填写仓库与 token。',
    )
  }
  if (state.status === 'locked') {
    return refused('locked', '保险库已锁定。请在 DSH Web GUI 的 flomo 面板里解锁。')
  }
  return undefined
}

/**
 * Build every flomo agent tool.
 * @param host - the shared host service.
 * @param defineTool - the Harness tool factory.
 * @returns the tool definitions, ready to register.
 */
export function buildFlomoTools(
  host: FlomoHostService,
  defineTool: DefineTool,
): ToolDefinition[] {
  const add = defineTool({
    name: 'flomo_add',
    description: [
      'Record a memo into the local flomo vault (the same store the DSH flomo panel shows).',
      'The body is written verbatim; `#tags` inside it are parsed and indexed automatically, so include them in the text rather than passing them separately.',
      'The memo is encrypted with the vault password and pushed to the user\'s private GitHub repository before this call returns, so a success means it is durable.',
      'Triggers: 记到 flomo, 记录一下, 帮我记一条, flomo add, 存进浮墨, save to flomo.',
    ].join(' '),
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The memo body, tags included inline (for example "读完《深度工作》#读书").',
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => false,
    async execute(args) {
      await host.ensureStarted()
      const gate = requireUnlocked(host)
      if (gate !== undefined) return gate
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (content === '') return refused('empty', 'content 不能为空。')
      const memo = await host.addAndSave(content)
      return json({ ok: true, memo: memoView(memo) })
    },
  })

  const search = defineTool({
    name: 'flomo_search',
    description: [
      'Full-text search over the local flomo vault, optionally restricted to one tag.',
      'Matching is a case-insensitive substring test against the memo body, newest first — predictable rather than fuzzy, which suits a personal corpus.',
      'Use flomo_recent to browse instead of search, and flomo_tags to see what tags exist.',
      'Triggers: 搜一下我的笔记, 我记过什么关于X的, flomo search, 查找记录.',
    ].join(' '),
    parameters: {
      query: { type: 'string', description: 'Substring to match against the memo body, case-insensitively. Omit to list by tag alone.' },
      tag: { type: 'string', description: 'Restrict to memos carrying this tag, without the leading #.' },
      limit: { type: 'integer', description: `Maximum results (default ${DEFAULT_LIST_LIMIT}).` },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      await host.ensureStarted()
      const gate = requireUnlocked(host)
      if (gate !== undefined) return gate
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const tag = typeof args.tag === 'string' && args.tag.trim() !== '' ? args.tag.trim().replace(/^#/, '') : undefined
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 200) : DEFAULT_LIST_LIMIT
      if (query === '' && tag === undefined) {
        return refused('empty-query', '请至少提供 query 或 tag 之一。')
      }
      const memos = host.search(query, tag, limit)
      return json({ ok: true, count: memos.length, memos: memos.map((m) => memoView(m)) })
    },
  })

  const recent = defineTool({
    name: 'flomo_recent',
    description: [
      'List the most recent memos in the local flomo vault, newest first, with pinned memos hoisted to the top.',
      'Use this to get context on what the user has been thinking about lately.',
      'Triggers: 我最近记了什么, 最近的笔记, flomo recent, 看看最新记录.',
    ].join(' '),
    parameters: {
      limit: { type: 'integer', description: `How many memos to return (default ${DEFAULT_LIST_LIMIT}, maximum 200).` },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      await host.ensureStarted()
      const gate = requireUnlocked(host)
      if (gate !== undefined) return gate
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 200) : DEFAULT_LIST_LIMIT
      const memos = host.recent(limit)
      return json({ ok: true, count: memos.length, total: host.memos().length, memos: memos.map((m) => memoView(m)) })
    },
  })

  const review = defineTool({
    name: 'flomo_daily_review',
    description: [
      'Surface the flomo daily review: a small set of older memos chosen for today.',
      'The selection is deterministic for the calendar day and excludes anything written in the last two days, so it is the same set all day and always feels like rediscovery.',
      'Use it when the user asks to revisit old notes or reflect.',
      'Triggers: 每日回顾, 回顾一下, 看看以前记的, flomo review, 随机回顾.',
    ].join(' '),
    parameters: {
      count: { type: 'integer', description: 'How many memos to surface (default 3, maximum 20).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      await host.ensureStarted()
      const gate = requireUnlocked(host)
      if (gate !== undefined) return gate
      const count = typeof args.count === 'number' ? Math.min(Math.max(Math.trunc(args.count), 1), 20) : 3
      const memos = host.review(count)
      if (memos.length === 0) return refused('empty', '还没有足够的旧记录可供回顾。')
      return json({ ok: true, count: memos.length, memos: memos.map((m) => memoView(m)) })
    },
  })

  const tags = defineTool({
    name: 'flomo_tags',
    description: [
      'List every tag in the local flomo vault with its memo count, most used first.',
      'Use it to discover the user\'s own vocabulary before searching, or to summarize what they write about.',
      'Triggers: 我的标签, 标签统计, flomo tags, 我都记了哪些主题.',
    ].join(' '),
    parameters: {
      limit: { type: 'integer', description: 'Maximum tags to return (default 100).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      await host.ensureStarted()
      const gate = requireUnlocked(host)
      if (gate !== undefined) return gate
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 500) : 100
      const all = host.tags()
      return json({
        ok: true,
        total: all.length,
        tags: all.slice(0, limit),
        stats: host.stats(),
      })
    },
  })

  const random = defineTool({
    name: 'flomo_random',
    description: [
      'Draw one memo at random from the local flomo vault — the "random walk" view.',
      'Useful for sparking a connection or showing the user something they had forgotten.',
      'Triggers: 随机漫步, 随便翻一条, flomo random, 抽一条笔记.',
    ].join(' '),
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute() {
      await host.ensureStarted()
      const gate = requireUnlocked(host)
      if (gate !== undefined) return gate
      const memo = host.random()
      if (memo === null) return refused('empty', '保险库里还没有任何记录。')
      return json({ ok: true, memo: memoView(memo) })
    },
  })

  return [add, search, recent, review, tags, random]
}
