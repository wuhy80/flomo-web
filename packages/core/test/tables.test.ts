/**
 * Table editing helpers: caret-to-range lookups and grid serialization.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isInsideFence, parseBlocks, stringifyTable, tableRangeAt } from '../src/index.ts'

describe('tableRangeAt', () => {
  const TABLE = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 梨 | 8 |'

  it('finds the table from every line inside it', () => {
    const lines = TABLE.split('\n')
    for (let line = 0; line < lines.length; line += 1) {
      const offset = lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + 1
      assert.deepEqual(tableRangeAt(TABLE, offset), { startLine: 0, endLine: 3 }, `line ${line}`)
    }
  })

  it('accepts a caret parked on a trailing newline of a body row', () => {
    const offset = TABLE.indexOf('\n', TABLE.indexOf('| 梨 |')) + 1
    assert.deepEqual(tableRangeAt(TABLE, offset), { startLine: 0, endLine: 3 })
  })

  it('returns null outside the table', () => {
    const before = `前言一段。\n${TABLE}`
    assert.equal(tableRangeAt(before, 2), null)
    const after = `${TABLE}\n表格之后的一句话。`
    const tail = after.indexOf('表格之后')
    assert.equal(tableRangeAt(after, tail), null)
  })

  it('returns null on an empty final line after the table', () => {
    assert.equal(tableRangeAt(`${TABLE}\n`, TABLE.length + 1), null)
  })

  it('refuses a lone pipe run without a separator', () => {
    const notATable = '| 只是 | 一段 |\n| 普通文字 | 而已 |'
    assert.equal(tableRangeAt(notATable, 4), null)
  })

  it('refuses a caret inside a fence that contains pipes', () => {
    const fenced = '```\n| a | b |\n| --- | --- |\n```\n之后'
    assert.equal(tableRangeAt(fenced, fenced.indexOf('| a |')), null)
    assert.equal(isInsideFence(fenced, fenced.indexOf('| a |')), true)
  })

  it('picks the right table when two sit back to back', () => {
    const first = '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |'
    const second = '| 丙 | 丁 |\n| :---: | ---: |\n| 3 | 4 |'
    const both = `${first}\n\n${second}`
    const seam = both.indexOf('| 丙 |')
    assert.deepEqual(tableRangeAt(both, seam + 2), { startLine: 4, endLine: 6 })
    assert.deepEqual(tableRangeAt(both, 2), { startLine: 0, endLine: 2 })
  })

  it('covers a header-only table', () => {
    const headerOnly = '| 名称 | 数量 |\n| --- | --- |'
    assert.deepEqual(tableRangeAt(headerOnly, 3), { startLine: 0, endLine: 1 })
  })
})

describe('stringifyTable', () => {
  it('round-trips through the block parser', () => {
    const source = stringifyTable(['名称', '数量'], [['苹果', '3'], ['梨', '8']])
    const blocks = parseBlocks(source)
    assert.equal(blocks.length, 1)
    const table = blocks[0]
    assert.ok(table !== undefined && table.type === 'table')
    if (table === undefined || table.type !== 'table') return
    assert.deepEqual(table.head, ['名称', '数量'])
    assert.deepEqual(table.rows, [['苹果', '3'], ['梨', '8']])
  })

  it('keeps alignment markers', () => {
    const source = stringifyTable(['左', '中', '右'], [['1', '2', '3']], ['left', 'center', 'right'])
    const lines = source.split('\n')
    assert.equal(lines[0], '| 左  | 中  | 右  |')
    assert.equal(lines[1], '| :-- | :-: | --: |')
  })

  it('pads cells so pipes line up across rows', () => {
    const source = stringifyTable(['项目', '金额'], [['书', '12'], ['文具盒', '7.5']])
    const lines = source.split('\n')
    // Pipes align in *display* columns: a CJK cell pads with fewer literal
    // spaces than a Latin one, so raw string offsets would falsely differ.
    const visualPipes = (line: string): number[] => {
      const at: number[] = []
      let column = 0
      for (const char of line) {
        if (char === '|') at.push(column)
        column += /[\u1100-\u115f\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(char)
          ? 2
          : 1
      }
      return at
    }
    const first = visualPipes(lines[0] ?? '')
    assert.ok(first.length >= 3, 'three pipes per row')
    for (const line of lines) {
      assert.deepEqual(visualPipes(line), first, 'pipes align in display columns')
    }
  })

  it('replaces bare pipes in a cell with the fullwidth mark', () => {
    const source = stringifyTable(['a|b'], [['c']])
    const blocks = parseBlocks(source)
    const table = blocks[0]
    assert.ok(table !== undefined && table.type === 'table')
    if (table === undefined || table.type !== 'table') return
    assert.deepEqual(table.head, ['a｜b'])
    assert.deepEqual(table.rows, [['c']])
  })

  it('pads short rows to the header width and survives no rows', () => {
    const padded = stringifyTable(['一', '二', '三'], [['只', '有两', '格'], ['缺格']])
    const blocks = parseBlocks(padded)
    const table = blocks[0]
    assert.ok(table !== undefined && table.type === 'table')
    if (table === undefined || table.type !== 'table') return
    assert.deepEqual(table.rows, [['只', '有两', '格'], ['缺格', '', '']])

    const headerOnly = stringifyTable(['列一', '列二'], [])
    assert.match(headerOnly, /^\| 列一 | 列二 \|$/m)
    assert.match(headerOnly, /^\| ---- | ---- \|$/m)
    assert.equal(headerOnly.split('\n').length, 2)
  })
})
