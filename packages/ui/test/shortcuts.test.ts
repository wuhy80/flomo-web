/**
 * Tests for the shortcut resolver.
 *
 * The pure function is the whole point of the split: the rules about staying out
 * of the user's way are the part that silently rots, and they are exactly the
 * part a listener cannot be tested for.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isTypingTarget, resolveShortcut } from '../src/shortcuts.ts'
import type { ShortcutEvent } from '../src/shortcuts.ts'

/**
 * Build a keystroke.
 * @param key - the key value.
 * @param overrides - event fields to override.
 * @returns the event.
 */
function key(key: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key, metaKey: false, ctrlKey: false, altKey: false, target: null, ...overrides }
}

/** A stand-in event target with a tag name. */
function element(tagName: string, isContentEditable = false): EventTarget {
  return { tagName, isContentEditable } as unknown as EventTarget
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
          `${letter} must not fire from a ${String((target as { tagName: string }).tagName)}`,
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
