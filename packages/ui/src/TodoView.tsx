/**
 * The TODO checklist, laid out the way Google Tasks lays out its list: a quick
 * add row on top, open tasks with round checkboxes, and completed work sunk
 * into a collapsible group at the bottom.
 *
 * Editing is per-row and inline — click the text, type, Enter or blur to keep
 * it, Escape to back out — because a checklist earns no heavier an editor than
 * that.
 *
 * @module @flomo/ui/TodoView
 */

import type * as React from 'react'
import { useRef, useState } from 'react'

import { splitTodos } from '@flomo/core'
import type { Todo } from '@flomo/core'

/** The checklist's mutation callbacks, all optional so a backend without todo
 * support can render the panel as a pointer to the web app instead. */
export interface TodoHandlers {
  /** Add a task at the top. */
  onAdd?: (content: string) => void
  /** Replace a task's text. */
  onEdit?: (id: string, content: string) => void
  /** Complete or reopen a task. */
  onToggle?: (id: string, done?: boolean) => void
  /** Delete one task. */
  onRemove?: (id: string) => void
  /** Drop every completed task. */
  onClearCompleted?: () => void
}

export interface TodoViewProps extends TodoHandlers {
  /** The whole checklist, in stored order; grouping happens here. */
  todos: readonly Todo[]
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

/**
 * One row: checkbox, text (or the inline editor while it is being edited), and
 * the delete affordance that floats in on hover.
 * @param props - the todo, the editing state it participates in, and handlers.
 * @returns the row element.
 */
function TodoRow({
  todo,
  editing,
  editText,
  onEditText,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onRemove,
}: {
  todo: Todo
  editing: boolean
  editText: string
  onEditText: (text: string) => void
  onStartEdit: (todo: Todo) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onToggle?: (id: string, done?: boolean) => void
  onRemove?: (id: string) => void
}): React.ReactElement {
  return (
    <li className="fl-todo-item" data-done={todo.completedAt !== undefined ? 'true' : undefined}>
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
            title="点击编辑"
            onClick={() => onStartEdit(todo)}
          >
            {todo.content}
          </button>
          <button
            type="button"
            className="fl-todo-remove"
            aria-label={`删除「${todo.content}」`}
            title="删除"
            onClick={() => onRemove?.(todo.id)}
          >
            ×
          </button>
        </>
      )}
    </li>
  )
}

/**
 * The TODO panel.
 * @param props - the checklist and its mutation callbacks.
 * @returns the panel element.
 */
export function TodoView({
  todos,
  onAdd,
  onEdit,
  onToggle,
  onRemove,
  onClearCompleted,
}: TodoViewProps): React.ReactElement {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const draftInput = useRef<HTMLInputElement>(null)

  const { active, completed } = splitTodos(todos)

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
    const original = todos.find((todo) => todo.id === editingId)
    if (content !== '' && original !== undefined && content !== original.content) {
      onEdit?.(editingId, content)
    }
    setEditingId(null)
  }

  /** Cancel the row under edit, putting the original text back. */
  const cancelEdit = (): void => {
    setEditingId(null)
  }

  if (onAdd === undefined) {
    return <div className="fl-empty">当前环境不支持 TODO，请在网页版使用。</div>
  }

  return (
    <div className="fl-todo">
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
            editing={editingId === todo.id}
            editText={editText}
            onEditText={setEditText}
            onStartEdit={startEdit}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        ))}
      </ul>

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
                  editing={editingId === todo.id}
                  editText={editText}
                  onEditText={setEditText}
                  onStartEdit={startEdit}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                  onToggle={onToggle}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
