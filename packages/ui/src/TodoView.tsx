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

import { QUADRANTS, findTodo, flattenTodos, splitTodos, todoDueState, todoQuadrant } from '@flomo/core'
import { isTypingTarget } from './shortcuts.ts'
import type { Todo, TodoPatch, TodoPriority } from '@flomo/core'

import { MarkdownBody } from './MarkdownBody.tsx'

/** The checklist's mutation callbacks, all optional so a backend without todo
 * support can render the panel as a pointer to the web app instead. */
export interface TodoHandlers {
  /** Add a task at the top, or as a child when a parent is given. */
  onAdd?: (content: string, parentId?: string | null) => void
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

/** The due-date badge: plain when far out, orange inside three days, red past. */
function DueBadge({ due, done }: { due: string; done: boolean }): React.ReactElement | null {
  const state = todoDueState(due)
  return (
    <span className="fl-todo-due" data-state={done ? 'later' : state} title={`期望结束 ${due}`}>
      {due.slice(5)}
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
  handlers: TodoHandlers
}): React.ReactElement {
  const { onToggle, onRemove, onUpdate, onAdd } = handlers
  const done = todo.completedAt !== undefined
  const hasChildren = (todo.children?.length ?? 0) > 0
  const editing = editingId === todo.id
  const open = openIds.has(todo.id)
  const detailOpen = detailId === todo.id
  const deleteArmedHere = deleteArmed === todo.id
  return (
    <li
      className="fl-todo-item"
      data-done={done ? 'true' : undefined}
      data-todo-id={todo.id}
      data-selected={selected ? 'true' : undefined}
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
              handlers={handlers}
            />
          ))}
        </ul>
      ) : null}
    </li>
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
  onEdit,
  onUpdate,
  onToggle,
  onRemove,
  onIndent,
  onOutdent,
  onMove,
  onClearCompleted,
}: TodoViewProps): React.ReactElement {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [mode, setMode] = useState<'list' | 'quadrant'>('list')
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const draftInput = useRef<HTMLInputElement>(null)

  const handlers: TodoHandlers = { onAdd, onEdit, onUpdate, onToggle, onRemove, onIndent, onOutdent, onMove, onClearCompleted }

  const { active, completed } = splitTodos(todos)

  // One reference day per render: the quadrant grid and the due badges must
  // agree on what "overdue" means this morning.
  const today = useMemo(() => new Date(), [])

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

  const toggleDetail = (id: string): void => {
    setDetailId((current) => (current === id ? null : id))
  }

  /** Commit the add row, keeping focus for the next entry — Enter chains tasks. */
  const submitDraft = (): void => {
    const content = draft.trim()
    if (content === '') return
    onAdd?.(content)
    setDraft('')
    draftInput.current?.focus()
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

  return (
    <div className="fl-todo">
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
              placeholder="添加任务"
              aria-label="添加任务"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitDraft()
              }}
            />
          </div>

          {todos.length === 0 ? (
            <div className="fl-empty">还没有任务，在上面输入并回车添加一条吧。</div>
          ) : null}

          <ul className="fl-todo-list">
            {active.map((todo) => (
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
                handlers={handlers}
              />
            ))}
          </ul>

          <div className="fl-todo-hints" aria-hidden="true">
            ↑↓ 选中 · Enter 编辑 · x 完成 · s 子任务 · d 详情 · 1/2/3 优先级 · Tab 缩进 · Del 删除
          </div>

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
              </div>
              {showCompleted ? (
                <ul className="fl-todo-list">
                  {completed.map((todo) => (
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
                      handlers={handlers}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
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
