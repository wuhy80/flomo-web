/**
 * The standalone TODO document: shapes, parsing, the tree operations the list
 * is built from, and the quadrant/due derivations the views group by.
 *
 * The checklist is saved apart from the memos — one encrypted `todo.json` at
 * the repository root rather than a shard under `data/` — so ticking a box
 * never rewrites a month of notes and the two documents version separately in
 * git. The payload is sealed with the vault key like everything else.
 *
 * The list is a forest: every task may nest subtasks of the same shape to any
 * depth. The detail fields (notes, priority, due) are optional, so a document
 * raised on the original flat format parses back unchanged — old entries are
 * just tasks that carry nothing extra.
 *
 * @module @flomo/core/todos
 */

import type { Todo, TodoPriority } from './types.ts'
import { dayLabel, dayOf } from './time.ts'

export type { TodoPriority }

/** Filename of the encrypted TODO document, at the repository root. */
export const TODO_FILE = 'todo.json'

/**
 * The sealed TODO document, as persisted.
 *
 * Same envelope as a memo shard minus the month: there is only ever one todo
 * file, so there is nothing to shard. `v` versions the *envelope*; the payload
 * schema evolves additively inside it.
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

/** The priority values, checked literally — anything else reads as none. */
const PRIORITIES: readonly string[] = ['P1', 'P2', 'P3']

/** A `YYYY-MM-DD` string, the only shape `due` accepts. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate one decrypted entry, and its subtasks recursively.
 * @param item - one element of the parsed payload array.
 * @returns the task, or null when the entry is not shaped like one.
 */
function parseOne(item: unknown): Todo | null {
  if (typeof item !== 'object' || item === null) return null
  const candidate = item as Partial<Todo>
  if (typeof candidate.id !== 'string' || typeof candidate.content !== 'string') return null
  if (typeof candidate.createdAt !== 'string') return null

  const todo: Todo = {
    id: candidate.id,
    content: candidate.content,
    createdAt: candidate.createdAt,
  }
  if (typeof candidate.notes === 'string' && candidate.notes.trim() !== '') todo.notes = candidate.notes
  if (candidate.priority !== undefined && PRIORITIES.includes(candidate.priority)) {
    todo.priority = candidate.priority
  }
  if (candidate.due !== undefined && DATE_ONLY.test(candidate.due)) todo.due = candidate.due
  if (typeof candidate.completedAt === 'string') todo.completedAt = candidate.completedAt
  if (Array.isArray(candidate.children)) {
    const children = candidate.children.map(parseOne).filter((child): child is Todo => child !== null)
    if (children.length > 0) todo.children = children
  }
  return todo
}

/**
 * Parse the decrypted plaintext of a TODO document.
 * @param plain - the decrypted JSON array.
 * @returns the forest, dropping any entry that is not shaped like one.
 */
export function parseTodoPlain(plain: string): Todo[] {
  const parsed: unknown = JSON.parse(plain)
  if (!Array.isArray(parsed)) return []
  return parsed.map(parseOne).filter((todo): todo is Todo => todo !== null)
}

/**
 * Visit every task in the forest, depth-first, parents before children.
 * @param todos - the forest.
 * @param visit - receives the task, its depth (0 for roots) and its ancestors.
 */
export function walkTodos(
  todos: readonly Todo[],
  visit: (todo: Todo, depth: number, parents: readonly Todo[]) => void,
): void {
  const walk = (list: readonly Todo[], depth: number, parents: readonly Todo[]): void => {
    for (const todo of list) {
      visit(todo, depth, parents)
      if (todo.children !== undefined) walk(todo.children, depth + 1, [...parents, todo])
    }
  }
  walk(todos, 0, [])
}

/** One task as the flat views see it: the task, its depth and ancestor titles. */
export interface FlatTodo {
  todo: Todo
  /** Nesting depth, 0 for a root task. */
  depth: number
  /** The ancestor tasks, nearest first. */
  parents: readonly Todo[]
}

/**
 * The forest flattened depth-first, parents before children.
 * @param todos - the forest.
 * @returns every task with its position in the tree.
 */
export function flattenTodos(todos: readonly Todo[]): FlatTodo[] {
  const flat: FlatTodo[] = []
  walkTodos(todos, (todo, depth, parents) => flat.push({ todo, depth, parents }))
  return flat
}

/**
 * Find one task anywhere in the forest.
 * @param todos - the forest.
 * @param id - the task id.
 * @returns the task, or null.
 */
export function findTodo(todos: readonly Todo[], id: string): Todo | null {
  for (const todo of todos) {
    if (todo.id === id) return todo
    if (todo.children !== undefined) {
      const found = findTodo(todo.children, id)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Rewrite one task anywhere in the forest, keeping its position.
 * @param todos - the forest.
 * @param id - the task to rewrite.
 * @param rewrite - maps the task to its next shape; return the task unchanged to be a no-op.
 * @returns the new forest; the original when the id is unknown.
 */
export function updateTodoAt(
  todos: readonly Todo[],
  id: string,
  rewrite: (todo: Todo) => Todo,
): Todo[] {
  let changed = false
  const next = todos.map((todo) => {
    if (todo.id === id) {
      changed = true
      return rewrite(todo)
    }
    if (todo.children === undefined) return todo
    const children = updateTodoAt(todo.children, id, rewrite)
    if (children === todo.children) return todo
    // A deeper level rewrote itself: its `changed` flag lives in that call's
    // own closure, so the reference change is what tells this level the news.
    changed = true
    return { ...todo, children }
  })
  // The no-op path hands the caller's own array back so a reference check can
  // tell "nothing changed" — the input never gets mutated, so the cast is safe.
  return changed ? next : (todos as Todo[])
}

/**
 * Remove one task — and its whole subtree — from anywhere in the forest.
 * @param todos - the forest.
 * @param id - the task to remove.
 * @returns the new forest, and whether anything was removed.
 */
export function removeTodoAt(todos: readonly Todo[], id: string): [Todo[], boolean] {
  let removed = false
  const strip = (list: readonly Todo[]): Todo[] =>
    list.flatMap((todo) => {
      if (todo.id === id) {
        removed = true
        return []
      }
      if (todo.children === undefined) return [todo]
      return [{ ...todo, children: strip(todo.children) }]
    })
  const next = strip(todos)
  return [next, removed]
}

/**
 * Insert a task as the newest entry of one parent's children — at the top of
 * the forest when no parent is given, matching where a fresh task belongs
 * while the Enter key is still warm.
 * @param todos - the forest.
 * @param todo - the task to insert.
 * @param parentId - the parent task's id, or null for the top level.
 * @returns the new forest.
 * @throws when the parent id is unknown.
 */
export function insertTodoAt(todos: readonly Todo[], todo: Todo, parentId: string | null): Todo[] {
  if (parentId === null) return [todo, ...todos]
  const next = updateTodoAt(todos, parentId, (parent) => ({
    ...parent,
    children: [todo, ...(parent.children ?? [])],
  }))
  // updateTodoAt hands back the original array when the id went nowhere.
  if (next === todos) throw new Error(`找不到 todo：${parentId}`)
  return next
}

/**
 * Insert a task as the next sibling of another task.
 * @param todos - the forest.
 * @param afterId - the task to insert after.
 * @param todo - the task to insert.
 * @returns the new forest.
 * @throws when `afterId` is unknown.
 */
export function insertAfterTodoAt(todos: readonly Todo[], afterId: string, todo: Todo): Todo[] {
  let changed = false
  // The walk returns the ORIGINAL list when nothing below changed — a rebuilt
  // array on every level would make every parent look changed and wreck the
  // no-op detection the outer return relies on.
  const walk = (list: readonly Todo[]): Todo[] => {
    const index = list.findIndex((task) => task.id === afterId)
    if (index !== -1) {
      changed = true
      const next = [...list]
      next.splice(index + 1, 0, todo)
      return next
    }
    let next: Todo[] | null = null
    for (let at = 0; at < list.length; at += 1) {
      const task = list[at]!
      if (task.children === undefined) continue
      const children = walk(task.children)
      if (children === task.children) continue
      next = next ?? [...list]
      next[at] = { ...task, children }
      break // one id matches, so at most one subtree changes
    }
    return next ?? (list as Todo[])
  }
  const next = walk(todos)
  // The no-op path hands the caller's array back, same contract as updateTodoAt.
  return changed ? next : (todos as Todo[])
}

/**
 * Insert a task as the previous sibling of another task — the mirror of
 * {@linkcode insertAfterTodoAt}.
 * @param todos - the forest.
 * @param beforeId - the task to insert before.
 * @param todo - the task to insert.
 * @returns the new forest.
 * @throws when `beforeId` is unknown.
 */
export function insertBeforeTodoAt(todos: readonly Todo[], beforeId: string, todo: Todo): Todo[] {
  let changed = false
  // Same identity discipline as insertAfterTodoAt: a level that did not
  // change hands back its own array.
  const walk = (list: readonly Todo[]): Todo[] => {
    const index = list.findIndex((task) => task.id === beforeId)
    if (index !== -1) {
      changed = true
      const next = [...list]
      next.splice(index, 0, todo)
      return next
    }
    let next: Todo[] | null = null
    for (let at = 0; at < list.length; at += 1) {
      const task = list[at]!
      if (task.children === undefined) continue
      const children = walk(task.children)
      if (children === task.children) continue
      next = next ?? [...list]
      next[at] = { ...task, children }
      break // one id matches, so at most one subtree changes
    }
    return next ?? (list as Todo[])
  }
  const next = walk(todos)
  return changed ? next : (todos as Todo[])
}

/**
 * Demote a task: it becomes the last child of the sibling above it, its own
 * subtree riding along. A first child has nobody to nest under and stays put.
 * @param todos - the forest.
 * @param id - the task to demote.
 * @returns the new forest.
 */
export function indentTodoAt(todos: readonly Todo[], id: string): Todo[] {
  let changed = false
  // Same identity discipline as insertAfterTodoAt: a level that did not
  // change hands back its own array.
  const walk = (list: readonly Todo[]): Todo[] => {
    const index = list.findIndex((task) => task.id === id)
    if (index !== -1) {
      if (index === 0) return list as Todo[] // a first child cannot demote
      changed = true
      const demoted = list[index]!
      return list
        .filter((_, at) => at !== index)
        .map((task, at) =>
          // Removing `index` shifts nothing before it, so the previous
          // sibling still sits at `index - 1`.
          at === index - 1 ? { ...task, children: [...(task.children ?? []), demoted] } : task,
        )
    }
    let next: Todo[] | null = null
    for (let at = 0; at < list.length; at += 1) {
      const task = list[at]!
      if (task.children === undefined) continue
      const children = walk(task.children)
      if (children === task.children) continue
      next = next ?? [...list]
      next[at] = { ...task, children }
      break // one id matches, so at most one subtree changes
    }
    return next ?? (list as Todo[])
  }
  const next = walk(todos)
  return changed ? next : (todos as Todo[])
}

/**
 * Promote a task out of its parent: it lands right after the parent, at the
 * parent's own level, its whole subtree following. A root task stays put.
 * @param todos - the forest.
 * @param id - the task to promote.
 * @returns the new forest.
 */
export function outdentTodoAt(todos: readonly Todo[], id: string): Todo[] {
  let parentId: string | null = null
  walkTodos(todos, (task, _depth, parents) => {
    if (task.id === id && parents.length > 0) parentId = parents[parents.length - 1]!.id
  })
  if (parentId === null) return todos as Todo[]
  const task = findTodo(todos, id)
  if (task === null) return todos as Todo[]
  const [without, removed] = removeTodoAt(todos, id)
  if (!removed) return todos as Todo[]
  return insertAfterTodoAt(without, parentId, task)
}

/**
 * Swap a task with the sibling above (`dir` −1) or below (`dir` +1) it.
 * @param todos - the forest.
 * @param id - the task to move.
 * @param dir - −1 up, +1 down.
 * @returns the new forest; the original at the edge of the list.
 */
export function moveTodoAt(todos: readonly Todo[], id: string, dir: -1 | 1): Todo[] {
  let changed = false
  const walk = (list: readonly Todo[]): Todo[] => {
    const index = list.findIndex((task) => task.id === id)
    if (index !== -1) {
      const other = index + dir
      if (other < 0 || other >= list.length) return list as Todo[] // already at the edge
      changed = true
      const next = [...list]
      next[index] = list[other]!
      next[other] = list[index]!
      return next
    }
    let next: Todo[] | null = null
    for (let at = 0; at < list.length; at += 1) {
      const task = list[at]!
      if (task.children === undefined) continue
      const children = walk(task.children)
      if (children === task.children) continue
      next = next ?? [...list]
      next[at] = { ...task, children }
      break // one id matches, so at most one subtree changes
    }
    return next ?? (list as Todo[])
  }
  const next = walk(todos)
  return changed ? next : (todos as Todo[])
}

/**
 * Move a task — its whole subtree riding along — to become the last child of
 * another task, the landing a drag-onto drop wants; `parentId === null` puts
 * it at the top of the forest instead. A drop onto the task itself or one of
 * its own descendants would curl the forest into a cycle, so that request is
 * refused and the forest comes back unchanged, as does a move that would land
 * the task under the parent it already sits under.
 * @param todos - the forest.
 * @param id - the task to move.
 * @param parentId - the parent task's id, or null for the top level.
 * @returns the new forest; the original when the move is refused or a no-op.
 */
export function reparentTodoAt(
  todos: readonly Todo[],
  id: string,
  parentId: string | null,
): Todo[] {
  const task = findTodo(todos, id)
  if (task === null) return todos as Todo[]
  // Onto itself or into its own subtree: either request would strand the tree,
  // because the drop target disappears together with the dragged subtree.
  if (parentId !== null && (parentId === id || findTodo(task.children ?? [], parentId) !== null)) {
    return todos as Todo[]
  }
  if (parentId !== null && findTodo(todos, parentId) === null) return todos as Todo[]
  let currentParent: string | null = null
  walkTodos(todos, (walking, _depth, parents) => {
    if (walking.id === id && parents.length > 0) {
      currentParent = parents[parents.length - 1]!.id
    }
  })
  if (parentId === currentParent) return todos as Todo[] // already a child there
  const [without, removed] = removeTodoAt(todos, id)
  if (!removed) return todos as Todo[]
  if (parentId === null) return [task, ...without]
  return updateTodoAt(without, parentId, (parent) => ({
    ...parent,
    children: [...(parent.children ?? []), task],
  }))
}

/**
 * Reorder a task to sit directly before or after another task, at that
 * task's own level — the landing a drag-on-a-row-edge drop wants. The moved
 * task's whole subtree rides along, and the move crosses levels the way the
 * eye expects: dropping beside a child of P makes the dragged task a child
 * of P too. A target inside the dragged subtree would strand the target, so
 * that request is refused and the forest comes back unchanged, as does any
 * move with an unknown id or the target equal to the dragged task.
 * @param todos - the forest.
 * @param id - the task to move.
 * @param targetId - the reference task to land beside.
 * @param side - land before or after the reference task.
 * @returns the new forest; the original when the move is refused or a no-op.
 */
export function reorderTodoAt(
  todos: readonly Todo[],
  id: string,
  targetId: string,
  side: 'before' | 'after',
): Todo[] {
  if (id === targetId) return todos as Todo[]
  const task = findTodo(todos, id)
  if (task === null) return todos as Todo[]
  if (findTodo(todos, targetId) === null) return todos as Todo[]
  if (findTodo(task.children ?? [], targetId) !== null) return todos as Todo[]
  const [without, removed] = removeTodoAt(todos, id)
  if (!removed) return todos as Todo[]
  return side === 'after'
    ? insertAfterTodoAt(without, targetId, task)
    : insertBeforeTodoAt(without, targetId, task)
}

/**
 * Set one task's done state, cascading to its whole subtree — completing a
 * parent retires its subtasks with it; reopening one revives them.
 * @param todo - the task to change.
 * @param done - the new value.
 * @param stamp - the completion timestamp to write when done.
 * @returns the new task.
 */
export function setTodoDone(todo: Todo, done: boolean, stamp: string): Todo {
  const apply = (task: Todo): Todo => {
    const next: Todo = { ...task }
    if (done) next.completedAt = stamp
    else delete next.completedAt
    if (next.children !== undefined) next.children = next.children.map(apply)
    return next
  }
  return apply(todo)
}

/** Drop empty `children` arrays left behind by edits, all the way down. */
function tidy(task: Todo): Todo {
  const next = { ...task }
  if (next.children !== undefined) {
    const children = next.children.map(tidy)
    if (children.length > 0) next.children = children
    else delete next.children
  }
  if (next.notes !== undefined && next.notes.trim() === '') delete next.notes
  return next
}

/**
 * Drop every completed task anywhere in the forest, completed roots taking
 * their whole subtree with them.
 * @param todos - the forest.
 * @returns the new forest, and how many tasks (subtree members included) went.
 */
export function stripCompleted(todos: readonly Todo[]): [Todo[], number] {
  let dropped = 0
  const count = (task: Todo): number => {
    let total = 1
    for (const child of task.children ?? []) total += count(child)
    return total
  }
  const keep = (list: readonly Todo[]): Todo[] =>
    list.flatMap((todo) => {
      if (todo.completedAt !== undefined) {
        dropped += count(todo)
        return []
      }
      return [{ ...todo, children: todo.children === undefined ? undefined : keep(todo.children) }]
    })
  const next = keep(todos).map(tidy)
  return [next, dropped]
}

/** The checklist split the way Google Tasks lays it out. */
export interface TodoGroups {
  /** Open roots, in list order — new ones go to the top. */
  active: Todo[]
  /** Completed roots (subtrees included), most recently completed first. */
  completed: Todo[]
}

/**
 * Split the forest into open and done roots.
 *
 * The split reads only each root's own tick — a task belongs to the done
 * group when it itself was checked, never because its subtasks all were. A
 * parent with every subtask ticked but its own box open stays in the open
 * list, showing its 子任务 progress bar until the top-level click happens.
 * The stored order is the display order for open tasks; done ones sink into
 * their own group ordered by when they were ticked, newest first.
 * @param todos - the forest, in stored order.
 * @returns the two groups.
 */
export function splitTodos(todos: readonly Todo[]): TodoGroups {
  const active: Todo[] = []
  const completed: Todo[] = []
  for (const todo of todos) {
    if (todo.completedAt === undefined) active.push(todo)
    else completed.push(todo)
  }
  completed.sort((a, b) => {
    const aa = a.completedAt ?? ''
    const bb = b.completedAt ?? ''
    return aa < bb ? 1 : -1
  })
  return { active, completed }
}

/** The newest completion timestamp anywhere in a task's subtree, or null while any of it is open. */
function latestCompletion(todo: Todo): string | null {
  let latest = todo.completedAt ?? null
  for (const child of todo.children ?? []) {
    const stamp = latestCompletion(child)
    if (stamp === null) return null
    if (latest === null || stamp > latest) latest = stamp
  }
  return latest
}

/** How many days of completed work stay recent before the rest is archived. */
export const COMPLETED_ARCHIVE_AFTER_DAYS = 3

/** One day of completed work, newest tick first inside the day. */
export interface CompletedDayGroup {
  /** `YYYY-MM-DD` in local time. */
  day: string
  /** `今天`, `昨天`, or a dated label such as `10月30日 周五`. */
  label: string
  /** Completed roots whose newest tick fell on this day. */
  items: Todo[]
}

/** Completed work split into the last few days and the archive. */
export interface CompletedByDay {
  /** Days inside the archive window, newest first. */
  recent: CompletedDayGroup[]
  /** Days past the window, newest first. */
  archived: CompletedDayGroup[]
  /** How many roots sit in {@link archived}. */
  archivedCount: number
}

/**
 * Group completed roots by the local day they were ticked off.
 *
 * The day comes from the row's own `completedAt` — the click that ticked that
 * task — rather than from the newest tick buried anywhere in its subtree. Only
 * when the row itself was never clicked (every subtask was ticked one by one)
 * does it fall back to the newest descendant tick, which is the moment the
 * tree actually became complete.
 *
 * Days newer than {@link COMPLETED_ARCHIVE_AFTER_DAYS} stay in `recent`; the
 * rest go to `archived`, which the view keeps collapsed by default rather than
 * deleting. Input order is preserved inside a day, so a newest-first list from
 * {@link splitTodos} stays newest-first here.
 * @param completed - completed roots, in display order.
 * @param today - reference instant for the retention window and the labels.
 * @param archiveAfterDays - how many days stay recent, counting today.
 * @returns the recent days, the archived days, and the archived total.
 */
export function groupCompletedByDay(
  completed: readonly Todo[],
  today: Date = new Date(),
  archiveAfterDays: number = COMPLETED_ARCHIVE_AFTER_DAYS,
): CompletedByDay {
  const cutoff = dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - archiveAfterDays))
  const buckets = new Map<string, Todo[]>()
  for (const todo of completed) {
    const stamp = todo.completedAt ?? latestCompletion(todo)
    if (stamp === null) continue
    const day = dayOf(stamp)
    const bucket = buckets.get(day)
    if (bucket === undefined) buckets.set(day, [todo])
    else bucket.push(todo)
  }
  const days = [...buckets.keys()].sort((a, b) => (a < b ? 1 : -1))
  const recent: CompletedDayGroup[] = []
  const archived: CompletedDayGroup[] = []
  for (const day of days) {
    const group: CompletedDayGroup = {
      day,
      label: dayLabel(day, today),
      items: buckets.get(day) ?? [],
    }
    if (day <= cutoff) archived.push(group)
    else recent.push(group)
  }
  const archivedCount = archived.reduce((total, group) => total + group.items.length, 0)
  return { recent, archived, archivedCount }
}

/** @returns how many tasks — subtasks included — are still open. */
export function activeTodoCount(todos: readonly Todo[]): number {
  let count = 0
  walkTodos(todos, (todo) => {
    if (todo.completedAt === undefined) count += 1
  })
  return count
}

/** How close a due date is, as the badge colour reads it. */
export type TodoDueState = 'overdue' | 'near' | 'later'

/** How many days out a date still counts as 紧急. */
export const NEAR_DAYS = 3

/**
 * Parse a `YYYY-MM-DD` date as local midnight — `new Date('YYYY-MM-DD')` would
 * read it as UTC midnight and shift the day for half the planet.
 * @param date - the date string.
 * @returns the local midnight of that date.
 */
export function parseDateOnly(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

/** Local midnight of the day an ISO timestamp falls on. */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/**
 * How close a task's due date is to a reference day.
 * @param due - the `YYYY-MM-DD` date.
 * @param today - the reference moment; defaults to now.
 * @returns overdue (before today), near (within {@linkcode NEAR_DAYS}), or later.
 */
export function todoDueState(due: string, today: Date = new Date()): TodoDueState {
  const day = startOfDay(today).getTime()
  const dueDay = parseDateOnly(due).getTime()
  if (dueDay < day) return 'overdue'
  if (dueDay <= day + NEAR_DAYS * 86_400_000) return 'near'
  return 'later'
}

/** The Eisenhower quadrant a task belongs to. */
export type TodoQuadrant = 'do' | 'plan' | 'delegate' | 'later'

/** One quadrant's key, label and hint, in the grid's reading order. */
export const QUADRANTS: ReadonlyArray<{ key: TodoQuadrant; label: string; hint: string }> = [
  { key: 'do', label: '立即做', hint: '重要且紧急' },
  { key: 'plan', label: '计划做', hint: '重要不紧急' },
  { key: 'delegate', label: '抓紧做', hint: '紧急不重要' },
  { key: 'later', label: '少做', hint: '不重要不紧急' },
]

/**
 * Which quadrant a task falls in — derived, never stored, so the grid can
 * never disagree with the fields that determine it.
 *
 * 重要 means the task carries a P1 or P2; 紧急 means it is due within
 * {@linkcode NEAR_DAYS} days of `today`, or already overdue. A task with
 * neither is 重要不紧急 only through its priority, and otherwise rests in 少做.
 * @param todo - the task.
 * @param today - the reference moment; defaults to now.
 * @returns the quadrant key.
 */
export function todoQuadrant(todo: Todo, today: Date = new Date()): TodoQuadrant {
  const important = todo.priority === 'P1' || todo.priority === 'P2'
  const urgent = todo.due !== undefined && todoDueState(todo.due, today) !== 'later'
  if (important && urgent) return 'do'
  if (important) return 'plan'
  if (urgent) return 'delegate'
  return 'later'
}
