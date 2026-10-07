/**
 * The left column: navigation, the tag index, and the settings entry.
 *
 * @module @flomo/ui/Sidebar
 */

import type * as React from 'react'
import { useMemo, useState } from 'react'

import { corpusStats, tagTree } from '@flomo/core'
import type { Memo, TagStat, TagTreeNode } from '@flomo/core'

import { loadFoldedTags, saveFoldedTags } from './folded-tags.ts'
import { Heatmap } from './Heatmap.tsx'
import { loadPinnedTags, savePinnedTags } from './pinned-tags.ts'
import { StatsModal } from './StatsModal.tsx'
import { sameView } from './views.ts'
import type { FlomoView } from './views.ts'

/**
 * Weeks of heatmap shown in the column.
 *
 * Measured off flomo itself: its calendar is 14 weeks of 16px squares at a 21px
 * pitch — 289px of grid — which is what the column here is sized to hold.
 */
const SIDEBAR_WEEKS = 14

export interface SidebarProps {
  view: FlomoView
  memos: readonly Memo[]
  tags: readonly TagStat[]
  onSelect: (view: FlomoView) => void
  /** Brand text shown at the top. */
  brand?: string
  /** Hide the settings row when the host owns configuration instead. */
  showSettings?: boolean
}

/**
 * The icon-plus-text label of one navigation row.
 *
 * flomo marks every nav row with a small glyph before the text; the glyph is
 * decorative, so it is hidden from assistive tech and the text stands alone.
 * @param props - the glyph and the row text.
 * @returns the label element.
 */
function NavLabel({ icon, text }: { icon: string; text: string }): React.ReactElement {
  return (
    <span className="fl-nav-label">
      <span className="fl-nav-icon" aria-hidden="true">
        {icon}
      </span>
      {text}
    </span>
  )
}

/**
 * The navigation column.
 * @param props - current view, the corpus, and the selection callback.
 * @returns the sidebar element.
 */
export function Sidebar({
  view,
  memos,
  tags,
  onSelect,
  brand = 'flomo',
  showSettings = true,
}: SidebarProps): React.ReactElement {
  const stats = corpusStats(memos, tags.length)
  const [statsOpen, setStatsOpen] = useState(false)
  const [pinned, setPinned] = useState<string[]>(() => loadPinnedTags())
  const [folded, setFolded] = useState<string[]>(() => loadFoldedTags())

  /**
   * Pin or unpin a tag. Pinned tags float into their own section above the
   * rest, and the list persists on this device.
   * @param tag - the tag to toggle.
   */
  const togglePin = (tag: string): void => {
    const next = pinned.includes(tag) ? pinned.filter((name) => name !== tag) : [...pinned, tag]
    setPinned(next)
    savePinnedTags(next)
  }

  /**
   * Fold or unfold one branch of the tag tree. The list of folded paths
   * persists on this device, like the pins do.
   * @param path - the full path of the branch to toggle.
   */
  const toggleFold = (path: string): void => {
    const next = folded.includes(path) ? folded.filter((item) => item !== path) : [...folded, path]
    setFolded(next)
    saveFoldedTags(next)
  }

  /**
   * Build the props for one navigation row.
   * @param target - the view the row navigates to.
   * @returns the row's attributes.
   */
  const rowProps = (target: FlomoView) => ({
    type: 'button' as const,
    className: 'fl-nav-item',
    'aria-current': sameView(view, target) ? ('true' as const) : ('false' as const),
    onClick: () => onSelect(target),
  })

  /**
   * One tag row: navigation, count, and the pin toggle.
   * @param stat - the tag and its frequency.
   * @returns the row element.
   */
  const renderTagRow = (stat: TagStat): React.ReactElement => {
    const target: FlomoView = { kind: 'tag', tag: stat.tag }
    const isPinned = pinned.includes(stat.tag)
    return (
      <button
        key={stat.tag}
        type="button"
        className="fl-tag-row"
        aria-current={sameView(view, target) ? 'true' : 'false'}
        onClick={() => onSelect(target)}
        title={`#${stat.tag}`}
      >
        <span className="fl-tag-name">#{stat.tag}</span>
        <span className="fl-nav-count">{stat.count}</span>
        <span
          role="button"
          tabIndex={0}
          className="fl-tag-pin"
          aria-pressed={isPinned}
          aria-label={isPinned ? `取消置顶 #${stat.tag}` : `置顶 #${stat.tag}`}
          title={isPinned ? '取消置顶' : '置顶'}
          onClick={(event) => {
            event.stopPropagation()
            togglePin(stat.tag)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            togglePin(stat.tag)
          }}
        >
          📌
        </span>
      </button>
    )
  }

  const pinnedRows = tags.filter((stat) => pinned.includes(stat.tag)).map(renderTagRow)

  // The hierarchy the slash syntax implies: `#读书/认知` makes `读书` a foldable
  // parent whether or not anything carries a bare `#读书`. Pinned leaves live
  // only in the pinned section; a pinned tag that is also a parent keeps its
  // place in the tree, because its children hang off it.
  const tree = useMemo(() => {
    const prunePinnedLeaves = (nodes: readonly TagTreeNode[]): TagTreeNode[] =>
      nodes
        .map((node) => ({ ...node, children: prunePinnedLeaves(node.children) }))
        .filter((node) => !(pinned.includes(node.path) && node.children.length === 0))
    return prunePinnedLeaves(tagTree(tags))
  }, [tags, pinned])

  /**
   * One level of the tree, as rows indented by depth. A branch with children
   * grows a fold arrow; the name navigates, exactly like flomo's list.
   * @param nodes - the branches to render.
   * @param depth - how far under the root this level sits.
   * @returns the rows.
   */
  const renderLevel = (nodes: readonly TagTreeNode[], depth: number): React.ReactElement[] =>
    nodes.map((node) => {
      const target: FlomoView = { kind: 'tag', tag: node.path }
      const isPinned = pinned.includes(node.path)
      const isFolded = folded.includes(node.path)
      const hasChildren = node.children.length > 0
      return (
        <div key={node.path} className="fl-tag-branch">
          <button
            type="button"
            className="fl-tag-row"
            style={depth > 0 ? { paddingLeft: 10 + depth * 14 } : undefined}
            aria-current={sameView(view, target) ? 'true' : 'false'}
            onClick={() => onSelect(target)}
            title={`#${node.path}`}
          >
            {hasChildren ? (
              <span
                role="button"
                tabIndex={0}
                className="fl-tag-fold"
                aria-expanded={!isFolded}
                aria-label={isFolded ? `展开 #${node.path}` : `折叠 #${node.path}`}
                title={isFolded ? '展开' : '折叠'}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleFold(node.path)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  toggleFold(node.path)
                }}
              >
                {isFolded ? '▸' : '▾'}
              </span>
            ) : (
              <span className="fl-tag-fold fl-tag-fold-none" aria-hidden="true" />
            )}
            <span className="fl-tag-name">#{node.name}</span>
            <span className="fl-nav-count">{node.count}</span>
            <span
              role="button"
              tabIndex={0}
              className="fl-tag-pin"
              aria-pressed={isPinned}
              aria-label={isPinned ? `取消置顶 #${node.path}` : `置顶 #${node.path}`}
              title={isPinned ? '取消置顶' : '置顶'}
              onClick={(event) => {
                event.stopPropagation()
                togglePin(node.path)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                togglePin(node.path)
              }}
            >
              📌
            </span>
          </button>
          {hasChildren && !isFolded ? renderLevel(node.children, depth + 1) : null}
        </div>
      )
    })

  const treeRows = renderLevel(tree, 0)

  return (
    <nav className="fl-sidebar" aria-label="主导航">
      <div className="fl-brand">
        <span className="fl-brand-dot" aria-hidden="true" />
        {brand}
      </div>

      {/* The headline numbers sit where flomo puts them, styled as flomo styles
          them: large quiet grey figures with the label beneath, every one a
          button into the same stats dialog. */}
      <div className="fl-corpus-stats">
        <button type="button" className="fl-stat-button" onClick={() => setStatsOpen(true)}>
          <strong>{stats.memos}</strong>
          <span>笔记</span>
        </button>
        <button type="button" className="fl-stat-button" onClick={() => setStatsOpen(true)}>
          <strong>{stats.tags}</strong>
          <span>标签</span>
        </button>
        <button type="button" className="fl-stat-button" onClick={() => setStatsOpen(true)}>
          <strong>{stats.span}</strong>
          <span>天</span>
        </button>
      </div>
      <Heatmap
        memos={memos}
        weeks={SIDEBAR_WEEKS}
        activeDay={view.kind === 'day' ? view.day : undefined}
        onSelectDay={(day) => onSelect({ kind: 'day', day })}
      />

      <button {...rowProps({ kind: 'all' })}>
        <NavLabel icon="▦" text="全部" />
        <span className="fl-nav-count">{memos.length}</span>
      </button>

      <button {...rowProps({ kind: 'review' })}>
        <NavLabel icon="✦" text="每日回顾" />
      </button>

      <button {...rowProps({ kind: 'insight' })}>
        <NavLabel icon="◎" text="AI 洞察" />
      </button>

      <button {...rowProps({ kind: 'heatmap' })}>
        <NavLabel icon="▦" text="记录统计" />
      </button>

      <button {...rowProps({ kind: 'random' })}>
        <NavLabel icon="🎲" text="随机漫步" />
      </button>

      {tags.length > 0 ? (
        <>
          {pinnedRows.length > 0 ? (
            <>
              <div className="fl-sidebar-section">置顶标签</div>
              <div className="fl-tag-list">{pinnedRows}</div>
            </>
          ) : null}
          {treeRows.length > 0 ? (
            <>
              <div className="fl-sidebar-section">全部标签</div>
              <div className="fl-tag-list">{treeRows}</div>
            </>
          ) : null}
        </>
      ) : null}

      <div className="fl-sidebar-foot">
        <div className="fl-stats-strip" style={{ gap: 14, margin: '0 0 12px', paddingLeft: 10 }}>
          <span>
            连续 <strong>{stats.streak}</strong> 天
          </span>
          <span>
            共 <strong>{stats.memos}</strong> 条
          </span>
        </div>
        {showSettings ? (
          <button {...rowProps({ kind: 'settings' })}>
            <NavLabel icon="⚙" text="设置" />
          </button>
        ) : null}
        <div className="fl-shortcut-hint">
          <kbd>/</kbd> 搜索 · <kbd>c</kbd> 记录 · <kbd>g</kbd> 全部 · <kbd>r</kbd> 回顾
        </div>
      </div>

      {statsOpen ? (
        <StatsModal
          memos={memos}
          onClose={() => setStatsOpen(false)}
          onSelectDay={(day) => {
            setStatsOpen(false)
            onSelect({ kind: 'day', day })
          }}
        />
      ) : null}
    </nav>
  )
}
