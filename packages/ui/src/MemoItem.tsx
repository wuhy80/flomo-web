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

import { clockOf, dayOf } from '@flomo/core'
import type { Memo } from '@flomo/core'

import { MarkdownBody } from './MarkdownBody.tsx'

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
  /** Start composing an annotation that references this memo. */
  onAnnotate: (memo: Memo) => void
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

export function MemoItem({
  memo,
  onEdit,
  onRemove,
  onPin,
  onTagClick,
  onLinkClick,
  onOpen,
  onAnnotate,
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
              onAnnotate(memo)
              setMenuOpen(false)
            }}
          >
            批注
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

      <div className="fl-memo-body" onDoubleClick={beginEdit}><MarkdownBody content={memo.content} onTagClick={onTagClick} onLinkClick={onLinkClick} onMemoOpen={onOpen} /></div>

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
