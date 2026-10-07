/**
 * The AI 洞察 view: pick a perspective, send a scope of notes to the configured
 * OpenAI-compatible endpoint, and read the answer rendered like any note.
 *
 * The privacy line is on the screen, not buried in docs: running an insight
 * sends those notes' plaintext to the configured provider. History stays local
 * (last ten runs in localStorage).
 *
 * @module @flomo/ui/InsightView
 */

import type * as React from 'react'
import { useCallback, useState } from 'react'

import {
  PERSPECTIVES,
  SCOPE_OPTIONS,
  addHistory,
  buildCorpus,
  loadAiConfig,
  loadHistory,
  removeHistory,
} from './ai-insights.ts'
import type { StoredInsight } from './ai-insights.ts'
import { MarkdownBody } from './MarkdownBody.tsx'
import type { Memo } from '@flomo/core'

export interface InsightViewProps {
  /** The whole corpus, newest first. */
  memos: readonly Memo[]
  /** All tag names, for the scope picker. */
  tags: readonly string[]
  /** Opens the settings view (where the AI provider is configured). */
  onOpenSettings: () => void
  /** Saves an insight's text as a new memo. */
  onSaveNote: (content: string) => void
}

/** Which notes a run sends. */
interface Scope {
  label: string
  limit: number | null
  tag?: string
}

/**
 * The AI 洞察 view element.
 * @param props - the corpus and the settings/save callbacks.
 * @returns the view element.
 */
export function InsightView({
  memos,
  tags,
  onOpenSettings,
  onSaveNote,
}: InsightViewProps): React.ReactElement {
  const [config] = useState(() => loadAiConfig())
  const [scope, setScope] = useState<Scope>({ label: SCOPE_OPTIONS[1]?.label ?? '全部笔记', limit: SCOPE_OPTIONS[1]?.limit ?? null })
  const [scopeTag, setScopeTag] = useState<string | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StoredInsight | null>(null)
  const [history, setHistory] = useState<StoredInsight[]>(() => loadHistory())
  const [showHistory, setShowHistory] = useState(false)

  const configured = config.apiKey.trim() !== ''

  const run = useCallback(
    async (perspectiveId: string): Promise<void> => {
      if (running) return
      const perspective = PERSPECTIVES.find((p) => p.id === perspectiveId)
      if (perspective === undefined) return
      const corpus = buildCorpus(memos, scope.limit, scopeTag)
      if (corpus === '') {
        setError('所选范围内没有笔记。')
        return
      }
      setError(null)
      setRunning(true)
      setResult(null)
      try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: perspective.prompt },
              { role: 'user', content: corpus },
            ],
            temperature: 0.7,
            stream: false,
          }),
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`AI 服务返回 ${response.status}：${body.slice(0, 200)}`)
        }
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const content = data.choices?.[0]?.message?.content
        if (typeof content !== 'string' || content === '') {
          throw new Error('AI 服务返回了空结果。')
        }
        const insight: StoredInsight = {
          id: Date.now(),
          perspectiveId: perspective.id,
          perspectiveName: perspective.name,
          scopeLabel: scopeTag !== undefined ? `${scope.label} · #${scopeTag}` : scope.label,
          content,
        }
        setResult(insight)
        setHistory(addHistory(insight))
      } catch (caught) {
        if (caught instanceof TypeError && /fetch/i.test(caught.message)) {
          // A blocked preflight surfaces as a bare TypeError: name the likely
          // cause and the providers this page is known to work with.
          setError(
            '请求被浏览器跨域拦截：该服务商不允许网页直连。已验证可直连：智谱 GLM、DeepSeek 官方、Moonshot（见设置页预设）。',
          )
        } else {
          setError(
            caught instanceof Error
              ? caught.message
              : '洞察失败：请检查网络与 AI 服务配置后重试。',
          )
        }
      } finally {
        setRunning(false)
      }
    },
    [running, memos, scope, scopeTag, config],
  )

  return (
    <>
      {configured ? null : (
        <div className="fl-notice fl-notice-error">
          <span>
            还没有配置 AI 服务——洞察会把所选笔记的<strong>明文</strong>发送给你自己的
            AI 服务商，请先在设置里填写 Base URL、API Key 和模型。
          </span>
          <button type="button" className="fl-button fl-button-ghost" onClick={onOpenSettings}>
            去设置
          </button>
        </div>
      )}

      <div className="fl-insight-hero">
        <h2 className="fl-insight-slogan">
          选择任意视角<span className="fl-insight-slogan-accent">，开始洞察</span>
        </h2>
        <p className="fl-insight-statsline">
          {memos.length} 条笔记 / {tags.length} 标签
          {scopeTag !== undefined ? ` / 范围：#${scopeTag}` : ''}
        </p>
        <div className="fl-insight-scope">
          {SCOPE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className="fl-insight-scope-option"
              data-active={scope.label === option.label && scopeTag === undefined}
              onClick={() => {
                setScope({ label: option.label, limit: option.limit })
                setScopeTag(undefined)
              }}
            >
              {option.label}
            </button>
          ))}
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="fl-insight-scope-option"
              data-active={scopeTag === tag}
              onClick={() => setScopeTag(tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      <div className="fl-insight-grid">
        {PERSPECTIVES.map((perspective) => (
          <button
            key={perspective.id}
            type="button"
            className="fl-insight-card"
            disabled={running || !configured}
            onClick={() => void run(perspective.id)}
            title={perspective.desc}
          >
            <span className="fl-insight-emoji" aria-hidden="true">
              {perspective.emoji}
            </span>
            <span className="fl-insight-card-text">
              <span className="fl-insight-name">
                {perspective.name} <em className="fl-insight-by">by {perspective.by}</em>
              </span>
              <span className="fl-insight-desc">{perspective.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {running ? (
        <div className="fl-insight-running">
          <span className="fl-spinner" /> 正在洞察…（把笔记交给模型，可能需要十几秒）
        </div>
      ) : null}

      {error !== null ? (
        <div className="fl-notice fl-notice-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {result !== null ? (
        <div className="fl-insight-result">
          <div className="fl-insight-result-head">
            <span>
              {result.perspectiveName} · {result.scopeLabel}
            </span>
            <span className="fl-insight-result-actions">
              <button
                type="button"
                className="fl-button fl-button-ghost"
                onClick={() => void navigator.clipboard.writeText(result.content).catch(() => {})}
              >
                复制
              </button>
              <button
                type="button"
                className="fl-button"
                onClick={() => onSaveNote(result.content)}
              >
                存为笔记
              </button>
            </span>
          </div>
          <div className="fl-insight-result-body">
            <MarkdownBody content={result.content} />
          </div>
        </div>
      ) : null}

      <div className="fl-insight-history">
        <button
          type="button"
          className="fl-insight-history-toggle"
          onClick={() => setShowHistory((open) => !open)}
        >
          {showHistory ? '收起历史洞察' : `历史洞察（${history.length}）`}
        </button>
        {showHistory ? (
          history.length === 0 ? (
            <p className="fl-insight-history-empty">还没有历史洞察。</p>
          ) : (
            history.map((item) => (
              <div key={item.id} className="fl-insight-history-item">
                <button
                  type="button"
                  className="fl-insight-history-open"
                  onClick={() => {
                    setResult(item)
                    setShowHistory(false)
                  }}
                >
                  <span>
                    {item.perspectiveName} · {item.scopeLabel}
                  </span>
                  <span className="fl-insight-history-time">
                    {new Date(item.id).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="fl-button fl-button-ghost"
                  aria-label="删除这条历史"
                  onClick={() => setHistory(removeHistory(item.id))}
                >
                  删除
                </button>
              </div>
            ))
          )
        ) : null}
      </div>
    </>
  )
}
