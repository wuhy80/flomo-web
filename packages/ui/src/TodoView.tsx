/**
 * The TODO checklist: a task tree with detail cards, plus a quadrant view.
 *
 * The list half keeps the Google-Tasks shape it grew from — a quick add row on
 * top, open tasks with round checkboxes, completed work sunk into a collapsible
 * group — but a row is now a tree node: it can carry subtasks to any depth, a
 * markdown description, a priority and a due date. The detail card under a row
 * edits those fields in place; the description renders with the same body
 * renderer the memos use, so `**bold**` in a task reads like `**bold**` in a
 * note.
 *
 * The quadrant half is the same data cut the Eisenhower way. The quadrant is
 * derived — priority for importance, due date for urgency — never stored, so
 * the grid cannot disagree with the fields that decide it.
 *
 * @module @flomo/ui/TodoView
 */

import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { QUADRANTS, findTodo, flattenTodos, groupCompletedByDay, splitTodos, todoDueState, todoQuadrant, walkTodos } from '@flomo/core'
import { isTypingTarget } from './shortcuts.ts'
import type { CompletedDayGroup, Todo, TodoPatch, TodoPriority } from '@flomo/core'
import type { TodoQuickFields } from './session.ts'

import { MarkdownBody } from './MarkdownBody.tsx'
import { groupArchivedByMonth } from './archive.ts'

/** The checklist's mutation callbacks, all optional so a backend without todo
 * support can render the panel as a pointer to the web app instead. */
export interface TodoHandlers {
  /** Add a task at the top, or as a child when a parent is given. */
  onAdd?: (content: string, parentId?: string | null) => void
  /**
   * Add a task with the composer chips' fields — shown only when present, so a
   * backend that speaks plain {@linkcode onAdd} never sees a chip it cannot honour.
   */
  onAddFields?: (fields: TodoQuickFields, parentId?: string | null) => void
  /** Replace a task's title. */
  onEdit?: (id: string, content: string) => void
  /** Rewrite a task's detail fields; null clears one. */
  onUpdate?: (id: string, patch: TodoPatch) => void
  /** Complete or reopen a task — the vault cascades to its subtree. */
  onToggle?: (id: string, done?: boolean) => void
  /** Delete one task with its subtree. */
  onRemove?: (id: string) => void
  /** Demote a task under the sibling above it. */
  onIndent?: (id: string) => void
  /** Promote a task to its parent's level. */
  onOutdent?: (id: string) => void
  /** Swap a task with the sibling above (−1) or below (+1). */
  onMove?: (id: string, dir: -1 | 1) => void
  /** Land a dragged task under the row it was released on, as its last child. */
  onMoveUnder?: (id: string, parentId: string) => void
  /** Reorder a dragged task directly before or after the row it touched. */
  onMoveBeside?: (id: string, targetId: string, side: 'before' | 'after') => void
  /** Drop every completed task. */
  onClearCompleted?: () => void
}

export interface TodoViewProps extends TodoHandlers {
  /** The whole forest, in stored order; grouping happens here. */
  todos: readonly Todo[]
}

/** Display labels for the priorities, in select order. */
const PRIORITY_OPTIONS: ReadonlyArray<{ value: TodoPriority | ''; label: string }> = [
  { value: '', label: '无优先级' },
  { value: 'P1', label: 'P1 高' },
  { value: 'P2', label: 'P2 中' },
  { value: 'P3', label: 'P3 低' },
]

/**
 * Local `YYYY-MM-DD`, the exact shape the due field stores. Due dates carry no
 * timezone, so "today" for grouping and chips must be cut from the same cloth.
 * @param date - the day to key.
 * @returns the key.
 */
function dateKeyOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 「11月5日」 from `"2026-11-05"` — chips stay short, the title carries the rest.
 * @param due - the stored date-only string.
 * @returns the label.
 */
function dueLabel(due: string): string {
  const [, m, d] = due.split('-')
  return `${Number(m)}月${Number(d)}日`
}

/**
 * One row's checkbox, round like Google Tasks' and green once ticked.
 * @param props - the todo and its toggle callback.
 * @returns the checkbox element.
 */
function TodoCheck({
  todo,
  onToggle,
}: {
  todo: Todo
  onToggle?: (id: string, done?: boolean) => void
}): React.ReactElement {
  const done = todo.completedAt !== undefined
  return (
    <button
      type="button"
      className="fl-todo-check"
      data-done={done}
      aria-pressed={done}
      aria-label={done ? `标记「${todo.content}」为未完成` : `完成「${todo.content}」`}
      title={done ? '标记为未完成' : '标记为已完成'}
      onClick={() => onToggle?.(todo.id)}
    >
      {done ? '✓' : ''}
    </button>
  )
}

/** The priority chip: a bare P1/P2/P3, colour-coded by heat. */
function PriorityChip({ priority }: { priority: TodoPriority }): React.ReactElement {
  return (
    <span className="fl-todo-priority" data-priority={priority}>
      {priority}
    </span>
  )
}

/** The due-date chip: green when due today, orange inside three days, red past. */
function DueBadge({ due, done }: { due: string; done: boolean }): React.ReactElement | null {
  const state = todoDueState(due)
  const isToday = due === dateKeyOf(new Date())
  const kind = done ? 'later' : isToday ? 'today' : state
  const text =
    kind === 'today' ? '今天' : kind === 'overdue' ? `逾期 ${dueLabel(due)}` : dueLabel(due)
  return (
    <span className="fl-todo-due" data-state={kind} title={`期望结束 ${due}`}>
      {text}
    </span>
  )
}

/**
 * The detail card under a row: description with markdown, priority, due date
 * and the subtask add row.
 *
 * Every field commits as it changes — select and date on change, description
 * on blur — because a checklist has no save button to forget. The card keys on
 * the task's id, so switching tasks starts from that task's fields.
 * @param props - the task, its update and child-add callbacks, and close.
 * @returns the card element.
 */
function TodoDetail({
  todo,
  onUpdate,
  onAdd,
  onExpand,
  onClose,
}: {
  todo: Todo
  onUpdate?: (id: string, patch: TodoPatch) => void
  onAdd?: (content: string, parentId?: string | null) => void
  /** Ensures the task's subtree is visible — a new subtask must be seen. */
  onExpand?: (id: string) => void
  onClose: () => void
}): React.ReactElement {
  const [notes, setNotes] = useState(todo.notes ?? '')
  const [preview, setPreview] = useState(false)
  const [subDraft, setSubDraft] = useState('')
  const subInput = useRef<HTMLInputElement>(null)

  /** Commit the description when it actually changed; empty clears the field. */
  const commitNotes = (): void => {
    if (notes === (todo.notes ?? '')) return
    onUpdate?.(todo.id, { notes: notes.trim() === '' ? null : notes })
  }

  const addSubtask = (): void => {
    const content = subDraft.trim()
    if (content === '') return
    onAdd?.(content, todo.id)
    // A fresh subtask under a collapsed task would be invisible — open it.
    onExpand?.(todo.id)
    setSubDraft('')
    subInput.current?.focus()
  }

  return (
    <div className="fl-todo-detail">
      <div className="fl-todo-detail-fields">
        <label className="fl-todo-field">
          <span className="fl-todo-field-label">优先级</span>
          <select
            value={todo.priority ?? ''}
            aria-label="优先级"
            onChange={(event) =>
              onUpdate?.(todo.id, {
                priority: event.target.value === '' ? null : (event.target.value as TodoPriority),
              })
            }
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fl-todo-field">
          <span className="fl-todo-field-label">期望结束</span>
          <input
            type="date"
            value={todo.due ?? ''}
            aria-label="期望结束日期"
            onChange={(event) =>
              onUpdate?.(todo.id, { due: event.target.value === '' ? null : event.target.value })
            }
          />
        </label>
      </div>

      <div className="fl-todo-notes">
        <div className="fl-todo-notes-head">
          <span className="fl-todo-field-label">任务描述</span>
          <button
            type="button"
            className="fl-todo-notes-toggle"
            aria-pressed={preview}
            onClick={() => setPreview((open) => !open)}
          >
            {preview ? '编辑' : '预览'}
          </button>
        </div>
        {preview ? (
          <div className="fl-todo-notes-body">
            {notes.trim() === '' ? (
              <span className="fl-todo-notes-empty">还没有描述</span>
            ) : (
              <MarkdownBody content={notes} />
            )}
          </div>
        ) : (
          <textarea
            className="fl-todo-notes-input"
            value={notes}
            rows={3}
            placeholder="描述这个任务，支持与笔记相同的格式"
            aria-label="任务描述"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={commitNotes}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                commitNotes()
              }
              if (event.key === 'Escape') {
                commitNotes()
                onClose()
              }
            }}
          />
        )}
      </div>

      <div className="fl-todo-subadd">
        <span className="fl-todo-add-icon" aria-hidden="true">
          ＋
        </span>
        <input
          ref={subInput}
          type="text"
          value={subDraft}
          placeholder="添加子任务"
          aria-label="添加子任务"
          onChange={(event) => setSubDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addSubtask()
            if (event.key === 'Escape') onClose()
          }}
        />
      </div>

      <button
        type="button"
        className="fl-todo-detail-close"
        aria-label="收起详情"
        onClick={onClose}
      >
        收起
      </button>
    </div>
  )
}

/**
 * One row of the tree: checkbox, title, chips, hover actions, and — when
 * expanded — the detail card and the nested subtasks.
 *
 * The view state arrives as the raw collections and each node computes its own
 * booleans, so the recursive call cannot inherit a parent's expanded or editing
 * flag by mistake.
 * @param props - the task and the shared view state plus callbacks.
 * @returns the row element.
 */
function TodoRow({
  todo,
  editingId,
  openIds,
  detailId,
  selected,
  deleteArmed,
  onArmRemove,
  onConfirmRemove,
  onEditText,
  editText,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleOpen,
  onExpand,
  onToggleDetail,
  dragId,
  dragSubtree,
  onDragStart,
  onDragEnd,
  onDropUnder,
  onDropBeside,
  handlers,
}: {
  todo: Todo
  editingId: string | null
  openIds: ReadonlySet<string>
  detailId: string | null
  selected: boolean
  /** The id whose removal is armed, or null — passed down so children see it. */
  deleteArmed: string | null
  onArmRemove: (id: string) => void
  onConfirmRemove: (id: string) => void
  editText: string
  onEditText: (text: string) => void
  onStartEdit: (todo: Todo) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onToggleOpen: (id: string) => void
  onExpand: (id: string) => void
  onToggleDetail: (id: string) => void
  /** The task under drag right now, or null between drags — every row reads
   * it to decide whether a hover is a valid landing. */
  dragId: string | null
  /** The dragged task's own subtree; a drop onto it would make a cycle. */
  dragSubtree: ReadonlySet<string>
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropUnder: (id: string, parentId: string) => void
  onDropBeside: (id: string, targetId: string, side: 'before' | 'after') => void
  handlers: TodoHandlers
}): React.ReactElement {
  const { onToggle, onRemove, onUpdate, onAdd } = handlers
  const done = todo.completedAt !== undefined
  const children = todo.children ?? []
  const hasChildren = children.length > 0
  const subDone = children.filter((child) => child.completedAt !== undefined).length
  const editing = editingId === todo.id
  const open = openIds.has(todo.id)
  const detailOpen = detailId === todo.id
  const deleteArmedHere = deleteArmed === todo.id
  // The row under the cursor answers every dragover, so the state lives here.
  // The hover splits into three bands across the row line — top edge lands
  // before it, bottom edge after it, the middle makes it a child — and `deny`
  // paints the not-allowed tint for self, descendant and done targets.
  const [dropState, setDropState] = useState<'idle' | 'child' | 'before' | 'after' | 'deny'>('idle')
  const dragActive = dragId !== null
  const dropAllowedHere = dragActive && dragId !== todo.id && !dragSubtree.has(todo.id) && !done
  const clearDrop = (): void => setDropState('idle')
  /** Which landing band the cursor is in, measured on the visible line —
   * the `li`'s own rect would stretch over the whole expanded subtree. */
  const hoverZone = (event: React.DragEvent<Element>): 'before' | 'after' | 'child' => {
    const line = event.currentTarget.querySelector(':scope > .fl-todo-line')
    if (!(line instanceof HTMLElement)) return 'child'
    const rect = line.getBoundingClientRect()
    const at = (event.clientY - rect.top) / rect.height
    return at < 0.3 ? 'before' : at > 0.7 ? 'after' : 'child'
  }
  return (
    <li
      className="fl-todo-item"
      data-done={done ? 'true' : undefined}
      data-todo-id={todo.id}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragId === todo.id ? 'true' : undefined}
      data-drop-child={dropState === 'child' ? 'true' : undefined}
      data-drop-before={dropState === 'before' ? 'true' : undefined}
      data-drop-after={dropState === 'after' ? 'true' : undefined}
      data-drop-deny={dropState === 'deny' ? 'true' : undefined}
      draggable={!editing && !done}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', todo.id)
        event.dataTransfer.effectAllowed = 'move'
        // The default ghost drags the whole expanded subtree along; a clone of
        // just the visible line reads as "this task" instead of "this pile".
        const line = event.currentTarget.querySelector('.fl-todo-line')
        if (line instanceof HTMLElement) {
          const ghost = line.cloneNode(true) as HTMLElement
          ghost.style.cssText =
            'position:absolute;top:-9999px;left:-9999px;width:420px;padding:7px 8px;' +
            'background:#fff;border:1px solid var(--flomo-border-strong);' +
            'border-radius:var(--flomo-radius-sm);box-shadow:0 8px 24px rgba(0,0,0,0.18);'
          document.body.appendChild(ghost)
          event.dataTransfer.setDragImage(ghost, 14, 16)
          window.setTimeout(() => ghost.remove(), 0)
        }
        onDragStart(todo.id)
      }}
      onDragEnd={() => {
        clearDrop()
        onDragEnd()
      }}
      onDragOver={(event) => {
        if (!dragActive) return
        // Events bubble up from nested rows; only the innermost row may light
        // up, and an outer row that was lit on the way in must switch off.
        if (event.target instanceof Element && event.target.closest('[data-todo-id]') !== event.currentTarget) {
          setDropState((current) => (current === 'idle' ? current : 'idle'))
          return
        }
        if (!dropAllowedHere) {
          event.dataTransfer.dropEffect = 'none'
          setDropState((current) => (current === 'deny' ? current : 'deny'))
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const zone = hoverZone(event)
        setDropState((current) => (current === zone ? current : zone))
      }}
      onDragLeave={(event) => {
        // Crossing into a child element fires a leave for the row itself;
        // only a departure past the row's border clears the highlight.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDrop()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const zone = dropAllowedHere && dragId !== null ? hoverZone(event) : null
        clearDrop()
        if (zone !== null && dragId !== null) {
          if (zone === 'child') onDropUnder(dragId, todo.id)
          else onDropBeside(dragId, todo.id, zone)
        }
        onDragEnd()
      }}
    >
      <div className="fl-todo-line">
        {hasChildren ? (
          <button
            type="button"
            className="fl-todo-caret"
            aria-expanded={open}
            aria-label={open ? `收起「${todo.content}」的子任务` : `展开「${todo.content}」的子任务`}
            onClick={() => onToggleOpen(todo.id)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="fl-todo-caret" aria-hidden="true" />
        )}
        <TodoCheck todo={todo} onToggle={onToggle} />
        {editing ? (
          <input
            className="fl-todo-edit"
            type="text"
            value={editText}
            aria-label="编辑任务"
            onChange={(event) => onEditText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommitEdit()
              if (event.key === 'Escape') onCancelEdit()
            }}
            onBlur={onCommitEdit}
            autoFocus
          />
        ) : (
          <>
            <button
              type="button"
              className="fl-todo-text"
              title="点击编辑标题"
              onClick={() => onStartEdit(todo)}
            >
              {todo.content}
            </button>
            {todo.priority !== undefined ? <PriorityChip priority={todo.priority} /> : null}
            {todo.due !== undefined ? <DueBadge due={todo.due} done={done} /> : null}
            <span className="fl-todo-actions">
              <button
                type="button"
                className="fl-todo-act"
                aria-pressed={detailOpen}
                title="详情"
                onClick={() => onToggleDetail(todo.id)}
              >
                详情
              </button>
              <button
                type="button"
                className={deleteArmedHere ? 'fl-todo-remove fl-todo-remove-confirm' : 'fl-todo-remove'}
                aria-label={deleteArmedHere ? `确认删除「${todo.content}」及其子任务` : `删除「${todo.content}」`}
                title={deleteArmedHere ? '再次点击确认删除' : '删除'}
                data-confirm={deleteArmedHere ? 'true' : undefined}
                onClick={() =>
                  deleteArmedHere ? onConfirmRemove(todo.id) : onArmRemove(todo.id)
                }
              >
                {deleteArmedHere ? '确认删除？' : '×'}
              </button>
            </span>
          </>
        )}
      </div>

      {hasChildren && !done ? (
        <div className="fl-todo-subprogress" aria-hidden="true">
          子任务 {subDone}/{children.length}
          <span className="fl-todo-subprogress-track">
            <i style={{ width: `${Math.round((subDone / children.length) * 100)}%` }} />
          </span>
        </div>
      ) : null}

      {detailOpen ? (
        <TodoDetail
          key={todo.id}
          todo={todo}
          onUpdate={onUpdate}
          onAdd={onAdd}
          onExpand={onExpand}
          onClose={() => onToggleDetail(todo.id)}
        />
      ) : null}

      {hasChildren && open ? (
        <ul className="fl-todo-children">
          {todo.children!.map((child) => (
            <TodoRow
              key={child.id}
              todo={child}
              editingId={editingId}
              openIds={openIds}
              detailId={detailId}
              selected={selected}
              deleteArmed={deleteArmed}
              onArmRemove={onArmRemove}
              onConfirmRemove={onConfirmRemove}
              editText={editText}
              onEditText={onEditText}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
              onToggleOpen={onToggleOpen}
              onExpand={onExpand}
              onToggleDetail={onToggleDetail}
              dragId={dragId}
              dragSubtree={dragSubtree}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropUnder={onDropUnder}
              onDropBeside={onDropBeside}
              handlers={handlers}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * The hero band: today's date, a greeting, and a progress ring for the whole
 * checklist. Pure display — everything it shows is derived from the counts the
 * panel already holds, so it can never disagree with the sections below.
 * @param props - completed and total task counts.
 * @returns the hero element.
 */
function TodoHero({ done, total }: { done: number; total: number }): React.ReactElement {
  const now = new Date()
  const hour = now.getHours()
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'
  const week = '日一二三四五六'[now.getDay()]
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const left = total - done
  return (
    <div className="fl-todo-hero">
      <div className="fl-todo-hero-text">
        <h2>今天</h2>
        <p>
          {now.getMonth() + 1}月{now.getDate()}日 星期{week} · {greet}
          {total === 0
            ? '，从一件小事开始'
            : left > 0
              ? `，还有 ${left} 件事`
              : '，全部完成 🎉'}
        </p>
      </div>
      <div
        className="fl-todo-ring"
        role="img"
        aria-label={`已完成 ${done} / ${total}，${pct}%`}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
      >
        <span>{pct}%</span>
      </div>
    </div>
  )
}

/**
 * The TODO panel.
 * @param props - the forest and its mutation callbacks.
 * @returns the panel element.
 */
export function TodoView({
  todos,
  onAdd,
  onAddFields,
  onEdit,
  onUpdate,
  onToggle,
  onRemove,
  onIndent,
  onOutdent,
  onMove,
  onMoveUnder,
  onMoveBeside,
  onClearCompleted,
}: TodoViewProps): React.ReactElement {
  const [draft, setDraft] = useState('')
  const [quick, setQuick] = useState<{ due?: string; priority?: TodoPriority | null; notes?: string }>({})
  const [composeDetailOpen, setComposeDetailOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveQuery, setArchiveQuery] = useState('')
  const [openMonths, setOpenMonths] = useState<ReadonlySet<string>>(new Set())
  const [mode, setMode] = useState<'list' | 'quadrant'>('list')
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  /** The task currently being dragged, or null between drags. */
  const [dragId, setDragId] = useState<string | null>(null)
  const draftInput = useRef<HTMLInputElement>(null)

  const handlers: TodoHandlers = { onAdd, onAddFields, onEdit, onUpdate, onToggle, onRemove, onIndent, onOutdent, onMove, onMoveUnder, onMoveBeside, onClearCompleted }

  const { active, completed } = splitTodos(todos)

  /** The dragged task's whole subtree — a drop onto any of it would curl the
   * forest into a cycle, so those rows refuse the drop instead. */
  const dragSubtree = useMemo(() => {
    const ids = new Set<string>()
    const root = dragId === null ? null : findTodo(todos, dragId)
    if (root !== null) walkTodos([root], (todo) => ids.add(todo.id))
    return ids
  }, [todos, dragId])

  // Completed work grouped by the day it was ticked off. Anything older than
  // the three-day window moves to the archive page, which buckets those days
  // by month and can be searched.
  const { recent, archived, archivedCount } = groupCompletedByDay(completed)
  const archiveMonths = groupArchivedByMonth(archived, archiveQuery)

  // One reference day per render: the quadrant grid and the due badges must
  // agree on what "overdue" means this morning.
  const today = useMemo(() => new Date(), [])

  const todayKey = dateKeyOf(today)
  const tomorrowKey = dateKeyOf(new Date(today.getTime() + 86_400_000))

  /** What the chips currently promise, phrased for the row under them. */
  const quickHint = (() => {
    const picked: string[] = []
    if (quick.due !== undefined) picked.push(`结束 ${dueLabel(quick.due)}`)
    if (quick.priority) picked.push(quick.priority)
    return picked.length > 0 ? `将保存：${picked.join(' · ')}` : '选中的会随任务一起保存'
  })()

  /**
   * The active top-level tasks, cut into time sections.
   *
   * Grouping is derived from the due field, never stored — the same rule the
   * quadrant grid follows — and within a section the stored order stands, so
   * Ctrl+↑/↓ keeps meaning what it meant. A parent without a due stays put even
   * when its children are due today; the chips carry the urgency.
   */
  const sections = useMemo(() => {
    const buckets: Array<{ key: string; label: string; tone: string; items: Todo[] }> = [
      { key: 'overdue', label: '逾期', tone: 'overdue', items: [] },
      { key: 'today', label: '今天', tone: 'today', items: [] },
      { key: 'upcoming', label: '即将到来', tone: 'upcoming', items: [] },
      { key: 'someday', label: '无日期', tone: 'someday', items: [] },
    ]
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
    for (const todo of active) {
      if (todo.due === undefined) byKey.get('someday')?.items.push(todo)
      else if (todo.due === todayKey) byKey.get('today')?.items.push(todo)
      else if (todoDueState(todo.due, today) === 'overdue') byKey.get('overdue')?.items.push(todo)
      else byKey.get('upcoming')?.items.push(todo)
    }
    return buckets.filter((bucket) => bucket.items.length > 0)
  }, [active, today, todayKey])

  /** The quadrant columns, computed once per render of the grid. */
  const quadrants = useMemo(() => {
    const groups = new Map<string, Array<{ todo: Todo; parent: string | null }>>([])
    for (const quad of QUADRANTS) groups.set(quad.key, [])
    for (const entry of flattenTodos(todos)) {
      if (entry.todo.completedAt !== undefined) continue
      const bucket = groups.get(todoQuadrant(entry.todo, today))
      bucket?.push({
        todo: entry.todo,
        parent: entry.parents.length > 0 ? (entry.parents.at(-1)?.content ?? null) : null,
      })
    }
    return groups
  }, [todos, today])

  const toggleOpen = (id: string): void => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Open a subtree without the toggle — a newly added subtask must be seen. */
  const expandTask = (id: string): void => {
    setOpenIds((current) => new Set(current).add(id))
  }

  const startDrag = (id: string): void => setDragId(id)
  const endDrag = (): void => setDragId(null)

  /** Land a dragged task under the row it was released on, then open the
   * parent so the new nesting is seen the instant it happens. */
  const dropUnder = (id: string, parentId: string): void => {
    onMoveUnder?.(id, parentId)
    expandTask(parentId)
  }

  /** Land a dragged task as the sibling right before or after the row it was
   * released on — the row-edge reorder landing. */
  const dropBeside = (id: string, targetId: string, side: 'before' | 'after'): void => {
    onMoveBeside?.(id, targetId, side)
  }

  const toggleDetail = (id: string): void => {
    setDetailId((current) => (current === id ? null : id))
  }

  /** Commit the add row, keeping focus for the next entry — Enter chains tasks.
   * The chips and the expanded detail are spent with the task, then reset. */
  const submitDraft = (): void => {
    const content = draft.trim()
    if (content === '') return
    const notes = quick.notes?.trim()
    if (onAddFields) {
      onAddFields({
        content,
        due: quick.due ?? null,
        priority: quick.priority ?? null,
        ...(notes ? { notes } : {}),
      })
    } else {
      onAdd?.(content)
    }
    setDraft('')
    setQuick({})
    draftInput.current?.focus()
  }

  /** Toggle one composer chip's field on and off. */
  const toggleQuick = (patch: { due?: string; priority?: TodoPriority | null }): void => {
    setQuick((current) => {
      if (patch.due !== undefined) return { ...current, due: current.due === patch.due ? undefined : patch.due }
      return { ...current, priority: current.priority === patch.priority ? undefined : patch.priority }
    })
  }

  /** Open a row for editing with its current text. */
  const startEdit = (todo: Todo): void => {
    setEditingId(todo.id)
    setEditText(todo.content)
  }

  /** Commit the row under edit; a no-op when nothing changed or the text went empty. */
  const commitEdit = (): void => {
    if (editingId === null) return
    const content = editText.trim()
    const original = flattenTodos(todos).find((entry) => entry.todo.id === editingId)?.todo
    if (content !== '' && original !== undefined && content !== original.content) {
      onEdit?.(editingId, content)
    }
    setEditingId(null)
  }

  /** Cancel the row under edit, putting the original text back. */
  const cancelEdit = (): void => {
    setEditingId(null)
  }

  /** The ids of every task row on screen, in display order. */
  const visibleIds = (): string[] =>
    [...document.querySelectorAll('.fl-todo [data-todo-id]')]
      .map((node) => node.getAttribute('data-todo-id'))
      .filter((id): id is string => id !== null)

  const armRemove = (id: string): void => setDeleteArmed(id)
  const confirmRemove = (id: string): void => {
    onRemove?.(id)
    setDeleteArmed(null)
    setSelectedId((current) => (current === id ? null : current))
  }

  // The keyboard layer. One document listener for as long as the panel is
  // mounted — it bails out on typing targets and on every modified key it does
  // not own, so the composer's accelerators and plain typing stay untouched.
  // Rebound per render on purpose: every action closes over fresh state.
  useEffect(() => {
    const moveSelection = (delta: number): void => {
      const ids = visibleIds()
      if (ids.length === 0) return
      const index = selectedId === null ? (delta > 0 ? -1 : 0) : ids.indexOf(selectedId)
      const nextIndex = index === -1 ? 0 : Math.max(0, Math.min(index + delta, ids.length - 1))
      setDeleteArmed(null)
      setSelectedId(ids[nextIndex] ?? null)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      // Ctrl+↑/↓ moves the selected task; every other modified key belongs to
      // the browser (and Ctrl+K stays the global search accelerator).
      if (
        (event.ctrlKey || event.altKey) &&
        selectedId !== null &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault()
        onMove?.(selectedId, event.key === 'ArrowUp' ? -1 : 1)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          event.preventDefault()
          moveSelection(1)
          return
        case 'ArrowUp':
        case 'k':
        case 'K':
          event.preventDefault()
          moveSelection(-1)
          return
        case 'a':
        case 'A':
          if (mode === 'list') {
            event.preventDefault()
            draftInput.current?.focus()
          }
          return
      }

      if (selectedId === null) return
      const todo = findTodo(todos, selectedId)
      if (todo === null) {
        setSelectedId(null)
        return
      }

      switch (event.key) {
        case 'Enter':
          event.preventDefault()
          startEdit(todo)
          return
        case ' ':
        case 'x':
        case 'X':
          event.preventDefault()
          onToggle?.(selectedId)
          return
        case 's':
        case 'S':
          event.preventDefault()
          expandTask(selectedId)
          setDetailId(selectedId)
          requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('.fl-todo-detail .fl-todo-subadd input')?.focus()
          })
          return
        case 'd':
        case 'D':
          event.preventDefault()
          toggleDetail(selectedId)
          return
        case '1':
          onUpdate?.(selectedId, { priority: 'P1' })
          return
        case '2':
          onUpdate?.(selectedId, { priority: 'P2' })
          return
        case '3':
          onUpdate?.(selectedId, { priority: 'P3' })
          return
        case '0':
          onUpdate?.(selectedId, { priority: null })
          return
        case 'Tab':
          if (mode !== 'list') return
          event.preventDefault()
          if (event.shiftKey) {
            onOutdent?.(selectedId)
          } else {
            const above = visibleIds()
            const at = above.indexOf(selectedId)
            if (at > 0) expandTask(above[at - 1] ?? '')
            onIndent?.(selectedId)
          }
          return
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          if (deleteArmed === selectedId) confirmRemove(selectedId)
          else setDeleteArmed(selectedId)
          return
        case 'Escape':
          event.preventDefault()
          if (deleteArmed !== null) setDeleteArmed(null)
          else if (detailId !== null) setDetailId(null)
          else setSelectedId(null)
          return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  // Keep the selection on screen as it walks.
  useEffect(() => {
    if (selectedId === null) return
    document
      .querySelector(`.fl-todo [data-todo-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (onAdd === undefined) {
    return <div className="fl-empty">当前环境不支持 TODO，请在网页版使用。</div>
  }

  /** The rows of one completed day, wired the same way as the open rows. */
  const doneRows = (items: readonly Todo[]): React.ReactElement => (
    <ul className="fl-todo-list">
      {items.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          editingId={editingId}
          editText={editText}
          onEditText={setEditText}
          onStartEdit={startEdit}
          onCommitEdit={commitEdit}
          onCancelEdit={cancelEdit}
          openIds={openIds}
          detailId={detailId}
          onToggleOpen={toggleOpen}
          onExpand={expandTask}
          onToggleDetail={toggleDetail}
          selected={selectedId === todo.id}
          deleteArmed={deleteArmed}
          onArmRemove={armRemove}
          onConfirmRemove={confirmRemove}
          dragId={dragId}
          dragSubtree={dragSubtree}
          onDragStart={startDrag}
          onDragEnd={endDrag}
          onDropUnder={dropUnder}
          onDropBeside={dropBeside}
          handlers={handlers}
        />
      ))}
    </ul>
  )

  /** One completed day with its date header. */
  const doneDay = (group: CompletedDayGroup): React.ReactElement => (
    <section className="fl-todo-done-day" key={group.day}>
      <header className="fl-todo-done-day-head">
        <span>{group.label}</span>
        <span className="fl-todo-done-day-count">{group.items.length}</span>
      </header>
      {doneRows(group.items)}
    </section>
  )

  /** Enter the archive page with its newest month already expanded. */
  const openArchive = (): void => {
    setArchiveOpen(true)
    setOpenMonths(archived.length > 0 ? new Set([archived[0]!.day.slice(0, 7)]) : new Set())
  }

  const toggleMonth = (key: string): void => {
    setOpenMonths((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (archiveOpen) {
    return (
      <div className="fl-todo">
        <div className="fl-archive">
          <header className="fl-archive-head">
            <button type="button" className="fl-archive-back" onClick={() => setArchiveOpen(false)}>
              ← 返回
            </button>
            <h2 className="fl-archive-title">归档</h2>
            <span className="fl-archive-count">{archivedCount} 条</span>
          </header>

          <input
            type="search"
            className="fl-archive-search"
            value={archiveQuery}
            placeholder="搜索归档任务…"
            aria-label="搜索归档任务"
            onChange={(event) => setArchiveQuery(event.target.value)}
          />

          {archiveMonths.length === 0 ? (
            <div className="fl-empty">
              {archiveQuery.trim() === '' ? '还没有归档任务。' : '没有匹配的归档任务。'}
            </div>
          ) : (
            archiveMonths.map((month, index) => {
              const open =
                archiveQuery.trim() !== '' || openMonths.has(month.key) || (openMonths.size === 0 && index === 0)
              return (
                <section className="fl-archive-month" key={month.key}>
                  <button
                    type="button"
                    className="fl-archive-month-head"
                    aria-expanded={open}
                    onClick={() => toggleMonth(month.key)}
                  >
                    <span className="fl-todo-done-caret" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                    <span>{month.label}</span>
                    <span className="fl-archive-month-count">{month.count}</span>
                  </button>
                  {open
                    ? month.days.map((group) => (
                        <div className="fl-todo-done-day" key={group.day}>
                          <header className="fl-todo-done-day-head">
                            <span>{group.label}</span>
                            <span className="fl-todo-done-day-count">{group.items.length}</span>
                          </header>
                          {doneRows(group.items)}
                        </div>
                      ))
                    : null}
                </section>
              )
            })
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fl-todo">
      <TodoHero done={completed.length} total={active.length + completed.length} />

      <div className="fl-todo-modes" role="tablist" aria-label="视图">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'list'}
          data-active={mode === 'list'}
          onClick={() => setMode('list')}
        >
          列表
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'quadrant'}
          data-active={mode === 'quadrant'}
          onClick={() => setMode('quadrant')}
        >
          四象限
        </button>
      </div>

      {mode === 'list' ? (
        <>
          <div className="fl-todo-add">
            <span className="fl-todo-add-icon" aria-hidden="true">
              ＋
            </span>
            <input
              ref={draftInput}
              type="text"
              value={draft}
              placeholder="添加任务，回车确认"
              aria-label="添加任务"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitDraft()
              }}
            />
            {onAddFields ? (
              <button
                type="button"
                className="fl-todo-detail-toggle"
                aria-expanded={composeDetailOpen}
                aria-controls="fl-todo-compose-detail"
                onClick={() => setComposeDetailOpen((open) => !open)}
              >
                详情<span className="fl-todo-detail-caret" aria-hidden="true">{composeDetailOpen ? '▴' : '▾'}</span>
              </button>
            ) : null}
          </div>

          {onAddFields ? (
            <>
              <div className="fl-todo-quick" aria-label="快速设置">
                <div className="fl-todo-quick-set">
                  <button
                    type="button"
                    className="fl-todo-chip"
                    data-active={quick.due === todayKey ? 'true' : undefined}
                    onClick={() => toggleQuick({ due: todayKey })}
                  >
                    今天
                  </button>
                  <button
                    type="button"
                    className="fl-todo-chip"
                    data-active={quick.due === tomorrowKey ? 'true' : undefined}
                    onClick={() => toggleQuick({ due: tomorrowKey })}
                  >
                    明天
                  </button>
                </div>
                <span className="fl-todo-quick-sep" aria-hidden="true" />
                <div className="fl-todo-quick-set">
                  {(['P1', 'P2', 'P3'] as const).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      className="fl-todo-chip fl-todo-chip-p"
                      data-p={priority}
                      data-active={quick.priority === priority ? 'true' : undefined}
                      onClick={() => toggleQuick({ priority })}
                    >
                      {priority}
                    </button>
                  ))}
                </div>
                <span className="fl-todo-quick-sep" aria-hidden="true" />
                <span className="fl-todo-compose-hint">{quickHint}</span>
              </div>

              {composeDetailOpen ? (
                <div className="fl-todo-compose-detail" id="fl-todo-compose-detail">
                  <textarea
                    value={quick.notes ?? ''}
                    rows={3}
                    placeholder="任务描述，支持与笔记相同的格式"
                    aria-label="新任务的描述"
                    onChange={(event) =>
                      setQuick((current) => ({ ...current, notes: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitDraft()
                      if (event.key === 'Escape') setComposeDetailOpen(false)
                    }}
                  />
                  <div className="fl-todo-compose-fields">
                    <label className="fl-todo-compose-field">
                      优先级
                      <select
                        value={quick.priority ?? ''}
                        aria-label="新任务的优先级"
                        onChange={(event) =>
                          setQuick((current) => ({
                            ...current,
                            priority:
                              event.target.value === ''
                                ? undefined
                                : (event.target.value as TodoPriority),
                          }))
                        }
                      >
                        {PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fl-todo-compose-field">
                      期望结束
                      <input
                        type="date"
                        value={quick.due ?? ''}
                        aria-label="新任务的期望结束日期"
                        onChange={(event) =>
                          setQuick((current) => ({
                            ...current,
                            due: event.target.value === '' ? undefined : event.target.value,
                          }))
                        }
                      />
                    </label>
                    <span className="fl-todo-compose-hint">Ctrl+Enter 提交</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {todos.length === 0 ? (
            <div className="fl-todo-empty">还没有任务，在下方输入并回车添加一条。</div>
          ) : (
            sections.map((section) => (
              <div className="fl-todo-section" key={section.key}>
                <div className="fl-todo-section-head">
                  <span className="fl-todo-section-dot" data-tone={section.tone} aria-hidden="true" />
                  {section.label}
                  <span className="fl-todo-section-count">{section.items.length}</span>
                </div>
                <ul className="fl-todo-list">
                  {section.items.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      editingId={editingId}
                      editText={editText}
                      onEditText={setEditText}
                      onStartEdit={startEdit}
                      onCommitEdit={commitEdit}
                      onCancelEdit={cancelEdit}
                      openIds={openIds}
                      detailId={detailId}
                      onToggleOpen={toggleOpen}
                      onExpand={expandTask}
                      onToggleDetail={toggleDetail}
                      selected={selectedId === todo.id}
                      deleteArmed={deleteArmed}
                      onArmRemove={armRemove}
                      onConfirmRemove={confirmRemove}
                      dragId={dragId}
                      dragSubtree={dragSubtree}
                      onDragStart={startDrag}
                      onDragEnd={endDrag}
                      onDropUnder={dropUnder}
                      onDropBeside={dropBeside}
                      handlers={handlers}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}

          {completed.length > 0 ? (
            <div className="fl-todo-done">
              <div className="fl-todo-done-head">
                <button
                  type="button"
                  className="fl-todo-done-toggle"
                  aria-expanded={showCompleted}
                  onClick={() => setShowCompleted((open) => !open)}
                >
                  <span className="fl-todo-done-caret" aria-hidden="true">
                    {showCompleted ? '▾' : '▸'}
                  </span>
                  已完成 {completed.length}
                </button>
                <span className="fl-todo-done-actions">
                  {archivedCount > 0 ? (
                    <button type="button" className="fl-todo-archive-link" onClick={openArchive}>
                      查看归档 {archivedCount} →
                    </button>
                  ) : null}
                  {onClearCompleted !== undefined ? (
                    <button
                      type="button"
                      className="fl-todo-clear"
                      onClick={onClearCompleted}
                      title="删除全部已完成任务"
                    >
                      清除已完成
                    </button>
                  ) : null}
                </span>
              </div>
              {showCompleted ? <>{recent.map(doneDay)}</> : null}
            </div>
          ) : null}

          <div className="fl-todo-hints" aria-hidden="true">
            ↑↓ 选中 · Enter 编辑 · x 完成 · s 子任务 · d 详情 · 1/2/3 优先级 · Tab 缩进 · Del 删除 · 拖拽:中间设为子任务,上下边缘排序
          </div>
        </>
      ) : (
        <div className="fl-quadrants">
          {QUADRANTS.map((quad) => {
            const items = quadrants.get(quad.key) ?? []
            return (
              <section key={quad.key} className="fl-quad" data-quad={quad.key}>
                <header className="fl-quad-head">
                  <span className="fl-quad-title">{quad.label}</span>
                  <span className="fl-quad-hint">{quad.hint}</span>
                  <span className="fl-quad-count">{items.length}</span>
                </header>
                {items.length === 0 ? (
                  <div className="fl-quad-empty">暂无任务</div>
                ) : (
                  <ul className="fl-quad-list">
                    {items.map(({ todo, parent }) => (
                      <li
                        key={todo.id}
                        className="fl-quad-item"
                        data-todo-id={todo.id}
                        data-selected={selectedId === todo.id ? 'true' : undefined}
                      >
                        <div className="fl-todo-line">
                          <TodoCheck todo={todo} onToggle={onToggle} />
                          <button
                            type="button"
                            className="fl-todo-text"
                            title="点击编辑标题"
                            onClick={() => startEdit(todo)}
                          >
                            {parent !== null ? (
                              <span className="fl-quad-parent">{parent} ▸ </span>
                            ) : null}
                            {todo.content}
                          </button>
                          {todo.priority !== undefined ? (
                            <PriorityChip priority={todo.priority} />
                          ) : null}
                          {todo.due !== undefined ? (
                            <DueBadge due={todo.due} done={false} />
                          ) : null}
                          <span className="fl-todo-actions">
                            <button
                              type="button"
                              className="fl-todo-act"
                              aria-pressed={detailId === todo.id}
                              title="详情"
                              onClick={() => toggleDetail(todo.id)}
                            >
                              详情
                            </button>
                            <button
                              type="button"
                              className={
                                deleteArmed === todo.id
                                  ? 'fl-todo-remove fl-todo-remove-confirm'
                                  : 'fl-todo-remove'
                              }
                              aria-label={
                                deleteArmed === todo.id
                                  ? `确认删除「${todo.content}」及其子任务`
                                  : `删除「${todo.content}」`
                              }
                              title={deleteArmed === todo.id ? '再次点击确认删除' : '删除'}
                              onClick={() =>
                                deleteArmed === todo.id ? confirmRemove(todo.id) : armRemove(todo.id)
                              }
                            >
                              {deleteArmed === todo.id ? '确认删除？' : '×'}
                            </button>
                          </span>
                        </div>
                        {editingId === todo.id ? (
                          <input
                            className="fl-todo-edit"
                            type="text"
                            value={editText}
                            aria-label="编辑任务"
                            onChange={(event) => setEditText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitEdit()
                              if (event.key === 'Escape') cancelEdit()
                            }}
                            onBlur={commitEdit}
                            autoFocus
                          />
                        ) : null}
                        {detailId === todo.id ? (
                          <TodoDetail
                            key={todo.id}
                            todo={todo}
                            onUpdate={onUpdate}
                            onAdd={onAdd}
                            onExpand={expandTask}
                            onClose={() => toggleDetail(todo.id)}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
