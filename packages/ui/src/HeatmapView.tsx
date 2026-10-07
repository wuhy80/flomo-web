/**
 * flomo's 记录统计 page: the month digest, the trailing-year heatmap, and the
 * six PRO chart cards.
 *
 * The month digest answers "how did this month go" — a month picker, five
 * headline numbers (MEMO / 字数 / 单日最多条数 / 单日最多字数 / 坚持记录天数)
 * and one bar per day. The trailing-year grid answers "what did the whole year
 * look like": 53 Monday-first week columns that flex to the container width,
 * month labels along the bottom, a weekday rail on the right, and every day
 * with notes clicking through to that day's feed. The chart cards reuse the
 * visualizations in {@link module:@flomo/ui/Charts}.
 *
 * @module @flomo/ui/HeatmapView
 */

import type * as React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { dayOf, heatmap, monthOf } from '@flomo/core'
import type { Memo } from '@flomo/core'

import {
  CharDistChart,
  MediaDistChart,
  PlatformDistChart,
  TagMatrixChart,
  TagTreeChart,
  TimeDistChart,
  tickStep,
} from './Charts.tsx'
import type { ChartSize } from './Charts.tsx'
import { heatLevel } from './Heatmap.tsx'

export interface HeatmapViewProps {
  /** The whole corpus, newest first. */
  memos: readonly Memo[]
  /** Navigates to a day's notes. */
  onSelectDay: (day: string) => void
}

/** Weekday rail labels, Monday first — shown on alternating rows. */
const WEEKDAY_RAIL = ['一', '', '三', '', '五', '', '日'] as const

/** The trailing-year window: 53 Monday-first week columns ending this week. */
const YEAR_WEEKS = 53

/** Per-day totals behind the month digest. */
interface DayTotals {
  notes: number
  chars: number
}

/* ── 月度: month picker, five numbers, daily bars ─────────────────────── */

/**
 * The month digest element.
 * @param props - the corpus.
 * @returns the section element.
 */
function MonthStats({ memos }: { memos: readonly Memo[] }): React.ReactElement {
  const [month, setMonth] = useState(() => monthOf(new Date()))

  const months = useMemo(() => {
    const set = new Set([monthOf(new Date())])
    for (const memo of memos) set.add(monthOf(memo.createdAt))
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [memos])

  const byDay = useMemo(() => {
    const map = new Map<string, DayTotals>()
    for (const memo of memos) {
      const day = dayOf(memo.createdAt)
      const bucket = map.get(day) ?? { notes: 0, chars: 0 }
      bucket.notes += 1
      bucket.chars += memo.content.length
      map.set(day, bucket)
    }
    return map
  }, [memos])

  const stats = useMemo(() => {
    const [year, mon] = month.split('-').map(Number)
    const total = year === undefined || mon === undefined ? 30 : new Date(year, mon, 0).getDate()
    const bars: number[] = []
    let notes = 0
    let chars = 0
    let activeDays = 0
    let maxNotes = 0
    let maxChars = 0
    for (let num = 1; num <= total; num += 1) {
      const key = `${month}-${String(num).padStart(2, '0')}`
      const bucket = byDay.get(key)
      const dayNotes = bucket?.notes ?? 0
      notes += dayNotes
      chars += bucket?.chars ?? 0
      if (bucket !== undefined) activeDays += 1
      maxNotes = Math.max(maxNotes, dayNotes)
      maxChars = Math.max(maxChars, bucket?.chars ?? 0)
      bars.push(dayNotes)
    }
    return { notes, chars, activeDays, maxNotes, maxChars, bars }
  }, [byDay, month])

  const max = Math.max(...stats.bars, 1)
  const step = tickStep(max)
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let tick = top; tick > 0; tick -= step) ticks.push(tick)
  ticks.push(0)

  return (
    <section className="fl-ms">
      <select
        className="fl-ms-select"
        value={month}
        aria-label="选择月份"
        onChange={(event) => setMonth(event.target.value)}
      >
        {months.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <div className="fl-ms-nums">
        <div className="fl-ms-num">
          <strong>{stats.notes}</strong>
          <span>MEMO</span>
        </div>
        <div className="fl-ms-num">
          <strong>{stats.chars}</strong>
          <span>字数</span>
        </div>
        <div className="fl-ms-num">
          <strong>{stats.maxNotes}</strong>
          <span>单日最多条数</span>
        </div>
        <div className="fl-ms-num">
          <strong>{stats.maxChars}</strong>
          <span>单日最多字数</span>
        </div>
        <div className="fl-ms-num">
          <strong>{stats.activeDays}</strong>
          <span>坚持记录天数</span>
        </div>
      </div>

      <div className="fl-ms-chart" role="img" aria-label={`${month} 每日记录条数`}>
        <div className="fl-ms-bars">
          {stats.bars.map((count, index) => (
            <i
              key={index}
              data-on={count > 0}
              style={{ height: count === 0 ? 2 : Math.max(4, Math.round((count / max) * 148)) }}
              title={`${index + 1} 日：${count} 条`}
            />
          ))}
        </div>
        <div className="fl-ms-ticks" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 最近一年: trailing-year heatmap ──────────────────────────────────── */

interface YearCell {
  key: string
  count: number
  future: boolean
}

/**
 * The trailing-year heatmap element.
 * @param props - the corpus and the day-navigation callback.
 * @returns the section element.
 */
function RecentYear({
  memos,
  onSelectDay,
}: {
  memos: readonly Memo[]
  onSelectDay: (day: string) => void
}): React.ReactElement {
  const today = new Date()
  const todayKey = dayOf(today)

  const columns = useMemo(() => {
    const counts = heatmap(memos)
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const start = new Date(end)
    start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (YEAR_WEEKS - 1) * 7)

    const out: YearCell[][] = []
    const cursor = new Date(start)
    for (let week = 0; week < YEAR_WEEKS; week += 1) {
      const column: YearCell[] = []
      for (let day = 0; day < 7; day += 1) {
        const key = dayOf(cursor)
        column.push({ key, count: counts.get(key) ?? 0, future: cursor > end })
        cursor.setDate(cursor.getDate() + 1)
      }
      out.push(column)
    }
    return out
  }, [memos, today])

  const startKey = columns[0]?.[0]?.key
  const yearCount = useMemo(
    () =>
      startKey === undefined
        ? 0
        : memos.filter((memo) => dayOf(memo.createdAt) >= startKey).length,
    [memos, startKey],
  )

  // One label per month the grid touches, at the column where that month
  // begins; a month starting mid-week takes the slot from the month whose days
  // mostly fell off the grid anyway.
  const monthMarks = useMemo(() => {
    const marks: Array<{ label: string; index: number }> = []
    columns.forEach((column, index) => {
      const first = column[0]
      if (first === undefined) return
      const label = `${Number(first.key.slice(5, 7))}月`
      const last = marks[marks.length - 1]
      if (last === undefined || last.label !== label) {
        marks.push({ label, index })
      }
    })
    return marks
  }, [columns])

  // The rail's rows must track the fluid cell size, which only exists once the
  // browser has laid the weeks out — hence measure, and re-measure on resize.
  const weeksRef = useRef<HTMLDivElement>(null)
  const [cell, setCell] = useState(13)
  useLayoutEffect(() => {
    const el = weeksRef.current
    if (el === null) return
    const update = () => setCell(Math.max(3, (el.clientWidth - (YEAR_WEEKS - 1) * 3) / YEAR_WEEKS))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="fl-ry">
      <h2 className="fl-ry-title">最近一年记录 {yearCount} 条 MEMO</h2>
      <div className="fl-ry-grid">
        <div className="fl-ry-columns">
          <div className="fl-ry-weeks" ref={weeksRef}>
            {columns.map((column, index) => (
              <div key={column[0]?.key ?? index} className="fl-ry-week">
                {column.map((cellDay) => {
                  const tip = `${cellDay.key}：${cellDay.count} 条`
                  const clickable = cellDay.count > 0 && !cellDay.future
                  return clickable ? (
                    <button
                      key={cellDay.key}
                      type="button"
                      className="fl-ry-cell"
                      data-level={heatLevel(cellDay.count)}
                      data-today={cellDay.key === todayKey}
                      title={tip}
                      aria-label={`${tip}，查看当天笔记`}
                      onClick={() => onSelectDay(cellDay.key)}
                    />
                  ) : (
                    <span
                      key={cellDay.key}
                      className="fl-ry-cell"
                      data-level={heatLevel(cellDay.count)}
                      data-today={cellDay.key === todayKey}
                      style={cellDay.future ? { opacity: 0.35 } : undefined}
                      title={tip}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <div className="fl-ry-months" aria-hidden="true">
            {monthMarks.map((mark) => (
              <span
                key={`${mark.label}-${mark.index}`}
                style={{ left: `calc((100% + 3px) * ${mark.index} / ${YEAR_WEEKS})` }}
              >
                {mark.label}
              </span>
            ))}
          </div>
        </div>
        <div
          className="fl-ry-rail"
          aria-hidden="true"
          style={{ gridTemplateRows: `repeat(7, ${cell.toFixed(1)}px)` }}
        >
          {WEEKDAY_RAIL.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── PRO 图表卡片 ─────────────────────────────────────────────────────── */

/** One card of flomo's chart grid. */
interface ProCardDef {
  key: string
  title: string
  desc: string
  render: (memos: readonly Memo[], size: ChartSize) => React.ReactElement
}

/** The six cards, in flomo's order. */
const PRO_CARDS: ProCardDef[] = [
  {
    key: 'tagtree',
    title: '标签树',
    desc: '树状图，展示标签层级关系',
    render: (memos, size) => <TagTreeChart memos={memos} size={size} />,
  },
  {
    key: 'tagmatrix',
    title: '标签矩阵',
    desc: '矩阵图，展示标签层级关系',
    render: (memos, size) => <TagMatrixChart memos={memos} size={size} />,
  },
  {
    key: 'chardist',
    title: '字数分布',
    desc: '极坐标柱状图，展示 MEMO 字数分布',
    render: (memos, size) => <CharDistChart memos={memos} size={size} />,
  },
  {
    key: 'timedist',
    title: '时间分布',
    desc: '散点图，展示记录时间分布',
    render: (memos, size) => <TimeDistChart memos={memos} size={size} />,
  },
  {
    key: 'platform',
    title: '平台分布',
    desc: '饼状图，展示记录平台分布',
    render: (_memos, size) => <PlatformDistChart size={size} />,
  },
  {
    key: 'media',
    title: '媒体分布',
    desc: '饼状图，展示 MEMO 媒体分布',
    render: (memos, size) => <MediaDistChart memos={memos} size={size} />,
  },
]

/**
 * The page element: month digest, trailing year, chart cards, lightbox.
 * @param props - the corpus and the day-navigation callback.
 * @returns the view element.
 */
export function HeatmapView({
  memos,
  onSelectDay,
}: HeatmapViewProps): React.ReactElement {
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    if (openKey === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openKey])

  const open = PRO_CARDS.find((def) => def.key === openKey)

  return (
    <>
      <MonthStats memos={memos} />
      <RecentYear memos={memos} onSelectDay={onSelectDay} />

      <div className="fl-pcards">
        {PRO_CARDS.map((def) => (
          <div key={def.key} className="fl-pcard">
            <div className="fl-pcard-chart">{def.render(memos, 'mini')}</div>
            <div className="fl-pcard-meta">
              <h3>
                {def.title} <i className="fl-pcard-pro">PRO</i>
              </h3>
              <p>{def.desc}</p>
              <button
                type="button"
                className="fl-pcard-view"
                onClick={() => setOpenKey(def.key)}
              >
                查看
              </button>
            </div>
          </div>
        ))}
      </div>

      {open !== undefined ? (
        <div className="fl-chartbox-overlay" onClick={() => setOpenKey(null)}>
          <div
            className="fl-chartbox"
            role="dialog"
            aria-modal="true"
            aria-label={open.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="fl-chartbox-head">
              <h3>{open.title}</h3>
              <button
                type="button"
                className="fl-chartbox-close"
                aria-label="关闭"
                onClick={() => setOpenKey(null)}
              >
                ×
              </button>
            </header>
            {open.render(memos, 'full')}
          </div>
        </div>
      ) : null}
    </>
  )
}
