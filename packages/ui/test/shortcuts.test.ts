/**
 * Tests for the shortcut resolver.
 *
 * The pure function is the whole point of the split: the rules about staying out
 * of the user's way are the part that silently rots, and they are exactly the
 * part a listener cannot be tested for.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { bindShortcuts, createKeydownHandler, isTypingTarget, resolveShortcut } from '../src/shortcuts.ts'
import type { ShortcutEvent, ShortcutTarget } from '../src/shortcuts.ts'

/**
 * Build a keystroke.
 * @param key - the key value.
 * @param overrides - event fields to override.
 * @returns the event.
 */
function key(key: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key, metaKey: false, ctrlKey: false, altKey: false, target: null, ...overrides }
}

/** A stand-in element carrying the two properties the resolver reads. */
interface FakeElement extends EventTarget {
  tagName: string
}

/**
 * Build a stand-in event target.
 * @param tagName - its tag name.
 * @param isContentEditable - whether it is an editable region.
 * @returns the element.
 */
function element(tagName: string, isContentEditable = false): FakeElement {
  return { tagName, isContentEditable } as unknown as FakeElement
}

describe('isTypingTarget', () => {
  it('recognises the fields a bare letter must not be stolen from', () => {
    assert.equal(isTypingTarget(element('INPUT')), true)
    assert.equal(isTypingTarget(element('TEXTAREA')), true)
    assert.equal(isTypingTarget(element('SELECT')), true)
    assert.equal(isTypingTarget(element('DIV', true)), true)
  })

  it('is not fooled by case, and ignores ordinary elements', () => {
    assert.equal(isTypingTarget(element('input')), true)
    assert.equal(isTypingTarget(element('BUTTON')), false)
    assert.equal(isTypingTarget(element('DIV')), false)
    assert.equal(isTypingTarget(null), false)
  })
})

describe('resolveShortcut', () => {
  it('maps the documented keys, in either case', () => {
    assert.deepEqual(resolveShortcut(key('/')), { kind: 'search' })
    assert.deepEqual(resolveShortcut(key('c')), { kind: 'compose' })
    assert.deepEqual(resolveShortcut(key('C')), { kind: 'compose' })
    assert.deepEqual(resolveShortcut(key('t')), { kind: 'view', view: 'todo' })
    assert.deepEqual(resolveShortcut(key('g')), { kind: 'view', view: 'all' })
    assert.deepEqual(resolveShortcut(key('r')), { kind: 'view', view: 'review' })
    assert.deepEqual(resolveShortcut(key('w')), { kind: 'view', view: 'random' })
  })

  it('leaves every modified combination to the browser and the OS', () => {
    assert.equal(resolveShortcut(key('c', { metaKey: true })), null)
    assert.equal(resolveShortcut(key('c', { ctrlKey: true })), null)
    assert.equal(resolveShortcut(key('c', { altKey: true })), null)
    assert.equal(resolveShortcut(key('/', { metaKey: true })), null)
  })

  it('stays out of the way while the user is typing', () => {
    for (const target of [element('INPUT'), element('TEXTAREA'), element('DIV', true)]) {
      for (const letter of ['/', 'c', 'g', 'r', 'w']) {
        assert.equal(
          resolveShortcut(key(letter, { target })),
          null,
          `${letter} must not fire from a ${target.tagName}`,
        )
      }
    }
  })

  it('ignores keys it does not own', () => {
    for (const other of ['a', '1', 'Enter', ' ', 'Shift', 'ArrowDown']) {
      assert.equal(resolveShortcut(key(other)), null, `${other} is not a shortcut`)
    }
  })

  it('does not bind Escape', () => {
    // Cancelling an edit is a per-field concern the field already handles; a
    // global binding would fire on top of it.
    assert.equal(resolveShortcut(key('Escape')), null)
  })
})

/**
 * Build a keyboard event as the listener would receive it.
 * @param key - the key value.
 * @param overrides - fields to override.
 * @returns the event and whether it was defaulted.
 */
function keyboardEvent(
  key: string,
  overrides: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: EventTarget | null }> = {},
): { event: KeyboardEvent; defaulted: () => boolean } {
  let defaulted = false
  const event = {
    key,
    metaKey: overrides.metaKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    altKey: overrides.altKey ?? false,
    target: overrides.target ?? null,
    preventDefault: () => {
      defaulted = true
    },
  }
  return { event: event as unknown as KeyboardEvent, defaulted: () => defaulted }
}

describe('keydown listener', () => {
  // This half used to live inside a useEffect, where nothing could reach it — so
  // the rules about what gets swallowed were untested by construction.

  it('acts on a recognised key and stops the browser seeing it', () => {
    const seen: unknown[] = []
    const handler = createKeydownHandler((action) => seen.push(action))
    const { event, defaulted } = keyboardEvent('/')

    handler(event)

    assert.deepEqual(seen, [{ kind: 'search' }])
    assert.equal(defaulted(), true, 'a key we act on must not also reach the page')
  })

  it('leaves an unrecognised key entirely alone', () => {
    const seen: unknown[] = []
    const handler = createKeydownHandler((action) => seen.push(action))
    const { event, defaulted } = keyboardEvent('a')

    handler(event)

    assert.deepEqual(seen, [])
    // Swallowing keys we do not own would break typing and browser shortcuts.
    assert.equal(defaulted(), false)
  })

  it('leaves a key alone when the user is typing', () => {
    const seen: unknown[] = []
    const handler = createKeydownHandler((action) => seen.push(action))
    const { event, defaulted } = keyboardEvent('c', { target: element('INPUT') })

    handler(event)

    assert.deepEqual(seen, [])
    assert.equal(defaulted(), false)
  })

  it('leaves a modified key to the browser', () => {
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      const seen: unknown[] = []
      const handler = createKeydownHandler((action) => seen.push(action))
      const { event, defaulted } = keyboardEvent('c', { [modifier]: true })

      handler(event)

      assert.deepEqual(seen, [], `${modifier}+c must not be ours`)
      assert.equal(defaulted(), false)
    }
  })
})

describe('binding shortcuts', () => {
  /** A target that records what was attached and detached. */
  function fakeTarget(): {
    target: ShortcutTarget
    fire: (event: KeyboardEvent) => void
    attached: () => number
    detached: () => number
  } {
    let listener: ((event: KeyboardEvent) => void) | null = null
    let attached = 0
    let detached = 0
    return {
      target: {
        addEventListener: (_type, next) => {
          listener = next
          attached += 1
        },
        removeEventListener: (_type, previous) => {
          // Identity matters: removing a freshly built equivalent would leave the
          // original attached forever.
          if (previous === listener) {
            listener = null
            detached += 1
          }
        },
      },
      fire: (event) => listener?.(event),
      attached: () => attached,
      detached: () => detached,
    }
  }

  it('routes keystrokes to the handler while bound', () => {
    const fake = fakeTarget()
    const seen: unknown[] = []
    bindShortcuts((action) => seen.push(action), fake.target)

    assert.equal(fake.attached(), 1)
    fake.fire(keyboardEvent('g').event)
    assert.deepEqual(seen, [{ kind: 'view', view: 'all' }])
  })

  it('detaches the very listener it attached', () => {
    const fake = fakeTarget()
    const seen: unknown[] = []
    const detach = bindShortcuts((action) => seen.push(action), fake.target)

    detach()
    assert.equal(fake.detached(), 1, 'the same reference must come back off')

    // And it really is inert afterwards, rather than merely counted as removed.
    fake.fire(keyboardEvent('g').event)
    assert.deepEqual(seen, [])
  })
})
