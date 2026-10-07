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

import { createFormatTools } from '../src/format-tools.ts'

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
