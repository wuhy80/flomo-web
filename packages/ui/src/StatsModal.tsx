/**
 * The corpus stats dialog flomo opens from the three numbers above the calendar.
 *
 * All three numbers open the same dialog: a 月/年 toggle over month cards —
 * each a full calendar of the month with per-day shading, counts, and character
 * totals — and a per-year summary. Clicking a shaded day closes the dialog and
 * opens that day's notes, which is the same journey as clicking the sidebar
 * calendar, so the two surfaces stay one mental model.
 *
 * @module @flomo/ui/StatsModal
 */

import type * as React from 'react'
import { useEffect, useMemo, useState } from 'react'

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

/** Per-day totals behind both the month and the year cards. */
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
  const [year, setYear] = useState(() => new Date().getFullYear())

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

  const cards = useMemo(() => {
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
  }, [year, byDay, todayKey])

  const yearCards = useMemo(
    () =>
      years.map((value) => {
        let notes = 0
        let chars = 0
        let activeDays = 0
        const months = new Array(12).fill(0) as number[]
        for (const [day, totals] of byDay) {
          if (Number(day.slice(0, 4)) !== value) continue
          notes += totals.notes
          chars += totals.chars
          activeDays += 1
          const index = Number(day.slice(5, 7)) - 1
          months[index] = (months[index] ?? 0) + totals.notes
        }
        return { year: value, notes, chars, activeDays, months }
      }),
    [years, byDay],
  )

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

        {tab === 'month' ? (
          <>
            <label className="fl-year-pick">
              <select
                className="fl-year-select"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                aria-label="选择年份"
              >
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">▾</span>
            </label>

            <div className="fl-month-grid">
              {cards.map((card) => (
                <MonthCard
                  key={card.prefix}
                  card={card}
                  memos={memos}
                  onSelectDay={onSelectDay}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="fl-year-list">
            {yearCards.map((card) => (
              <button
                key={card.year}
                type="button"
                className="fl-year-card"
                onClick={() => {
                  setYear(card.year)
                  setTab('month')
                }}
                title={`查看 ${card.year} 年的按月统计`}
              >
                <span className="fl-year-name">{card.year}</span>
                <span className="fl-year-stats">
                  <strong>{card.notes}</strong> 笔记 · <strong>{card.chars}</strong> 字数 ·{' '}
                  <strong>{card.activeDays}</strong> 记录天数
                </span>
                <YearBars months={card.months} />
              </button>
            ))}
          </div>
        )}
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

/**
 * Twelve month bars summarising a year at a glance.
 * @param props - note counts per month, January first.
 * @returns the bars element.
 */
function YearBars({ months }: { months: readonly number[] }): React.ReactElement {
  const peak = Math.max(...months, 1)
  return (
    <span className="fl-year-bars" aria-hidden="true">
      {months.map((count, index) => (
        <i
          key={index}
          className="fl-year-bar"
          data-level={heatLevel(count)}
          style={{ height: count === 0 ? 5 : 6 + Math.round((count / peak) * 22) }}
        />
      ))}
    </span>
  )
}
