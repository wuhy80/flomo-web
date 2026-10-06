/**
 * One memo in the feed, with inline editing.
 *
 * @module @flomo/ui/MemoItem
 */

import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { clockOf, tokenizeTags } from '@flomo/core'
import type { Memo } from '@flomo/core'

export interface MemoItemProps {
  memo: Memo
  /** Commit an edited body. */
  onEdit: (id: string, content: string) => void
  /** Delete the memo. */
  onRemove: (id: string) => void
  /** Toggle the pinned flag. */
  onPin: (id: string) => void
  /** Navigate to a tag. */
  onTagClick: (tag: string) => void
}

/**
 * Render a memo body with its tags as clickable spans.
 *
 * Splitting goes through the core tokenizer, so what is highlighted here is
 * exactly what the tag index counted.
 * @param memo - the memo to render.
 * @param onTagClick - navigation callback.
 * @returns the body nodes.
 */
function renderBody(memo: Memo, onTagClick: (tag: string) => void): React.ReactNode[] {
  return tokenizeTags(memo.content).map((token, index) =>
    token.type === 'tag' ? (
      <span
        key={`${index}-tag`}
        className="fl-memo-tag"
        role="button"
        tabIndex={0}
        onClick={() => onTagClick(token.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onTagClick(token.value)
          }
        }}
      >
        #{token.value}
      </span>
    ) : (
      <span key={`${index}-text`}>{token.value}</span>
    ),
  )
}

/**
 * A single memo card.
 * @param props - the memo plus its mutation callbacks.
 * @returns the card element.
 */
export function MemoItem({
  memo,
  onEdit,
  onRemove,
  onPin,
  onTagClick,
}: MemoItemProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(memo.content)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const beginEdit = useCallback(() => {
    setDraft(memo.content)
    setEditing(true)
  }, [memo.content])

  const commit = useCallback(() => {
    const next = draft.trim()
    if (next.length > 0 && next !== memo.content) onEdit(memo.id, next)
    setEditing(false)
  }, [draft, memo.content, memo.id, onEdit])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        commit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
      }
    },
    [commit],
  )

  if (editing) {
    return (
      <article className="fl-memo">
        <div className="fl-memo-edit">
          <textarea
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="编辑 MEMO"
          />
          <div className="fl-memo-edit-actions">
            <button type="button" className="fl-button fl-button-primary" onClick={commit}>
              保存
            </button>
            <button
              type="button"
              className="fl-button fl-button-ghost"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="fl-memo">
      <div className="fl-memo-actions">
        <button
          type="button"
          className="fl-icon-button"
          onClick={() => onPin(memo.id)}
          title={memo.pinned ? '取消置顶' : '置顶'}
        >
          {memo.pinned ? '取消置顶' : '置顶'}
        </button>
        <button type="button" className="fl-icon-button" onClick={beginEdit} title="编辑">
          编辑
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className="fl-icon-button"
              style={{ color: 'var(--flomo-danger)' }}
              onClick={() => onRemove(memo.id)}
            >
              确认删除
            </button>
            <button
              type="button"
              className="fl-icon-button"
              onClick={() => setConfirmingDelete(false)}
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="fl-icon-button"
            onClick={() => setConfirmingDelete(true)}
            title="删除"
          >
            删除
          </button>
        )}
      </div>

      <div className="fl-memo-body">{renderBody(memo, onTagClick)}</div>

      <div className="fl-memo-foot">
        <span>
          {memo.pinned ? <span className="fl-memo-pin">已置顶 · </span> : null}
          {clockOf(memo.createdAt)}
          {memo.updatedAt !== memo.createdAt ? ' · 已编辑' : ''}
        </span>
        <span className="fl-memo-tags">
          {memo.tags.map((tag) => (
            <span
              key={tag}
              className="fl-memo-tag"
              role="button"
              tabIndex={0}
              onClick={() => onTagClick(tag)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onTagClick(tag)
                }
              }}
            >
              #{tag}
            </span>
          ))}
        </span>
      </div>
    </article>
  )
}
