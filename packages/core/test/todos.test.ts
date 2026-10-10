/**
 * The standalone TODO document: list operations, the sealed round trip, and the
 * guarantee that ticking a box never touches a memo shard.
 *
 * @module flomo-core/test/todos
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DATA_DIR, FlomoVault, splitTodos, TODO_FILE } from '../src/index.ts'
import type { Memo } from '../src/index.ts'
import { MemoryStore } from '@flomo/core/testing'

const PASSWORD = 'correct horse battery staple'
const FAST = 1_000

/**
 * Unlock a fresh vault against an in-memory repository.
 * @param store - the fake repository.
 * @returns the unlocked vault and its recovery code.
 */
async function openVault(store: MemoryStore): Promise<{ vault: FlomoVault; code: string }> {
  const created = await FlomoVault.create(store, PASSWORD, FAST)
  const reopened = await FlomoVault.openWithRecovery(store, created.recoveryCode)
  await reopened.loadAll()
  return { vault: reopened, code: created.recoveryCode }
}

describe('todo list operations', () => {
  it('adds tasks at the top, in insertion order', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    vault.addTodo('first')
    vault.addTodo('second')
    assert.deepEqual(
      vault.todos().map((todo) => todo.content),
      ['second', 'first'],
    )
  })

  it('edits a task by id', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    const todo = vault.addTodo('buy milk')
    vault.editTodo(todo.id, 'buy oat milk')
    assert.equal(vault.todos()[0]?.content, 'buy oat milk')
  })

  it('toggles a task done and back, stamping completion time', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    const todo = vault.addTodo('ship the release')

    const done = vault.toggleTodo(todo.id)
    assert.equal(typeof done.completedAt, 'string')

    // Toggling again reopens the task: the stamp disappears outright, the way
    // `pinned` disappears, so the stored shape never carries a null.
    const reopened = vault.toggleTodo(todo.id)
    assert.equal(reopened.completedAt, undefined)
    assert.ok(!('completedAt' in reopened))

    // An explicit value does not toggle, it sets.
    assert.equal(vault.toggleTodo(todo.id, true).completedAt !== undefined, true)
    assert.equal(vault.toggleTodo(todo.id, true).completedAt !== undefined, true)
  })

  it('removes one task and clears every completed one', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    const a = vault.addTodo('a')
    vault.addTodo('b')
    const c = vault.addTodo('c')

    vault.toggleTodo(a.id)
    vault.toggleTodo(c.id)
    assert.equal(vault.clearCompletedTodos(), 2)
    assert.deepEqual(
      vault.todos().map((todo) => todo.content),
      ['b'],
    )

    assert.equal(vault.removeTodo(vault.todos()[0]!.id), true)
    assert.equal(vault.removeTodo('nope'), false)
    assert.equal(vault.todos().length, 0)
  })
})

describe('todo persistence', () => {
  it('round-trips the checklist through todo.json, sealed', async () => {
    const store = new MemoryStore()
    const created = await FlomoVault.create(store, PASSWORD, FAST)
    created.vault.addTodo('任务一')
    created.vault.addTodo('任务二')
    created.vault.toggleTodo(created.vault.todos()[0]!.id)
    await created.vault.flush()

    // One document at the root, holding ciphertext only — the plaintext tasks
    // never appear in the file.
    assert.ok(store.raw(TODO_FILE))
    const raw = store.raw(TODO_FILE)!
    assert.ok(!raw.includes('任务一'))
    assert.deepEqual(JSON.parse(raw).v, 1)

    const reopened = await FlomoVault.openWithRecovery(store, created.recoveryCode)
    await reopened.loadAll()
    assert.deepEqual(
      reopened.todos().map((todo) => [todo.content, todo.completedAt !== undefined]),
      [['任务二', true], ['任务一', false]],
    )
  })

  it('keeps todo writes out of the memo shards', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    const memo: Memo = vault.add('#work A memo about work')
    await vault.flush()
    const shardBefore = store.raw(`${DATA_DIR}/${memo.createdAt.slice(0, 7)}.json`)

    vault.addTodo('a task')
    vault.toggleTodo(vault.todos()[0]!.id)
    await vault.flush()
    const shardAfter = store.raw(`${DATA_DIR}/${memo.createdAt.slice(0, 7)}.json`)

    assert.equal(shardBefore, shardAfter)
    assert.ok(store.raw(TODO_FILE))
  })

  it('keeps memo writes out of todo.json', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    vault.addTodo('a task')
    await vault.flush()
    const todoBefore = store.raw(TODO_FILE)

    vault.add('another memo')
    await vault.flush()

    assert.equal(store.raw(TODO_FILE), todoBefore)
  })

  it('starts an empty checklist when no todo file exists', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    assert.deepEqual(vault.todos(), [])
    // Flushing without any todo change must not conjure a file.
    vault.add('memo only')
    await vault.flush()
    assert.equal(store.raw(TODO_FILE), undefined)
  })

  it('reports pending writes across both documents', async () => {
    const store = new MemoryStore()
    const created = await FlomoVault.create(store, PASSWORD, FAST)
    const vault = created.vault
    assert.equal(vault.hasPendingWrites, false)
    vault.addTodo('t')
    assert.equal(vault.hasPendingWrites, true)
    await vault.flush()
    assert.equal(vault.hasPendingWrites, false)
  })
})

describe('splitTodos', () => {
  const todo = (id: string, completedAt?: string) => ({
    id,
    content: `task ${id}`,
    createdAt: '2026-10-10T00:00:00.000Z',
    ...(completedAt ? { completedAt } : {}),
  })

  it('splits open from done, done newest first', () => {
    const { active, completed } = splitTodos([
      todo('1'),
      todo('2', '2026-10-01T10:00:00.000Z'),
      todo('3'),
      todo('4', '2026-10-03T10:00:00.000Z'),
    ])
    assert.deepEqual(active.map((item) => item.id), ['1', '3'])
    assert.deepEqual(completed.map((item) => item.id), ['4', '2'])
  })

  it('returns two empty groups for an empty list', () => {
    assert.deepEqual(splitTodos([]), { active: [], completed: [] })
  })
})
