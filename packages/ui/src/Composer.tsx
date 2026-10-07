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

import { FormatToolsBar } from './FormatTools.tsx'
import { createFormatTools } from './format-tools.ts'

import { dayOf, memoFragmentAtCaret, suggestTags, tagFragmentAtCaret } from '@flomo/core'
import type { Memo, TagFragment, TagStat } from '@flomo/core'

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
  /** A preset injected after mount (批注 references). Applied when it changes. */
  preset?: string
  /** Recent memos for the @ quick-quote menu. */
  recentMemos?: readonly Memo[]
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
  preset,
  recentMemos = [],
  autoFocus = true,
  focusToken,
}: ComposerProps): React.ReactElement {
  // The preset is read once: a later prop change must not clobber what the
  // user has already typed on top of it.
  const [value, setValue] = useState(initialValue ?? '')
  const [fragment, setFragment] = useState<TagFragment | null>(null)
  const [active, setActive] = useState(0)
  const [memoFrag, setMemoFrag] = useState<{ start: number; query: string } | null>(null)
  const [activeMemo, setActiveMemo] = useState(0)
  const [images, setImages] = useState<PendingImage[]>([])
  const [busyImage, setBusyImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(
    () => (fragment === null || memoFrag !== null ? [] : suggestTags(fragment.query, knownTags)),
    [fragment, memoFrag, knownTags],
  )
  const open = suggestions.length > 0 && memoFrag === null

  // The @ quick-quote menu: recent memos, filtered by what follows the @.
  const memoSuggestions = useMemo(() => {
    if (memoFrag === null) return []
    const query = memoFrag.query.toLowerCase()
    return recentMemos
      .filter((memo) => query === '' || memo.content.toLowerCase().includes(query))
      .slice(0, 8)
  }, [memoFrag, recentMemos])
  const memoOpen = memoSuggestions.length > 0

  /**
   * Recompute the `#` fragment under the caret.
   *
   * Read from the live DOM rather than from `value`, because React state is a
   * render behind the keystroke that just happened.
   */
  const syncFragment = useCallback(() => {
    const el = textarea.current
    if (!el) return
    const caret = el.selectionStart ?? el.value.length
    setFragment(tagFragmentAtCaret(el.value, caret))
    setMemoFrag(memoFragmentAtCaret(el.value, caret))
    setActive(0)
    setActiveMemo(0)
  }, [])



  const resize = useCallback(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [])

  /** Replace the open @-fragment with a reference to the chosen memo. */
  const acceptMemo = useCallback(
    (memo: Memo) => {
      const el = textarea.current
      const frag = memoFrag
      if (!el || frag === null) return
      const caret = el.selectionStart ?? el.value.length
      const next = `${el.value.slice(0, frag.start)}@[${memo.id}] ${el.value.slice(caret)}`
      const nextCaret = frag.start + memo.id.length + 4
      setValue(next)
      setMemoFrag(null)
      setActiveMemo(0)
      requestAnimationFrame(() => {
        const node = textarea.current
        if (node === null) return
        node.focus()
        node.setSelectionRange(nextCaret, nextCaret)
        syncFragment()
        resize()
      })
    },
    [memoFrag, syncFragment, resize],
  )

  useEffect(resize, [value, resize])

  // A preset injected after mount (批注): replaces the draft when it is empty,
  // appends otherwise, and pulls focus with the caret at the end.
  useEffect(() => {
    if (preset === undefined || preset === '') return
    setValue((current) => {
      const base = current.trim()
      if (base === '') return preset
      return `${base}${base.endsWith(' ') ? '' : ' '}${preset}`
    })
    requestAnimationFrame(() => {
      const node = textarea.current
      if (node === null) return
      node.focus()
      const end = node.value.length
      node.setSelectionRange(end, end)
      resize()
    })
  }, [preset, resize])

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

  // One shared set of text transforms bound to this textarea: the toolbar and
  // the format menu both drive them, and `commit` keeps the value state, the
  // caret, tag completion and the auto-height in step afterwards.
  const commitValue = useCallback(
    (next: string, caret: number) => {
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
    [syncFragment, resize],
  )
  const tools = useMemo(() => createFormatTools(() => textarea.current, commitValue), [commitValue])

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

      {memoOpen ? (
        <div className="fl-suggest" role="listbox" aria-label="快速引用">
          {memoSuggestions.map((memo, index) => (
            <button
              key={memo.id}
              type="button"
              role="option"
              aria-selected={index === activeMemo}
              className="fl-suggest-item fl-suggest-memo"
              data-active={index === activeMemo ? 'true' : 'false'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => acceptMemo(memo)}
            >
              <span className="fl-suggest-memo-text">
                {memo.content.split('\n')[0]?.slice(0, 40) || '（空）'}
              </span>
              <span className="fl-nav-count">{dayOf(memo.createdAt).slice(5)}</span>
            </button>
          ))}
        </div>
      ) : null}

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
        <FormatToolsBar
          tools={tools}
          imageSlot={
            <button
              type="button"
              className="fl-tool"
              title="添加图片"
              onClick={() => fileInput.current?.click()}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="5.8" cy="6.4" r="1.2" fill="currentColor" />
                <path d="m4 11.5 3-3 2.2 2.2 1.8-1.8 2 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </button>
          }
        />
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
