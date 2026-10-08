/**
 * The Markdown body renderer, shared by the memo card and the AI-insight view.
 *
 * One renderer, one tokenizer: what the memo card highlights is exactly what
 * the tag index stored, and an AI insight's Markdown answer renders with the
 * same rules as the notes it came from. Tags and links here are display-only
 * unless a handler is given — the insight view passes none.
 *
 * @module @flomo/ui/MarkdownBody
 */

import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { parseBlocks, tokenizeInline } from '@flomo/core'
import type { Block, InlineToken, ListItem } from '@flomo/core'

export interface MarkdownBodyProps {
  /** The raw markdown-ish body. */
  content: string
  /** Navigate to a tag; omitted renders tags as inert pills. */
  onTagClick?: (tag: string) => void
  /** Navigate to a `[[link]]`; omitted renders links as inert text. */
  onLinkClick?: (target: string) => void
  /** Open the note a `@[id]` reference points to; omitted renders inert chips. */
  onMemoOpen?: (id: string) => void
  /**
   * Tick or untick the task on a source line; omitted renders boxes inert.
   * The line number is the one the block parser recorded for the item.
   */
  onTaskToggle?: (line: number) => void
  /**
   * Decrypts a media ref, so an `![alt](ref)` whose target is not a web URL
   * still shows its image; omitted renders such images as nothing.
   */
  readImage?: (ref: string) => Promise<{ bytes: Uint8Array; mime: string }>
}

/**
 * Render a body as the memo card renders it.
 * @param props - the content and optional navigation handlers.
 * @returns the rendered nodes.
 */
export function MarkdownBody({
  content,
  onTagClick = () => {},
  onLinkClick = () => {},
  onMemoOpen = () => {},
  onTaskToggle,
  readImage,
}: MarkdownBodyProps): React.ReactElement {
  const nodes = parseBlocks(content).map((block: Block, index) => {
    const inline = (text: string): React.ReactNode[] =>
      renderTokens(tokenizeInline(text), onTagClick, onLinkClick, onMemoOpen, readImage)
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
          onMemoOpen,
          onTaskToggle,
          key,
        )
      case 'table': {
        const align = (column: number): React.CSSProperties | undefined =>
          block.align[column]
            ? { textAlign: block.align[column] as React.CSSProperties['textAlign'] }
            : undefined
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
  return <>{nodes}</>
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
    (event: React.MouseEvent | React.KeyboardEvent) => {
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
 * @param readImage - decrypts media refs for inline images, when available.
 * @returns the nodes.
 */
function renderTokens(
  tokens: readonly InlineToken[],
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
  onMemoOpen: (id: string) => void,
  readImage?: (ref: string) => Promise<{ bytes: Uint8Array; mime: string }>,
): React.ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${index}-${token.type}`
    switch (token.type) {
      case 'tag':
        return <InlineMark key={key} kind="tag" value={token.value} onActivate={() => onTagClick(token.value)} />
      case 'link':
        return <InlineMark key={key} kind="link" value={token.value} onActivate={() => onLinkClick(token.value)} />
      case 'memoref':
        return (
          <button
            key={key}
            type="button"
            className="fl-memo-ref"
            title="查看关联的 MEMO"
            onClick={() => onMemoOpen(token.value)}
          >
            MEMO&gt;
          </button>
        )
      case 'strong':
        return <strong key={key}>{containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}</strong>
      case 'em':
        return <em key={key}>{containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}</em>
      case 'strike':
        return <del key={key}>{containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}</del>
      case 'underline':
        return <u key={key} className="fl-md-u">{containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}</u>
      case 'mark':
        return <mark key={key} className="fl-md-mark">{containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}</mark>
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
          return <span key={key}>{containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}</span>
        }
        return (
          <a key={key} className="fl-md-a" href={href} target="_blank" rel="noopener noreferrer">
            {containerContent(token, onTagClick, onLinkClick, onMemoOpen, readImage)}
          </a>
        )
      }
      case 'image': {
        const href = safeUrl(token.url)
        if (href !== null) {
          return <img key={key} className="fl-md-img" src={href} alt={token.value} loading="lazy" />
        }
        // Not a web URL: a media ref from the vault, decryptable only through
        // the session. Without a loader or a target there is nothing to show.
        if (readImage === undefined || token.url === undefined) return null
        return <MediaImage key={key} mediaRef={token.url} alt={token.value} readImage={readImage} />
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
  onMemoOpen: (id: string) => void,
): React.ReactNode[] {
  return renderTokens(tokenizeInline(text), onTagClick, onLinkClick, onMemoOpen)
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
  onMemoOpen: (id: string) => void,
  readImage?: (ref: string) => Promise<{ bytes: Uint8Array; mime: string }>,
): React.ReactNode {
  if (token.children === undefined) return token.value
  return renderTokens(token.children, onTagClick, onLinkClick, onMemoOpen, readImage)
}

/**
 * An inline `![alt](ref)` whose target is a vault media ref, decrypted on
 * demand — the body counterpart of the memo card's attached-image tiles. The
 * bytes arrive through the session; the object URL dies with the element.
 * @param props - the media ref, its alt text, and the decrypting loader.
 * @returns the image element, a placeholder while loading, a note on failure.
 */
function MediaImage({
  mediaRef,
  alt,
  readImage,
}: {
  mediaRef: string
  alt: string
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

  if (failed) return <span className="fl-md-img fl-media-failed">图片加载失败</span>
  if (src === null) return <span className="fl-md-img fl-media-loading" aria-label={alt} />
  return <img className="fl-md-img" src={src} alt={alt} loading="lazy" />
}

/**
 * One list item's content: a box glyph ahead of the text when it is a task,
 * and any sub-list indented beneath it.
 * @param props - the item and the navigations.
 * @returns the item's nodes.
 */
function renderListItem(
  item: ListItem,
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
  onMemoOpen: (id: string) => void,
  onTaskToggle?: (line: number) => void,
): React.ReactNode {
  let label: React.ReactNode
  if (item.task === null) {
    label = renderInline(item.text, onTagClick, onLinkClick, onMemoOpen)
  } else {
    // A box with a line to rewrite is a real control — clicking it flips the
    // `[ ]`/`[x]` the parser recorded; without one it stays a glyph.
    const box =
      onTaskToggle !== undefined ? (
        <button
          type="button"
          className="fl-task-box"
          role="checkbox"
          aria-checked={item.task}
          aria-label={item.task ? '标记为未完成' : '标记为已完成'}
          title={item.task ? '标记为未完成' : '标记为已完成'}
          onClick={(event) => {
            event.stopPropagation()
            onTaskToggle(item.line)
          }}
          // Ticking a box must not read as the card's double-click-to-edit.
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {item.task ? '☑' : '☐'}
        </button>
      ) : (
        <span className="fl-task-box" aria-hidden="true">
          {item.task ? '☑' : '☐'}
        </span>
      )
    label = (
      <span className="fl-task">
        {box}
        <span className={item.task ? 'fl-task-text fl-task-done' : 'fl-task-text'}>
          {renderInline(item.text, onTagClick, onLinkClick, onMemoOpen)}
        </span>
      </span>
    )
  }
  if (item.children === undefined) return label
  return (
    <>
      {label}
      {renderList(
        item.children,
        onTagClick,
        onLinkClick,
        onMemoOpen,
        onTaskToggle,
      )}
    </>
  )
}

/**
 * A list at any nesting depth.
 * @param props - the items, their flavour, and the navigations.
 * @returns the list element.
 */
function renderList(
  group: { ordered: boolean; items: readonly ListItem[] },
  onTagClick: (tag: string) => void,
  onLinkClick: (target: string) => void,
  onMemoOpen: (id: string) => void,
  onTaskToggle?: (line: number) => void,
  key?: string,
): React.ReactNode {
  const Tag = group.ordered ? 'ol' : 'ul'
  return (
    <Tag key={key} className="fl-md-list">
      {group.items.map((item, index) => (
        <li key={index}>
          {renderListItem(item, onTagClick, onLinkClick, onMemoOpen, onTaskToggle)}
        </li>
      ))}
    </Tag>
  )
}

/**
 * A single memo card.
 * @param props - the memo plus its mutation and navigation callbacks.
 * @returns the card element.
 */
