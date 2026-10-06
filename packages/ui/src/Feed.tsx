/**
 * The memo feed, grouped by day with a pinned section on top.
 *
 * @module @flomo/ui/Feed
 */

import type * as React from 'react'

import { dayLabel, dayOf } from '@flomo/core'
import type { Memo } from '@flomo/core'

import { MemoItem } from './MemoItem.tsx'
import type { MemoItemProps } from './MemoItem.tsx'

export interface FeedProps {
  /** Memos to render, in the order the session returned them. */
  memos: readonly Memo[]
  /** Shown when the list is empty. */
  emptyText?: string
  /**
   * Group by day. Turned off where the day headings would be noise — a single
   * memo's backlink list, for instance, is short and already scoped.
   */
  groupByDay?: boolean
  onEdit: MemoItemProps['onEdit']
  onRemove: MemoItemProps['onRemove']
  onPin: MemoItemProps['onPin']
  onTagClick: MemoItemProps['onTagClick']
  onLinkClick: MemoItemProps['onLinkClick']
  onOpen: MemoItemProps['onOpen']
}

/** A day (or the pinned bucket) and the memos under it. */
interface Group {
  key: string
  label: string
  memos: Memo[]
}

/**
 * Bucket memos into day groups, preserving the incoming order.
 *
 * Pinned memos are split into their own leading group rather than being left in
 * place, so that a pin from last month does not drag its old day header to the
 * top of the feed and split today's group in two.
 * @param memos - the memos, newest first.
 * @returns the ordered groups.
 */
function group(memos: readonly Memo[]): Group[] {
  const pinned: Memo[] = []
  const byDay = new Map<string, Memo[]>()

  for (const memo of memos) {
    if (memo.pinned) {
      pinned.push(memo)
      continue
    }
    const day = dayOf(memo.createdAt)
    const bucket = byDay.get(day)
    if (bucket) bucket.push(memo)
    else byDay.set(day, [memo])
  }

  const groups: Group[] = []
  if (pinned.length > 0) groups.push({ key: '__pinned__', label: '置顶', memos: pinned })
  for (const [day, bucket] of byDay) {
    groups.push({ key: day, label: dayLabel(day), memos: bucket })
  }
  return groups
}

/**
 * The scrolling list of memos.
 * @param props - memos plus the mutation and navigation callbacks.
 * @returns the feed element.
 */
export function Feed({
  memos,
  emptyText = '还没有记录，写下第一条吧。',
  groupByDay = true,
  onEdit,
  onRemove,
  onPin,
  onTagClick,
  onLinkClick,
  onOpen,
}: FeedProps): React.ReactElement {
  if (memos.length === 0) {
    return <div className="fl-empty">{emptyText}</div>
  }

  const sections = groupByDay ? group(memos) : [{ key: 'flat', label: '', memos: [...memos] }]

  return (
    <div className="fl-feed">
      {sections.map((section) => (
        <section key={section.key}>
          {section.label ? <div className="fl-day">{section.label}</div> : null}
          {section.memos.map((memo) => (
            <MemoItem
              key={memo.id}
              memo={memo}
              onEdit={onEdit}
              onRemove={onRemove}
              onPin={onPin}
              onTagClick={onTagClick}
              onLinkClick={onLinkClick}
              onOpen={onOpen}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
