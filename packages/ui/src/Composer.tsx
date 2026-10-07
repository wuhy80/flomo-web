/**
 * The capture box — the single most-used control in flomo, so it gets the most
 * care: it auto-grows, submits on Cmd/Ctrl+Enter from the round button or the
 * keyboard, completes `#tags` from what the user has already written (the
 * toolbar's `#` opens the same menu), and its toolbar writes the Markdown the
 * renderer understands — heading, the two lists, task boxes, a table — as
 * line-level toggles rather than modal dialogs. Pasted or picked images ride
 * along as encrypted attachments, shown as removable thumbnails. No draft is
 * lost to a stray click.
 *
 * @module @flomo/ui/Composer
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'

import { suggestTags, tagFragmentAtCaret } from '@flomo/core'
import type { TagFragment, TagStat } from '@flomo/core'

/** Largest height the textarea grows to before it starts scrolling. */
const MAX_HEIGHT = 320

/** Longest image edge kept from a paste or pick; larger ones are scaled down. */
const MAX_EDGE = 2048

/** Largest raw image accepted, in bytes; pastes beyond it are refused. */
const MAX_BYTES = 8 * 1024 * 1024

/** One image waiting to ride along with the next memo. */
interface PendingImage {
  /** Local unique id, for the list key and the remove button. */
  localId: string
  /** Object URL for the thumbnail; revoked when the image leaves the list. */
  preview: string
  bytes: Uint8Array
  mime: string
}

/**
 * Downscale an image through a canvas so a phone photo does not become a
 * multi-megabyte upload.
 * @param bitmap - the decoded image.
 * @param mime - the output MIME type.
 * @returns the re-encoded bytes, and whether anything was downscaled.
 */
async function downscale(bitmap: ImageBitmap, mime: string): Promise<Uint8Array | null> {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale >= 1) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (context === null) return null
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.85),
  )
  if (blob === null) return null
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Turn a picked or pasted file into a pending attachment.
 * @param file - the image file.
 * @returns the attachment, or a human-readable refusal.
 */
async function readImageFile(file: File): Promise<PendingImage | string> {
  if (!file.type.startsWith('image/')) return '只能添加图片文件。'
  if (file.size > MAX_BYTES) return '图片超过 8MB，请压缩后再试。'
  let bytes = new Uint8Array(await file.arrayBuffer())
  let mime = file.type
  try {
    const bitmap = await createImageBitmap(file)
    const smaller = await downscale(bitmap, mime)
    if (smaller !== null) {
      bytes = smaller
      mime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
    }
    bitmap.close()
  } catch {
    // Undecodable or no canvas: the raw bytes are still worth a try.
  }
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    preview: URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime })),
    bytes,
    mime,
  }
}

export interface ComposerProps {
  /** Called with the trimmed body and the uploaded image refs on commit. */
  onSubmit: (content: string, images: string[]) => void
  /** Uploads one image and resolves to its media ref. */
  onAddImage: (bytes: Uint8Array, mime: string) => Promise<string>
  /** Tags already in the corpus, for completion. */
  knownTags?: readonly TagStat[]
  /** Disables submission while a save is in flight, when desired. */
  disabled?: boolean
  placeholder?: string
  /** Text the box starts with — the deep-link capture preset. Read on mount only. */
  initialValue?: string
  /** Focus the box on mount. */
  autoFocus?: boolean
  /**
   * Change this number to pull focus into the box from elsewhere.
   *
   * An imperative focus has to arrive as a value the component can observe,
   * because the textarea's ref belongs to this component and a parent cannot
   * reach it — and a callback ref would run on every render rather than when the
   * user actually asked for focus.
   */
  focusToken?: number
}

/**
 * The memo input.
 * @param props - submission handler, known tags and presentation flags.
 * @returns the composer element.
 */
export function Composer({
  onSubmit,
  onAddImage,
  knownTags = [],
  disabled = false,
  placeholder = '有什么值得记录的？',
  initialValue,
  autoFocus = true,
  focusToken,
}: ComposerProps): React.ReactElement {
  // The preset is read once: a later prop change must not clobber what the
  // user has already typed on top of it.
  const [value, setValue] = useState(initialValue ?? '')
  const [fragment, setFragment] = useState<TagFragment | null>(null)
  const [active, setActive] = useState(0)
  const [images, setImages] = useState<PendingImage[]>([])
  const [busyImage, setBusyImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [aaOpen, setAaOpen] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const aaWrap = useRef<HTMLSpanElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(
    () => (fragment === null ? [] : suggestTags(fragment.query, knownTags)),
    [fragment, knownTags],
  )
  const open = suggestions.length > 0

  /**
   * Recompute the `#` fragment under the caret.
   *
   * Read from the live DOM rather than from `value`, because React state is a
   * render behind the keystroke that just happened.
   */
  const syncFragment = useCallback(() => {
    const el = textarea.current
    if (!el) return
    setFragment(tagFragmentAtCaret(el.value, el.selectionStart ?? el.value.length))
    setActive(0)
  }, [])

  const resize = useCallback(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [])

  useEffect(resize, [value, resize])

  useEffect(() => {
    if (autoFocus) textarea.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    // Runs on mount and again whenever the token changes, so a host can both ask
    // for focus later and leave the prop off entirely to opt out.
    if (focusToken === undefined) return
    textarea.current?.focus()
  }, [focusToken])

  /**
   * Replace the fragment under the caret with a complete tag.
   * @param tag - the tag to insert, without its `#`.
   */
  const accept = useCallback(
    (tag: string) => {
      const el = textarea.current
      if (!el || fragment === null) return
      const caret = el.selectionStart ?? el.value.length
      const next = `${value.slice(0, fragment.start)}#${tag} ${value.slice(caret)}`
      // A trailing space so the next word does not get absorbed into the tag.
      const nextCaret = fragment.start + tag.length + 2

      setValue(next)
      setFragment(null)
      setActive(0)
      requestAnimationFrame(() => {
        const node = textarea.current
        if (node === null) return
        node.focus()
        node.setSelectionRange(nextCaret, nextCaret)
        resize()
      })
    },
    [fragment, value, resize],
  )

  const submit = useCallback(async () => {
    const text = value.trim()
    if ((text.length === 0 && images.length === 0) || disabled) return
    // Images upload before the memo: a ref the repository does not hold yet
    // would render as a broken tile everywhere the memo does.
    const refs: string[] = []
    try {
      setBusyImage(true)
      for (const image of images) {
        refs.push(await onAddImage(image.bytes, image.mime))
      }
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '图片上传失败，请重试。')
      return
    } finally {
      setBusyImage(false)
    }
    onSubmit(text, refs)
    for (const image of images) URL.revokeObjectURL(image.preview)
    setImages([])
    setImageError(null)
    setValue('')
    setFragment(null)
    setActive(0)
    // Re-focus after React commits the cleared value, so the caret never jumps.
    requestAnimationFrame(() => {
      textarea.current?.focus()
      resize()
    })
  }, [value, images, disabled, onSubmit, onAddImage, resize])

  /** Add picked or pasted files as pending attachments. */
  const addFiles = useCallback(
    async (files: Iterable<File>): Promise<void> => {
      const added: PendingImage[] = []
      let refusal: string | null = null
      for (const file of files) {
        const result = await readImageFile(file)
        if (typeof result === 'string') refusal = result
        else added.push(result)
      }
      if (refusal !== null) setImageError(refusal)
      else setImageError(null)
      if (added.length > 0) setImages((current) => [...current, ...added])
    },
    [],
  )

  /** Remove one pending attachment and free its preview URL. */
  const removeImage = useCallback((localId: string): void => {
    setImages((current) => {
      const target = current.find((image) => image.localId === localId)
      if (target !== undefined) URL.revokeObjectURL(target.preview)
      return current.filter((image) => image.localId !== localId)
    })
  }, [])

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      )
      if (files.length === 0) return
      // The paste must not also drop the image's filename into the text.
      event.preventDefault()
      void addFiles(files)
    },
    [addFiles],
  )

  const onPickFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      void addFiles(event.target.files ?? [])
      // Cleared so picking the same file twice still fires a change event.
      event.target.value = ''
    },
    [addFiles],
  )

  /**
   * Drop a `#` at the caret from the toolbar, which opens tag completion.
   *
   * The fragment is read from the live DOM inside the same rAF that moves the
   * caret, so the suggestion menu sees the character React has just committed.
   */
  const insertTagStart = useCallback(() => {
    const el = textarea.current
    if (!el) return
    const caret = el.selectionStart ?? el.value.length
    setValue(`${value.slice(0, caret)}#${value.slice(caret)}`)
    requestAnimationFrame(() => {
      const node = textarea.current
      if (node === null) return
      node.focus()
      node.setSelectionRange(caret + 1, caret + 1)
      syncFragment()
      resize()
    })
  }, [value, syncFragment, resize])

  /**
   * Replace the selection with `text` and park the caret at `caretOffset` into
   * it — an image is inserted as a Markdown skeleton the URL is typed into.
   */
  const insertTemplate = useCallback(
    (text: string, caretOffset: number) => {
      const el = textarea.current
      if (!el) return
      const { selectionStart, selectionEnd } = el
      const next = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd ?? selectionStart)}`
      const caret = selectionStart + caretOffset
      setValue(next)
      requestAnimationFrame(() => {
        const node = textarea.current
        if (node === null) return
        node.focus()
        node.setSelectionRange(caret, caret)
        syncFragment()
        resize()
      })
    },
    [value, syncFragment, resize],
  )

  /**
   * Rewrite the lines the selection touches, then leave the caret at the end of
   * the rewritten run.
   *
   * Every toolbar toggle below is this one transform: the decision of *what* a
   * line becomes lives in the caller, the mechanics of splicing the value and
   * restoring the caret live here, once.
   */
  const editLines = useCallback(
    (transform: (line: string, index: number, all: string[]) => string) => {
      const el = textarea.current
      if (!el) return
      const { value: current, selectionStart, selectionEnd } = el
      const start = current.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
      const after = current.indexOf('\n', selectionEnd)
      const end = after === -1 ? current.length : after
      const lines = current.slice(start, end).split('\n')
      const rewritten = lines.map(transform).join('\n')
      if (rewritten === current.slice(start, end)) return
      setValue(current.slice(0, start) + rewritten + current.slice(end))
      requestAnimationFrame(() => {
        const node = textarea.current
        if (node === null) return
        node.focus()
        const caret = start + rewritten.length
        node.setSelectionRange(caret, caret)
        syncFragment()
        resize()
      })
    },
    [syncFragment, resize],
  )

  // The Aa menu closes on any click outside its anchor.
  useEffect(() => {
    if (!aaOpen) return undefined
    const close = (event: PointerEvent) => {
      if (aaWrap.current && !aaWrap.current.contains(event.target as Node)) {
        setAaOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [aaOpen])

  /** Wrap (or unwrap) the current selection with an inline format pair. */
  const wrapSelection = useCallback((before: string, after: string): void => {
    const el = textarea.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const current = el.value
    const selected = current.slice(start, end)
    const pre = current.slice(start - before.length, start)
    const post = current.slice(end, end + after.length)
    // Two shapes count as already-wrapped: the markers sit just outside the
    // selection, or the user selected them together with the word. Either way
    // the toggle strips them instead of stacking another pair.
    const wrappedOutside = selected.length > 0 && pre === before && post === after
    const wrappedInside =
      selected.length >= before.length + after.length &&
      selected.startsWith(before) &&
      selected.endsWith(after)
    let next: string
    let caret: number
    if (wrappedOutside) {
      next = current.slice(0, start - before.length) + selected + current.slice(end + after.length)
      caret = start - before.length + selected.length
    } else if (wrappedInside) {
      const inner = selected.slice(before.length, selected.length - after.length)
      next = current.slice(0, start) + inner + current.slice(end)
      caret = start + inner.length
    } else {
      next = current.slice(0, start) + before + selected + after + current.slice(end)
      caret = start + before.length + selected.length
    }
    setValue(next)
    requestAnimationFrame(() => {
      const node = textarea.current
      if (node === null) return
      node.focus()
      node.setSelectionRange(caret, caret)
      syncFragment()
      resize()
    })
  }, [syncFragment, resize])

  /** The three formats of flomo's Aa menu. */
  const applyFormat = useCallback((kind: 'bold' | 'underline' | 'mark'): void => {
    if (kind === 'bold') wrapSelection('**', '**')
    else if (kind === 'underline') wrapSelection('<u>', '</u>')
    else wrapSelection('==', '==')
    setAaOpen(false)
  }, [wrapSelection])

  /**
   * Toggle a list marker over the selected lines.
   *
   * When every non-blank line already carries the marker the toggle strips it;
   * otherwise it is added. Tasks convert an existing bullet in place instead of
   * stacking a second one.
   */
  const toggleList = useCallback(
    (kind: 'ul' | 'ol' | 'task'): void => {
      editLines((line, index, all) => {
        const marker =
          kind === 'ul'
            ? /^ {0,3}[-*+]\s+/
            : kind === 'ol'
              ? /^ {0,3}\d{1,9}[.)]\s+/
              : /^ {0,3}[-*+]\s+\[[ xX]\]\s+/
        const marked = all.filter((candidate) => candidate.trim() !== '')
        if (marked.length > 0 && marked.every((candidate) => marker.test(candidate))) {
          const stripped = line.replace(marker, '')
          return kind === 'ul' ? stripped.replace(/^\[[ xX]\]\s+/, '') : stripped
        }
        if (line.trim() === '') return line
        if (kind === 'ul') return `- ${line.replace(/^ {0,3}[-*+]\s+\[[ xX]\]\s+/, '')}`
        if (kind === 'ol') return `${index + 1}. ${line}`
        const bullet = /^ {0,3}[-*+]\s+/.exec(line)
        return bullet === null ? `- [ ] ${line}` : `- [ ] ${line.slice(bullet[0].length)}`
      })
    },
    [editLines],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // The completion menu owns the navigation keys only while it is open, so
      // Enter still inserts a newline the rest of the time.
      if (open) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((index) => (index + 1) % suggestions.length)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => (index - 1 + suggestions.length) % suggestions.length)
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const chosen = suggestions[active]
          if (chosen !== undefined) {
            event.preventDefault()
            void accept(chosen.tag)
            return
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setFragment(null)
          return
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    },
    [open, suggestions, active, accept, submit],
  )

  const canSend = (value.trim().length > 0 || images.length > 0) && !disabled

  return (
    <div className="fl-composer">
      <textarea
        ref={textarea}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          syncFragment()
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncFragment}
        onClick={syncFragment}
        onSelect={syncFragment}
        onBlur={() => setFragment(null)}
        onPaste={onPaste}
        placeholder={placeholder}
        aria-label="记录一条 MEMO"
        spellCheck={false}
      />

      {open ? (
        // A listbox with `option` children directly: wrapping each option in an
        // `li` would be invalid inside a listbox role.
        <div className="fl-suggest" role="listbox" aria-label="标签建议">
          {suggestions.map((stat, index) => (
            <button
              key={stat.tag}
              type="button"
              role="option"
              aria-selected={index === active}
              className="fl-suggest-item"
              data-active={index === active ? 'true' : 'false'}
              // Keeps focus in the textarea so the click does not blur the
              // field and close the menu before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => accept(stat.tag)}
            >
              <span>#{stat.tag}</span>
              <span className="fl-nav-count">{stat.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {images.length > 0 ? (
        <div className="fl-composer-attach">
          {images.map((image) => (
            <span key={image.localId} className="fl-attach-thumb">
              <img src={image.preview} alt="待发送的图片" />
              <button
                type="button"
                className="fl-attach-remove"
                aria-label="移除这张图片"
                onClick={() => removeImage(image.localId)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="fl-attach-add"
            title="添加图片"
            aria-label="添加图片"
            disabled={busyImage}
            onClick={() => fileInput.current?.click()}
          >
            {busyImage ? <span className="fl-spinner" /> : '+'}
          </button>
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="fl-visually-hidden"
        onChange={onPickFiles}
      />

      <div className="fl-composer-bar">
        <div className="fl-composer-tools">
          <button type="button" className="fl-tool" title="插入标签" onClick={insertTagStart}>
            #
          </button>
          <button
            type="button"
            className="fl-tool"
            title="添加图片"
            onClick={() => fileInput.current?.click()}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <rect
                x="2"
                y="3"
                width="12"
                height="10"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="5.8" cy="6.4" r="1.2" fill="currentColor" />
              <path
                d="m4 11.5 3-3 2.2 2.2 1.8-1.8 2 2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="fl-tool-divider" aria-hidden="true" />
          <span className="fl-aa-wrap" ref={aaWrap}>
            <button
              type="button"
              className="fl-tool fl-tool-text"
              title="文字格式"
              aria-expanded={aaOpen}
              onClick={() => setAaOpen((open) => !open)}
            >
              Aa
            </button>
            {aaOpen ? (
              <span className="fl-aa-menu">
                <button type="button" className="fl-aa-option" title="加粗" onClick={() => applyFormat('bold')}>
                  <strong>B</strong>
                </button>
                <button type="button" className="fl-aa-option" title="下划线" onClick={() => applyFormat('underline')}>
                  <span className="fl-aa-u">U</span>
                </button>
                <button type="button" className="fl-aa-option" title="高亮" onClick={() => applyFormat('mark')}>
                  <span className="fl-aa-hl">H</span>
                </button>
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="fl-tool"
            title="无序列表"
            onClick={() => toggleList('ul')}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <g fill="currentColor">
                <circle cx="3" cy="4" r="1.1" />
                <circle cx="3" cy="8" r="1.1" />
                <circle cx="3" cy="12" r="1.1" />
              </g>
              <path
                d="M6.5 4h7M6.5 8h7M6.5 12h7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="fl-tool"
            title="有序列表"
            onClick={() => toggleList('ol')}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <text x="1" y="5.6" fontSize="5.4" fill="currentColor" fontFamily="inherit">
                1.
              </text>
              <text x="1" y="10.6" fontSize="5.4" fill="currentColor" fontFamily="inherit">
                2.
              </text>
              <text x="1" y="15.6" fontSize="5.4" fill="currentColor" fontFamily="inherit">
                3.
              </text>
              <path
                d="M7.5 4h7M7.5 8.5h7M7.5 13h7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="fl-tool"
            title="任务清单"
            onClick={() => toggleList('task')}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <rect
                x="2.5"
                y="2.5"
                width="11"
                height="11"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="m5.2 8.2 2 2 3.6-4.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="fl-tool"
            title="插入表格"
            onClick={() => insertTemplate('| 列一 | 列二 |\n| --- | --- |\n|  |  |', 4)}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <rect
                x="2"
                y="2"
                width="12"
                height="12"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M2 6.5h12M2 10.5h12M6.5 2v12M10.5 2v12"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        </div>
        <div className="fl-composer-side">
          {imageError !== null ? (
            <span className="fl-attach-error" role="alert">
              {imageError}
            </span>
          ) : null}
          {value.length > 0 ? (
            <span className="fl-composer-count" aria-hidden="true">
              {value.length} 字
            </span>
          ) : null}
          <button
            type="button"
            className="fl-send"
            onClick={() => void submit()}
            disabled={!canSend && !busyImage}
            title={canSend ? '发送（Ctrl/Cmd + Enter）' : '先写点什么'}
            aria-label="发送"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
