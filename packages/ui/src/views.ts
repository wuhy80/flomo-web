/**
 * The navigation model shared by the sidebar and the app shell.
 *
 * @module @flomo/ui/views
 */

import { absoluteDayLabel } from '@flomo/core'

/**
 * The tag of one day's diary, `2026-10-08` becoming `日记/2026/10/08`.
 *
 * The 日记 button jumps to this tag's view; the memo carrying it is the day's
 * diary, created on first visit — one per day, findable again through the tag
 * tree like any other nested tag.
 * @param day - a `YYYY-MM-DD` day key, as `dayOf` produces.
 * @returns the diary tag without its leading `#`.
 */
export function diaryTagOf(day: string): string {
  return `日记/${day.split('-').join('/')}`
}

/** Which panel the main column is showing. */
export type FlomoView =
  /** The standalone TODO checklist. */
  | { kind: 'todo' }
  /** The full reverse-chronological feed. */
  | { kind: 'all' }
  /** The feed filtered to one tag. */
  | { kind: 'tag'; tag: string }
  /** The feed filtered to one calendar day. */
  | { kind: 'day'; day: string }
  /** The memos a `[[link]]` resolves to. */
  | { kind: 'link'; target: string }
  /** One memo in full, with its outgoing links and its backlinks. */
  | { kind: 'focus'; id: string }
  /** A handful of older notes, stable for the whole day. */
  | { kind: 'review' }
  /** AI 洞察: send a scope of notes to the configured AI provider. */
  | { kind: 'insight' }
  /** The full-page heatmap for a whole year. */
  | { kind: 'heatmap' }
  /** One note at a time, drawn at random. */
  | { kind: 'random' }
  /** Repository and vault settings. */
  | { kind: 'settings' }

/**
 * Whether two views are the same destination.
 * @param a - first view.
 * @param b - second view.
 * @returns true when they address the same panel.
 */
export function sameView(a: FlomoView, b: FlomoView): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag
  if (a.kind === 'day' && b.kind === 'day') return a.day === b.day
  if (a.kind === 'link' && b.kind === 'link') return a.target === b.target
  if (a.kind === 'focus' && b.kind === 'focus') return a.id === b.id
  return true
}

/**
 * A short human label for a view, used as the main column's title.
 * @param view - the view.
 * @returns the label.
 */
export function viewTitle(view: FlomoView): string {
  switch (view.kind) {
    case 'todo':
      return 'TODO'
    case 'all':
      return '全部笔记'
    case 'tag':
      return `#${view.tag}`
    case 'day':
      return absoluteDayLabel(view.day)
    case 'link':
      return `[[${view.target}]]`
    case 'focus':
      return '单条笔记'
    case 'review':
      return '每日回顾'
    case 'insight':
      return 'AI 洞察'
    case 'heatmap':
      return '记录统计'
    case 'random':
      return '随机漫步'
    case 'settings':
      return '设置'
  }
}

/**
 * Whether a view shows the capture box.
 *
 * Writing is a feed activity: it makes no sense to offer the composer over a
 * single memo's detail page or over the settings form.
 * @param view - the view.
 * @returns true when the composer belongs on this panel.
 */
export function showsComposer(view: FlomoView): boolean {
  return (
    view.kind === 'all' ||
    view.kind === 'tag' ||
    view.kind === 'day' ||
    view.kind === 'link'
  )
}

/**
 * Encode one view as the value of the `view` hash parameter — the address bar
 * form of the navigation model, so `#view=todo` is a bookmarkable address.
 *
 * Payloads (tag paths, memo ids) ride after a colon and are percent-encoded,
 * matching the `#memo=` deep link that already shares this hash.
 * @param view - the view to encode.
 * @returns the parameter value, or null when the view kind has no address.
 */
export function encodeViewParam(view: FlomoView): string | null {
  switch (view.kind) {
    case 'todo':
    case 'all':
    case 'review':
    case 'insight':
    case 'heatmap':
    case 'random':
    case 'settings':
      return view.kind
    case 'tag':
      return `tag:${encodeURIComponent(view.tag)}`
    case 'day':
      return `day:${view.day}`
    case 'link':
      return `link:${encodeURIComponent(view.target)}`
    case 'focus':
      return `focus:${encodeURIComponent(view.id)}`
  }
}

/**
 * Decode a `view` hash parameter back into a view — the inverse of
 * {@linkcode encodeViewParam}.
 *
 * `URLSearchParams` undoes only its own transport encoding, and the hash can
 * come from two places: this app (payload percent-encoded by
 * {@linkcode encodeViewParam}) or a hand-typed address (payload raw). A
 * decode that tolerates both reads '开发环境' and '%E5%BC%80...' alike, and
 * a malformed escape refuses the value instead of throwing.
 * @param value - the raw parameter value, or null when the hash lacked one.
 * @returns the view, or null when the value addresses nothing recognizable.
 */
export function decodeViewParam(value: string | null): FlomoView | null {
  if (value === null) return null
  const colon = value.indexOf(':')
  const kind = colon === -1 ? value : value.slice(0, colon)
  const payload = colon === -1 ? '' : value.slice(colon + 1)
  let decoded = payload
  if (payload !== '') {
    try {
      decoded = decodeURIComponent(payload)
    } catch {
      return null // a malformed escape addresses nothing recognizable
    }
  }
  switch (kind) {
    case 'todo':
    case 'all':
    case 'review':
    case 'insight':
    case 'heatmap':
    case 'random':
    case 'settings':
      return { kind } as FlomoView
    case 'tag':
      return decoded === '' ? null : { kind: 'tag', tag: decoded }
    case 'day':
      return /^\d{4}-\d{2}-\d{2}$/.test(payload) ? { kind: 'day', day: payload } : null
    case 'link':
      return decoded === '' ? null : { kind: 'link', target: decoded }
    case 'focus':
      return decoded === '' ? null : { kind: 'focus', id: decoded }
    default:
      return null
  }
}
