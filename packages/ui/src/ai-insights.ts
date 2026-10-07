/**
 * AI 洞察：perspectives, corpus assembly, and local storage for config/history.
 *
 * The design point is that the app has no server: the browser holds the
 * decrypted notes after unlock and calls an **OpenAI-compatible** chat
 * completions endpoint directly (DeepSeek, an OpenCode-style gateway, GLM's
 * open platform, anything speaking that protocol). The user brings their own
 * API key, stored here like the GitHub token already is — with one honest
 * difference worth stating in the UI: running an insight sends those notes'
 * *plaintext* to whichever provider is configured.
 *
 * @module @flomo/ui/ai-insights
 */

import { dayOf } from '@flomo/core'
import type { Memo } from '@flomo/core'

/** One analysis perspective: the what, the why, and the prompt that drives it. */
export interface Perspective {
  id: string
  name: string
  emoji: string
  by: string
  desc: string
  /** The system prompt sent with the notes. */
  prompt: string
}

/** The built-in perspectives, mirroring flomo's menu. */
export const PERSPECTIVES: readonly Perspective[] = [
  {
    id: 'default',
    name: '默认洞察',
    emoji: '🧠',
    by: 'flomo',
    desc: '挖掘笔记背后隐藏的思维模式与深层内在关注点',
    prompt:
      '你是一位善于从笔记中发现规律的思考伙伴。用户会给你一段时间内的全部笔记。请：' +
      '1) 挖掘笔记背后反复出现的思维模式与深层关注点；' +
      '2) 指出用户自己可能没有意识到的习惯与惯性；' +
      '3) 给出 2-3 条具体可行的下一步建议。' +
      '用中文输出，使用 Markdown 小标题组织结构；引用笔记原文时用引号标注。',
  },
  {
    id: 'values',
    name: '价值澄清',
    emoji: '⚖️',
    by: '@shaonan',
    desc: '从笔记里找出你真正看重的东西，从混乱的想法中提炼价值观',
    prompt:
      '你是一位价值观教练。用户会给你一段时间内的笔记。请从混乱的日常记录中提炼出' +
      '用户真正看重的东西：1) 归纳 3-5 条核心价值观，每条附上笔记中的证据（引用原文）；' +
      '2) 指出言行不一致的地方——嘴上看重 A、时间却花在 B 上的例子；' +
      '3) 用一段话总结"如果把注意力只放在一件事上，应该是什么"。' +
      '用中文输出，使用 Markdown 小标题组织结构。',
  },
  {
    id: 'inversion',
    name: '逆向思考',
    emoji: '↩️',
    by: 'flomo',
    desc: '通过芒格的逆向思维来考察笔记中的关键问题',
    prompt:
      '你运用查理·芒格的逆向思维来考察用户的笔记："反过来想，总是反过来想。"请：' +
      '1) 从笔记中归纳用户正在努力的 2-4 个领域；' +
      '2) 对每个领域回答：基于笔记中暴露的行为模式，**怎样做一定会失败**？列出具体的失败路径（引用笔记作为证据）；' +
      '3) 把失败路径反过来，给出一张"避免清单"。' +
      '用中文输出，使用 Markdown 小标题组织结构，语气直接、不奉承。',
  },
  {
    id: 'second-order',
    name: '二阶思维',
    emoji: '🪜',
    by: '@shaonan',
    desc: '从笔记中识别出问题，并提炼出问题之上的二阶思考',
    prompt:
      '你运用霍华德·马克斯的二阶思维来审视用户的笔记。请：' +
      '1) 从笔记中识别出用户记录的关键问题与决定；' +
      '2) 对每一个推演：一阶后果（直接发生什么）→ 二阶后果（然后呢？别人会怎么反应？一年后呢？）；' +
      '3) 指出哪些记录说明用户只想到一阶就停下了，并补全缺失的二阶思考。' +
      '用中文输出，使用 Markdown 小标题组织结构。',
  },
  {
    id: 'cbt',
    name: 'CBT 疗法',
    emoji: '🧩',
    by: 'flomo',
    desc: '识别笔记中的思维陷阱并提供具体的改善建议',
    prompt:
      '你以认知行为疗法（CBT）的视角阅读用户的笔记。请：' +
      '1) 识别笔记中的自动化思维与常见认知扭曲（灾难化、非黑即白、过度概括、读心术等），每条引用原文并对应该扭曲类型；' +
      '2) 对最突出的两条，给出认知重构的具体示例（事实是什么 → 想法是什么 → 更平衡的想法是什么）；' +
      '3) 给出可以在下周练习的 2-3 个小行动。' +
      '结尾提醒：这是自我观察工具，不是医疗建议；如果情绪困扰持续，请寻求专业帮助。' +
      '用中文输出，使用 Markdown 小标题组织结构。',
  },
  {
    id: 'mbti',
    name: 'MBTI 分析',
    emoji: '🎭',
    by: 'flomo',
    desc: '从你的笔记内容中解读真实的 MBTI 人格倾向',
    prompt:
      '你基于笔记内容推断用户的 MBTI 人格倾向。请对四个维度逐一分析：' +
      'E/I（能量来源）、S/N（信息偏好）、T/F（决策方式）、J/P（生活方式），' +
      '每个维度：给出倾向判断 + 引用笔记中支持该判断的具体证据 + 标注该判断的置信度（高/中/低）。' +
      '最后综合一个类型假说，并明确提醒：这只是基于有限笔记样本的推测，不是人格测试。' +
      '用中文输出，使用 Markdown 小标题组织结构。',
  },
]

/** How many recent notes a run sends, and the labels shown for each choice. */
export const SCOPE_OPTIONS: ReadonlyArray<{ label: string; limit: number | null }> = [
  { label: '最近 50 条', limit: 50 },
  { label: '最近 200 条', limit: 200 },
  { label: '全部笔记', limit: null },
]

/** Longest single note body sent to the model; longer notes are truncated. */
const MAX_NOTE_CHARS = 2000

/**
 * Assemble the notes into one user message.
 * @param memos - the corpus, newest first as the session provides it.
 * @param limit - how many recent notes to include; null for all.
 * @param tag - optional tag filter applied before the limit.
 * @returns the formatted message text.
 */
export function buildCorpus(memos: readonly Memo[], limit: number | null, tag?: string): string {
  const pool = tag === undefined ? memos : memos.filter((memo) => memo.tags.includes(tag))
  const chosen = (limit === null ? pool : pool.slice(0, limit)).filter(
    (memo) => memo.content.trim() !== '',
  )
  if (chosen.length === 0) return ''
  const blocks = chosen.map((memo) => {
    const body =
      memo.content.length > MAX_NOTE_CHARS
        ? `${memo.content.slice(0, MAX_NOTE_CHARS)}…（本条过长已截断）`
        : memo.content
    const tags = memo.tags.length > 0 ? ` ${memo.tags.map((tag) => `#${tag}`).join(' ')}` : ''
    return `#### ${dayOf(memo.createdAt)}${tags}\n${body}`
  })
  const newest = chosen[0]
  const oldest = chosen[chosen.length - 1]
  if (newest === undefined || oldest === undefined) return ''
  const span = `（共收录 ${chosen.length} 条，最新为 ${dayOf(newest.createdAt)}，最早为 ${dayOf(oldest.createdAt)}）`
  return `以下是用户 ${span} 的笔记：\n\n${blocks.join('\n\n')}`
}

/**
 * One-tap provider presets. Every entry is verified to answer browser
 * preflights with CORS headers — opencode's gateway, for one, does not, so a
 * plan key behind it cannot be used from a web page directly.
 */
export const AI_PRESETS: ReadonlyArray<{ name: string; baseUrl: string; model: string; hint?: string }> = [
  {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5-flash',
    hint: 'glm-4.5-flash 免费，注册 open.bigmodel.cn 即得 API Key',
  },
  {
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: 'platform.deepseek.com 充值后生成 Key，按量计费',
  },
  {
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: 'platform.moonshot.cn 生成 Key',
  },
]

/** The AI provider settings a user configures in 设置. */
export interface AiConfig {
  /** OpenAI-compatible base URL, no trailing slash — e.g. https://api.deepseek.com */
  baseUrl: string
  /** The API key of the configured provider. */
  apiKey: string
  /** The model name, e.g. deepseek-chat. */
  model: string
}

/** `localStorage` key holding the AI settings. */
const CONFIG_KEY = 'flomo-sim:ai:v1'

/** The DeepSeek defaults; any OpenAI-compatible endpoint works by overwriting. */
export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
}

/** The slice of `Storage` this module needs, so a test can inject a stand-in. */
export type AiArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Read the AI settings; missing fields fall back to the DeepSeek defaults.
 * @param area - storage to read; defaults to the browser's `localStorage`.
 * @returns the effective config (never partial).
 */
export function loadAiConfig(area: AiArea | undefined = defaultArea()): AiConfig {
  if (area === undefined) return { ...DEFAULT_AI_CONFIG }
  try {
    const raw = area.getItem(CONFIG_KEY)
    const parsed = raw === null ? {} : (JSON.parse(raw) as Partial<AiConfig>)
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl !== '' ? parsed.baseUrl : DEFAULT_AI_CONFIG.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model !== '' ? parsed.model : DEFAULT_AI_CONFIG.model,
    }
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

/**
 * Persist the AI settings.
 * @param config - the settings to store.
 * @param area - storage to write; defaults to the browser's `localStorage`.
 */
export function saveAiConfig(config: AiConfig, area: AiArea | undefined = defaultArea()): void {
  if (area === undefined) return
  try {
    area.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Storage unavailable: the settings simply do not persist.
  }
}

/** One stored insight result. */
export interface StoredInsight {
  /** Run identifier: the completion timestamp in milliseconds. */
  id: number
  /** The perspective's id at run time. */
  perspectiveId: string
  /** The perspective's name at run time, kept for display. */
  perspectiveName: string
  /** Human description of the scope that was sent. */
  scopeLabel: string
  /** The model's full answer. */
  content: string
}

/** `localStorage` key holding the insight history. */
const HISTORY_KEY = 'flomo-sim:insights:v1'

/** At most this many results are remembered. */
export const MAX_HISTORY = 10

/**
 * Read the insight history, newest first.
 * @param area - storage to read; defaults to the browser's `localStorage`.
 * @returns the stored results, or an empty list when none or unreadable.
 */
export function loadHistory(area: AiArea | undefined = defaultArea()): StoredInsight[] {
  if (area === undefined) return []
  try {
    const raw = area.getItem(HISTORY_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isStoredInsight) : []
  } catch {
    return []
  }
}

/**
 * Prepend a result to the history, trimming to {@link MAX_HISTORY}.
 * @param insight - the finished run.
 * @param area - storage to write; defaults to the browser's `localStorage`.
 * @returns the updated history.
 */
export function addHistory(
  insight: StoredInsight,
  area: AiArea | undefined = defaultArea(),
): StoredInsight[] {
  const history = [insight, ...loadHistory(area)].slice(0, MAX_HISTORY)
  if (area !== undefined) {
    try {
      area.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      // Quota or private mode: the run still shows; it just is not remembered.
    }
  }
  return history
}

/**
 * Remove one stored result.
 * @param id - the run id to drop.
 * @param area - storage to read and write.
 * @returns the updated history.
 */
export function removeHistory(id: number, area: AiArea | undefined = defaultArea()): StoredInsight[] {
  const history = loadHistory(area).filter((item) => item.id !== id)
  if (area !== undefined) {
    try {
      area.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      // Best effort.
    }
  }
  return history
}

function isStoredInsight(value: unknown): value is StoredInsight {
  const v = value as Partial<StoredInsight>
  return (
    typeof v.id === 'number' &&
    typeof v.perspectiveId === 'string' &&
    typeof v.perspectiveName === 'string' &&
    typeof v.scopeLabel === 'string' &&
    typeof v.content === 'string'
  )
}

function defaultArea(): AiArea | undefined {
  return globalThis.localStorage
}
