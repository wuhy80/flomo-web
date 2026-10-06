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

  const [y, m, d] = dayKey.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) return dayKey
  const date = new Date(y, m - 1, d)
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] ?? ''
  if (y === today.getFullYear()) return `${m}月${d}日 ${weekday}`
  return `${y}年${m}月${d}日`
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
