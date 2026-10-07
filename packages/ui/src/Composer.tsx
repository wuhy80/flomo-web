/**
 * The capture box — the single most-used control in flomo, so it gets the most
 * care: it auto-grows, submits on Cmd/Ctrl+Enter from the round button or the
 * keyboard, completes `#tags` from what the user has already written (the
 * toolbar's `#` opens the same menu), and never loses a draft to a stray click.
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
          <button type="button" className="fl-tool" title="插入图片（尚未支持）" disabled>
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
