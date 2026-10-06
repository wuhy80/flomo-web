/**
 * The left column: navigation, the tag index, and the settings entry.
 *
 * @module @flomo/ui/Sidebar
 */

import type * as React from 'react'

import { corpusStats } from '@flomo/core'
import type { Memo, TagStat } from '@flomo/core'

import { sameView } from './views.ts'
import type { FlomoView } from './views.ts'

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

      <button {...rowProps({ kind: 'all' })}>
        <span>全部</span>
        <span className="fl-nav-count">{memos.length}</span>
      </button>

      <button {...rowProps({ kind: 'review' })}>
        <span>每日回顾</span>
      </button>

      <button {...rowProps({ kind: 'random' })}>
        <span>随机漫步</span>
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
            <span>设置</span>
          </button>
        ) : null}
        <div className="fl-shortcut-hint">
          <kbd>/</kbd> 搜索 · <kbd>c</kbd> 记录 · <kbd>g</kbd> 全部 · <kbd>r</kbd> 回顾
        </div>
      </div>
    </nav>
  )
}
