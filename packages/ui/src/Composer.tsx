/**
 * The capture box — the single most-used control in flomo, so it gets the most
 * care: it auto-grows, submits on Cmd/Ctrl+Enter, and never loses a draft to a
 * stray click.
 *
 * @module @flomo/ui/Composer
 */

import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

/** Largest height the textarea grows to before it starts scrolling. */
const MAX_HEIGHT = 320

export interface ComposerProps {
  /** Called with the trimmed body when the user commits. */
  onSubmit: (content: string) => void
  /** Disables submission while a save is in flight, when desired. */
  disabled?: boolean
  placeholder?: string
  /** Focus the box on mount. */
  autoFocus?: boolean
}

/**
 * The memo input.
 * @param props - submission handler and presentation flags.
 * @returns the composer element.
 */
export function Composer({
  onSubmit,
  disabled = false,
  placeholder = '有什么值得记录的？',
  autoFocus = true,
}: ComposerProps): React.ReactElement {
  const [value, setValue] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)

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

  const submit = useCallback(() => {
    const text = value.trim()
    if (text.length === 0 || disabled) return
    onSubmit(text)
    setValue('')
    // Re-focus after React commits the cleared value, so the caret never jumps.
    requestAnimationFrame(() => {
      textarea.current?.focus()
      resize()
    })
  }, [value, disabled, onSubmit, resize])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    },
    [submit],
  )

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="fl-composer">
      <textarea
        ref={textarea}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="记录一条 MEMO"
        spellCheck={false}
      />
      <div className="fl-composer-bar">
        <span className="fl-composer-hint">
          {value.length > 0 ? `${value.length} 字 · ` : ''}Ctrl/Cmd + Enter 发送
        </span>
        <div className="fl-composer-actions">
          <button
            type="button"
            className="fl-button fl-button-primary"
            onClick={submit}
            disabled={!canSend}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
