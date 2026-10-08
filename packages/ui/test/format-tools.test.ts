/**
 * Unit tests for the shared format-tool transforms.
 *
 * The textarea is faked as a plain object — the transforms only read
 * `value`/`selectionStart`/`selectionEnd` and hand the next value plus caret to
 * `commit`, so the interesting logic (wrap toggling, list toggling, template
 * insertion) runs without a DOM.
 *
 * @module flomo-ui/test/format-tools
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { continueListOnEnter, createFormatTools, flipTaskLine } from '../src/format-tools.ts'

/** A fake textarea plus the commits the tools produced. */
function fakeTextarea(initial: string, selectionStart = 0, selectionEnd = selectionStart) {
  const commits: Array<{ next: string; caret: number }> = []
  const el = {
    value: initial,
    selectionStart,
    selectionEnd,
  }
  const tools = createFormatTools(
    () => el as unknown as HTMLTextAreaElement,
    (next, caret) => {
      commits.push({ next, caret })
      el.value = next
    },
  )
  return { el, commits, tools }
}

describe('format tools', () => {
  it('wrapSelection wraps the selection and parks the caret after it', () => {
    const { el, commits, tools } = fakeTextarea('把Deploy做对比', 1, 7)
    tools.wrapSelection('**', '**')
    assert.equal(commits.length, 1)
    assert.equal(commits[0]?.next, '把**Deploy**做对比')
    assert.equal(commits[0]?.caret, 9)
    assert.equal(el.value, '把**Deploy**做对比')
  })

  it('wrapSelection strips markers sitting outside the selection', () => {
    const { commits, tools } = fakeTextarea('把**Deploy**做对比', 3, 9)
    tools.wrapSelection('**', '**')
    assert.equal(commits[0]?.next, '把Deploy做对比')
    assert.equal(commits[0]?.caret, 7)
  })

  it('wrapSelection strips markers selected together with the word', () => {
    const { commits, tools } = fakeTextarea('把**Deploy**做对比', 1, 11)
    tools.wrapSelection('**', '**')
    assert.equal(commits[0]?.next, '把Deploy做对比')
  })

  it('wrapSelection with no selection inserts the pair around the caret', () => {
    const { commits, tools } = fakeTextarea('abc', 2)
    tools.wrapSelection('==', '==')
    assert.equal(commits[0]?.next, 'ab====c')
    assert.equal(commits[0]?.caret, 4)
  })

  it('underline uses its own markup', () => {
    const { commits, tools } = fakeTextarea('重点', 0, 2)
    tools.wrapSelection('<u>', '</u>')
    assert.equal(commits[0]?.next, '<u>重点</u>')
  })

  it('toggleList adds a bullet to every selected line', () => {
    const { commits, tools } = fakeTextarea('一行\n二行', 0, 20)
    tools.toggleList('ul')
    assert.equal(commits[0]?.next, '- 一行\n- 二行')
  })

  it('toggleList strips when every line already carries the marker', () => {
    const { commits, tools } = fakeTextarea('- 一行\n- 二行', 0, 20)
    tools.toggleList('ul')
    assert.equal(commits[0]?.next, '一行\n二行')
  })

  it('toggleList numbers the selection', () => {
    const { commits, tools } = fakeTextarea('甲\n乙', 0, 20)
    tools.toggleList('ol')
    assert.equal(commits[0]?.next, '1. 甲\n2. 乙')
  })

  it('toggleList converts a task in place under a bullet', () => {
    const { commits, tools } = fakeTextarea('- 已经是列表', 0, 20)
    tools.toggleList('task')
    assert.equal(commits[0]?.next, '- [ ] 已经是列表')
  })

  it('insertTemplate replaces the selection and parks the caret', () => {
    const { commits, tools } = fakeTextarea('前后', 1, 1)
    tools.insertTemplate('| 列一 | 列二 |\n| --- | --- |\n|  |  |', 4)
    assert.equal(commits[0]?.next, '前| 列一 | 列二 |\n| --- | --- |\n|  |  |后')
    assert.equal(commits[0]?.caret, 5)
  })

  it('insertTagStart inserts a hash and moves the caret past it', () => {
    const { commits, tools } = fakeTextarea('前后', 1)
    tools.insertTagStart()
    assert.equal(commits[0]?.next, '前#后')
    assert.equal(commits[0]?.caret, 2)
  })
})

describe('continueListOnEnter', () => {
  it('hands a bullet marker to the next line', () => {
    const next = continueListOnEnter('- 已办', 4)
    assert.equal(next?.value, '- 已办\n- ')
    assert.equal(next?.caret, 7)
  })

  it('keeps the asterisk the author chose', () => {
    const next = continueListOnEnter('* 甲', 3)
    assert.equal(next?.value, '* 甲\n* ')
    assert.equal(next?.caret, 6)
  })

  it('increments an ordered marker and keeps its delimiter', () => {
    assert.equal(continueListOnEnter('3. 丙', 4)?.value, '3. 丙\n4. ')
    assert.equal(continueListOnEnter('2) 丁', 4)?.value, '2) 丁\n3) ')
  })

  it('restarts a task box unticked', () => {
    const next = continueListOnEnter('- [x] 完成', 8)
    assert.equal(next?.value, '- [x] 完成\n- [ ] ')
    assert.equal(next?.caret, 15)
  })

  it('continues a nested numbered item at its own indent', () => {
    const doc = '* 顶层\n  1. 子项'
    const next = continueListOnEnter(doc, doc.length)
    assert.equal(next?.value, '* 顶层\n  1. 子项\n  2. ')
    assert.equal(next?.caret, doc.length + 6)
  })

  it('splits the line when the caret sits mid-item', () => {
    const next = continueListOnEnter('- 前缀后缀', 4)
    assert.equal(next?.value, '- 前缀\n- 后缀')
    assert.equal(next?.caret, 7)
  })

  it('retires a spent bullet instead of stacking one', () => {
    const doc = '- 一行\n- '
    const next = continueListOnEnter(doc, doc.length)
    assert.equal(next?.value, '- 一行\n')
    assert.equal(next?.caret, 5)
  })

  it('retires a spent task box the same way', () => {
    const next = continueListOnEnter('- [ ] ', 6)
    assert.equal(next?.value, '')
    assert.equal(next?.caret, 0)
  })

  it('leaves prose lines alone', () => {
    assert.equal(continueListOnEnter('普通文字', 4), null)
  })

  it('leaves lines inside a fence alone', () => {
    const doc = '```\n- 假装列表\n```'
    const caret = doc.indexOf('- ') + 2
    assert.equal(continueListOnEnter(doc, caret), null)
  })
})

describe('flipTaskLine', () => {
  it('ticks an unchecked box, leaving the marker and text whole', () => {
    assert.equal(flipTaskLine('- [ ] 买菜'), '- [x] 买菜')
  })

  it('unticks a checked box', () => {
    assert.equal(flipTaskLine('- [x] 买菜'), '- [ ] 买菜')
  })

  it('keeps the asterisk, the indent and the ordered marker', () => {
    assert.equal(flipTaskLine('* [ ] 甲'), '* [x] 甲')
    assert.equal(flipTaskLine('  1. [x] 子任务'), '  1. [ ] 子任务')
  })

  it('accepts a capital tick and writes a lowercase one', () => {
    assert.equal(flipTaskLine('- [X] 大写'), '- [ ] 大写')
  })

  it('returns null for a line without a task box', () => {
    assert.equal(flipTaskLine('- 普通条目'), null)
    assert.equal(flipTaskLine('正文'), null)
  })

  it('never stacks a second box on a line that already has one', () => {
    // The regression that shipped once: a two-argument replace callback read
    // the marker prefix as the tick, producing `- [ ][x]`.
    const once = flipTaskLine('- [ ] 买菜')
    assert.equal(once, '- [x] 买菜')
    assert.equal(flipTaskLine(once ?? ''), '- [ ] 买菜')
  })
})
