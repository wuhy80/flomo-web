/**
 * The contribution heatmap: one square per day over the trailing months.
 *
 * @module @flomo/ui/Heatmap
 */

import type * as React from 'react'
import { useMemo } from 'react'

import { heatmap } from '@flomo/core'
import type { Memo } from '@flomo/core'

export interface HeatmapProps {
  memos: readonly Memo[]
  /** How many weeks of history to show. */
  weeks?: number
  /** Reference instant, for tests. */
  today?: Date
}

/** Square size plus gap, in pixels; must match the stylesheet. */
const CELL = 13

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

    // Walk back to the Sunday that starts the first visible week, so the grid
    // always aligns to weekday rows regardless of what day it is today.
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const start = new Date(end)
    start.setDate(start.getDate() - (weeks * 7 - 1) - end.getDay())

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

  return (
    <div className="fl-heatmap" role="img" aria-label="记录热力图">
      {columns.map((column, index) => (
        <div className="fl-heatmap-week" key={column[0]?.key ?? index}>
          {column.map((cell) => (
            <div
              key={cell.key}
              className="fl-heatmap-cell"
              data-level={cell.future ? 0 : level(cell.count)}
              style={cell.future ? { opacity: 0.35 } : undefined}
              title={`${cell.key}：${cell.count} 条`}
            />
          ))}
        </div>
      ))}
      <span className="fl-visually-hidden">{`每格 ${CELL} 像素`}</span>
    </div>
  )
}
