/**
 * The six PRO chart cards of flomo's 记录统计 page: 标签树, 标签矩阵,
 * 字数分布, 时间分布, 平台分布, 媒体分布.
 *
 * Every chart renders from the live corpus at two sizes: a `mini` that sits
 * inside its card, and a `full` that the 查看 link opens in a lightbox. The
 * data behind them is whatever the vault actually has — tags, character
 * counts, writing hours, attached images — so a chart of something the model
 * does not track (platform) says so honestly rather than inventing slices.
 *
 * @module @flomo/ui/Charts
 */

import type * as React from 'react'
import { useMemo } from 'react'

import { tagSegments, tagStats } from '@flomo/core'
import type { Memo } from '@flomo/core'

/** Render size: a card thumbnail or the lightbox enlargement. */
export type ChartSize = 'mini' | 'full'

/** The green the charts share, plus the pie palette flomo leans on. */
const GREEN = '#47b881'
const GREEN_SOFT = '#8ed3ae'
const PIE_COLORS = ['#5b8bd9', '#e15b64', '#f2a33c', '#47b881', '#9b6fd9', '#5bc0d9'] as const

/**
 * Abbreviate a count the way the reference charts do: 13.0K, never 13041.
 * @param value - the count.
 * @returns the compact label.
 */
export function compact(value: number): string {
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
export function tickStep(max: number): number {
  if (max <= 8) return 1
  const raw = max / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const multiple of [1, 2, 5, 10]) {
    if (multiple * power >= raw) return multiple * power
  }
  return power * 10
}

/** Muted placeholder for a chart whose corpus has nothing to plot. */
function Empty({ text = '暂无数据' }: { text?: string }): React.ReactElement {
  return <div className="fl-chart-empty">{text}</div>
}

/* ── 标签树 ──────────────────────────────────────────────────────────── */

/** One node of the tag hierarchy: a path segment and the memos under it. */
interface TagNode {
  name: string
  count: number
  children: Map<string, TagNode>
}

/**
 * Fold the corpus's tags into a tree. A tag `#读书/认知` contributes its count
 * to `读书` and to `读书/认知`, so a parent's number is everything beneath it.
 */
function tagHierarchy(memos: readonly Memo[]): TagNode {
  const root: TagNode = { name: '全部', count: 0, children: new Map() }
  for (const stat of tagStats(memos)) {
    root.count += stat.count
    let node = root
    for (const segment of tagSegments(stat.tag)) {
      let child = node.children.get(segment)
      if (child === undefined) {
        child = { name: segment, count: 0, children: new Map() }
        node.children.set(segment, child)
      }
      child.count += stat.count
      node = child
    }
  }
  return root
}

/**
 * The radial dendrogram: root at the center, top-level tags on a ring, their
 * children fanned out within the parent's angular slice.
 */
export function TagTreeChart({
  memos,
  size,
}: {
  memos: readonly Memo[]
  size: ChartSize
}): React.ReactElement {
  const root = useMemo(() => tagHierarchy(memos), [memos])
  const tops = [...root.children.values()].sort((a, b) => b.count - a.count).slice(0, 14)
  if (tops.length === 0) return <Empty text="暂无标签" />

  const box = size === 'full' ? 460 : 190
  const c = box / 2
  const radius = box / 2 - (size === 'full' ? 58 : 22)
  const r1 = radius * 0.42
  const r2 = radius * 0.78

  const lines: React.ReactElement[] = []
  const dots: React.ReactElement[] = []
  const labels: React.ReactElement[] = []

  tops.forEach((top, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / tops.length
    const x1 = c + Math.cos(angle) * r1
    const y1 = c + Math.sin(angle) * r1
    lines.push(
      <line key={`t${index}`} x1={c} y1={c} x2={x1} y2={y1} stroke={GREEN} strokeWidth={1.4} />,
    )
    dots.push(<circle key={`td${index}`} cx={x1} cy={y1} r={2.6} fill={GREEN} />)
    if (size === 'full' || tops.length <= 8) {
      const anchor = Math.abs(Math.cos(angle)) < 0.25 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end'
      labels.push(
        <text
          key={`tl${index}`}
          x={c + Math.cos(angle) * (r1 + 7)}
          y={c + Math.sin(angle) * (r1 + 7) + 3}
          textAnchor={anchor}
          className="fl-chart-label"
        >
          {`${top.name} ${top.count}`}
        </text>,
      )
    }

    const kids = [...top.children.values()].sort((a, b) => b.count - a.count).slice(0, 8)
    const slice = (2 * Math.PI) / tops.length
    kids.forEach((kid, j) => {
      const kidAngle = angle + (slice * (j + 1)) / (kids.length + 1)
      const x2 = c + Math.cos(kidAngle) * r2
      const y2 = c + Math.sin(kidAngle) * r2
      lines.push(
        <line
          key={`k${index}-${j}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={GREEN_SOFT}
          strokeWidth={1.1}
        />,
      )
      dots.push(<circle key={`kd${index}-${j}`} cx={x2} cy={y2} r={1.8} fill={GREEN_SOFT} />)
      if (size === 'full') {
        const anchor = Math.abs(Math.cos(kidAngle)) < 0.25 ? 'middle' : Math.cos(kidAngle) > 0 ? 'start' : 'end'
        labels.push(
          <text
            key={`kl${index}-${j}`}
            x={c + Math.cos(kidAngle) * (r2 + 6)}
            y={c + Math.sin(kidAngle) * (r2 + 6) + 3}
            textAnchor={anchor}
            className="fl-chart-label fl-chart-label-faint"
          >
            {kid.name}
          </text>,
        )
      }
    })
  })

  return (
    <svg viewBox={`0 0 ${box} ${box}`} className="fl-chart-svg" role="img" aria-label="标签树">
      {lines}
      {dots}
      {labels}
      <circle cx={c} cy={c} r={size === 'full' ? 14 : 7} fill={GREEN} />
      {size === 'full' ? (
        <text x={c} y={c + 4} textAnchor="middle" className="fl-chart-label fl-chart-label-inverse">
          {compact(root.count)}
        </text>
      ) : null}
    </svg>
  )
}

/* ── 标签矩阵 ────────────────────────────────────────────────────────── */

interface Rect {
  tag: string
  count: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Treemap by recursive balanced split: sort by size, halve the list where the
 * sums are closest, cut the longer side proportionally, recurse. Not squarify,
 * but close for a dozen tags and a tenth of the code.
 */
function splitTreemap(
  entries: Array<{ tag: string; count: number }>,
  x: number,
  y: number,
  w: number,
  h: number,
  out: Rect[],
): void {
  if (entries.length === 0) return
  const [first] = entries
  if (first === undefined || entries.length === 1) {
    if (first !== undefined) out.push({ ...first, x, y, w, h })
    return
  }
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
  let acc = 0
  let cut = 1
  let bestDiff = Infinity
  for (let i = 1; i <= entries.length - 1; i += 1) {
    const entry = entries[i - 1]
    if (entry === undefined) break
    acc += entry.count
    const diff = Math.abs(acc - total / 2)
    if (diff < bestDiff) {
      bestDiff = diff
      cut = i
    }
  }
  const head = entries.slice(0, cut)
  const tail = entries.slice(cut)
  if (head.length === 0 || tail.length === 0) {
    out.push({ ...first, x, y, w, h })
    return
  }
  const headSum = head.reduce((sum, entry) => sum + entry.count, 0)
  const share = headSum / total
  if (w >= h) {
    splitTreemap(head, x, y, w * share, h, out)
    splitTreemap(tail, x + w * share, y, w * (1 - share), h, out)
  } else {
    splitTreemap(head, x, y, w, h * share, out)
    splitTreemap(tail, x, y + h * share, w, h * (1 - share), out)
  }
}

/** The treemap of tag counts: area = usage, shade = usage, label in the big blocks. */
export function TagMatrixChart({
  memos,
  size,
}: {
  memos: readonly Memo[]
  size: ChartSize
}): React.ReactElement {
  const rects = useMemo(() => {
    const stats = tagStats(memos).slice(0, 14)
    if (stats.length === 0) return []
    const w = size === 'full' ? 460 : 150
    const h = size === 'full' ? 340 : 112
    const out: Rect[] = []
    splitTreemap(
      stats.map((stat) => ({ tag: stat.tag, count: stat.count })),
      0,
      0,
      w,
      h,
      out,
    )
    return out
  }, [memos, size])

  if (rects.length === 0) return <Empty text="暂无标签" />
  const max = Math.max(...rects.map((rect) => rect.count))

  return (
    <svg
      viewBox={size === 'full' ? '0 0 460 340' : '0 0 150 112'}
      className="fl-chart-svg"
      role="img"
      aria-label="标签矩阵"
    >
      {rects.map((rect) => {
        const level = rect.count / max
        return (
          <g key={rect.tag}>
            <rect
              x={rect.x + 1}
              y={rect.y + 1}
              width={Math.max(0, rect.w - 2)}
              height={Math.max(0, rect.h - 2)}
              rx={3}
              fill={GREEN}
              opacity={0.25 + level * 0.75}
            />
            {rect.w > 42 && rect.h > 26 ? (
              <text x={rect.x + 7} y={rect.y + 17} className="fl-chart-label fl-chart-label-inverse">
                {rect.tag.length > 8 ? `${rect.tag.slice(0, 8)}…` : rect.tag}
              </text>
            ) : null}
            {rect.w > 42 && rect.h > 42 ? (
              <text x={rect.x + 7} y={rect.y + 31} className="fl-chart-label fl-chart-label-inverse fl-chart-label-faint">
                {rect.count}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/* ── 字数分布 ────────────────────────────────────────────────────────── */

/** Bucket edges for memo lengths: 0-49, 50-99, … up to an open 500+ bucket. */
const CHAR_BUCKETS = [50, 100, 150, 200, 300, 400, 500]

/** The polar histogram: one wedge per length bucket, radius = memo count. */
export function CharDistChart({
  memos,
  size,
}: {
  memos: readonly Memo[]
  size: ChartSize
}): React.ReactElement {
  const buckets = useMemo(() => {
    const counts = new Array(CHAR_BUCKETS.length + 1).fill(0)
    for (const memo of memos) {
      const length = memo.content.length
      let index = CHAR_BUCKETS.findIndex((edge) => length < edge)
      if (index < 0) index = CHAR_BUCKETS.length
      counts[index] = (counts[index] ?? 0) + 1
    }
    return counts
  }, [memos])

  const total = buckets.reduce((sum, count) => sum + count, 0)
  if (total === 0) return <Empty />

  const box = size === 'full' ? 380 : 150
  const c = box / 2
  const radius = box / 2 - (size === 'full' ? 34 : 10)
  const max = Math.max(...buckets)
  const step = (2 * Math.PI) / buckets.length

  const sector = (r0: number, r1: number, a0: number, a1: number): string => {
    const point = (r: number, a: number) => `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`
    const large = a1 - a0 > Math.PI ? 1 : 0
    return [
      `M ${point(r0, a0)}`,
      `L ${point(r1, a0)}`,
      `A ${r1} ${r1} 0 ${large} 1 ${point(r1, a1)}`,
      `L ${point(r0, a1)}`,
      `A ${r0} ${r0} 0 ${large} 0 ${point(r0, a0)}`,
      'Z',
    ].join(' ')
  }

  return (
    <svg viewBox={`0 0 ${box} ${box}`} className="fl-chart-svg" role="img" aria-label="字数分布">
      {buckets.map((count, index) => {
        const a0 = -Math.PI / 2 + index * step + step * 0.06
        const a1 = -Math.PI / 2 + (index + 1) * step - step * 0.06
        const r1 = count === 0 ? radius * 0.08 : radius * (0.16 + 0.84 * (count / max))
        return (
          <path
            key={index}
            d={sector(radius * 0.08, r1, a0, a1)}
            fill={GREEN}
            opacity={count === 0 ? 0.15 : 0.45 + 0.55 * (count / max)}
          >
            <title>{`${index === 0 ? '0' : CHAR_BUCKETS[index - 1]}–${index === CHAR_BUCKETS.length ? '+' : String(CHAR_BUCKETS[index])} 字：${count} 条`}</title>
          </path>
        )
      })}
      {size === 'full'
        ? buckets.map((_, index) => {
            const angle = -Math.PI / 2 + (index + 0.5) * step
            const from = index === 0 ? 0 : CHAR_BUCKETS[index - 1]
            return (
              <text
                key={index}
                x={c + Math.cos(angle) * (radius + 14)}
                y={c + Math.sin(angle) * (radius + 14) + 3}
                textAnchor="middle"
                className="fl-chart-label"
              >
                {from}
              </text>
            )
          })
        : null}
    </svg>
  )
}

/* ── 时间分布 ────────────────────────────────────────────────────────── */

/** The scatter of writing times: x = hour of day, y = the trailing year. */
export function TimeDistChart({
  memos,
  size,
}: {
  memos: readonly Memo[]
  size: ChartSize
}): React.ReactElement {
  const points = useMemo(() => {
    const now = Date.now()
    const yearAgo = now - 365 * 86_400_000
    const out: Array<{ x: number; y: number; count: number }> = []
    const cells = new Map<string, number>()
    for (const memo of memos) {
      const at = new Date(memo.createdAt).getTime()
      if (at < yearAgo) continue
      const date = new Date(at)
      const hour = date.getHours() + date.getMinutes() / 60
      const dayIndex = (now - at) / 86_400_000
      const key = `${Math.floor(hour)}-${Math.floor(dayIndex)}`
      cells.set(key, (cells.get(key) ?? 0) + 1)
    }
    for (const [key, count] of cells) {
      const [hour, day] = key.split('-').map(Number)
      if (hour === undefined || day === undefined) continue
      out.push({ x: hour / 24, y: day / 366, count })
    }
    return out
  }, [memos])

  if (points.length === 0) return <Empty />

  const w = size === 'full' ? 460 : 150
  const h = size === 'full' ? 300 : 112
  const pad = size === 'full' ? 16 : 2

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fl-chart-svg" role="img" aria-label="时间分布">
      {points.map((point, index) => (
        <circle
          key={index}
          cx={pad + point.x * (w - pad * 2)}
          cy={pad + point.y * (h - pad * 2)}
          r={point.count > 2 ? 2.6 : 1.7}
          fill={GREEN}
          opacity={0.25 + Math.min(point.count, 4) * 0.16}
        />
      ))}
      {size === 'full'
        ? [0, 6, 12, 18, 24].map((hour) => (
            <text
              key={hour}
              x={pad + (hour / 24) * (w - pad * 2)}
              y={h - 2}
              textAnchor="middle"
              className="fl-chart-label fl-chart-label-faint"
            >
              {hour}
            </text>
          ))
        : null}
    </svg>
  )
}

/* ── 饼状图基座 ──────────────────────────────────────────────────────── */

/** One named slice of the donut. */
interface Slice {
  label: string
  value: number
  color: string
}

/** Donut from stroked circle arcs, starting at 12 o'clock. */
function Donut({
  slices,
  size,
}: {
  slices: readonly Slice[]
  size: ChartSize
}): React.ReactElement {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  if (total === 0) return <Empty />

  const box = size === 'full' ? 220 : 110
  const r = box / 2 - (size === 'full' ? 22 : 11)
  const stroke = size === 'full' ? 26 : 15
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="fl-donut">
      <svg viewBox={`0 0 ${box} ${box}`} className="fl-chart-svg" role="img" aria-label="分布饼图">
        {slices.map((slice, index) => {
          const fraction = slice.value / total
          const dash = `${fraction * circumference} ${circumference}`
          const element = (
            <circle
              key={index}
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              stroke={slice.color}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-offset * circumference}
              transform={`rotate(-90 ${box / 2} ${box / 2})`}
            >
              <title>{`${slice.label}：${slice.value} 条`}</title>
            </circle>
          )
          offset += fraction
          return element
        })}
        {size === 'full' ? (
          <text x={box / 2} y={box / 2 + 4} textAnchor="middle" className="fl-chart-label">
            {compact(total)} 条
          </text>
        ) : null}
      </svg>
      {size === 'full' ? (
        <div className="fl-donut-legend">
          {slices.map((slice) => (
            <span key={slice.label}>
              <i style={{ background: slice.color }} />
              {slice.label} {Math.round((slice.value / total) * 100)}%
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 平台分布 — the model records no platform, and this app only writes from the web. */
export function PlatformDistChart({ size }: { size: ChartSize }): React.ReactElement {
  return (
    <Donut
      size={size}
      slices={[{ label: '网页', value: 1, color: PIE_COLORS[0] ?? GREEN }]}
    />
  )
}

/** 媒体分布 — attached-image memos against text-only ones. */
export function MediaDistChart({
  memos,
  size,
}: {
  memos: readonly Memo[]
  size: ChartSize
}): React.ReactElement {
  const withImages = memos.filter((memo) => (memo.images?.length ?? 0) > 0).length
  if (memos.length === 0) return <Empty />
  return (
    <Donut
      size={size}
      slices={[
        { label: '带图片', value: withImages, color: PIE_COLORS[3] ?? GREEN },
        { label: '纯文字', value: memos.length - withImages, color: PIE_COLORS[0] ?? GREEN },
      ]}
    />
  )
}
