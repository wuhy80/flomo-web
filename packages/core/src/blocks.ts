/**
 * Block structure: headings, paragraphs, lists, tasks, quotes, tables, rules
 * and fenced code — the block half of Markdown, plus flomo's own marks.
 *
 * flomo's body is mostly prose, but a notes app that cannot hold a snippet of
 * code or a checklist is missing something real. Blocks are the smallest
 * structure that makes that work without turning the editor into a rich-text
 * one.
 *
 * This module exists for a correctness reason as much as a rendering one. Tags
 * and links are extracted from the body, and a fenced block is **not prose**:
 * the `#include` in
 *
 * ~~~text
 * ```c
 * #include <stdio.h>
 * ```
 * ~~~
 *
 * is a preprocessor directive, not a tag, and `[[x]]` inside a snippet is bracket
 * syntax rather than a link. So the tag index, the link resolver and the renderer
 * all read the *same* block structure, exactly as they already shared one
 * tokenizer.
 *
 * @module @flomo/core/blocks
 */

/** Cell alignment of a table column; null when the separator did not ask for one. */
export type TableAlign = 'left' | 'center' | 'right' | null

/** One entry of a list, possibly a task. */
export interface ListItem {
  /** The item's inline content. */
  text: string
  /** null when the item is not a task; otherwise whether its box is ticked. */
  task: boolean | null
}

/** One structural run of a memo body. */
export type Block =
  /** Ordinary prose; inline marks may span newlines. */
  | { type: 'paragraph'; text: string }
  /** A run of `>` lines, with the markers stripped. */
  | { type: 'quote'; text: string }
  /** A fenced block. `{{language}}` is the info string, possibly empty. */
  | { type: 'code'; language: string; code: string }
  /** An ATX heading, `#` through `######`. */
  | { type: 'heading'; level: number; text: string }
  /** A horizontal rule. */
  | { type: 'hr' }
  /** A run of list lines of one flavour; nesting is flattened. */
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  /** A pipe table. Rows are padded to the header's width. */
  | { type: 'table'; head: string[]; rows: string[][]; align: TableAlign[] }

/** A line that opens or closes a fence, capturing the info string. */
const FENCE = /^```(.*)$/

/** A quoted line, capturing everything after the optional space. */
const QUOTE = /^>\s?(.*)$/

/** An ATX heading, allowing optional closing hashes. */
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/

/** A horizontal rule: three or more of one marker, spaces allowed. */
const HR = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/

/** One list line: the marker, then the content. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/

/** A task box at the head of a list item's content. */
const TASK = /^\[([ xX])\]\s+(.*)$/

/** A pipe-delimited row. */
const TABLE_ROW = /^\s*\|.*\|\s*$/

/**
 * Parse one table row into trimmed cells.
 * @param line - the raw line.
 * @returns the cells, without the outer pipes.
 */
function splitTableRow(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  return body.split('|').map((cell) => cell.trim())
}

/**
 * Whether a row is a table separator: every cell dashes with optional colons.
 * @param line - the raw line.
 * @returns true when the row can sit under a header row.
 */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|')) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

/**
 * The alignment one separator cell asks for.
 * @param cell - the separator cell.
 * @returns left, center, right, or null for plain dashes.
 */
function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

/**
 * Split a memo body into blocks.
 *
 * Unterminated fences run to the end of the body rather than being discarded:
 * a user mid-keystroke has an open fence, and eating their text would be a far
 * worse failure than displaying an unclosed block.
 * @param content - the raw body.
 * @returns the blocks, in order.
 */
export function parseBlocks(content: string): Block[] {
  const lines = content.split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let quote: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }
  const flushQuote = (): void => {
    if (quote.length === 0) return
    blocks.push({ type: 'quote', text: quote.join('\n') })
    quote = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    const fence = FENCE.exec(line)
    if (fence !== null) {
      flushParagraph()
      flushQuote()
      const language = (fence[1] ?? '').trim()
      const code: string[] = []
      index += 1
      for (; index < lines.length; index += 1) {
        const inner = lines[index] ?? ''
        if (FENCE.test(inner)) break
        code.push(inner)
      }
      blocks.push({ type: 'code', language, code: code.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      flushParagraph()
      flushQuote()
      blocks.push({ type: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      continue
    }

    if (HR.test(line)) {
      flushParagraph()
      flushQuote()
      blocks.push({ type: 'hr' })
      continue
    }

    if (TABLE_ROW.test(line) && isTableSeparator(lines[index + 1] ?? '')) {
      flushParagraph()
      flushQuote()
      const head = splitTableRow(line)
      const separators = splitTableRow(lines[index + 1] ?? '')
      const align = head.map((_, column) => alignOf(separators[column] ?? '---'))
      const rows: string[][] = []
      index += 2
      for (; index < lines.length; index += 1) {
        if (!TABLE_ROW.test(lines[index] ?? '')) break
        const cells = splitTableRow(lines[index] ?? '')
        rows.push(head.map((_, column) => cells[column] ?? ''))
      }
      blocks.push({ type: 'table', head, rows, align })
      index -= 1
      continue
    }

    const quoted = QUOTE.exec(line)
    if (quoted !== null) {
      flushParagraph()
      quote.push(quoted[1] ?? '')
      continue
    }

    const listed = LIST_ITEM.exec(line)
    if (listed !== null) {
      flushParagraph()
      flushQuote()
      const ordered = /\d/.test(listed[1] ?? '')
      const items: ListItem[] = []
      for (; index < lines.length; index += 1) {
        const next = LIST_ITEM.exec(lines[index] ?? '')
        // A list ends at anything that is not another line of the same flavour:
        // switching between bullets and numbers opens a second list.
        if (next === null) break
        if (items.length > 0 && /\d/.test(next[1] ?? '') !== ordered) break
        const raw = next[2] ?? ''
        const task = TASK.exec(raw)
        items.push(
          task !== null
            ? { text: task[2] ?? '', task: (task[1] ?? ' ').toLowerCase() === 'x' }
            : { text: raw, task: null },
        )
      }
      index -= 1
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushQuote()
      continue
    }

    flushQuote()
    paragraph.push(line)
  }

  flushParagraph()
  flushQuote()
  return blocks
}

/**
 * The body's prose, with fenced blocks removed.
 *
 * This is the input every inline-markup reader should use: what a tag or link
 * means in code is nothing. The text of headings, lists and tables *is* prose —
 * a `#tag` in a heading indexes like one in a paragraph.
 * @param content - the raw body.
 * @returns the prose lines joined by newlines.
 */
export function proseText(content: string): string {
  return parseBlocks(content)
    .flatMap((block) => {
      switch (block.type) {
        case 'code':
          return []
        case 'hr':
          return []
        case 'table':
          return [block.head.join(' | '), ...block.rows.map((row) => row.join(' | '))]
        case 'list':
          return block.items.map((item) => item.text)
        default:
          return [block.text]
      }
    })
    .join('\n')
}

/**
 * Whether an offset falls inside an open fence.
 *
 * Used to keep `#` completion out of code, so the field never offers a tag the
 * parser would refuse to record.
 * @param content - the field's value.
 * @param offset - the caret position.
 * @returns true when the caret sits inside code.
 */
export function isInsideFence(content: string, offset: number): boolean {
  const clamped = Math.max(0, Math.min(offset, content.length))
  let open = false
  for (const line of content.slice(0, clamped).split('\n')) {
    if (FENCE.test(line)) open = !open
  }
  return open
}
