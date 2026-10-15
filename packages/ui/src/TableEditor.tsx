/**
 * The table grid dialog, and the tool that opens it from a textarea.
 *
 * The field stays the single source of truth — no markdown is edited anywhere
 * but the textarea itself. When the caret sits inside a pipe table the dialog
 * loads that table's grid; from open air it starts a blank 2×2 one. Applying
 * serializes back through {@link stringifyTable} and splices the source lines,
 * so the user never types a pipe. A pipe typed into a cell survives as the
 * fullwidth `｜`, which the parser reads as an ordinary character.
 *
 * @module @flomo/ui/TableEditor
 */

import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { parseBlocks, stringifyTable, tableRangeAt } from '@flomo/core'
import type { TableAlign, TableRange } from '@flomo/core'

/** One editable table as the grid sees it. */
export interface TableDraft {
  head: string[]
  rows: string[][]
  align: TableAlign[]
}

/** A fresh 2×2 grid for a brand-new table. */
export function blankTableDraft(): TableDraft {
  return { head: ['', ''], rows: [['', '']], align: [null, null] }
}

/**
 * The grid of the table covering `range`.
 *
 * The slice is read back through the same parser the card renders with, so a
 * hand-mangled table still lands as the closest thing the app understands.
 * @param content - the field's value.
 * @param range - the line span returned by {@linkcode tableRangeAt}.
 * @returns the draft grid.
 */
export function tableDraftAt(content: string, range: TableRange): TableDraft {
  const slice = content.split('\n').slice(range.startLine, range.endLine + 1).join('\n')
  const table = parseBlocks(slice).find((block) => block.type === 'table')
  if (table === undefined || table.type !== 'table') return blankTableDraft()
  return {
    head: [...table.head],
    rows: table.rows.map((row) => [...row]),
    align: [...table.align],
  }
}

/** Props of {@link TableEditor}: the grid to start from, and where results go. */
export interface TableEditorProps {
  /** The grid the dialog opens with. Copied into local state on mount. */
  draft: TableDraft
  /** Receives the serialized table; the host splices it into the body. */
  onApply: (markdown: string) => void
  /** Closes without touching the field. */
  onClose: () => void
  /** true when the grid came from the body and will replace its lines there. */
  replacing?: boolean
}

const ALIGN_OPTIONS: Array<{ value: TableAlign; label: string }> = [
  { value: null, label: '默认' },
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
]

/**
 * The grid dialog itself.
 * @param props - the draft grid, an apply callback and a close callback.
 * @returns the dialog element.
 */
export function TableEditor({ draft, onApply, onClose, replacing = false }: TableEditorProps): React.ReactElement {
  const [head, setHead] = useState<string[]>(draft.head)
  const [rows, setRows] = useState<string[][]>(draft.rows)
  const [align, setAlign] = useState<TableAlign[]>(draft.align)

  const apply = useCallback((): void => {
    onApply(stringifyTable(head, rows, align))
  }, [head, rows, align, onApply])

  const setCell = useCallback((rowIndex: number, column: number, value: string): void => {
    setRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? row.map((cell, at) => (at === column ? value : cell)) : row,
      ),
    )
  }, [])

  const setHeadCell = useCallback((column: number, value: string): void => {
    setHead((current) => current.map((cell, at) => (at === column ? value : cell)))
  }, [])

  const setColumnAlign = useCallback((column: number, value: TableAlign): void => {
    setAlign((current) => current.map((one, at) => (at === column ? value : one)))
  }, [])

  const addRow = useCallback((): void => {
    setRows((current) => [...current, head.map(() => '')])
  }, [head])

  const removeRow = useCallback((rowIndex: number): void => {
    setRows((current) => current.filter((_, index) => index !== rowIndex))
  }, [])

  const addColumn = useCallback((): void => {
    setHead((current) => [...current, ''])
    setAlign((current) => [...current, null])
    setRows((current) => current.map((row) => [...row, '']))
  }, [])

  const removeColumn = useCallback((column: number): void => {
    if (head.length <= 1) return
    setHead((current) => current.filter((_, at) => at !== column))
    setAlign((current) => current.filter((_, at) => at !== column))
    setRows((current) => current.map((row) => row.filter((_, at) => at !== column)))
  }, [head.length])

  // Enter walks down a column like a spreadsheet, Escape and Ctrl/Cmd+Enter
  // match every dialog in the app.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        apply()
        return
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        const cell = (event.target as HTMLElement).dataset
        if (cell.r === undefined || cell.c === undefined) return
        event.preventDefault()
        const below = document.querySelector<HTMLInputElement>(
          `[data-table-cell][data-r="${Number(cell.r) + 1}"][data-c="${cell.c}"]`,
        )
        below?.focus()
      }
    },
    [apply, onClose],
  )

  return (
    <div className="fl-modal-overlay" onClick={onClose}>
      <div
        className="fl-modal fl-table-modal"
        role="dialog"
        aria-modal="true"
        aria-label="表格编辑"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="fl-modal-head">
          <span className="fl-modal-title">表格</span>
          <button type="button" className="fl-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <table className="fl-table-grid">
          <thead>
            <tr>
              {head.map((cell, column) => (
                <th key={column}>
                  <input
                    className="fl-table-cell"
                    value={cell}
                    placeholder={`列${column + 1}`}
                    aria-label={`第 ${column + 1} 列表头`}
                    onChange={(event) => setHeadCell(column, event.target.value)}
                  />
                  <span className="fl-table-coltools">
                    <select
                      value={align[column] ?? ''}
                      aria-label={`第 ${column + 1} 列对齐`}
                      onChange={(event) =>
                        setColumnAlign(
                          column,
                          (ALIGN_OPTIONS.find((option) => option.value === event.target.value)?.value ??
                            null),
                        )
                      }
                    >
                      {ALIGN_OPTIONS.map((option) => (
                        <option key={option.label} value={option.value ?? ''}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="fl-table-x"
                      title="删除本列"
                      aria-label={`删除第 ${column + 1} 列`}
                      disabled={head.length <= 1}
                      onClick={() => removeColumn(column)}
                    >
                      ×
                    </button>
                  </span>
                </th>
              ))}
              <th className="fl-table-gutter" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {head.map((_, column) => (
                  <td key={column}>
                    <input
                      className="fl-table-cell"
                      value={row[column] ?? ''}
                      data-table-cell=""
                      data-r={rowIndex}
                      data-c={column}
                      aria-label={`第 ${rowIndex + 1} 行第 ${column + 1} 列`}
                      onChange={(event) => setCell(rowIndex, column, event.target.value)}
                    />
                  </td>
                ))}
                <td className="fl-table-gutter">
                  <button
                    type="button"
                    className="fl-table-x"
                    title="删除本行"
                    aria-label={`删除第 ${rowIndex + 1} 行`}
                    onClick={() => removeRow(rowIndex)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="fl-table-foot">
          <span className="fl-table-adds">
            <button type="button" className="fl-table-add" onClick={addColumn}>
              ＋ 加一列
            </button>
            <button type="button" className="fl-table-add" onClick={addRow}>
              ＋ 加一行
            </button>
          </span>
          <span className="fl-table-actions">
            <button type="button" className="fl-button fl-button-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="fl-button fl-button-primary" onClick={apply}>
              {replacing ? '替换表格' : '插入表格'}
            </button>
          </span>
        </footer>
      </div>
    </div>
  )
}

/** One open dialog: the grid on it, and the span it writes back to. */
export interface TableToolDialog {
  draft: TableDraft
  /** null when the grid will be inserted at the caret instead of replacing a table. */
  range: TableRange | null
}

/**
 * The table tool bound to one textarea: context-aware open, grid dialog state,
 * and the splice back into the field.
 *
 * Sharing the same `(getEl, commit)` contract as the format tools keeps both
 * hosts (capture box and memo editor) on one wiring.
 * @param getEl - the live textarea, or null when unmounted.
 * @param commit - receives the next value and caret; the host applies them.
 * @returns the dialog state and its three actions.
 */
export function useTableTool(
  getEl: () => HTMLTextAreaElement | null,
  commit: (next: string, caret: number) => void,
): {
  dialog: TableToolDialog | null
  openTable: () => void
  applyTable: (markdown: string) => void
  closeTable: () => void
} {
  const [dialog, setDialog] = useState<TableToolDialog | null>(null)

  const openTable = useCallback((): void => {
    const el = getEl()
    if (!el) return
    const value = el.value
    const caret = el.selectionStart ?? value.length
    const range = tableRangeAt(value, caret)
    if (range === null) setDialog({ draft: blankTableDraft(), range: null })
    else setDialog({ draft: tableDraftAt(value, range), range })
  }, [getEl])

  const closeTable = useCallback((): void => {
    setDialog(null)
  }, [])

  const applyTable = useCallback(
    (markdown: string): void => {
      const el = getEl()
      if (!el || dialog === null) return
      const value = el.value
      if (dialog.range !== null) {
        // Replace the table's whole line span; the caret lands after the
        // inserted lines, on the line break that follows them.
        const lines = value.split('\n')
        const prefix = lines.slice(0, dialog.range.startLine).join('\n')
        const next = [
          ...lines.slice(0, dialog.range.startLine),
          markdown,
          ...lines.slice(dialog.range.endLine + 1),
        ].join('\n')
        commit(next, prefix.length + (dialog.range.startLine > 0 ? 1 : 0) + markdown.length)
      } else {
        // An insertion replaces the selection, as every insert does — but a
        // table is a run of whole lines, so it always lands on its own lines:
        // a newline is added between the table and whatever prose surrounds
        // the caret, or the header row would glue itself to that prose and the
        // source would stop parsing as a table at all.
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? start
        const before = value.slice(0, start)
        const after = value.slice(end)
        const lead = before.length > 0 && !before.endsWith('\n') ? '\n' : ''
        const tail = after.length > 0 && !after.startsWith('\n') ? '\n' : ''
        commit(before + lead + markdown + tail + after, before.length + lead.length + markdown.length)
      }
      setDialog(null)
    },
    [dialog, getEl, commit],
  )

  return { dialog, openTable, applyTable, closeTable }
}
