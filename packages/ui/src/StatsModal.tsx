/**
 * The corpus stats dialog flomo opens from the three numbers above the calendar.
 *
 * All three numbers open the same dialog: a 月/年 toggle, then every year from
 * newest to oldest — month cards under 月, three per-year chart cards (notes,
 * characters, active days, one bar per month) under 年. There is no year
 * picker on purpose: the dialog is one scrolling column, and the wheel is the
 * navigation. Clicking a shaded day closes the dialog and opens that day's
 * notes, which is the same journey as clicking the sidebar calendar.
 *
 * @module @flomo/ui/StatsModal
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { absoluteDayLabel, dayOf, memosToMarkdown, monthOf } from '@flomo/core'
import type { Memo } from '@flomo/core'

import { downloadText } from './download.ts'
import { heatLevel } from './Heatmap.tsx'

export interface StatsModalProps {
  /** The whole corpus. */
  memos: readonly Memo[]
  /** Closes the dialog. */
  onClose: () => void
  /** Where a shaded day-cell click navigates. */
  onSelectDay: (day: string) => void
}

/** Weekday heads of the month cards; flomo's calendars run Monday first. */
const WEEKDAY_HEADS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** Per-day totals behind both the month and the year views. */
interface DayTotals {
  notes: number
  chars: number
}

/** One month card: its totals and its day cells. */
interface MonthCardData {
  prefix: string
  month: number
  notes: number
  chars: number
  activeDays: number
  /** Blank weekday cells before day 1, Monday-first. */
  offset: number
  days: Array<{ day: string; num: number; notes: number; future: boolean }>
}

/** Everything the 年 view shows for one year. */
interface YearStats {
  year: number
  /** Per-month series, January first. */
  notes: number[]
  chars: number[]
  days: number[]
  /** Year totals. */
  totalNotes: number
  totalChars: number
  totalDays: number
}

/**
 * Abbreviate a count the way the reference charts do: 13.0K, never 13041.
 * @param value - the count.
 * @returns the compact label.
 */
function compact(value: number): string {
  if (value >= 1000) {
    const k = (value / 1000).toFixed(1)
    return `${k.endsWith('.0') ? k.slice(0, -2) : k}K`
  }
  return String(value)
}

/**
 * Pick a clean tick step for a chart whose tallest bar is `max`.
 *
 * Small axes step by one; larger ones round the quarter up to a 1/2/5 power of
 * ten, so the labels stay readable numbers.
 * @param max - the tallest value, zero allowed.
 * @returns the step between ticks.
 */
function tickStep(max: number): number {
  if (max <= 8) return 1
  const raw = max / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const multiple of [1, 2, 5, 10]) {
    if (multiple * power >= raw) return multiple * power
  }
  return power * 10
}

/**
 * One metric chart: the year total, twelve monthly bars, and a right-hand
 * tick rail — the three cards of flomo's 年 view.
 * @param props - the metric name, per-month values, and the palette tone.
 * @returns the chart card.
 */
function ChartCard({
  label,
  values,
  tone,
}: {
  label: string
  values: readonly number[]
  tone: 'blue' | 'green' | 'red'
}): React.ReactElement {
  const total = values.reduce((sum, value) => sum + value, 0)
  const max = Math.max(...values)
  const step = tickStep(max)
  const ticks: number[] = []
  for (let tick = max; tick > 0; tick -= step) ticks.push(tick)
  ticks.push(0)

  return (
    <div className="fl-chart-card">
      <div className="fl-chart-head">
        <strong className="fl-chart-num">{compact(total)}</strong>
        <span className="fl-chart-unit">{label}</span>
      </div>
      <div className="fl-chart-body">
        <div className="fl-chart-plot">
          <div className="fl-chart-bars">
            {values.map((value, index) => (
              <i
                key={index}
                className="fl-chart-bar"
                data-tone={tone}
                style={{
                  height: value === 0 ? 2 : Math.max(6, Math.round((value / max) * 230)),
                }}
                title={`${index + 1} 月：${value}`}
              />
            ))}
          </div>
          <div className="fl-chart-months" aria-hidden="true">
            {values.map((_, index) => (
              <span key={index}>{String(index + 1).padStart(2, '0')}</span>
            ))}
          </div>
        </div>
        <div className="fl-chart-ticks" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{compact(tick)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The dialog element.
 * @param props - the corpus and the close/navigate callbacks.
 * @returns the dialog element.
 */
export function StatsModal({
  memos,
  onClose,
  onSelectDay,
}: StatsModalProps): React.ReactElement {
  const [tab, setTab] = useState<'month' | 'year'>('month')

  // Escape closes, like the view dropdown and the memo editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const todayKey = dayOf(new Date())

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

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    for (const day of byDay.keys()) set.add(Number(day.slice(0, 4)))
    return [...set].sort((a, b) => b - a)
  }, [byDay])

  /** Build the twelve month cards of one year. */
  const buildCards = useCallback(
    (year: number): MonthCardData[] => {
      const out: MonthCardData[] = []
      for (let month = 12; month >= 1; month -= 1) {
        const prefix = `${year}-${String(month).padStart(2, '0')}`
        let notes = 0
        let chars = 0
        let activeDays = 0
        const days: MonthCardData['days'] = []
        const daysInMonth = new Date(year, month, 0).getDate()
        const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
        for (let num = 1; num <= daysInMonth; num += 1) {
          const day = `${prefix}-${String(num).padStart(2, '0')}`
          const totals = byDay.get(day)
          notes += totals?.notes ?? 0
          chars += totals?.chars ?? 0
          if (totals !== undefined) activeDays += 1
          days.push({ day, num, notes: totals?.notes ?? 0, future: day > todayKey })
        }
        out.push({ prefix, month, notes, chars, activeDays, offset, days })
      }
      return out
    },
    [byDay, todayKey],
  )

  const monthSections = useMemo(
    () => years.map((year) => ({ year, cards: buildCards(year) })),
    [years, buildCards],
  )

  const yearStats = useMemo<YearStats[]>(
    () =>
      years.map((year) => {
        const stats: YearStats = {
          year,
          notes: new Array(12).fill(0),
          chars: new Array(12).fill(0),
          days: new Array(12).fill(0),
          totalNotes: 0,
          totalChars: 0,
          totalDays: 0,
        }
        for (const [day, totals] of byDay) {
          if (Number(day.slice(0, 4)) !== year) continue
          const index = Number(day.slice(5, 7)) - 1
          if (index < 0 || index > 11) continue
          stats.notes[index] = (stats.notes[index] ?? 0) + totals.notes
          stats.chars[index] = (stats.chars[index] ?? 0) + totals.chars
          stats.days[index] = (stats.days[index] ?? 0) + 1
          stats.totalNotes += totals.notes
          stats.totalChars += totals.chars
          stats.totalDays += 1
        }
        return stats
      }),
    [years, byDay],
  )

  /** Export one year's memos as Markdown. */
  const exportYear = (year: number): void => {
    const yearMemos = memos.filter((memo) => memo.createdAt.startsWith(String(year)))
    if (yearMemos.length === 0) return
    downloadText(`flomo-${year}.md`, memosToMarkdown(yearMemos), 'text/markdown')
  }

  return (
    <div className="fl-modal-overlay" onClick={onClose}>
      <div
        className="fl-modal"
        role="dialog"
        aria-modal="true"
        aria-label="记录统计"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="fl-modal-head">
          <span className="fl-modal-title">记录统计</span>
          <button type="button" className="fl-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="fl-seg" role="tablist" aria-label="统计粒度">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'month'}
            data-active={tab === 'month'}
            className="fl-seg-option"
            onClick={() => setTab('month')}
          >
            月
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'year'}
            data-active={tab === 'year'}
            className="fl-seg-option"
            onClick={() => setTab('year')}
          >
            年
          </button>
        </div>

        {tab === 'month'
          ? monthSections.map((section) => (
              <section key={section.year} className="fl-year-block">
                <h2 className="fl-year-title">{section.year}</h2>
                <div className="fl-month-grid">
                  {section.cards.map((card) => (
                    <MonthCard key={card.prefix} card={card} memos={memos} onSelectDay={onSelectDay} />
                  ))}
                </div>
              </section>
            ))
          : yearStats.map((stat) => (
              <section key={stat.year} className="fl-year-block">
                <header className="fl-year-head">
                  <h2 className="fl-year-title">{stat.year}</h2>
                  <button
                    type="button"
                    className="fl-card-export"
                    title={`导出 ${stat.year} 年 Markdown`}
                    aria-label={`导出 ${stat.year} 年的笔记`}
                    disabled={stat.totalNotes === 0}
                    onClick={() => exportYear(stat.year)}
                  >
                    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                      <path
                        d="M8 10V2.5M5 5l3-3 3 3M3 10.5v2A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </header>
                <div className="fl-chart-row">
                  <ChartCard label="条笔记" values={stat.notes} tone="blue" />
                  <ChartCard label="字" values={stat.chars} tone="green" />
                  <ChartCard label="天" values={stat.days} tone="red" />
                </div>
              </section>
            ))}
      </div>
    </div>
  )
}

/**
 * One month: header with a Markdown export, the three totals, and the day grid.
 * @param props - the precomputed card, the corpus, and the day-click target.
 * @returns the card element.
 */
function MonthCard({
  card,
  memos,
  onSelectDay,
}: {
  card: MonthCardData
  memos: readonly Memo[]
  onSelectDay: (day: string) => void
}): React.ReactElement {
  const exportMonth = () => {
    const monthMemos = memos.filter((memo) => monthOf(memo.createdAt) === card.prefix)
    if (monthMemos.length === 0) return
    downloadText(`flomo-${card.prefix}.md`, memosToMarkdown(monthMemos), 'text/markdown')
  }

  return (
    <section className="fl-month-card">
      <header className="fl-month-head">
        <h3 className="fl-month-title">{String(card.month).padStart(2, '0')} 月</h3>
        <button
          type="button"
          className="fl-card-export"
          title="导出本月 Markdown"
          aria-label={`导出 ${card.prefix} 的笔记`}
          disabled={card.notes === 0}
          onClick={exportMonth}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M8 10V2.5M5 5l3-3 3 3M3 10.5v2A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      <p className="fl-month-stats">
        <span>
          <strong>{card.notes}</strong> 笔记
        </span>
        <span>
          <strong>{card.chars}</strong> 字数
        </span>
        <span>
          <strong>{card.activeDays}</strong> 记录天数
        </span>
      </p>

      <div className="fl-cal-weekdays" aria-hidden="true">
        {WEEKDAY_HEADS.map((head) => (
          <span key={head}>{head}</span>
        ))}
      </div>
      <div className="fl-cal-grid">
        {Array.from({ length: card.offset }, (_, index) => (
          <span key={`pad-${card.prefix}-${index}`} className="fl-cal-day" />
        ))}
        {card.days.map((day) => (
          <span key={day.day} className="fl-cal-day">
            <span className="fl-cal-num">{day.num}</span>
            {day.notes > 0 && !day.future ? (
              <button
                type="button"
                className="fl-cal-cell"
                data-level={heatLevel(day.notes)}
                title={`${absoluteDayLabel(day.day)} · ${day.notes} 条`}
                aria-label={`${absoluteDayLabel(day.day)} ${day.notes} 条，查看当天笔记`}
                onClick={() => onSelectDay(day.day)}
              />
            ) : (
              <span className="fl-cal-cell" data-level={heatLevel(day.notes)} />
            )}
          </span>
        ))}
      </div>
    </section>
  )
}
