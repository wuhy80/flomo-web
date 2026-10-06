/**
 * Keyboard shortcuts.
 *
 * The decision of *whether* a keystroke is a shortcut is a pure function of the
 * event, kept separate from the listener that wires it up. That split is what
 * makes the interesting part testable: the rules about when to stay out of the
 * user's way are exactly the part that silently rots.
 *
 * @module @flomo/ui/shortcuts
 */

import { useEffect } from 'react'

/** What a keystroke asks the app to do. */
export type ShortcutAction =
  /** Focus the search box. */
  | { kind: 'search' }
  /** Focus the capture box. */
  | { kind: 'compose' }
  /** Switch to a top-level view. */
  | { kind: 'view'; view: 'all' | 'review' | 'random' }

/** The subset of a keyboard event the resolver reads. */
export interface ShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  /** The event target, used only to tell whether the user is typing. */
  target: EventTarget | null
}

/**
 * Whether the keystroke is going into a text field.
 *
 * A bare letter key must never be stolen from someone mid-sentence, which is the
 * single rule that makes unmodified shortcuts safe to offer at all.
 * @param target - the event target.
 * @returns true when the user is typing.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null) return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  if (element.isContentEditable === true) return true
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Map a keystroke to an action, or to nothing.
 *
 * Escape is deliberately not bound here. Cancelling an edit is a per-field
 * concern that the field itself already handles, and a global handler would fire
 * on top of it.
 * @param event - the keystroke.
 * @returns the action, or `null` when the app should ignore the key.
 */
export function resolveShortcut(event: ShortcutEvent): ShortcutAction | null {
  // Leave every modified combination to the browser and the operating system.
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (isTypingTarget(event.target)) return null

  switch (event.key) {
    case '/':
      return { kind: 'search' }
    case 'c':
    case 'C':
      return { kind: 'compose' }
    case 'g':
    case 'G':
      return { kind: 'view', view: 'all' }
    case 'r':
    case 'R':
      return { kind: 'view', view: 'review' }
    case 'w':
    case 'W':
      return { kind: 'view', view: 'random' }
    default:
      return null
  }
}

/**
 * Bind the shortcuts to the window for as long as the component is mounted.
 *
 * A no-op without a DOM, so the component tree stays renderable on a server.
 * @param handler - receives every recognised action.
 * @param enabled - set false to keep the keys entirely inert.
 */
export function useShortcuts(
  handler: (action: ShortcutAction) => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const onKeyDown = (event: KeyboardEvent): void => {
      const action = resolveShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        target: event.target,
      })
      if (action === null) return
      // Only once the key is known to be ours, so an unrecognised keystroke is
      // never swallowed.
      event.preventDefault()
      handler(action)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handler, enabled])
}
