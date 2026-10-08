/**
 * The format toolbar's text transforms, shared by the capture box and the memo
 * editor.
 *
 * Pure logic, no JSX: they read the live textarea and hand the next value plus
 * caret to a `commit` callback, so each host keeps its own state and resize
 * story. The buttons live in {@link module:@flomo/ui/FormatTools}.
 *
 * The Enter continuation ({@linkcode continueListOnEnter}) serves the same
 * hosts from the keydown handler: a list line that gets an Enter keeps its
 * flavour on the next line, so `*`, `1.` and task boxes never have to be
 * retyped per line.
 *
 * @module @flomo/ui/format-tools
 */

import { isInsideFence } from '@flomo/core'

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

/** The next value and caret a keypress should commit. */
export interface KeyEdit {
  value: string
  caret: number
}

/**
 * A list line's prefix: the indent, a bullet or a number, one space, and for
 * tasks the box. The box is captured separately so a continuation can restart
 * it unticked while the exit case can strip it whole.
 */
const LIST_PREFIX = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(\[[ xX]\][ \t]+)?/

/**
 * What Enter on a list line should do, or null when Enter stays plain.
 *
 * A line carrying a list marker passes the marker on: the same bullet, the
 * next number, or a fresh unticked box — always with the line's own indent, so
 * a nested `1.` under a `*` item continues as `2.` at the same depth. An item
 * that holds nothing but its marker ends the list instead, dropping the marker
 * the way every list editor does. Inside a fenced block Enter is never touched.
 *
 * The caret may sit mid-line; text after it rides down to the new item, which
 * is the split every Markdown field performs.
 * @param value - the field's value.
 * @param caret - the collapsed caret offset.
 * @returns the continued value and caret, or null for a plain newline.
 */
export function continueListOnEnter(value: string, caret: number): KeyEdit | null {
  if (isInsideFence(value, caret)) return null
  const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
  const prefix = LIST_PREFIX.exec(value.slice(lineStart, caret))
  if (prefix === null) return null
  const markerEnd = lineStart + prefix[0].length
  const indent = prefix[1] ?? ''
  const box = prefix[5]
  const tail = value.slice(markerEnd, caret)
  const lineEnd = value.indexOf('\n', caret)
  const restOfLine = lineEnd === -1 ? value.slice(caret) : value.slice(caret, lineEnd)

  // Nothing but the marker before the caret and nothing after it: the item is
  // empty, so Enter retires the marker rather than stacking a new one. An
  // untouched task box counts as empty too — otherwise a checklist could never
  // be left with Enter alone. The line itself stays on as the empty line the
  // caret now sits on; only the marker (and its trailing spaces) goes.
  if (tail.trim() === '' && restOfLine.trim() === '') {
    return {
      value: value.slice(0, lineStart) + (lineEnd === -1 ? '' : value.slice(lineEnd)),
      caret: lineStart,
    }
  }

  const freshBox = box !== undefined ? '[ ] ' : ''
  let marker: string
  if (prefix[2] !== undefined) {
    marker = `${prefix[2]} ${freshBox}`
  } else {
    marker = `${Number.parseInt(prefix[3] ?? '1', 10) + 1}${prefix[4] ?? '.'} ${freshBox}`
  }
  const insert = `\n${indent}${marker}`
  return {
    value: value.slice(0, caret) + insert + value.slice(caret),
    caret: caret + insert.length,
  }
}

