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

import {
  activeTodoCount,
  backlinks,
  corpusStats,
  dailyReview,
  dayOf,
  exportFilename,
  hasTag,
  memosToJson,
  memosToMarkdown,
  outgoingLinks,
  randomWalk,
  resolveLinkTarget,
  searchMemos,
} from '@flomo/core'
import type { Memo } from '@flomo/core'

import { Composer } from './Composer.tsx'
import { readComposeDeepLink, readMemoDeepLink, readShareTarget } from './deep-link.ts'
import { loadReviewScope, saveReviewScope } from './review-scope.ts'
import type { ReviewScope } from '@flomo/core'
import { downloadText } from './download.ts'
import { Feed } from './Feed.tsx'
import { Sidebar } from './Sidebar.tsx'
import { HeatmapView } from './HeatmapView.tsx'
import { InsightView } from './InsightView.tsx'
import { TodoView } from './TodoView.tsx'
import { AI_PRESETS, loadAiConfig, saveAiConfig } from './ai-insights.ts'
import type { AiConfig } from './ai-insights.ts'
import { UnlockGate } from './UnlockGate.tsx'
import { injectFlomoStyles } from './styles.ts'
import { useFlomoSession } from './useFlomoSession.ts'
import { useShortcuts } from './shortcuts.ts'
import type { ShortcutAction } from './shortcuts.ts'
import { showsComposer, sameView, viewTitle, diaryTagOf } from './views.ts'
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

/** The views the column title's dropdown offers, in flomo's order. */
const VIEW_MENU: Array<{ kind: 'todo' | 'all' | 'review' | 'random' | 'settings'; label: string }> = [
  { kind: 'todo', label: 'TODO' },
  { kind: 'all', label: '全部笔记' },
  { kind: 'review', label: '每日回顾' },
  { kind: 'random', label: '随机漫步' },
  { kind: 'settings', label: '设置' },
]

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
  const [view, setView] = useState<FlomoView>(() => {
    const memoId = typeof location === 'undefined' ? null : readMemoDeepLink(location.hash)
    return memoId ? { kind: 'focus', id: memoId } : { kind: 'all' }
  })
  const [query, setQuery] = useState('')
  const [randomTick, setRandomTick] = useState(0)
  const [composeToken, setComposeToken] = useState(0)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The #compose= deep link: parsed once at startup, held until the capture box
  // has actually mounted with it, then dropped — so a later remount of the
  // composer never resurrects text the user may already have sent or edited.
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig())
  const [aiSaved, setAiSaved] = useState(false)
  const [reviewScope, setReviewScope] = useState<ReviewScope>(() => loadReviewScope())
  const [composePreset, setComposePreset] = useState<string | null>(() => {
    if (typeof location === 'undefined') return null
    return readComposeDeepLink(location.hash) ?? readShareTarget(location.search)
  })
  const probed = useRef(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const titleMenu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (injectStyles) injectFlomoStyles()
  }, [injectStyles])

  // The address bar should not keep the note: strip the fragment as soon as the
  // app has read it, so a refresh or a shared bookmark starts clean.
  useEffect(() => {
    if (typeof location === 'undefined') return
    if (
      location.hash.startsWith('#compose=') ||
      location.hash.startsWith('#memo=') ||
      location.search !== ''
    ) {
      // The app keeps no URL state, so a consumed deep link leaves nothing behind.
      history.replaceState(null, '', location.pathname)
    }
  }, [])

  // Consumed once the capture box has mounted with the preset in hand.
  useEffect(() => {
    if (composePreset === null) return
    if (snapshot.status === 'unlocked' && showsComposer(view)) {
      const timer = setTimeout(() => setComposePreset(null), 0)
      return () => clearTimeout(timer)
    }
  }, [composePreset, snapshot.status, view])

  // The title dropdown closes on any click outside it and on Escape. Both listen
  // only while the menu is open; the click is heard on `pointerdown` so the menu
  // is gone before the click's `click` half can land somewhere new.
  useEffect(() => {
    if (!menuOpen) return undefined
    const closeOnPointer = (event: PointerEvent) => {
      if (titleMenu.current && !titleMenu.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  // Probe the remote exactly once. The ref guard matters because `refresh`
  // briefly parks the status back on 'probing', which would otherwise re-enter.
  useEffect(() => {
    if (probed.current) return
    probed.current = true
    void session.refresh()
  }, [session])

  const visible = useMemo(() => {
    if (view.kind === 'tag') return searchMemos(snapshot.memos, { tag: view.tag, text: query })
    if (view.kind === 'day') {
      const ofDay = snapshot.memos.filter((memo) => dayOf(memo.createdAt) === view.day)
      return searchMemos(ofDay, { text: query })
    }
    if (view.kind === 'all') return searchMemos(snapshot.memos, { text: query })
    return []
  }, [snapshot.memos, view, query])

  const reviewMemos = useMemo(
    () => (view.kind === 'review' ? dailyReview(snapshot.memos, reviewScope) : []),
    [snapshot.memos, view.kind, reviewScope],
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

  // Narrowed to plain values before the hooks, so the memo dependencies are the
  // link target and the memo id rather than the whole view object.
  const linkTarget = view.kind === 'link' ? view.target : null
  const focusId = view.kind === 'focus' ? view.id : null

  const linkMatches = useMemo(
    () => (linkTarget === null ? [] : resolveLinkTarget(linkTarget, snapshot.memos)),
    [linkTarget, snapshot.memos],
  )

  /** Link results narrowed by the search box, mirroring the tag view. */
  const linkVisible = useMemo(
    () => (query.trim() === '' ? linkMatches : searchMemos(linkMatches, { text: query })),
    [linkMatches, query],
  )

  const focused = useMemo(
    () => (focusId === null ? null : (snapshot.memos.find((memo) => memo.id === focusId) ?? null)),
    [focusId, snapshot.memos],
  )

  const focusedLinks = useMemo(
    () => (focused === null ? [] : outgoingLinks(focused, snapshot.memos)),
    [focused, snapshot.memos],
  )

  const focusedBacklinks = useMemo(
    () => (focused === null ? [] : backlinks(focused, snapshot.memos)),
    [focused, snapshot.memos],
  )

  const handleTagClick = useCallback((tag: string) => {
    setView({ kind: 'tag', tag })
    setQuery('')
  }, [])

  // The day's diary lives under one nested tag, so the tag view *is* the diary
  // page: every memo filed there shows up, and the feed's composer stays at
  // hand. First visit of the day creates the memo — after that the button is
  // a pure jump, which keeps one diary per day by construction.
  const diaryTag = diaryTagOf(dayOf(new Date()))
  const handleDiary = useCallback(() => {
    const tag = diaryTagOf(dayOf(new Date()))
    if (!snapshot.memos.some((memo) => hasTag(memo, tag))) {
      session.add(`#${tag}`)
    }
    setView({ kind: 'tag', tag })
    setQuery('')
  }, [snapshot.memos, session])

  const handleAdd = useCallback(
    (content: string) => {
      session.add(content)
      // Writing is the common case, so pull the user back to the live feed if
      // they were browsing a tag or a review panel.
      if (view.kind !== 'all') setView({ kind: 'all' })
    },
    [session, view.kind],
  )

  const handleAddImage = useCallback(
    (bytes: Uint8Array, mime: string) => session.addImage(bytes, mime),
    [session],
  )

  const handleReadImage = useCallback(
    (ref: string) => session.readImage(ref),
    [session],
  )

  const handleImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget
      const file = input.files?.[0]
      if (!file) return
      try {
        setImportMessage(await session.importJson(await file.text()))
      } catch (error) {
        setImportMessage(
          `导入失败：${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        // Cleared so picking the same file twice still fires a change event.
        input.value = ''
      }
    },
    [session],
  )

  const handleLinkClick = useCallback((target: string) => {
    setView({ kind: 'link', target })
    setQuery('')
  }, [])

  const handleOpen = useCallback((id: string) => {
    setView({ kind: 'focus', id })
    setQuery('')
  }, [])

  // 批注: pull the user back to the capture box with the referenced memo's
  // link already in it — flomo's flow, exactly.
  const handleAnnotate = useCallback(
    (memo: Memo) => {
      setView({ kind: 'all' })
      setQuery('')
      setComposePreset(`@[${memo.id}] `)
      setComposeToken((token) => token + 1)
    },
    [],
  )

  /**
   * The mutation and navigation callbacks every feed shares.
   *
   * Built once and spread into each `<Feed>`, so adding a callback does not mean
   * remembering to thread it through five call sites.
   */
  const memoHandlers = useMemo(
    () => ({
      onEdit: (id: string, content: string) => session.edit(id, content),
      onRemove: (id: string) => session.remove(id),
      onPin: (id: string) => session.pin(id),
      onTagClick: handleTagClick,
      onLinkClick: handleLinkClick,
      onOpen: handleOpen,
      onAnnotate: handleAnnotate,
      readImage: handleReadImage,
    }),
    [session, handleTagClick, handleLinkClick, handleOpen, handleAnnotate, handleReadImage],
  )

  const handleShortcut = useCallback(
    (action: ShortcutAction) => {
      switch (action.kind) {
        case 'search':
          searchInput.current?.focus()
          searchInput.current?.select()
          return
        case 'compose':
          // The composer only exists where writing makes sense, so on a panel
          // that has none, go to the feed first — the key should never be a
          // silent no-op.
          if (!showsComposer(view)) setView({ kind: 'all' })
          setComposeToken((token) => token + 1)
          return
        case 'view':
          setView({ kind: action.view })
          setQuery('')
          return
      }
    },
    [view],
  )

  useShortcuts(handleShortcut)

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
        onCreate={(password, options) => void session.create(password, options)}
        onUnlock={(password, options) => void session.unlock(password, options)}
        onUnlockWithRecovery={(code, options) => void session.unlockWithRecovery(code, options)}
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
        todoCount={activeTodoCount(snapshot.todos)}
        onSelect={(next) => {
          setView(next)
          setQuery('')
        }}
        onDiary={handleDiary}
        diaryTag={diaryTag}
        brand={brand}
        showSettings={showSettings}
      />

      <main className="fl-main">
        <div className="fl-column">
          <div className="fl-column-head">
            <div className="fl-title-wrap" ref={titleMenu}>
              <h1 className="fl-column-title">
                <button
                  type="button"
                  className="fl-title-toggle"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  {viewTitle(view)}
                  <span className="fl-title-caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
              </h1>
              {menuOpen ? (
                <div className="fl-title-menu" role="menu" aria-label="切换视图">
                  {VIEW_MENU.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      role="menuitem"
                      className="fl-title-menu-item"
                      data-current={sameView(view, { kind: item.kind }) ? 'true' : 'false'}
                      onClick={() => {
                        setView({ kind: item.kind })
                        setQuery('')
                        setMenuOpen(false)
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {view.kind === 'all' ||
            view.kind === 'tag' ||
            view.kind === 'day' ||
            view.kind === 'link' ? (
              <div className="fl-search">
                <input
                  ref={searchInput}
                  type="search"
                  value={query}
                  placeholder="搜索…"
                  aria-label="搜索 MEMO"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <span className="fl-search-kbd" aria-hidden="true">
                  <kbd>Ctrl</kbd>
                  <kbd>K</kbd>
                </span>
              </div>
            ) : null}
          </div>

          {snapshot.offline ? (
            <div className="fl-notice">
              <span>
                离线中：下面显示的是本机缓存的密文副本。改动要等联网后才会写进仓库。
              </span>
            </div>
          ) : null}

          {snapshot.error ? (
            <div className="fl-notice fl-notice-error">
              <span>{snapshot.error}</span>
              <button type="button" className="fl-button fl-button-ghost" onClick={() => void session.save()}>
                重试保存
              </button>
            </div>
          ) : null}

          {showsComposer(view) ? (
            <Composer
              onSubmit={handleAdd}
              onAddImage={handleAddImage}
              knownTags={snapshot.tags}
              initialValue={composePreset ?? undefined}
              preset={composePreset ?? undefined}
              recentMemos={snapshot.memos}
              focusToken={composeToken}
            />
          ) : null}

          {/* The calendar and the headline numbers live in the sidebar, the way flomo
              arranges them — they describe the whole corpus, so above the feed they
              only pushed the notes down the page. What is left here is the one
              number that belongs to this list rather than to the corpus. */}
          {view.kind === 'all' || view.kind === 'day' ? (
            <div className="fl-stats-strip fl-list-stats">
              <span>
                共 <strong>{visible.length}</strong> 条
              </span>
              <span>{snapshot.saving ? '保存中…' : savedLabel(snapshot.lastSavedAt)}</span>
            </div>
          ) : null}

          {view.kind === 'todo' ? (
            /* Bound conditionally on purpose: a backend without todo support
               must arrive here as `undefined`, which is exactly the signal
               TodoView uses to show its "use the web app" notice. */
            <TodoView
              todos={snapshot.todos}
              onAdd={session.addTodo?.bind(session)}
              onEdit={session.editTodo?.bind(session)}
              onToggle={session.toggleTodo?.bind(session)}
              onRemove={session.removeTodo?.bind(session)}
              onClearCompleted={session.clearCompletedTodos?.bind(session)}
            />
          ) : null}

          {view.kind === 'all' || view.kind === 'tag' || view.kind === 'day' ? (
            <Feed
              memos={visible}
              emptyText={
                searching || view.kind === 'tag'
                  ? '没有匹配的记录。'
                  : view.kind === 'day'
                    ? '这一天还没有记录。'
                    : '还没有记录，写下第一条吧。'
              }
              {...memoHandlers}
            />
          ) : null}

          {view.kind === 'link' ? (
            <Feed
              memos={linkVisible}
              emptyText={`还没有人用散文或标签提到过「${linkTarget}」。`}
              {...memoHandlers}
            />
          ) : null}

          {view.kind === 'focus' ? (
            focused === null ? (
              <div className="fl-empty">这条记录已经不在了。</div>
            ) : (
              <>
                <div className="fl-card-lg">
                  <Feed memos={[focused]} {...memoHandlers} />
                </div>

                {focusedLinks.length > 0 ? (
                  <>
                    <div className="fl-sidebar-section" style={{ margin: '24px 0 6px' }}>
                      出链
                    </div>
                    <div className="fl-link-list">
                      {focusedLinks.map((link) => (
                        <button
                          key={link.target}
                          type="button"
                          className="fl-link-row"
                          onClick={() => handleLinkClick(link.target)}
                          title={
                            link.matches.length === 0
                              ? '还没有记录提到它'
                              : `${link.matches.length} 条记录`
                          }
                        >
                          <span className="fl-tag-name">[[{link.target}]]</span>
                          <span className="fl-nav-count">{link.matches.length}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                <div className="fl-sidebar-section" style={{ margin: '24px 0 6px' }}>
                  反向链接 {focusedBacklinks.length}
                </div>
                {focusedBacklinks.length === 0 ? (
                  <p className="fl-review-note">
                    还没有其他记录链接到这里。在别处写 <code>[[正文里的一个词]]</code> 就会连过来。
                  </p>
                ) : (
                  <Feed
                    memos={focusedBacklinks.map((link) => link.source)}
                    {...memoHandlers}
                  />
                )}
              </>
            )
          ) : null}

          {view.kind === 'review' ? (
            <>
              <p className="fl-review-note">
                每天固定抽出一批旧笔记。每天来看一次，等于和过去的自己碰个面。范围设置只影响明天的抽取。
              </p>
              <div className="fl-review-settings">
                <div className="fl-review-setting">
                  <span className="fl-review-label">内容范围</span>
                  <div className="fl-review-options">
                    {([['all', '全部内容'], ['include', '包含标签'], ['exclude', '排除标签'], ['untagged', '无标签']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className="fl-review-option"
                        data-active={reviewScope.tagMode === mode}
                        onClick={() => {
                          const next = { ...reviewScope, tagMode: mode }
                          setReviewScope(next)
                          saveReviewScope(next)
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {reviewScope.tagMode === 'include' || reviewScope.tagMode === 'exclude' ? (
                    <select
                      className="fl-review-tag"
                      value={reviewScope.tag}
                      onChange={(event) => {
                        const next = { ...reviewScope, tag: event.target.value }
                        setReviewScope(next)
                        saveReviewScope(next)
                      }}
                    >
                      <option value="">选择标签…</option>
                      {snapshot.tags.map((tag) => (
                        <option key={tag.tag} value={tag.tag}>
                          #{tag.tag}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <div className="fl-review-setting">
                  <span className="fl-review-label">时间范围</span>
                  <div className="fl-review-options">
                    {([['全部时间', null], ['1 年内', 12], ['6 个月内', 6], ['3 个月内', 3], ['1 个月内', 1]] as const).map(([label, months]) => (
                      <button
                        key={label}
                        type="button"
                        className="fl-review-option"
                        data-active={reviewScope.months === months}
                        onClick={() => {
                          const next = { ...reviewScope, months }
                          setReviewScope(next)
                          saveReviewScope(next)
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fl-review-setting">
                  <span className="fl-review-label">回顾数量</span>
                  <div className="fl-review-options">
                    {[4, 8, 12, 16, 20, 24].map((count) => (
                      <button
                        key={count}
                        type="button"
                        className="fl-review-option"
                        data-active={reviewScope.count === count}
                        onClick={() => {
                          const next = { ...reviewScope, count }
                          setReviewScope(next)
                          saveReviewScope(next)
                        }}
                      >
                        {count} 条/天
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Feed
                memos={reviewMemos}
                emptyText="还没有足够的旧记录可供回顾。"
                {...memoHandlers}
              />
            </>
          ) : null}

          {view.kind === 'heatmap' ? (
            <HeatmapView
              memos={snapshot.memos}
              onSelectDay={(day) => {
                setView({ kind: 'day', day })
                setQuery('')
              }}
            />
          ) : null}

          {view.kind === 'insight' ? (
            <InsightView
              memos={snapshot.memos}
              tags={snapshot.tags.map((tag) => tag.tag)}
              onOpenSettings={() => setView({ kind: 'settings' })}
              onSaveNote={(content) => session.add(content)}
            />
          ) : null}

      {view.kind === 'random' ? (
            <>
              <p className="fl-review-note">随机漫步：每次一条，翻到哪里算哪里。</p>
              {randomMemo ? (
                <div className="fl-card-lg">
                  <Feed memos={[randomMemo]} {...memoHandlers} />
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
                  <label className="fl-button" style={{ cursor: 'pointer' }}>
                    导入 JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="fl-visually-hidden"
                      onChange={(event) => void handleImport(event)}
                    />
                  </label>
                </div>
                <p className="fl-recovery-hint">
                  导出的是明文。请把它放在你信任的地方 —— 这也是万一忘记密码和恢复码时，
                  唯一能把文字带走的办法。
                </p>
                <p className="fl-recovery-hint">
                  导入是<strong>只增不改</strong>的：id 相同的记录会被跳过，
                  不会覆盖你现在的版本。
                </p>
                {importMessage ? (
                  <pre className="fl-import-report">{importMessage}</pre>
                ) : null}
              </div>
              {renderSettingsExtra?.()}
              <div className="fl-card-lg" style={{ marginTop: 16 }}>
                <h3 className="fl-settings-title">AI 洞察服务</h3>
                <p className="fl-review-note">
                  洞察会把所选笔记的明文发送给你自己的 AI 服务商。任何 OpenAI 兼容端点都可以：
                  DeepSeek 官方、opencode 套餐的网关、GLM 开放平台等。密钥只存在本机。
                </p>
                <div className="fl-insight-presets">
                  {AI_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="fl-insight-scope-option"
                      title={preset.hint}
                      onClick={() => setAiConfig({ ...aiConfig, baseUrl: preset.baseUrl, model: preset.model })}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
                <div className="fl-field">
                  <span className="fl-field-label">Base URL（不含 /chat/completions）</span>
                  <input
                    className="fl-input"
                    value={aiConfig.baseUrl}
                    onChange={(event) => setAiConfig({ ...aiConfig, baseUrl: event.target.value })}
                    placeholder="https://api.deepseek.com"
                    spellCheck={false}
                  />
                </div>
                <div className="fl-field">
                  <span className="fl-field-label">API Key</span>
                  <input
                    className="fl-input"
                    type="password"
                    value={aiConfig.apiKey}
                    onChange={(event) => setAiConfig({ ...aiConfig, apiKey: event.target.value })}
                    placeholder="sk-…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="fl-field">
                  <span className="fl-field-label">模型</span>
                  <input
                    className="fl-input"
                    value={aiConfig.model}
                    onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })}
                    placeholder="deepseek-chat"
                    spellCheck={false}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="fl-button fl-button-primary"
                    disabled={aiConfig.apiKey.trim() === ''}
                    onClick={() => {
                      saveAiConfig(aiConfig)
                      setAiSaved(true)
                    }}
                  >
                    保存 AI 设置
                  </button>
                  {aiSaved ? <span className="fl-recovery-hint">已保存 ✓</span> : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  )
}
