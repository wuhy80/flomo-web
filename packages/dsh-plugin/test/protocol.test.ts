/**
 * Tests for the action parser.
 *
 * This is the trust boundary: it turns a decoded JSON body from the HTTP route
 * into a typed action, and everything downstream treats the result as
 * well-formed. The uncovered half of it was the rejection paths, which are the
 * half that matters — a payload this accepts is a payload the host will act on.
 *
 * The other thing worth pinning is that it whitelists. It builds a fresh object
 * from named fields rather than passing the input through, so unknown keys cannot
 * ride along into the host.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseAction } from '../src/protocol.ts'

describe('parseAction', () => {
  it('rejects anything that is not an object', () => {
    for (const value of [undefined, null, 'configure', 42, true, [], () => {}]) {
      assert.equal(parseAction(value), undefined, `${String(value)} must not parse`)
    }
  })

  it('rejects an unknown or missing kind', () => {
    assert.equal(parseAction({}), undefined)
    assert.equal(parseAction({ kind: 'delete-everything' }), undefined)
    assert.equal(parseAction({ kind: 42 }), undefined)
    assert.equal(parseAction({ kind: 'Configure' }), undefined, 'kinds are exact')
  })

  it('requires owner and repo to configure', () => {
    assert.equal(parseAction({ kind: 'configure' }), undefined)
    assert.equal(parseAction({ kind: 'configure', owner: 'me' }), undefined)
    assert.equal(parseAction({ kind: 'configure', repo: 'r' }), undefined)
    assert.equal(parseAction({ kind: 'configure', owner: '', repo: 'r' }), undefined)
    assert.equal(parseAction({ kind: 'configure', owner: 'me', repo: '' }), undefined)
    assert.equal(parseAction({ kind: 'configure', owner: 42, repo: 'r' }), undefined)

    assert.deepEqual(parseAction({ kind: 'configure', owner: 'me', repo: 'r' }), {
      kind: 'configure',
      owner: 'me',
      repo: 'r',
    })
  })

  it('omits optional configure fields rather than storing empty strings', () => {
    // An empty branch must be absent, not present-and-empty: the host treats a
    // present branch as the branch to use.
    assert.deepEqual(
      parseAction({ kind: 'configure', owner: 'me', repo: 'r', branch: '', token: '' }),
      { kind: 'configure', owner: 'me', repo: 'r' },
    )
    assert.deepEqual(
      parseAction({ kind: 'configure', owner: 'me', repo: 'r', branch: 'main', token: 't' }),
      { kind: 'configure', owner: 'me', repo: 'r', branch: 'main', token: 't' },
    )
  })

  it('requires a non-empty password to unlock or create', () => {
    for (const kind of ['unlock', 'create']) {
      assert.equal(parseAction({ kind }), undefined)
      assert.equal(parseAction({ kind, password: '' }), undefined)
      assert.equal(parseAction({ kind, password: 123 }), undefined)
      assert.deepEqual(parseAction({ kind, password: 'pw' }), { kind, password: 'pw' })
    }
  })

  it('requires a recovery code', () => {
    assert.equal(parseAction({ kind: 'recovery' }), undefined)
    assert.equal(parseAction({ kind: 'recovery', code: '' }), undefined)
    assert.deepEqual(parseAction({ kind: 'recovery', code: 'abc' }), {
      kind: 'recovery',
      code: 'abc',
    })
  })

  it('takes lock and save with no fields at all', () => {
    assert.deepEqual(parseAction({ kind: 'lock' }), { kind: 'lock' })
    assert.deepEqual(parseAction({ kind: 'save' }), { kind: 'save' })
  })

  it('requires content to add and both id and content to edit', () => {
    assert.equal(parseAction({ kind: 'add' }), undefined)
    assert.equal(parseAction({ kind: 'add', content: '' }), undefined)
    assert.deepEqual(parseAction({ kind: 'add', content: '#a' }), { kind: 'add', content: '#a' })

    assert.equal(parseAction({ kind: 'edit', id: 'x' }), undefined)
    assert.equal(parseAction({ kind: 'edit', content: 'c' }), undefined)
    assert.deepEqual(parseAction({ kind: 'edit', id: 'x', content: 'c' }), {
      kind: 'edit',
      id: 'x',
      content: 'c',
    })
  })

  it('requires an id to remove and to pin', () => {
    assert.equal(parseAction({ kind: 'remove' }), undefined)
    assert.equal(parseAction({ kind: 'remove', id: '' }), undefined)
    assert.deepEqual(parseAction({ kind: 'remove', id: 'x' }), { kind: 'remove', id: 'x' })

    assert.equal(parseAction({ kind: 'pin' }), undefined)
    assert.equal(parseAction({ kind: 'pin', id: '' }), undefined)
  })

  it('carries pinned: false rather than dropping it', () => {
    // The falsy-boolean trap: a `...(pinned ? { pinned } : {})` spread would lose
    // an explicit unpin, so the toggle would only ever pin.
    assert.deepEqual(parseAction({ kind: 'pin', id: 'x', pinned: false }), {
      kind: 'pin',
      id: 'x',
      pinned: false,
    })
    assert.deepEqual(parseAction({ kind: 'pin', id: 'x', pinned: true }), {
      kind: 'pin',
      id: 'x',
      pinned: true,
    })
    // Absent means "toggle", which is not the same as false.
    assert.deepEqual(parseAction({ kind: 'pin', id: 'x' }), { kind: 'pin', id: 'x' })
    // A non-boolean is ignored rather than coerced.
    assert.deepEqual(parseAction({ kind: 'pin', id: 'x', pinned: 'yes' }), {
      kind: 'pin',
      id: 'x',
    })
  })

  it('requires a payload to import', () => {
    assert.equal(parseAction({ kind: 'import' }), undefined)
    assert.equal(parseAction({ kind: 'import', payload: '' }), undefined)
    assert.deepEqual(parseAction({ kind: 'import', payload: '{}' }), {
      kind: 'import',
      payload: '{}',
    })
  })

  it('drops unknown fields instead of passing them through', () => {
    // Whitelisting, not validation: the returned object is built from named
    // fields, so nothing extra can reach the host.
    const parsed = parseAction({
      kind: 'add',
      content: 'hello',
      tags: ['#fake'],
      pinned: true,
      id: 'injected',
      owner: 'attacker',
    })
    assert.deepEqual(parsed, { kind: 'add', content: 'hello' })
  })
})
