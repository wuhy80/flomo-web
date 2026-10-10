/**
 * The standalone TODO document: shapes, parsing, and the list queries the UI
 * renders from.
 *
 * The checklist is saved apart from the memos — one encrypted `todo.json` at
 * the repository root rather than a shard under `data/` — so ticking a box
 * never rewrites a month of notes and the two documents version separately in
 * git. The payload is sealed with the vault key like everything else.
 *
 * @module @flomo/core/todos
 */

import type { Todo } from './types.ts'

/** Filename of the encrypted TODO document, at the repository root. */
export const TODO_FILE = 'todo.json'

/**
 * The sealed TODO document, as persisted.
 *
 * Same envelope as a memo shard minus the month: there is only ever one todo
 * file, so there is nothing to shard.
 */
export interface TodoDocument {
  /** Format version. */
  v: 1
  /** IV and ciphertext of the todo array. */
  iv: string
  ct: string
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string
}

/**
 * Parse and validate a sealed TODO document payload.
 * @param text - the raw file text.
 * @returns the validated document.
 * @throws {Error} when the shape is wrong.
 */
export function parseTodoDocument(text: string): TodoDocument {
  const parsed = JSON.parse(text) as Partial<TodoDocument>
  if (parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') {
    throw new Error('todo.json 结构无法识别。')
  }
  return {
    v: 1,
    iv: parsed.iv,
    ct: parsed.ct,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
  }
}

/**
 * Parse the decrypted plaintext of a TODO document.
 * @param plain - the decrypted JSON array.
 * @returns the todos, dropping any entry that is not shaped like one.
 */
export function parseTodoPlain(plain: string): Todo[] {
  const parsed: unknown = JSON.parse(plain)
  if (!Array.isArray(parsed)) return []
  const todos: Todo[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const candidate = item as Partial<Todo>
    if (typeof candidate.id !== 'string' || typeof candidate.content !== 'string') continue
    if (typeof candidate.createdAt !== 'string') continue
    todos.push(
      typeof candidate.completedAt === 'string'
        ? { ...candidate, id: candidate.id, content: candidate.content, createdAt: candidate.createdAt, completedAt: candidate.completedAt }
        : { id: candidate.id, content: candidate.content, createdAt: candidate.createdAt },
    )
  }
  return todos
}

/** The checklist split the way Google Tasks lays it out. */
export interface TodoGroups {
  /** Open tasks, in list order — new ones go to the top. */
  active: Todo[]
  /** Done tasks, most recently completed first. */
  completed: Todo[]
}

/**
 * Split the list into open and done tasks.
 *
 * The stored order is the display order for open tasks; done ones sink into
 * their own group ordered by when they were ticked, newest first, which is the
 * order they would be cleared in.
 * @param todos - the full list, in stored order.
 * @returns the two groups.
 */
export function splitTodos(todos: readonly Todo[]): TodoGroups {
  const active: Todo[] = []
  const completed: Todo[] = []
  for (const todo of todos) {
    if (todo.completedAt === undefined) active.push(todo)
    else completed.push(todo)
  }
  completed.sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))
  return { active, completed }
}

/** @returns how many tasks are still open. */
export function activeTodoCount(todos: readonly Todo[]): number {
  let count = 0
  for (const todo of todos) if (todo.completedAt === undefined) count += 1
  return count
}
