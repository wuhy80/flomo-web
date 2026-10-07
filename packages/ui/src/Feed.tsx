/**
 * The memo feed.
 *
 * One flat list, like flomo: there are no day headings, because every memo
 * carries its full timestamp at its own top. Pinned memos still float to the
 * head of the list, so a pin from last month stays where the user put it.
 *
 * @module @flomo/ui/Feed
 */

import type * as React from 'react'

import type { Memo } from '@flomo/core'

import { MemoItem } from './MemoItem.tsx'
import type { MemoItemProps } from './MemoItem.tsx'

export interface FeedProps {
  /** Memos to render, in the order the session returned them. */
  memos: readonly Memo[]
  /** Shown when the list is empty. */
  emptyText?: string
  onEdit: MemoItemProps['onEdit']
  onRemove: MemoItemProps['onRemove']
  onPin: MemoItemProps['onPin']
  onTagClick: MemoItemProps['onTagClick']
  onLinkClick: MemoItemProps['onLinkClick']
  onOpen: MemoItemProps['onOpen']
}

/**
 * Split a memo list into pins leading and the rest, preserving either order.
 * @param memos - the memos, newest first.
 * @returns the memos with pins first.
 */
function withPinsFirst(memos: readonly Memo[]): Memo[] {
  const pinned: Memo[] = []
  const rest: Memo[] = []
  for (const memo of memos) (memo.pinned ? pinned : rest).push(memo)
  return [...pinned, ...rest]
}

/**
 * The scrolling list of memos.
 * @param props - memos plus the mutation and navigation callbacks.
 * @returns the feed element.
 */
export function Feed({
  memos,
  emptyText = '还没有记录，写下第一条吧。',
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

  return (
    <div>
      {withPinsFirst(memos).map((memo) => (
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
    </div>
  )
}
