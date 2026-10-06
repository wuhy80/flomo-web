/**
 * The flomo shell: sidebar, capture box, feed, and the review views.
 *
 * This component is deliberately backend-agnostic. It renders whatever
 * {@link FlomoSession} it is handed, which is what lets the identical UI run as
 * a standalone web app and as a panel inside the DeepSeek Harness.
 *
 * @module @flomo/ui/FlomoApp
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { corpusStats, dailyReview, exportFilename, memosToJson, memosToMarkdown, randomWalk, searchMemos } from '@flomo/core'

import { Composer } from './Composer.tsx'
import { downloadText } from './download.ts'
import { Feed } from './Feed.tsx'
import { Heatmap } from './Heatmap.tsx'
import { Sidebar } from './Sidebar.tsx'
import { UnlockGate } from './UnlockGate.tsx'
import { injectFlomoStyles } from './styles.ts'
import { useFlomoSession } from './useFlomoSession.ts'
import { sameView, viewTitle } from './views.ts'
import type { FlomoView } from './views.ts'
import type { FlomoSession } from './session.ts'

export interface FlomoAppProps {
  /** The data backend. */
  session: FlomoSession
  /** Brand text in the sidebar and gate. */
  brand?: string
  /** Hide the settings row when the host owns configuration. */
  showSettings?: boolean
  /** Extra settings content supplied by the host. */
  renderSettingsExtra?: () => React.ReactNode
  /**
   * Rendered when the backend has no repository configured yet.
   *
   * A browser session is always constructed *with* a repository, so only a
   * host-owned session can be unconfigured. The DSH panel supplies the
   * connection form here.
   */
  renderUnconfigured?: () => React.ReactNode
  /** Inject the stylesheet on mount. */
  injectStyles?: boolean
}

/**
 * Format a save timestamp for the status strip.
 * @param iso - ISO timestamp, or null when nothing has been saved yet.
 * @returns a short label.
 */
function savedLabel(iso: string | null): string {
  if (!iso) return '尚未保存'
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `已保存 ${hh}:${mm}`
}

/**
 * The application shell.
 * @param props - the session and presentation options.
 * @returns the app element.
 */
export function FlomoApp({
  session,
  brand = 'flomo',
  showSettings = true,
  renderSettingsExtra,
  renderUnconfigured,
  injectStyles = true,
}: FlomoAppProps): React.ReactElement {
  const snapshot = useFlomoSession(session)
  const [view, setView] = useState<FlomoView>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [randomTick, setRandomTick] = useState(0)
  const probed = useRef(false)

  useEffect(() => {
    if (injectStyles) injectFlomoStyles()
  }, [injectStyles])

  // Probe the remote exactly once. The ref guard matters because `refresh`
  // briefly parks the status back on 'probing', which would otherwise re-enter.
  useEffect(() => {
    if (probed.current) return
    probed.current = true
    void session.refresh()
  }, [session])

  const visible = useMemo(() => {
    if (view.kind === 'tag') return searchMemos(snapshot.memos, { tag: view.tag, text: query })
    if (view.kind === 'all') return searchMemos(snapshot.memos, { text: query })
    return []
  }, [snapshot.memos, view, query])

  const reviewMemos = useMemo(
    () => (view.kind === 'review' ? dailyReview(snapshot.memos, 3) : []),
    [snapshot.memos, view.kind],
  )

  const randomMemo = useMemo(
    () => (view.kind === 'random' ? randomWalk(snapshot.memos) : null),
    // `randomTick` participates on purpose: it is the "再抽一条" trigger.
    [snapshot.memos, view.kind, randomTick],
  )

  const stats = useMemo(
    () => corpusStats(snapshot.memos, snapshot.tags.length),
    [snapshot.memos, snapshot.tags.length],
  )

  const handleTagClick = useCallback((tag: string) => {
    setView({ kind: 'tag', tag })
    setQuery('')
  }, [])

  const handleAdd = useCallback(
    (content: string) => {
      session.add(content)
      // Writing is the common case, so pull the user back to the live feed if
      // they were browsing a tag or a review panel.
      if (view.kind !== 'all') setView({ kind: 'all' })
    },
    [session, view.kind],
  )

  if (snapshot.status === 'probing') {
    return (
      <div className="fl-root">
        <div className="fl-main">
          <div className="fl-loading">
            <span className="fl-spinner" />
            正在连接保险库…
          </div>
        </div>
      </div>
    )
  }

  if (snapshot.status === 'unconfigured') {
    if (renderUnconfigured) {
      return (
        <div className="fl-root">
          <div className="fl-main">
            <div className="fl-column">{renderUnconfigured()}</div>
          </div>
        </div>
      )
    }
    return (
      <div className="fl-root">
        <div className="fl-main">
          <div className="fl-empty">尚未配置数据仓库。</div>
        </div>
      </div>
    )
  }

  if (snapshot.status !== 'unlocked') {
    return (
      <UnlockGate
        hasVault={snapshot.status !== 'empty'}
        status={snapshot.status}
        error={snapshot.error}
        recoveryCode={snapshot.recoveryCode}
        brand={brand}
        onCreate={(password) => void session.create(password)}
        onUnlock={(password) => void session.unlock(password)}
        onUnlockWithRecovery={(code) => void session.unlockWithRecovery(code)}
        onDismissRecovery={() => session.dismissRecovery()}
      />
    )
  }

  const searching = query.trim().length > 0

  return (
    <div className="fl-root">
      <Sidebar
        view={view}
        memos={snapshot.memos}
        tags={snapshot.tags}
        onSelect={(next) => {
          setView(next)
          setQuery('')
        }}
        brand={brand}
        showSettings={showSettings}
      />

      <main className="fl-main">
        <div className="fl-column">
          <div className="fl-column-head">
            <h1 className="fl-column-title">{viewTitle(view)}</h1>
            {view.kind === 'all' || view.kind === 'tag' ? (
              <div className="fl-search">
                <input
                  type="search"
                  value={query}
                  placeholder="搜索…"
                  aria-label="搜索 MEMO"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : null}
          </div>

          {snapshot.error ? (
            <div className="fl-notice fl-notice-error">
              <span>{snapshot.error}</span>
              <button type="button" className="fl-button fl-button-ghost" onClick={() => void session.save()}>
                重试保存
              </button>
            </div>
          ) : null}

          {view.kind !== 'settings' && view.kind !== 'random' ? (
            <Composer onSubmit={handleAdd} />
          ) : null}

          {view.kind === 'all' || view.kind === 'tag' ? (
            <>
              <Heatmap memos={snapshot.memos} />
              <div className="fl-stats-strip">
                <span>
                  共 <strong>{stats.memos}</strong> 条
                </span>
                <span>
                  连续 <strong>{stats.streak}</strong> 天
                </span>
                <span>
                  标签 <strong>{stats.tags}</strong> 个
                </span>
                <span>{snapshot.saving ? '保存中…' : savedLabel(snapshot.lastSavedAt)}</span>
              </div>
              <Feed
                memos={visible}
                emptyText={
                  searching || view.kind === 'tag'
                    ? '没有匹配的记录。'
                    : '还没有记录，写下第一条吧。'
                }
                onEdit={(id, content) => session.edit(id, content)}
                onRemove={(id) => session.remove(id)}
                onPin={(id) => session.pin(id)}
                onTagClick={handleTagClick}
              />
            </>
          ) : null}

          {view.kind === 'review' ? (
            <>
              <p className="fl-review-note">
                从旧记录里抽出的三条，今天固定不变。每天来看一次，等于和过去的自己碰个面。
              </p>
              <Feed
                memos={reviewMemos}
                emptyText="还没有足够的旧记录可供回顾。"
                onEdit={(id, content) => session.edit(id, content)}
                onRemove={(id) => session.remove(id)}
                onPin={(id) => session.pin(id)}
                onTagClick={handleTagClick}
              />
            </>
          ) : null}

          {view.kind === 'random' ? (
            <>
              <p className="fl-review-note">随机漫步：每次一条，翻到哪里算哪里。</p>
              {randomMemo ? (
                <div className="fl-card-lg">
                  <Feed
                    memos={[randomMemo]}
                    onEdit={(id, content) => session.edit(id, content)}
                    onRemove={(id) => session.remove(id)}
                    onPin={(id) => session.pin(id)}
                    onTagClick={handleTagClick}
                  />
                </div>
              ) : (
                <div className="fl-empty">还没有记录。</div>
              )}
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="fl-button"
                  onClick={() => setRandomTick((n) => n + 1)}
                >
                  再抽一条
                </button>
              </div>
            </>
          ) : null}

          {view.kind === 'settings' ? (
            <>
              <div className="fl-card-lg">
                <div className="fl-stats-strip" style={{ marginTop: 0 }}>
                  <span>
                    笔记 <strong>{stats.memos}</strong> 条
                  </span>
                  <span>
                    标签 <strong>{stats.tags}</strong> 个
                  </span>
                  <span>
                    活跃 <strong>{stats.activeDays}</strong> 天
                  </span>
                  <span>
                    连续 <strong>{stats.streak}</strong> 天
                  </span>
                </div>
                <p className="fl-review-note" style={{ marginTop: 14 }}>
                  笔记以 AES-256-GCM 加密后存放，密码不会离开本机。请务必另存好恢复码 ——
                  忘记密码时它是唯一的入口。
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="fl-button fl-button-primary"
                    onClick={() => void session.save()}
                    disabled={snapshot.saving}
                  >
                    {snapshot.saving ? '保存中…' : '立即保存'}
                  </button>
                  <button
                    type="button"
                    className="fl-button"
                    disabled={snapshot.memos.length === 0}
                    onClick={() =>
                      downloadText(
                        exportFilename('md'),
                        memosToMarkdown(snapshot.memos),
                        'text/markdown',
                      )
                    }
                  >
                    导出 Markdown
                  </button>
                  <button
                    type="button"
                    className="fl-button"
                    disabled={snapshot.memos.length === 0}
                    onClick={() =>
                      downloadText(
                        exportFilename('json'),
                        memosToJson(snapshot.memos),
                        'application/json',
                      )
                    }
                  >
                    导出 JSON
                  </button>
                </div>
                <p className="fl-recovery-hint">
                  导出的是明文。请把它放在你信任的地方 —— 这也是万一忘记密码和恢复码时，
                  唯一能把文字带走的办法。
                </p>
              </div>
              {renderSettingsExtra?.()}
            </>
          ) : null}
        </div>
      </main>
    </div>
  )
}
