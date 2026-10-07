/**
 * The contribution heatmap: one square per day over the trailing months.
 *
 * @module @flomo/ui/Heatmap
 */

import type * as React from 'react'
import { useMemo } from 'react'

import { absoluteDayLabel, heatmap } from '@flomo/core'
import type { Memo } from '@flomo/core'

export interface HeatmapProps {
  memos: readonly Memo[]
  /** How many weeks of history to show. */
  weeks?: number
  /** Reference instant, for tests. */
  today?: Date
}

/** Square size, in pixels; must match the stylesheet. */
const CELL = 16

/** Gap between squares, in pixels; must match the stylesheet. */
const GAP = 5

/** Center-to-center distance between two adjacent squares. */
const PITCH = CELL + GAP

/**
 * Bucket a count into one of five shading levels.
 * @param count - memos written that day.
 * @returns 0 through 4.
 */
function level(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

/**
 * The trailing-weeks activity grid.
 * @param props - the corpus and the window size.
 * @returns the heatmap element.
 */
export function Heatmap({ memos, weeks = 26, today = new Date() }: HeatmapProps): React.ReactElement {
  const columns = useMemo(() => {
    const counts = heatmap(memos)

    // Walk back to the Sunday that opens the *current* week, then back (weeks
    // - 1) more weeks, so the grid always runs through today. Anchoring on the
    // current week is the part that matters: subtracting the whole span from
    // today first left the last column ending a few days before `end`, which
    // could drop today — and the whole current month — off the right edge.
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const start = new Date(end)
    start.setDate(start.getDate() - end.getDay() - (weeks - 1) * 7)

    const out: Array<Array<{ key: string; count: number; future: boolean }>> = []
    const cursor = new Date(start)
    for (let w = 0; w < weeks; w += 1) {
      const column: Array<{ key: string; count: number; future: boolean }> = []
      for (let d = 0; d < 7; d += 1) {
        const year = cursor.getFullYear()
        const month = String(cursor.getMonth() + 1).padStart(2, '0')
        const day = String(cursor.getDate()).padStart(2, '0')
        const key = `${year}-${month}-${day}`
        column.push({ key, count: counts.get(key) ?? 0, future: cursor > end })
        cursor.setDate(cursor.getDate() + 1)
      }
      out.push(column)
    }
    return out
  }, [memos, weeks, today])

  /**
   * One label per month the grid touches, at the column where that month begins
   * — detected cell by cell, so a month starting mid-week is labelled in the
   * week it starts in rather than at the first column that opens inside it.
   * That placement is what keeps the current month off the right edge: with the
   * old first-column-of-the-month rule, `10月` landed on the last column and
   * was clipped into invisibility.
   *
   * When a range that starts mid-month puts two month beginnings in one column,
   * the later month takes the slot — the earlier one labels days that are
   * mostly off the grid anyway. The left position is clamped so no label can
   * run past the grid's right edge.
   */
  const months = useMemo(() => {
    const out: Array<{ label: string; index: number }> = []
    let previous: string | null = null
    for (const [index, column] of columns.entries()) {
      for (const cell of column) {
        const month = cell.key.slice(0, 7)
        if (month === previous) continue
        previous = month
        const item = { label: `${Number(month.slice(5, 7))}月`, index }
        const last = out[out.length - 1]
        if (last !== undefined && last.index === index) out[out.length - 1] = item
        else out.push(item)
      }
    }
    return out
  }, [columns])

  return (
    <div className="fl-heatmap-wrap">
      <div className="fl-heatmap" role="img" aria-label="记录热力图">
        {columns.map((column, index) => (
          <div className="fl-heatmap-week" key={column[0]?.key ?? index}>
            {column.map((cell) => (
              <div
                key={cell.key}
                className="fl-heatmap-cell"
                data-level={cell.future ? 0 : level(cell.count)}
                style={cell.future ? { opacity: 0.35 } : undefined}
                title={`${absoluteDayLabel(cell.key)} · ${cell.count} 条`}
              />
            ))}
          </div>
        ))}
        <span className="fl-visually-hidden">{`每格 ${CELL} 像素`}</span>
      </div>
      {/* Month labels go *under* the grid, the way flomo lays it out: labels on
          top read as a header row for the cells beneath them, labels on the
          bottom read as the axis. */}
      <div className="fl-heatmap-months" aria-hidden="true">
        {months.map((month) => (
          <span
            key={month.label}
            className="fl-heatmap-month"
            style={{ left: Math.min(month.index * PITCH, columns.length * PITCH - GAP - 34) }}
          >
            {month.label}
          </span>
        ))}
      </div>
    </div>
  )
}
