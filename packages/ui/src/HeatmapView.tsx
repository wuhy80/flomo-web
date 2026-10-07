/**
 * The full-page heatmap: one square per day across a whole year, flomo's
 * dedicated 热力图 page.
 *
 * The sidebar's small calendar answers "am I still writing?"; this page answers
 * "what did the whole year look like" — bigger cells, weekday and month rails,
 * a year switcher, and the year's totals on top. Days with notes click through
 * to that day's feed, exactly like the sidebar calendar.
 *
 * @module @flomo/ui/HeatmapView
 */

import type * as React from 'react'
import { useMemo, useState } from 'react'

import { dayOf } from '@flomo/core'
import type { Memo } from '@flomo/core'

import { heatLevel } from './Heatmap.tsx'

export interface HeatmapViewProps {
  /** The whole corpus, newest first. */
  memos: readonly Memo[]
  /** Navigates to a day's notes. */
  onSelectDay: (day: string) => void
}

/** Weekday rail labels, Monday first — shown on alternating rows. */
const WEEKDAY_RAIL = ['一', '', '三', '', '五', '', '日'] as const

interface DayCell {
  key: string
  dayOfMonth: number
  count: number
  chars: number
  future: boolean
}

/**
 * The full-page heatmap view element.
 * @param props - the corpus and the day-navigation callback.
 * @returns the view element.
 */
export function HeatmapView({
  memos,
  onSelectDay,
}: HeatmapViewProps): React.ReactElement {
  const todayKey = dayOf(new Date())
  const [year, setYear] = useState(() => new Date().getFullYear())

  const perDay = useMemo(() => {
    const map = new Map<string, { notes: number; chars: number }>()
    for (const memo of memos) {
      const day = dayOf(memo.createdAt)
      const bucket = map.get(day) ?? { notes: 0, chars: 0 }
      bucket.notes += 1
      bucket.chars += memo.content.length
      map.set(day, bucket)
    }
    return map
  }, [memos])

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    for (const day of perDay.keys()) set.add(Number(day.slice(0, 4)))
    return [...set].sort((a, b) => b - a)
  }, [perDay])

  // The grid: the Monday on/before Jan 1 through Dec 31, padded to whole weeks.
  // For the current year the cells after today render dimmed and inert.
  const columns = useMemo(() => {
    const jan1 = new Date(year, 0, 1)
    const dec31 = new Date(year, 11, 31)
    const start = new Date(jan1)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))

    const out: DayCell[][] = []
    const cursor = new Date(start)
    while (cursor <= dec31) {
      const column: DayCell[] = []
      for (let d = 0; d < 7 && cursor <= dec31; d += 1) {
        const month = String(cursor.getMonth() + 1).padStart(2, '0')
        const day = String(cursor.getDate()).padStart(2, '0')
        const key = `${year}-${month}-${day}`
        const bucket = perDay.get(key)
        column.push({
          key,
          dayOfMonth: cursor.getDate(),
          count: bucket?.notes ?? 0,
          chars: bucket?.chars ?? 0,
          future: false,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
      out.push(column)
    }
    return out
  }, [year, perDay])

  const totals = useMemo(() => {
    let notes = 0
    let chars = 0
    let days = 0
    for (const [day, bucket] of perDay) {
      if (Number(day.slice(0, 4)) !== year) continue
      notes += bucket.notes
      chars += bucket.chars
      days += 1
    }
    return { notes, chars, days }
  }, [perDay, year])

  // Month labels along the top: one per month, in the column where its day 1
  // falls. Marking the column's first cell instead would label the previous
  // December's padding days in column 0 — a stray `12 月` before `1 月`.
  const monthMarks = useMemo(() => {
    const marks: Array<{ label: string; index: number }> = []
    columns.forEach((column, index) => {
      const first = column.find((cell) => cell.key.slice(8, 10) === '01')
      if (first === undefined) return
      marks.push({ label: `${Number(first.key.slice(5, 7))} 月`, index })
    })
    return marks
  }, [columns])

  return (
    <>
      <div className="fl-year-head">
        <h2 className="fl-year-title">{year}</h2>
        {years.length > 1 ? (
          <span className="fl-year-switch">
            {years.map((value) => (
              <button
                key={value}
                type="button"
                className="fl-insight-scope-option"
                data-active={value === year}
                onClick={() => setYear(value)}
              >
                {value}
              </button>
            ))}
          </span>
        ) : null}
      </div>

      <div className="fl-year-summary">
        <span>
          <strong>{totals.notes}</strong> 条笔记
        </span>
        <span>
          <strong>{totals.chars}</strong> 字
        </span>
        <span>
          <strong>{totals.days}</strong> 记录天数
        </span>
        <span className="fl-year-legend" aria-hidden="true">
          少
          <i data-level={1} />
          <i data-level={2} />
          <i data-level={3} />
          <i data-level={4} />
          多
        </span>
      </div>

      <div className="fl-year-grid-wrap">
        <div className="fl-year-grid">
          <div className="fl-year-rail" aria-hidden="true">
            {WEEKDAY_RAIL.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>
          <div className="fl-year-columns">
            <div className="fl-year-months" aria-hidden="true">
              {monthMarks.map((mark) => (
                <span
                  key={mark.label}
                  style={{ left: `calc((100% + 3px) * ${mark.index} / ${columns.length})` }}
                >
                  {mark.label}
                </span>
              ))}
            </div>
            <div className="fl-year-weeks">
              {columns.map((column, index) => (
                <div key={index} className="fl-year-week">
                  {column.map((cell) => {
                    const tip = `${cell.key}：${cell.count} 条`
                    const clickable = cell.count > 0 && !cell.future && cell.key <= todayKey
                    return clickable ? (
                      <button
                        key={cell.key}
                        type="button"
                        className="fl-year-cell"
                        data-level={heatLevel(cell.count)}
                        data-today={cell.key === todayKey}
                        title={tip}
                        aria-label={`${tip}，查看当天笔记`}
                        onClick={() => onSelectDay(cell.key)}
                      />
                    ) : (
                      <span
                        key={cell.key}
                        className="fl-year-cell"
                        data-level={heatLevel(cell.count)}
                        data-today={cell.key === todayKey}
                        title={tip}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
