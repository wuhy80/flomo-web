/**
 * One memo in the feed, with inline editing.
 *
 * The body is rendered from the core tokenizer, so a `#tag` or a `[[link]]` here
 * is guaranteed to be exactly what the tag index and the link resolver saw.
 *
 * @module @flomo/ui/MemoItem
 */

import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { clockOf, dayOf, parseBlocks, tokenizeInline } from '@flomo/core'
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
  /** Navigate to what a `[[link]]` resolves to. */
  onLinkClick: (target: string) => void
  /** Open this memo's detail page. */
  onOpen: (id: string) => void
}

/**
 * An interactive `#tag` or `[[link]]` inside a memo body.
 *
 * Factored out so the click-versus-keyboard contract is written once rather than
 * three times, and so both markers stop propagation identically — the body will
 * eventually gain its own click target, and a tag click must never be read as a
 * click on the body.
 * @param props - the marker kind, its text, and what activating it does.
 * @returns the marker element.
 */
function InlineMark({
  kind,
  value,
  onActivate,
}: {
  kind: 'tag' | 'link'
  value: string
  onActivate: () => void
}): React.ReactElement {
  const activate = useCallback(
    (event: MouseEvent | KeyboardEvent) => {
      if ('key' in event) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
      }
      event.stopPropagation()
      onActivate()
    },
    [onActivate],
  )

  return (
    <span
      className={kind === 'tag' ? 'fl-memo-tag' : 'fl-memo-link'}
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={activate}
    >
      {kind === 'tag' ? `#${value}` : `[[${value}]]`}
    </span>
  )
}

/**
 * Render a run of prose with its tags and links interactive.
 * @param text - the prose.
 * @param onTagClick - tag navigation.
 * @param onLinkClick - link navigation.
 * @returns the nodes.
 */
function renderInline(
  text: string,
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
): React.ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    if (token.type === 'tag') {
      return (
        <InlineMark
          key={`${index}-tag`}
          kind="tag"
          value={token.value}
          onActivate={() => onTagClick(token.value)}
        />
      )
    }
    if (token.type === 'link') {
      return (
        <InlineMark
          key={`${index}-link`}
          kind="link"
          value={token.value}
          onActivate={() => onLinkClick(token.value)}
        />
      )
    }
    if (token.type === 'strong') {
      return <strong key={`${index}-strong`}>{token.value}</strong>
    }
    if (token.type === 'code') {
      return <code key={`${index}-code`}>{token.value}</code>
    }
    return <span key={`${index}-text`}>{token.value}</span>
  })
}

/**
 * Render a memo body from its block structure.
 *
 * Only paragraphs and quotes go through the inline renderer. A fenced block is
 * emitted verbatim, which is both what the user means and what keeps the display
 * consistent with the tag index — neither treats `#include` as a tag.
 * @param memo - the memo to render.
 * @param onTagClick - tag navigation.
 * @param onLinkClick - link navigation.
 * @returns the body nodes.
 */
function renderBody(
  memo: Memo,
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
): React.ReactNode[] {
  return parseBlocks(memo.content).map((block, index) => {
    if (block.type === 'code') {
      return (
        <pre
          key={`${index}-code`}
          className="fl-code"
          {...(block.language ? { 'data-language': block.language } : {})}
        >
          <code>{block.code}</code>
        </pre>
      )
    }
    if (block.type === 'quote') {
      return (
        <blockquote key={`${index}-quote`} className="fl-quote">
          {renderInline(block.text, onTagClick, onLinkClick)}
        </blockquote>
      )
    }
    return (
      <p key={`${index}-para`} className="fl-para">
        {renderInline(block.text, onTagClick, onLinkClick)}
      </p>
    )
  })
}

/**
 * A single memo card.
 * @param props - the memo plus its mutation and navigation callbacks.
 * @returns the card element.
 */
export function MemoItem({
  memo,
  onEdit,
  onRemove,
  onPin,
  onTagClick,
  onLinkClick,
  onOpen,
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
          onClick={() => onOpen(memo.id)}
          title="打开单条笔记与反向链接"
        >
          详情
        </button>
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

      <div className="fl-memo-head">
        {/* The full stamp sits on the card itself, the way flomo shows it. With
            no day headings above the feed, the date has to live on each note. */}
        <span className="fl-memo-stamp">
          {dayOf(memo.createdAt)} {clockOf(memo.createdAt)}
        </span>
        {memo.pinned ? <span className="fl-memo-pin">已置顶</span> : null}
        {memo.updatedAt !== memo.createdAt ? (
          <span className="fl-memo-edited">已编辑</span>
        ) : null}
      </div>

      <div className="fl-memo-body">{renderBody(memo, onTagClick, onLinkClick)}</div>
    </article>
  )
}
