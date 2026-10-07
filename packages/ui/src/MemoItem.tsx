/**
 * One memo in the feed, with inline editing.
 *
 * The body is rendered from the core tokenizer, so a `#tag` or a `[[link]]` here
 * is guaranteed to be exactly what the tag index and the link resolver saw.
 *
 * @module @flomo/ui/MemoItem
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { FormatToolsBar } from './FormatTools.tsx'
import { createFormatTools } from './format-tools.ts'

import { clockOf, dayOf, parseBlocks, tokenizeInline } from '@flomo/core'
import type { Block, InlineToken, ListItem, Memo } from '@flomo/core'

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
      case 'underline':
        return <u key={key} className="fl-md-u">{containerContent(token, onTagClick, onLinkClick)}</u>
      case 'mark':
        return <mark key={key} className="fl-md-mark">{containerContent(token, onTagClick, onLinkClick)}</mark>
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
 * One list item's content: a box glyph ahead of the text when it is a task,
 * and any sub-list indented beneath it.
 * @param props - the item and the two navigations.
 * @returns the item's nodes.
 */
function renderListItem(
  item: ListItem,
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
): React.ReactNode {
  const label =
    item.task === null ? (
      renderInline(item.text, onTagClick, onLinkClick)
    ) : (
      <span className="fl-task">
        <span className="fl-task-box" aria-hidden="true">
          {item.task ? '☑' : '☐'}
        </span>
        <span className={item.task ? 'fl-task-text fl-task-done' : 'fl-task-text'}>
          {renderInline(item.text, onTagClick, onLinkClick)}
        </span>
      </span>
    )
  if (item.children === undefined) return label
  return (
    <>
      {label}
      {renderList(item.children, onTagClick, onLinkClick)}
    </>
  )
}

/**
 * A list at any nesting depth.
 * @param props - the items, their flavour, and the two navigations.
 * @returns the list element.
 */
function renderList(
  group: { ordered: boolean; items: readonly ListItem[] },
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
  key?: string,
): React.ReactNode {
  const Tag = group.ordered ? 'ol' : 'ul'
  return (
    <Tag key={key} className="fl-md-list">
      {group.items.map((item, index) => (
        <li key={index}>{renderListItem(item, onTagClick, onLinkClick)}</li>
      ))}
    </Tag>
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
      case 'list':
        return renderList(
          { ordered: block.ordered, items: block.items },
          onTagClick,
          onLinkClick,
          key,
        )
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrap = useRef<HTMLDivElement>(null)
  const editArea = useRef<HTMLTextAreaElement>(null)

  // The edit box grows with its draft, exactly like the capture box does: an
  // auto-height pass on every draft change, capped by the stylesheet.
  useEffect(() => {
    const el = editArea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, editing])

  // The more-menu closes on any click outside the card and resets its delete
  // confirmation, so abandoning the menu never leaves an armed delete behind.
  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event: PointerEvent) => {
      if (menuWrap.current && !menuWrap.current.contains(event.target as Node)) {
        setMenuOpen(false)
        setConfirmingDelete(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  /** Clipboard with a textarea fallback for restricted contexts. */
  const copyText = useCallback(async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const helper = document.createElement('textarea')
      helper.value = value
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      helper.remove()
    }
  }, [])

  /** The per-note link the more-menu's 复制链接 hands out. */
  const shareLink =
    typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}#memo=${memo.id}`

  /** Share through the system sheet when there is one, else copy. */
  const shareMemo = useCallback(async (): Promise<void> => {
    if (typeof navigator !== 'undefined' && navigator.share !== undefined) {
      try {
        await navigator.share({ text: memo.content })
        return
      } catch {
        return // a dismissed share sheet is not an error
      }
    }
    await copyText(memo.content)
  }, [memo.content, copyText])

  // The editor shares the capture box's toolbar: same transforms, bound to the
  // edit textarea, with the draft as the value they rewrite.
  const tools = useMemo(
    () =>
      createFormatTools(
        () => editArea.current,
        (next, caret) => {
          setDraft(next)
          requestAnimationFrame(() => {
            editArea.current?.setSelectionRange(caret, caret)
          })
        },
      ),
    [],
  )

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
            ref={editArea}
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="编辑 MEMO"
          />
          <div className="fl-memo-edit-bar">
            <FormatToolsBar tools={tools} />
            <span className="fl-edit-count" aria-hidden="true">
              {draft.length} 字
            </span>
            <span className="fl-memo-edit-actions">
              <button
                type="button"
                className="fl-button fl-button-ghost"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
              <button type="button" className="fl-button fl-button-primary" onClick={commit}>
                保存
              </button>
            </span>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="fl-memo" data-memo-id={memo.id} ref={menuWrap}>
      <button
        type="button"
        className="fl-more"
        aria-label="更多操作"
        aria-expanded={menuOpen}
        onClick={() => {
          setConfirmingDelete(false)
          setMenuOpen((open) => !open)
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="3.5" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="12.5" cy="8" r="1.4" />
          </g>
        </svg>
      </button>

      {menuOpen ? (
        <div className="fl-memo-menu" role="menu" aria-label="笔记操作">
          <button
            type="button"
            role="menuitem"
            className="fl-memo-menu-item"
            onClick={() => {
              void shareMemo()
              setMenuOpen(false)
            }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="M8 10V2.5M5 5l3-3 3 3M3 10.5v2A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            分享
          </button>
          <button
            type="button"
            role="menuitem"
            className="fl-memo-menu-item"
            onClick={() => {
              beginEdit()
              setMenuOpen(false)
              setConfirmingDelete(false)
            }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="m11.3 2.6 2.1 2.1-8 8L3 13l.3-2.4 8-8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            编辑
          </button>
          <button
            type="button"
            role="menuitem"
            className="fl-memo-menu-item"
            onClick={() => {
              void copyText(memo.content)
              setMenuOpen(false)
            }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <rect
                x="5.5"
                y="5.5"
                width="8"
                height="8"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4.5A1.5 1.5 0 0 0 3 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            复制
          </button>
          <hr className="fl-memo-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="fl-memo-menu-item"
            onClick={() => {
              onPin(memo.id)
              setMenuOpen(false)
            }}
          >
            {memo.pinned ? '取消置顶' : '置顶'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="fl-memo-menu-item"
            onClick={() => {
              onOpen(memo.id)
              setMenuOpen(false)
            }}
          >
            相关笔记
          </button>
          <button
            type="button"
            role="menuitem"
            className="fl-memo-menu-item"
            onClick={() => {
              void copyText(shareLink)
              setMenuOpen(false)
            }}
          >
            复制链接
          </button>
          <hr className="fl-memo-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className={
              confirmingDelete
                ? 'fl-memo-menu-item fl-memo-menu-item-danger'
                : 'fl-memo-menu-item'
            }
            onClick={() => {
              if (confirmingDelete) {
                onRemove(memo.id)
                setMenuOpen(false)
              } else {
                setConfirmingDelete(true)
              }
            }}
          >
            {confirmingDelete ? '确认删除？' : '删除'}
          </button>
          <div className="fl-memo-menu-foot">
            <div>字数统计：{memo.content.length}</div>
            <div>编辑于 {dayOf(memo.updatedAt)}</div>
          </div>
        </div>
      ) : null}

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

      <div className="fl-memo-body" onDoubleClick={beginEdit}>{renderBody(memo, onTagClick, onLinkClick)}</div>

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
