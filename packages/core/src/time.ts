/**
 * Pure date helpers shared by the web app and the DSH plugin.
 *
 * Sharding keys and feed grouping must agree across both surfaces, so they live
 * here rather than in either UI.
 *
 * @module @flomo/core/time
 */

/**
 * The `YYYY-MM` shard key a timestamp belongs to, in local time.
 * @param iso - an ISO-8601 timestamp, or a `Date`.
 * @returns the month key.
 */
export function monthOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * The `YYYY-MM-DD` day key a timestamp belongs to, in local time.
 * @param iso - an ISO-8601 timestamp, or a `Date`.
 * @returns the day key.
 */
export function dayOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Enumerate the `YYYY-MM` keys spanning the last `count` months, newest first.
 * @param count - how many months to include.
 * @param from - reference instant, defaulting to now.
 * @returns month keys in descending order.
 */
export function recentMonths(count: number, from: Date = new Date()): string[] {
  const out: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let i = 0; i < count; i += 1) {
    out.push(monthOf(cursor))
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return out
}

/** Weekday names, indexed by `Date#getDay`. */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/**
 * Split a `YYYY-MM-DD` key into finite numbers.
 *
 * The finiteness check is the one that matters: a malformed key parses to `NaN`,
 * not to `undefined`, so a guard written as an undefined check can never fire for
 * the case it names and the caller gets `NaN年NaN月NaN日` back. Both are needed
 * because only the undefined check narrows the types.
 * @param dayKey - the key.
 * @returns the parts, or `null` when the key is not a date.
 */
function partsOf(dayKey: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = dayKey.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) return null
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  return { y, m, d }
}

/**
 * Human-readable Chinese label for a day, used as a feed group header.
 * @param dayKey - a `YYYY-MM-DD` key.
 * @param today - reference instant, defaulting to now.
 * @returns a label such as `今天`, `昨天`, or `3月14日 周五`.
 */
export function dayLabel(dayKey: string, today: Date = new Date()): string {
  const todayKey = dayOf(today)
  if (dayKey === todayKey) return '今天'

  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (dayKey === dayOf(yesterday)) return '昨天'

  const parts = partsOf(dayKey)
  if (parts === null) return dayKey
  const { y, m, d } = parts
  const date = new Date(y, m - 1, d)
  const weekday = WEEKDAYS[date.getDay()] ?? ''
  if (y === today.getFullYear()) return `${m}月${d}日 ${weekday}`
  return `${y}年${m}月${d}日`
}

/**
 * Fully-qualified label for a day, with no reference to today.
 *
 * Used by exports, where "今天" would be meaningless the moment the file is
 * read back.
 * @param dayKey - a `YYYY-MM-DD` key.
 * @returns a label such as `2026年10月6日 周二`.
 */
export function absoluteDayLabel(dayKey: string): string {
  const parts = partsOf(dayKey)
  if (parts === null) return dayKey
  const { y, m, d } = parts
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()] ?? ''
  return `${y}年${m}月${d}日 ${weekday}`
}

/**
 * Local-time stamp suitable for a filename: `YYYY-MM-DD-HHmm`.
 * @param at - the instant to stamp.
 * @returns the stamp.
 */
export function fileStamp(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`
  )
}

/**
 * Clock time `HH:mm` for a timestamp, shown beside each memo.
 * @param iso - an ISO-8601 timestamp.
 * @returns the two-digit hour and minute.
 */
export function clockOf(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
