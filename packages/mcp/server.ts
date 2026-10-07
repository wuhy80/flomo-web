/**
 * The flomo MCP server: a Model Context Protocol endpoint over stdio that
 * gives a model the same vault the browser uses.
 *
 * The protocol surface is spoken by hand — MCP is newline-delimited JSON-RPC
 * 2.0, and the server only needs `initialize`, `tools/list` and `tools/call`,
 * so the zero-dependency rule that holds for the rest of the workspace holds
 * here too. Everything a tool does goes through {@link FlomoVault}: the server
 * opens the repository's encrypted vault with the password (or the recovery
 * code) from its environment, decrypts in this process, and pushes sealed
 * shards back through the same GitHub contents store the web app uses.
 *
 * Secrets stay on the machine running the server — it is the browser story
 * with one more local program holding the key.
 *
 * @module @flomo/mcp/server
 */

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_REVIEW_SCOPE,
  FlomoVault,
  GitHubContentsStore,
  dailyReview,
  searchMemos,
  tagStats,
} from '@flomo/core'
import type { Memo, TextStore } from '@flomo/core'

/** Announced in `initialize`, and in the stderr banner on startup. */
const SERVER_INFO = { name: 'flomo-mcp', title: 'flomo 笔记', version: '0.1.0' }

/** The protocol version this server speaks when the client names none. */
const PROTOCOL_VERSION = '2025-06-18'

/** How many memos the listings return unless the model asks otherwise. */
const DEFAULT_LIST_LIMIT = 20

/** Upper bound for the listings, so a runaway model cannot dump the vault. */
const MAX_LIST_LIMIT = 200

/** How many memos 每日回顾 surfaces unless asked otherwise. */
const DEFAULT_REVIEW_COUNT = 8

/** An environment that is missing its connection settings. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'

  constructor(message: string) {
    super(message)
  }
}

/** The connection settings the environment carries. */
export interface McpConfig {
  token: string
  owner: string
  repo: string
  branch?: string
  password?: string
  recoveryCode?: string
}

/**
 * Read the connection settings from the environment.
 *
 * MCP clients launch the server with an `env` block, so the environment is the
 * whole configuration surface: `FLOMO_GITHUB_TOKEN`, `FLOMO_REPO`
 * (`owner/repo`), optional `FLOMO_BRANCH`, and either `FLOMO_PASSWORD` or
 * `FLOMO_RECOVERY_CODE` to unlock the vault.
 * @param env - the environment to read; defaults to `process.env`.
 * @returns the parsed settings.
 * @throws {ConfigError} naming the missing pieces when settings are absent.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const missing: string[] = []
  const token = env.FLOMO_GITHUB_TOKEN?.trim() ?? ''
  if (token === '') missing.push('FLOMO_GITHUB_TOKEN（GitHub fine-grained PAT）')
  const repoField = env.FLOMO_REPO?.trim() ?? ''
  const [owner = '', repo = ''] = repoField.split('/')
  if (owner === '' || repo === '') missing.push('FLOMO_REPO（格式 owner/repo）')
  if (missing.length > 0) {
    throw new ConfigError(`缺少环境变量：${missing.join('、')}。MCP 客户端的 mcpServers 配置里需要带 env。`)
  }
  const password = env.FLOMO_PASSWORD?.trim() ?? ''
  const recoveryCode = env.FLOMO_RECOVERY_CODE?.trim() ?? ''
  if (password === '' && recoveryCode === '') {
    throw new ConfigError('缺少解锁凭据：请设置 FLOMO_PASSWORD（保险库密码）或 FLOMO_RECOVERY_CODE（创建保险库时的恢复码）。')
  }
  return {
    token,
    owner,
    repo,
    branch: env.FLOMO_BRANCH?.trim() || undefined,
    password: password || undefined,
    recoveryCode: recoveryCode || undefined,
  }
}

/** The state one server instance carries across calls. */
export interface McpState {
  env: NodeJS.ProcessEnv
  /** The backing store, injectable so tests run against a memory vault. */
  store?: TextStore
  vault: FlomoVault | null
}

/**
 * Build the state for one server instance.
 * @param options - the environment to read settings from, and an optional
 *   prebuilt store that replaces the GitHub client (tests).
 * @returns the fresh state, vault not yet opened.
 */
export function createState(
  options: { env?: NodeJS.ProcessEnv; store?: TextStore } = {},
): McpState {
  return { env: options.env ?? process.env, store: options.store, vault: null }
}

/**
 * Open the vault on first use.
 *
 * Everything is derived from the environment each launch, so a server run is
 * stateless: clients can restart it at will.
 * @param state - the server state.
 * @returns the unlocked vault with every shard loaded.
 */
async function ensureVault(state: McpState): Promise<FlomoVault> {
  if (state.vault !== null) return state.vault
  const store =
    state.store ??
    new GitHubContentsStore(readConfig(state.env))
  if (!(await FlomoVault.exists(store))) {
    throw new Error('仓库里没有 vault.json：请先在网页端创建保险库，再运行本服务器。')
  }
  const recoveryCode = state.env.FLOMO_RECOVERY_CODE?.trim() ?? ''
  const password = state.env.FLOMO_PASSWORD?.trim() ?? ''
  const vault =
    recoveryCode !== ''
      ? await FlomoVault.openWithRecovery(store, recoveryCode)
      : await FlomoVault.open(store, password)
  await vault.loadAll()
  state.vault = vault
  return vault
}

/** The model-facing view of one memo — no fields the model cannot act on. */
function memoView(memo: Memo): Record<string, unknown> {
  return { id: memo.id, createdAt: memo.createdAt, tags: memo.tags, content: memo.content }
}

/** Clamp an integer argument into a safe range. */
function clampCount(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(parsed, 1), max)
}

/** The five tools, mirroring the DSH plugin's agent surface. */
const TOOLS = [
  {
    name: 'flomo_add',
    description: '写一条 flomo 笔记。标签写在正文里（例如「读完《深度工作》 #读书」），保存后手机和网页都能看到。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '笔记正文，标签以 # 写在正文里，多级标签用 / 分隔（#读书/认知）。' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'flomo_recent',
    description: '看最近写的 flomo 笔记，新的在前。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: `返回多少条（默认 ${DEFAULT_LIST_LIMIT}，最多 ${MAX_LIST_LIMIT}）。` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flomo_search',
    description: '搜索 flomo 笔记：按正文关键词、按标签，或两者组合。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '正文的大小写不敏感子串。省略则只按标签筛选。' },
        tag: { type: 'string', description: '限定标签，不带开头的 #，多级标签写全路径（读书/认知）。' },
        limit: { type: 'integer', description: `最多返回多少条（默认 ${DEFAULT_LIST_LIMIT}）。` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flomo_daily_review',
    description: '每日回顾：从过去的笔记里按 flomo 的规则挑几条重现。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', description: `要几条（默认 ${DEFAULT_REVIEW_COUNT}，最多 24）。` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flomo_tags',
    description: '列出全部 flomo 标签及其笔记数。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const

/**
 * Run one tool.
 * @param state - the server state.
 * @param name - the tool name.
 * @param args - the model's arguments.
 * @returns the JSON-serializable result.
 */
async function runTool(
  state: McpState,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'flomo_add': {
      const content = typeof args.content === 'string' ? args.content.trim() : ''
      if (content === '') throw new Error('content 不能为空：笔记正文是一段文本，标签写在正文里。')
      const vault = await ensureVault(state)
      const memo = vault.add(content)
      const written = await vault.flush()
      return { saved: memoView(memo), written }
    }
    case 'flomo_recent': {
      const vault = await ensureVault(state)
      const limit = clampCount(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      const memos = vault.all().slice(0, limit)
      return { total: vault.all().length, memos: memos.map(memoView) }
    }
    case 'flomo_search': {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const tag = typeof args.tag === 'string' ? args.tag.trim() : ''
      if (query === '' && tag === '') {
        throw new Error('query 和 tag 至少给一个：按正文搜索、按标签筛选，或两者组合。')
      }
      const vault = await ensureVault(state)
      const memos = searchMemos(vault.all(), {
        text: query || undefined,
        tag: tag || undefined,
        limit: clampCount(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
      })
      return { memos: memos.map(memoView) }
    }
    case 'flomo_daily_review': {
      const vault = await ensureVault(state)
      const scope = { ...DEFAULT_REVIEW_SCOPE, count: clampCount(args.count, DEFAULT_REVIEW_COUNT, 24) }
      const memos = dailyReview(vault.all(), scope)
      return { memos: memos.map(memoView) }
    }
    case 'flomo_tags': {
      const vault = await ensureVault(state)
      return { tags: tagStats(vault.all()) }
    }
    default:
      throw new Error(`未知工具 ${name}。可用工具：${TOOLS.map((tool) => tool.name).join('、')}。`)
  }
}

/** Turn a thrown value into the text an MCP error result carries. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** One JSON-RPC message as it arrives on stdin. */
export interface IncomingMessage {
  jsonrpc?: unknown
  id?: string | number | null
  method?: unknown
  params?: Record<string, unknown>
}

/** A response, or `null` when the message was a notification. */
export type OutgoingMessage = Record<string, unknown> | null

/** Build a success response. */
function result(id: string | number | null, value: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value }
}

/** Build an error response. */
function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/**
 * Handle one JSON-RPC message.
 *
 * Notifications (no id) answer with `null` — nothing goes back on stdout.
 * Tool failures do not become protocol errors: MCP models read
 * `isError: true` better than a JSON-RPC stack trace.
 * @param state - the server state.
 * @param message - the parsed message.
 * @returns the response, or `null` for notifications.
 */
export async function handleMessage(
  state: McpState,
  message: IncomingMessage,
): Promise<OutgoingMessage> {
  const id = message.id ?? null
  const hasId = typeof message.id === 'string' || typeof message.id === 'number'
  const method = typeof message.method === 'string' ? message.method : ''
  if (method === '') {
    return hasId ? rpcError(id, -32600, '无效请求：缺少 method。') : null
  }
  // Notifications (no id) never get an answer, whatever the method is.
  if (!hasId) return null

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion:
          typeof message.params?.protocolVersion === 'string'
            ? (message.params.protocolVersion as string)
            : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    case 'ping':
      return result(id, {})
    case 'tools/list':
      return result(id, { tools: TOOLS })
    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? (message.params.name as string) : ''
      const args =
        message.params?.arguments !== null && typeof message.params?.arguments === 'object'
          ? (message.params.arguments as Record<string, unknown>)
          : {}
      try {
        const data = await runTool(state, name, args)
        return result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
      } catch (error) {
        return result(id, { content: [{ type: 'text', text: describe(error) }], isError: true })
      }
    }
    default:
      return rpcError(id, -32601, `未知方法 ${method}。`)
  }
}

/**
 * Read stdin line by line, answer each message on stdout.
 *
 * stdout carries protocol and nothing else — any logging belongs on stderr,
 * where MCP clients route it to their own logs instead of the model.
 */
async function main(): Promise<void> {
  const state = createState()
  let configured = '未配置'
  try {
    const config = readConfig()
    configured = `${config.owner}/${config.repo}`
  } catch {
    // The banner says 未配置; the first tool call explains what is missing.
  }
  console.error(`flomo-mcp ${SERVER_INFO.version} 就绪（${configured}）；凭据只留在本机。`)

  let buffer = ''
  for await (const chunk of process.stdin) {
    buffer += typeof chunk === 'string' ? chunk : String(chunk)
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (line === '') continue
      let message: IncomingMessage
      try {
        message = JSON.parse(line) as IncomingMessage
      } catch {
        // A line that is not JSON gets an error only when someone awaits it.
        console.error(`忽略无法解析的一行：${line.slice(0, 80)}`)
        continue
      }
      try {
        const outgoing = await handleMessage(state, message)
        if (outgoing !== null) {
          void process.stdout.write(`${JSON.stringify(outgoing)}\n`)
        }
      } catch (error) {
        const id = message.id ?? null
        void process.stdout.write(`${JSON.stringify(rpcError(id, -32603, describe(error)))}\n`)
      }
    }
  }
}

// Run only when launched directly; tests import the exported handlers.
const isDirectRun = (() => {
  try {
    return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()

if (isDirectRun) void main()
