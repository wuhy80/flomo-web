/**
 * The format toolbar's text transforms, shared by the capture box and the memo
 * editor.
 *
 * Pure logic, no JSX: they read the live textarea and hand the next value plus
 * caret to a `commit` callback, so each host keeps its own state and resize
 * story. The buttons live in {@link module:@flomo/ui/FormatTools}.
 *
 * @module @flomo/ui/format-tools
 */

/** One list flavour the toolbar toggles. */
export type ListKind = 'ul' | 'ol' | 'task'

/** The text transforms, bound to one textarea. */
export interface FormatTools {
  /** Drop a `#` at the caret; opens tag completion where one exists. */
  insertTagStart(): void
  /** Replace the selection with `text`, parking the caret `caretOffset` in. */
  insertTemplate(text: string, caretOffset: number): void
  /** Toggle a list marker of `kind` over the selected lines. */
  toggleList(kind: ListKind): void
  /** Wrap (or unwrap) the current selection with an inline format pair. */
  wrapSelection(before: string, after: string): void
}

/**
 * Bind the transforms to a textarea.
 * @param getEl - the live textarea, or null when unmounted.
 * @param commit - receives the next value and caret; the host applies them.
 * @returns the bound transforms.
 */
export function createFormatTools(
  getEl: () => HTMLTextAreaElement | null,
  commit: (next: string, caret: number) => void,
): FormatTools {
  /** Re-line a run of lines, ending with the caret after the rewritten run. */
  const editLines = (transform: (line: string, index: number, all: string[]) => string): void => {
    const el = getEl()
    if (!el) return
    const { value: current, selectionStart, selectionEnd } = el
    const start = current.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
    const after = current.indexOf('\n', selectionEnd)
    const end = after === -1 ? current.length : after
    const run = current.slice(start, end)
    const rewritten = run.split('\n').map(transform).join('\n')
    if (rewritten === run) return
    commit(current.slice(0, start) + rewritten + current.slice(end), start + rewritten.length)
  }

  return {
    insertTagStart(): void {
      const el = getEl()
      if (!el) return
      const caret = el.selectionStart ?? el.value.length
      commit(`${el.value.slice(0, caret)}#${el.value.slice(caret)}`, caret + 1)
    },

    insertTemplate(text: string, caretOffset: number): void {
      const el = getEl()
      if (!el) return
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? start
      commit(`${el.value.slice(0, start)}${text}${el.value.slice(end)}`, start + caretOffset)
    },

    toggleList(kind: ListKind): void {
      const marker =
        kind === 'ul'
          ? /^ {0,3}[-*+]\s+/
          : kind === 'ol'
            ? /^ {0,3}\d{1,9}[.)]\s+/
            : /^ {0,3}[-*+]\s+\[[ xX]\]\s+/
      editLines((line, index, all) => {
        const marked = all.filter((candidate) => candidate.trim() !== '')
        if (marked.length > 0 && marked.every((candidate) => marker.test(candidate))) {
          const stripped = line.replace(marker, '')
          return kind === 'ul' ? stripped.replace(/^\[[ xX]\]\s+/, '') : stripped
        }
        if (line.trim() === '') return line
        if (kind === 'ul') return `- ${line.replace(/^ {0,3}[-*+]\s+\[[ xX]\]\s+/, '')}`
        if (kind === 'ol') return `${index + 1}. ${line}`
        const bullet = /^ {0,3}[-*+]\s+/.exec(line)
        return bullet === null ? `- [ ] ${line}` : `- [ ] ${line.slice(bullet[0].length)}`
      })
    },

    wrapSelection(before: string, after: string): void {
      const el = getEl()
      if (!el) return
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const current = el.value
      const selected = current.slice(start, end)
      const pre = current.slice(start - before.length, start)
      const post = current.slice(end, end + after.length)
      // Two shapes count as already-wrapped: the markers sit just outside the
      // selection, or the user selected them together with the word. Either way
      // the toggle strips them instead of stacking another pair.
      const wrappedOutside = selected.length > 0 && pre === before && post === after
      const wrappedInside =
        selected.length >= before.length + after.length &&
        selected.startsWith(before) &&
        selected.endsWith(after)
      if (wrappedOutside) {
        commit(
          current.slice(0, start - before.length) + selected + current.slice(end + after.length),
          start - before.length + selected.length,
        )
      } else if (wrappedInside) {
        const inner = selected.slice(before.length, selected.length - after.length)
        commit(current.slice(0, start) + inner + current.slice(end), start + inner.length)
      } else {
        commit(
          current.slice(0, start) + before + selected + after + current.slice(end),
          start + before.length + selected.length,
        )
      }
    },
  }
}

