/**
 * The capture box — the single most-used control in flomo, so it gets the most
 * care: it auto-grows, submits on Cmd/Ctrl+Enter from the round button or the
 * keyboard, completes `#tags` from what the user has already written (the
 * toolbar's `#` opens the same menu), and its toolbar writes the Markdown the
 * renderer understands — image skeleton, heading, the two lists, task boxes —
 * as line-level toggles rather than modal dialogs. No draft is lost to a stray
 * click.
 *
 * @module @flomo/ui/Composer
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { suggestTags, tagFragmentAtCaret } from '@flomo/core'
import type { TagFragment, TagStat } from '@flomo/core'

/** Largest height the textarea grows to before it starts scrolling. */
const MAX_HEIGHT = 320

export interface ComposerProps {
  /** Called with the trimmed body when the user commits. */
  onSubmit: (content: string) => void
  /** Tags already in the corpus, for completion. */
  knownTags?: readonly TagStat[]
  /** Disables submission while a save is in flight, when desired. */
  disabled?: boolean
  placeholder?: string
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
  knownTags = [],
  disabled = false,
  placeholder = '有什么值得记录的？',
  autoFocus = true,
  focusToken,
}: ComposerProps): React.ReactElement {
  const [value, setValue] = useState('')
  const [fragment, setFragment] = useState<TagFragment | null>(null)
  const [active, setActive] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)

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

  const submit = useCallback(() => {
    const text = value.trim()
    if (text.length === 0 || disabled) return
    onSubmit(text)
    setValue('')
    setFragment(null)
    setActive(0)
    // Re-focus after React commits the cleared value, so the caret never jumps.
    requestAnimationFrame(() => {
      textarea.current?.focus()
      resize()
    })
  }, [value, disabled, onSubmit, resize])

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

  /** Toggle a `## ` heading on the first selected line. */
  const toggleHeading = useCallback((): void => {
    editLines((line, index) => {
      if (index > 0) return line
      if (/^ {0,3}#{1,6}\s/.test(line)) return line.replace(/^ {0,3}#{1,6}\s+/, '')
      return `## ${line}`
    })
  }, [editLines])

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
            accept(chosen.tag)
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
        submit()
      }
    },
    [open, suggestions, active, accept, submit],
  )

  const canSend = value.trim().length > 0 && !disabled

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

      <div className="fl-composer-bar">
        <div className="fl-composer-tools">
          <button type="button" className="fl-tool" title="插入标签" onClick={insertTagStart}>
            #
          </button>
          <button
            type="button"
            className="fl-tool"
            title="插入图片（填入图片链接）"
            onClick={() => insertTemplate('![](https://)', 4)}
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
          <button type="button" className="fl-tool fl-tool-text" title="标题" onClick={toggleHeading}>
            Aa
          </button>
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
        </div>
        <div className="fl-composer-side">
          {value.length > 0 ? (
            <span className="fl-composer-count" aria-hidden="true">
              {value.length} 字
            </span>
          ) : null}
          <button
            type="button"
            className="fl-send"
            onClick={submit}
            disabled={!canSend}
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
