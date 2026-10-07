/**
 * One memo in the feed, with inline editing.
 *
 * The body is rendered from the core tokenizer, so a `#tag` or a `[[link]]` here
 * is guaranteed to be exactly what the tag index and the link resolver saw.
 *
 * @module @flomo/ui/MemoItem
 */

import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { clockOf, dayOf, parseBlocks, tokenizeInline } from '@flomo/core'
import type { Block, InlineToken, Memo } from '@flomo/core'

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
  /** Fetches and decrypts one attached image. Absent: attachments render inert. */
  readImage?: (ref: string) => Promise<{ bytes: Uint8Array; mime: string }>
}

/**
 * One attached image, decrypted on demand.
 *
 * The ref alone carries no pixels — the bytes come out of the vault's media
 * directory through the session, and the object URL is revoked the moment this
 * tile leaves the feed, so a long session does not accumulate blobs.
 * @param props - the media ref and the decrypting loader.
 * @returns the image tile.
 */
function AttachedImage({
  mediaRef,
  readImage,
}: {
  /** The media reference; named mediaRef because `ref` belongs to React. */
  mediaRef: string
  readImage: (ref: string) => Promise<{ bytes: Uint8Array; mime: string }>
}): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let live = true
    readImage(mediaRef)
      .then(({ bytes, mime }) => {
        if (!live) return
        revoked = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
        setSrc(revoked)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
      if (revoked !== null) URL.revokeObjectURL(revoked)
    }
  }, [mediaRef, readImage])

  if (failed) return <span className="fl-memo-image fl-memo-image-failed">图片加载失败</span>
  if (src === null) return <span className="fl-memo-image fl-memo-image-loading" />
  return <img className="fl-memo-image" src={src} alt="笔记附件" loading="lazy" />
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
 * The URL a Markdown link or image may actually point at.
 *
 * The renderer builds real elements rather than HTML strings, so there is no
 * injection path — but `javascript:` in a hand-typed document would still be a
 * self-inflicted hole, so anything that is not http(s) renders as plain text.
 * @param url - the URL from the document.
 * @returns the URL when it is a web address, else null.
 */
function safeUrl(url: string | undefined): string | null {
  if (url === undefined || !/^https?:\/\//i.test(url)) return null
  return url
}

/**
 * Render a run of prose with its tags, links and Markdown marks interactive.
 * @param tokens - the token stream to render.
 * @param onTagClick - tag navigation.
 * @param onLinkClick - link navigation.
 * @returns the nodes.
 */
function renderTokens(
  tokens: readonly InlineToken[],
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
): React.ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${index}-${token.type}`
    switch (token.type) {
      case 'tag':
        return <InlineMark key={key} kind="tag" value={token.value} onActivate={() => onTagClick(token.value)} />
      case 'link':
        return <InlineMark key={key} kind="link" value={token.value} onActivate={() => onLinkClick(token.value)} />
      case 'strong':
        return <strong key={key}>{containerContent(token, onTagClick, onLinkClick)}</strong>
      case 'em':
        return <em key={key}>{containerContent(token, onTagClick, onLinkClick)}</em>
      case 'strike':
        return <del key={key}>{containerContent(token, onTagClick, onLinkClick)}</del>
      case 'code':
        return <code key={key}>{token.value}</code>
      case 'url':
        return (
          <a key={key} className="fl-md-a" href={token.value} target="_blank" rel="noopener noreferrer">
            {token.value}
          </a>
        )
      case 'mdlink': {
        const href = safeUrl(token.url)
        if (href === null) {
          return <span key={key}>{containerContent(token, onTagClick, onLinkClick)}</span>
        }
        return (
          <a key={key} className="fl-md-a" href={href} target="_blank" rel="noopener noreferrer">
            {containerContent(token, onTagClick, onLinkClick)}
          </a>
        )
      }
      case 'image': {
        const href = safeUrl(token.url)
        if (href === null) return null
        return <img key={key} className="fl-md-img" src={href} alt={token.value} loading="lazy" />
      }
      default:
        return <span key={key}>{token.value}</span>
    }
  })
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
  return renderTokens(tokenizeInline(text), onTagClick, onLinkClick)
}

/**
 * A container mark's content: its inner tokens when nesting is present, the
 * literal text otherwise — never an extra wrapper element, so `**粗**` renders
 * as `<strong>粗</strong>` exactly as it always did.
 * @param token - the container token.
 * @param onTagClick - tag navigation.
 * @param onLinkClick - link navigation.
 * @returns the content nodes.
 */
function containerContent(
  token: InlineToken,
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
): React.ReactNode {
  if (token.children === undefined) return token.value
  return renderTokens(token.children, onTagClick, onLinkClick)
}

/**
 * One list item's content: a box glyph ahead of the text when it is a task.
 * @param props - the item and the two navigations.
 * @returns the item's nodes.
 */
function renderListItem(
  item: { text: string; task: boolean | null },
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
): React.ReactNode {
  if (item.task === null) return renderInline(item.text, onTagClick, onLinkClick)
  return (
    <span className="fl-task">
      <span className="fl-task-box" aria-hidden="true">
        {item.task ? '☑' : '☐'}
      </span>
      <span className={item.task ? 'fl-task-text fl-task-done' : 'fl-task-text'}>
        {renderInline(item.text, onTagClick, onLinkClick)}
      </span>
    </span>
  )
}

/**
 * Render a memo body from its block structure.
 *
 * Only paragraphs, quotes, headings, lists and tables go through the inline
 * renderer. A fenced block is emitted verbatim, which is both what the user
 * means and what keeps the display consistent with the tag index — neither
 * treats `#include` as a tag.
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
  const inline = (text: string): React.ReactNode[] => renderInline(text, onTagClick, onLinkClick)

  return parseBlocks(memo.content).map((block: Block, index) => {
    const key = `${index}-${block.type}`
    switch (block.type) {
      case 'code':
        return (
          <pre
            key={key}
            className="fl-code"
            {...(block.language ? { 'data-language': block.language } : {})}
          >
            <code>{block.code}</code>
          </pre>
        )
      case 'quote':
        return (
          <blockquote key={key} className="fl-quote">
            {inline(block.text)}
          </blockquote>
        )
      case 'heading': {
        const Tag = `h${block.level}` as 'h1'
        return (
          <Tag key={key} className="fl-md-h" data-level={block.level}>
            {inline(block.text)}
          </Tag>
        )
      }
      case 'hr':
        return <hr key={key} className="fl-md-hr" />
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul'
        return (
          <Tag key={key} className="fl-md-list">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderListItem(item, onTagClick, onLinkClick)}</li>
            ))}
          </Tag>
        )
      }
      case 'table': {
        const align = (column: number): React.CSSProperties | undefined =>
          block.align[column] ? { textAlign: block.align[column] as React.CSSProperties['textAlign'] } : undefined
        return (
          <table key={key} className="fl-md-table">
            <thead>
              <tr>
                {block.head.map((cell, column) => (
                  <th key={column} style={align(column)}>
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {block.head.map((_, column) => (
                    <td key={column} style={align(column)}>
                      {inline(row[column] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
      default:
        return (
          <p key={key} className="fl-para">
            {inline(block.text)}
          </p>
        )
    }
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
  readImage,
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

      {memo.images !== undefined && memo.images.length > 0 ? (
        <div className="fl-memo-images">
          {memo.images.map((ref) =>
            readImage !== undefined ? (
              <AttachedImage key={ref} mediaRef={ref} readImage={readImage} />
            ) : (
              <span key={ref} className="fl-memo-image fl-memo-image-loading" />
            ),
          )}
        </div>
      ) : null}
    </article>
  )
}
