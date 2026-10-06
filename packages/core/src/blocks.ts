/**
 * Block structure: fenced code, block quotes, and paragraphs.
 *
 * flomo's body is mostly prose, but a notes app that cannot hold a snippet of
 * code is missing something real. Blocks are the smallest structure that makes
 * that work without turning the editor into a rich-text one.
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

/** One structural run of a memo body. */
export type Block =
  /** Ordinary prose; `**` may contain newlines. */
  | { type: 'paragraph'; text: string }
  /** A run of `>` lines, with the markers stripped. */
  | { type: 'quote'; text: string }
  /** A fenced block. `{{language}}` is the info string, possibly empty. */
  | { type: 'code'; language: string; code: string }

/** A line that opens or closes a fence, capturing the info string. */
const FENCE = /^```(.*)$/

/** A quoted line, capturing everything after the optional space. */
const QUOTE = /^>\s?(.*)$/

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

    const quoted = QUOTE.exec(line)
    if (quoted !== null) {
      flushParagraph()
      quote.push(quoted[1] ?? '')
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
 * means in code is nothing.
 * @param content - the raw body.
 * @returns the prose blocks joined by newlines.
 */
export function proseText(content: string): string {
  return parseBlocks(content)
    .filter((block) => block.type !== 'code')
    .map((block) => block.text)
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
