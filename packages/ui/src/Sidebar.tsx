/**
 * The left column: navigation, the tag index, and the settings entry.
 *
 * @module @flomo/ui/Sidebar
 */

import type * as React from 'react'

import { corpusStats } from '@flomo/core'
import type { Memo, TagStat } from '@flomo/core'

import { Heatmap } from './Heatmap.tsx'
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

  return (
    <nav className="fl-sidebar" aria-label="主导航">
      <div className="fl-brand">
        <span className="fl-brand-dot" aria-hidden="true" />
        {brand}
      </div>

      {/* The headline numbers and the calendar sit at the top of the column, the way
          flomo arranges them. They describe the whole corpus rather than the list
          below them, so putting them above the feed only pushed the notes down. */}
      <div className="fl-corpus-stats">
        <span>
          <strong>{stats.memos}</strong> 笔记
        </span>
        <span>
          <strong>{stats.tags}</strong> 标签
        </span>
        <span>
          <strong>{stats.span}</strong> 天
        </span>
      </div>
      <Heatmap memos={memos} weeks={SIDEBAR_WEEKS} />

      <button {...rowProps({ kind: 'all' })}>
        <NavLabel icon="▦" text="全部" />
        <span className="fl-nav-count">{memos.length}</span>
      </button>

      <button {...rowProps({ kind: 'review' })}>
        <NavLabel icon="✦" text="每日回顾" />
      </button>

      <button {...rowProps({ kind: 'random' })}>
        <NavLabel icon="🎲" text="随机漫步" />
      </button>

      {tags.length > 0 ? (
        <>
          <div className="fl-sidebar-section">标签</div>
          <div className="fl-tag-list">
            {tags.map((stat) => {
              const target: FlomoView = { kind: 'tag', tag: stat.tag }
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
                </button>
              )
            })}
          </div>
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
    </nav>
  )
}
