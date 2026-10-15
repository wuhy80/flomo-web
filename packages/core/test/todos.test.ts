/**
 * The standalone TODO document: list operations, the sealed round trip, and the
 * guarantee that ticking a box never touches a memo shard.
 *
 * @module flomo-core/test/todos
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DATA_DIR,
  FlomoVault,
  findTodo,
  flattenTodos,
  insertTodoAt,
  parseDateOnly,
  parseTodoPlain,
  removeTodoAt,
  setTodoDone,
  splitTodos,
  stripCompleted,
  TODO_FILE,
  todoDueState,
  todoQuadrant,
  updateTodoAt,
} from '../src/index.ts'
import type { Memo, Todo } from '../src/index.ts'
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

  it('keeps an open root active while any descendant is open, and sinks a done tree', () => {
    const tree: Todo = {
      ...todo('root'),
      children: [
        todo('child-done', '2026-10-02T08:00:00.000Z'),
        {
          ...todo('child-open'),
          children: [todo('grandchild-open')],
        },
      ],
    }
    const doneTree: Todo = {
      ...todo('root2', '2026-10-05T08:00:00.000Z'),
      children: [todo('child2', '2026-10-04T08:00:00.000Z')],
    }
    const { active, completed } = splitTodos([tree, doneTree])
    assert.deepEqual(active.map((item) => item.id), ['root'])
    assert.deepEqual(completed.map((item) => item.id), ['root2'])
  })
})

describe('the todo forest', () => {
  const task = (id: string, extra: Partial<Todo> = {}): Todo => ({
    id,
    content: `task ${id}`,
    createdAt: '2026-10-10T00:00:00.000Z',
    ...extra,
  })

  const TREE: Todo[] = [
    task('a', {
      priority: 'P1',
      due: '2026-10-20',
      children: [task('a1'), task('a2', { children: [task('a2a')] })],
    }),
    task('b'),
  ]

  it('parses the recursive payload and drops junk fields', () => {
    const todos = parseTodoPlain(
      JSON.stringify([
        {
          id: 'a',
          content: '标题',
          createdAt: '2026-10-10T00:00:00.000Z',
          notes: '## 说明\n- 重点',
          priority: 'P1',
          due: '2026-10-20',
          children: [
            { id: 'a1', content: '子任务', createdAt: '2026-10-10T00:00:00.000Z' },
            { notATask: true },
          ],
        },
        { id: 'bad-priority', content: 'x', createdAt: '2026-10-10T00:00:00.000Z', priority: 'P9' },
        { id: 'bad-due', content: 'x', createdAt: '2026-10-10T00:00:00.000Z', due: '2026/10/20' },
      ]),
    )
    assert.equal(todos.length, 3)
    assert.equal(todos[0]?.children?.length, 1, 'junk children dropped, real ones kept')
    assert.equal(todos[0]?.notes, '## 说明\n- 重点')
    assert.equal(todos[1]?.priority, undefined, 'unknown priority reads as none')
    assert.equal(todos[2]?.due, undefined, 'malformed date reads as none')
  })

  it('parses a legacy flat document unchanged', () => {
    const todos = parseTodoPlain(
      JSON.stringify([{ id: 'a', content: '旧任务', createdAt: '2026-01-01T00:00:00.000Z' }]),
    )
    assert.deepEqual(todos, [
      { id: 'a', content: '旧任务', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('flattens depth-first with ancestors', () => {
    const flat = flattenTodos(TREE)
    assert.deepEqual(flat.map((entry) => [entry.todo.id, entry.depth]), [
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['a2a', 2],
      ['b', 0],
    ])
    assert.deepEqual(flat[3]?.parents.map((parent) => parent.id), ['a', 'a2'])
  })

  it('finds, updates and removes at any depth', () => {
    assert.equal(findTodo(TREE, 'a2a')?.id, 'a2a')
    const retitled = updateTodoAt(TREE, 'a2a', (todo) => ({ ...todo, content: '改过的' }))
    assert.equal(findTodo(retitled, 'a2a')?.content, '改过的')
    assert.equal(findTodo(TREE, 'a2a')?.content, 'task a2a', 'the original stays untouched')
    const [pruned, removed] = removeTodoAt(TREE, 'a2')
    assert.equal(removed, true)
    assert.equal(findTodo(pruned, 'a2a'), null, 'the subtree goes with the parent')
    assert.equal(removeTodoAt(TREE, 'nope')[1], false)
  })

  it('inserts at the top level or under a parent, and refuses unknown parents', () => {
    const withChild = insertTodoAt(TREE, task('a0'), 'a')
    assert.deepEqual(findTodo(withChild, 'a')?.children?.map((child) => child.id), ['a0', 'a1', 'a2'])
    const atTop = insertTodoAt(TREE, task('top'), null)
    assert.equal(atTop[0]?.id, 'top')
    assert.throws(() => insertTodoAt(TREE, task('x'), 'nope'))
  })

  it('cascades completion down the subtree and back up', () => {
    const done = setTodoDone(findTodo(TREE, 'a')!, true, '2026-10-12T00:00:00.000Z')
    assert.ok(findTodo([done], 'a1')?.completedAt !== undefined)
    assert.ok(findTodo([done], 'a2a')?.completedAt !== undefined)
    const revived = setTodoDone(done, false, '2026-10-12T00:00:00.000Z')
    assert.equal(findTodo([revived], 'a1')?.completedAt, undefined)
  })

  it('strips completed tasks with their subtrees and counts what went', () => {
    const mixed: Todo[] = [
      task('open', { children: [task('open-child')] }),
      task('done', { completedAt: '2026-10-11T00:00:00.000Z', children: [task('done-child')] }),
      task('open2', { children: [task('done-child2', { completedAt: '2026-10-11T00:00:00.000Z' })] }),
    ]
    const [next, dropped] = stripCompleted(mixed)
    assert.equal(dropped, 3, 'a completed root takes its subtree; a done leaf goes alone')
    assert.deepEqual(
      next.map((todo) => todo.id),
      ['open', 'open2'],
    )
    assert.equal(next[1]?.children, undefined, 'the emptied children field is dropped')
  })

  it('derives due state against a reference day', () => {
    const today = parseDateOnly('2026-10-12')
    assert.equal(todoDueState('2026-10-11', today), 'overdue')
    assert.equal(todoDueState('2026-10-12', today), 'near', 'due today is near')
    assert.equal(todoDueState('2026-10-15', today), 'near', 'the third day out is still near')
    assert.equal(todoDueState('2026-10-16', today), 'later')
  })

  it('derives the quadrant from priority and due date', () => {
    const today = parseDateOnly('2026-10-12')
    const base = task('x')
    assert.equal(todoQuadrant({ ...base, priority: 'P1' }, today), 'plan', 'important, no deadline')
    assert.equal(
      todoQuadrant({ ...base, priority: 'P2', due: '2026-10-13' }, today),
      'do',
      'important and due soon',
    )
    assert.equal(
      todoQuadrant({ ...base, due: '2026-10-13' }, today),
      'delegate',
      'urgent but unranked',
    )
    assert.equal(todoQuadrant({ ...base, priority: 'P3' }, today), 'later')
    assert.equal(
      todoQuadrant({ ...base, priority: 'P3', due: '2026-10-01' }, today),
      'delegate',
      'overdue reads as urgent',
    )
  })
})

describe('vault tree operations', () => {
  it('nests subtasks, edits detail fields and clears them with null', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    const parent = vault.addTodo('发布新版本')
    vault.addTodo('写公告', parent.id)
    vault.addTodo('回归测试', parent.id)

    const tree = vault.todos()
    assert.deepEqual(tree.map((todo) => todo.content), ['发布新版本'])
    // Newest child first, the way a fresh task lands at the top of the list.
    assert.deepEqual(tree[0]?.children?.map((child) => child.content), ['回归测试', '写公告'])

    vault.updateTodo(parent.id, {
      notes: '## 注意\n- 先打 tag',
      priority: 'P1',
      due: '2026-10-20',
    })
    const detailed = vault.todos()[0]!
    assert.equal(detailed.notes, '## 注意\n- 先打 tag')
    assert.equal(detailed.priority, 'P1')
    assert.equal(detailed.due, '2026-10-20')

    vault.updateTodo(parent.id, { due: null, priority: null })
    const cleared = vault.todos()[0]!
    assert.equal(cleared.due, undefined)
    assert.equal(cleared.priority, undefined)
    assert.equal(cleared.notes, '## 注意\n- 先打 tag', 'untouched fields stay')
  })

  it('cascades a parent toggle through the subtree, persisted', async () => {
    const store = new MemoryStore()
    const { vault, code } = await openVault(store)
    const parent = vault.addTodo('父任务')
    const child = vault.addTodo('子任务', parent.id)

    vault.toggleTodo(parent.id)
    assert.ok(findTodo(vault.todos(), child.id)?.completedAt !== undefined)

    vault.toggleTodo(parent.id, false)
    assert.equal(findTodo(vault.todos(), child.id)?.completedAt, undefined)

    // The cascade survives a flush-and-reload: the tree itself is what persists.
    vault.toggleTodo(parent.id)
    await vault.flush()
    const reopened = await FlomoVault.openWithRecovery(store, code)
    await reopened.loadAll()
    const reloaded = findTodo(reopened.todos(), child.id)
    assert.ok(reloaded?.completedAt !== undefined, 'the child stamp rode along')
    assert.ok(reloaded !== null && reloaded.children === undefined)
  })

  it('removes a task with its subtree and clears completed trees', async () => {
    const store = new MemoryStore()
    const { vault } = await openVault(store)
    const parent = vault.addTodo('父任务')
    vault.addTodo('子任务', parent.id)
    vault.addTodo('独立任务')

    // Removing a parent takes the subtask with it.
    vault.removeTodo(parent.id)
    assert.deepEqual(vault.todos().map((todo) => todo.content), ['独立任务'])
    assert.equal(vault.removeTodo('nope'), false)

    // Clearing takes a done leaf alone, then a done parent with its whole tree.
    const leaf = vault.addTodo('叶子')
    vault.toggleTodo(leaf.id)
    assert.equal(vault.clearCompletedTodos(), 1, 'a done leaf goes alone')

    const parent2 = vault.addTodo('父任务二')
    vault.addTodo('子任务二', parent2.id)
    vault.toggleTodo(parent2.id)
    assert.equal(vault.clearCompletedTodos(), 2, 'a done parent takes its subtree')
    assert.deepEqual(vault.todos().map((todo) => todo.content), ['独立任务'])
    assert.equal(vault.removeTodo(vault.todos()[0]!.id), true)
    assert.equal(vault.todos().length, 0)
  })
})
