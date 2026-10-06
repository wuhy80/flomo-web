/**
 * The navigation model shared by the sidebar and the app shell.
 *
 * @module @flomo/ui/views
 */

/** Which panel the main column is showing. */
export type FlomoView =
  /** The full reverse-chronological feed. */
  | { kind: 'all' }
  /** The feed filtered to one tag. */
  | { kind: 'tag'; tag: string }
  /** A handful of older notes, stable for the whole day. */
  | { kind: 'review' }
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
  return true
}

/**
 * A short human label for a view, used as the main column's title.
 * @param view - the view.
 * @returns the label.
 */
export function viewTitle(view: FlomoView): string {
  switch (view.kind) {
    case 'all':
      return '全部记录'
    case 'tag':
      return `#${view.tag}`
    case 'review':
      return '每日回顾'
    case 'random':
      return '随机漫步'
    case 'settings':
      return '设置'
  }
}
