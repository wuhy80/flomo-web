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
  /** The memos a `[[link]]` resolves to. */
  | { kind: 'link'; target: string }
  /** One memo in full, with its outgoing links and its backlinks. */
  | { kind: 'focus'; id: string }
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
    case 'all':
      return '全部记录'
    case 'tag':
      return `#${view.tag}`
    case 'link':
      return `[[${view.target}]]`
    case 'focus':
      return '单条笔记'
    case 'review':
      return '每日回顾'
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
  return view.kind === 'all' || view.kind === 'tag' || view.kind === 'link'
}
