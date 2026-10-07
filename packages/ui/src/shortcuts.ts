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
  // Ctrl/Cmd+K is the search box's own accelerator, and it works while typing —
  // that is what separates it from the bare `/`, which must never be stolen
  // mid-sentence. It has to be recognised before the bail-out below hands every
  // modified keystroke to the browser.
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    if (event.key === 'k' || event.key === 'K') return { kind: 'search' }
    return null
  }
  // Leave every other modified combination to the browser and the operating system.
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
 * The part of a window this module needs.
 *
 * Narrower than `Window` on purpose: a test can supply one, and the narrowness
 * documents that nothing here reads anything else off the global.
 */
export interface ShortcutTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
}

/**
 * Build the keydown listener.
 *
 * Exported so the wiring can be exercised without a renderer. The interesting
 * behaviour is in here — which keystrokes are swallowed and which are passed
 * through — and it used to live inside an effect, where nothing could reach it.
 * @param handler - receives every recognised action.
 * @returns the listener.
 */
export function createKeydownHandler(
  handler: (action: ShortcutAction) => void,
): (event: KeyboardEvent) => void {
  return (event) => {
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
}

/**
 * Attach the shortcuts to a target.
 * @param handler - receives every recognised action.
 * @param target - where to listen; the window in practice.
 * @returns a function that detaches the same listener.
 */
export function bindShortcuts(
  handler: (action: ShortcutAction) => void,
  target: ShortcutTarget,
): () => void {
  const onKeyDown = createKeydownHandler(handler)
  target.addEventListener('keydown', onKeyDown)
  // The same function reference, which is the whole reason it is held here: a
  // listener removed by a freshly built equivalent is not removed at all.
  return () => target.removeEventListener('keydown', onKeyDown)
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
    if (!enabled || typeof window === 'undefined') return undefined
    return bindShortcuts(handler, window)
  }, [handler, enabled])
}
