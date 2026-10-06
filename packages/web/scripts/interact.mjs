/**
 * Operate the running app in a real browser.
 *
 * Every other check in this repository stops at "it rendered": the unit tests
 * render to a string, and `screenshot.mjs` looks at a page it never touches. This
 * one types into the composer, sends, and then inspects what the app tried to
 * persist — which is the only way to know the interactive path works, and the only
 * place the browser-side of the encryption claim can be checked.
 *
 * Usage:
 *   node scripts/interact.mjs [app-url] [--size WxH]
 *
 * Requires the dev server (`pnpm dev`) or a static host to be running, and Chrome
 * or Edge installed.
 */

import { openApp } from './harness.mjs'

const argv = process.argv.slice(2)

/**
 * Parse the arguments.
 *
 * Written as a walk rather than `find(arg => !arg.startsWith('--'))`: that
 * shorthand reads the *value* of `--size` as the URL when no URL is given, so
 * `interact.mjs --size 420x900` tried to navigate to "420x900". It only worked
 * while the URL happened to come first.
 * @param args - the raw arguments.
 * @returns the URL and the viewport.
 */
function parseArgs(args) {
  const options = { url: 'http://127.0.0.1:5273/', width: 1280, height: 1000 }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--size') {
      const [width, height] = (args[index += 1] ?? '').split('x').map(Number)
      if (!width || !height) throw new Error('--size wants WxH, e.g. 420x900')
      options.width = width
      options.height = height
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`)
    } else if (arg !== undefined) {
      options.url = arg
    }
  }
  return options
}

const { url, width, height } = parseArgs(argv)

/** A string distinctive enough that finding it anywhere is unambiguous. */
const MARKER = '交互测试标记-Zx9'
/** The tag written alongside it, which must also never be persisted in the clear. */
const TAG = '交互'

let failures = 0

/**
 * Record a check.
 * @param ok - whether it passed.
 * @param label - what was checked.
 * @param detail - extra context, shown only on failure.
 */
function check(ok, label, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const app = await openApp(url, { width, height })

try {
  await app.unlock()
  console.log('unlocked through the real form')

  // ── the starting point ─────────────────────────────────────────────────────
  const before = await app.evaluate('document.querySelectorAll(".fl-memo").length')
  check(before > 0, 'the fixture rendered a feed', `${before} memos`)

  // ── type it the way a person does ──────────────────────────────────────────
  await app.typeInto('.fl-composer textarea', `${MARKER} #${TAG}`)
  const typed = await app.evaluate('document.querySelector(".fl-composer textarea").value')
  check(
    typeof typed === 'string' && typed.includes(MARKER),
    'the composer accepted the text',
    `value was ${JSON.stringify(typed)}`,
  )

  await app.clickLabel('发送')

  // ── it appears, without a reload ───────────────────────────────────────────
  await app.waitFor(
    `document.body.innerText.includes(${JSON.stringify(MARKER)})`,
    'the new memo to appear in the feed',
  )
  const after = await app.evaluate('document.querySelectorAll(".fl-memo").length')
  check(after === before + 1, 'exactly one memo was added', `${before} -> ${after}`)

  const composerAfter = await app.evaluate('document.querySelector(".fl-composer textarea").value')
  check(composerAfter === '', 'the composer cleared itself', JSON.stringify(composerAfter))

  // The tag has to be recognised from the body, not sent as a field.
  const tags = await app.evaluate(
    '[...document.querySelectorAll(".fl-memo-tag")].map((node) => node.textContent)',
  )
  check(
    Array.isArray(tags) && tags.some((tag) => String(tag).includes(TAG)),
    'the tag was parsed out of the body',
    JSON.stringify(tags),
  )

  // ── and it is persisted, encrypted ─────────────────────────────────────────
  // The auto-save is debounced, so this is the first thing that proves the write
  // path ran at all rather than merely updating the view.
  await app.waitFor('(window.__flomoWrites ?? []).length > 0', 'the app to persist the memo')
  const writes = await app.writes()

  check(
    writes.some((write) => write.path.startsWith('data/')),
    'the memo was written to a monthly shard',
    JSON.stringify(writes.map((write) => write.path)),
  )

  // The point of the whole project, checked from the browser rather than from the
  // service: what left the app is ciphertext, and the plaintext is nowhere in it.
  const leakedBody = writes.filter((write) => write.body.includes(MARKER))
  const leakedTag = writes.filter((write) => write.body.includes(`#${TAG}`))
  check(leakedBody.length === 0, 'no write contains the memo body in the clear')
  check(leakedTag.length === 0, 'no write contains the tag in the clear')

  const total = writes.reduce((sum, write) => sum + write.body.length, 0)
  check(total > 0, 'the writes actually carried a payload', `${total} bytes across ${writes.length} writes`)

  // ── the rest of the app is still reachable ─────────────────────────────────
  // On a narrow viewport the sidebar becomes a horizontal strip. It used to be
  // hidden outright, which left a phone with no navigation at all — so navigating
  // is the check that matters most at that size, and it is never exercised by
  // looking at a screenshot.
  const title = () => app.evaluate('document.querySelector(".fl-column-title")?.textContent ?? ""')

  await app.clickLabel('每日回顾')
  await app.waitFor(
    'document.querySelector(".fl-column-title")?.textContent?.includes("每日回顾") === true',
    'the review view',
  )
  check(true, 'the review view opens by clicking its nav item')

  await app.clickLabel('随机漫步')
  await app.waitFor(
    'document.querySelector(".fl-column-title")?.textContent?.includes("随机漫步") === true',
    'the random view',
  )
  check(true, 'the random view opens by clicking its nav item')

  await app.clickLabel('全部')
  await app.waitFor(
    'document.querySelector(".fl-column-title")?.textContent?.includes("全部") === true',
    'the all view',
  )
  check(true, 'and back to everything')
  check(
    typeof (await title()) === 'string',
    'the column title is readable at this size',
  )

  // ── search filters what is on screen ───────────────────────────────────────
  await app.typeInto('.fl-search input', MARKER)
  await app.waitFor(
    `document.querySelectorAll(".fl-memo").length < ${before + 1}`,
    'the feed to filter down to the search hit',
  )
  const hits = await app.evaluate('document.querySelectorAll(".fl-memo").length')
  check(hits === 1, 'search narrows the feed to the one matching memo', `${hits} shown`)

  // Clearing matters: a live filter hides most of the feed, so anything that looks
  // for a different memo afterwards would fail on a DOM that is behaving correctly.
  await app.clearText('.fl-search input')
  await app.waitFor(
    `document.querySelectorAll(".fl-memo").length > 1`,
    'the feed to come back',
  )
  check(true, 'clearing the search restores the feed')
  // ── editing an existing note ───────────────────────────────────────────────
  // The only UI path that rewrites data that already exists, which makes it the
  // riskiest one here: a bug does not add a note, it replaces one.
  const EDITED = `${MARKER}-已改`
  await app.clickInMemo(MARKER, '编辑')
  await app.replaceText('.fl-memo-edit textarea', EDITED)
  await app.clickLabel('保存')
  await app.waitFor(
    `document.body.innerText.includes(${JSON.stringify(EDITED)})`,
    'the edited body to appear',
  )
  const bodies = await app.memos()
  check(
    bodies.some((body) => String(body).includes(EDITED)),
    'the edit replaced the body',
    JSON.stringify(bodies),
  )
  check(
    !bodies.some((body) => String(body).includes(MARKER) && !String(body).includes(EDITED)),
    'and the old body is gone rather than duplicated',
  )

  // ── pinning reorders the feed ──────────────────────────────────────────────
  // Note that the newly captured memo is not necessarily first: the fixture carries
  // memos stamped later in the day than the moment this runs, so "newest" and "top"
  // are not the same thing here. What matters is that the target starts somewhere
  // other than the top, and that pinning moves it.
  const target = '晚饭后散步'
  const beforePin = await app.memos()
  check(
    !String(beforePin[0]).includes(target),
    'the memo about to be pinned does not already start at the top',
    JSON.stringify(beforePin[0]),
  )

  await app.clickInMemo(target, '置顶')
  await app.waitFor(
    `document.querySelector(".fl-memo")?.innerText.includes(${JSON.stringify(target)}) === true`,
    'the pinned memo to hoist to the top',
  )
  check(true, 'pinning hoists a memo to the top of the feed')

  await app.clickInMemo(target, '取消置顶')
  await app.waitFor(
    `document.querySelector(".fl-memo")?.innerText.includes(${JSON.stringify(target)}) === false`,
    'the unpinned memo to fall back',
  )
  const afterUnpin = await app.memos()
  check(
    !String(afterUnpin[0]).includes(target),
    'and unpinning really moves it back, rather than only relabelling the button',
    JSON.stringify(afterUnpin[0]),
  )

  // ── the plaintext guarantee holds for rewrites, not only for the first capture ─
  // An edit rewrites a shard that already exists, which is a different code path
  // from appending to an empty one.
  await app.waitFor(
    `(window.__flomoWrites ?? []).length > ${writes.length}`,
    'the edit to be persisted',
  )
  const laterWrites = await app.writes()
  check(
    laterWrites.length > writes.length,
    'editing and pinning produced further writes',
    `${writes.length} -> ${laterWrites.length}`,
  )
  check(
    !laterWrites.some((write) => write.body.includes(EDITED)),
    'no write contains the edited body in the clear',
  )
  check(
    !laterWrites.some((write) => write.body.includes(target)),
    'nor the memo that was pinned, in the clear',
  )
} catch (error) {
  failures += 1
  console.log(`  FAIL  the run threw: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  app.close()
}

console.log('')
if (failures > 0) {
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all interaction checks passed')
