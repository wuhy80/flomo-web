/**
 * Table editing helpers: the caret's table in the raw body, and a table grid
 * back to source.
 *
 * The renderer already turns a pipe table into `head`/`rows`/`align` through
 * {@link parseBlocks}; editing is the same journey backwards. A grid dialog
 * reads the lines the caret sits in and writes them back serialized, so the
 * user never has to count pipes — and the serialized form pads cells so the
 * source itself stays a readable grid, the way Obsidian's table helpers keep
 * their tables tidy.
 *
 * @module @flomo/core/tables
 */

import { isInsideFence } from './blocks.ts'
import type { TableAlign } from './blocks.ts'

export type { TableAlign }

/** The line span of one table in the raw body, both ends inclusive, from zero. */
export interface TableRange {
  /** The header row's line. */
  startLine: number
  /** The last body row's line. */
  endLine: number
}

/** A pipe-delimited row; the same shape the block parser matches. */
const TABLE_ROW = /^\s*\|.*\|\s*$/

/**
 * The table the caret sits in, or null when it sits elsewhere.
 *
 * A table is a run of pipe lines whose second line is the dash separator — the
 * exact grammar the block parser reads, so a range returned here always parses
 * back as one table. A caret inside a fenced block never counts, and a lone
 * pipe row (which renders as plain text) is not a table either.
 * @param content - the field's value.
 * @param offset - the caret position.
 * @returns the covering line range, or null.
 */
export function tableRangeAt(content: string, offset: number): TableRange | null {
  const clamped = Math.max(0, Math.min(offset, content.length))
  if (isInsideFence(content, clamped)) return null
  const lines = content.split('\n')

  // The line the offset belongs to: an offset on a trailing newline belongs to
  // the line it terminates, and an offset at the very end of the body sits on
  // the final line even when that line is empty.
  let caretLine = 0
  let rest = clamped
  while (caretLine < lines.length - 1) {
    const lineLength = (lines[caretLine] ?? '').length + 1
    if (rest < lineLength) break
    rest -= lineLength
    caretLine += 1
  }

  const isRow = (line: string | undefined): boolean => line !== undefined && TABLE_ROW.test(line)
  if (!isRow(lines[caretLine])) return null
  let startLine = caretLine
  while (startLine > 0 && isRow(lines[startLine - 1])) startLine -= 1
  let endLine = caretLine
  while (endLine + 1 < lines.length && isRow(lines[endLine + 1])) endLine += 1

  if (endLine - startLine < 1 || !isTableSeparator(lines[startLine + 1] ?? '')) return null
  return { startLine, endLine }
}

/**
 * Whether a pipe row is the dash separator under a header; shared grammar with
 * the block parser's own check.
 * @param line - one raw line.
 * @returns true when the line is a separator row.
 */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|')) return false
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  const cells = body.split('|').map((cell) => cell.trim())
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

/** A cell made safe for the pipe grammar: no newlines, no bare pipes. */
function sanitizeCell(cell: string): string {
  return cell.replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '｜')
}

/** A row trimmed and padded to the header's width, cells sanitized. */
function sanitizeRow(row: readonly string[], columns: number): string[] {
  return Array.from({ length: columns }, (_, column) => sanitizeCell(row[column] ?? '').trim())
}

/**
 * The display width of one cell: CJK and fullwidth marks occupy two columns,
 * everything else one — enough for tidy pipes in the text this app writes,
 * without pulling in a grapheme table.
 * @param text - the cell text.
 * @returns the terminal-style width.
 */
function visualWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    width += wide ? 2 : 1
  }
  return width
}

/**
 * One separator cell of the requested alignment, padded to the column width.
 * @param align - the column's alignment, or null for plain dashes.
 * @param width - the column's padded width, at least three.
 * @returns the separator cell, colons marking the alignment.
 */
function separatorCell(align: TableAlign, width: number): string {
  if (align === 'left') return `:${'-'.repeat(width - 1)}`
  if (align === 'right') return `${'-'.repeat(width - 1)}:`
  if (align === 'center') return `:${'-'.repeat(width - 2)}:`
  return '-'.repeat(width)
}

/**
 * Serialize a table grid back to pipe text.
 *
 * Cells are padded so every pipe lines up vertically in the source — a table
 * that reads as a grid even as plain text. A pipe typed into a cell becomes
 * the fullwidth `｜`, because the parser has no escaped-pipe grammar and a
 * bare pipe would tear the row apart. Short rows are padded to the header's
 * width, matching what the renderer shows.
 * @param head - the header cells.
 * @param rows - the body rows.
 * @param align - per-column alignment; missing entries render plain dashes.
 * @returns the multi-line table, ready to splice into a body.
 */
export function stringifyTable(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly TableAlign[] = [],
): string {
  const columns = Math.max(1, head.length)
  const safeHead = sanitizeRow(head, columns)
  const safeRows = rows.map((row) => sanitizeRow(row, columns))
  const widths = Array.from({ length: columns }, (_, column) => {
    const widest = Math.max(
      visualWidth(safeHead[column] ?? ''),
      ...safeRows.map((row) => visualWidth(row[column] ?? '')),
    )
    return Math.max(3, widest)
  })
  const aligns = Array.from({ length: columns }, (_, column) => align[column] ?? null)

  const line = (cells: readonly string[]): string =>
    `| ${cells
      .map((cell, column) => {
        const width = widths[column] ?? 3
        return cell + ' '.repeat(width - visualWidth(cell))
      })
      .join(' | ')} |`
  const separator = `| ${aligns
    .map((one, column) => separatorCell(one, widths[column] ?? 3))
    .join(' | ')} |`

  return [line(safeHead), separator, ...safeRows.map((row) => line(row))].join('\n')
}
