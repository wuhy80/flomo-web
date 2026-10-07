/**
 * Screenshot the running app with a real browser.
 *
 * The stylesheet is a few hundred lines, and no amount of unit testing substitutes
 * for seeing it. This drives headless Chrome over the DevTools Protocol, with the
 * real app running its real code path against a real encrypted vault.
 *
 * The browser work lives in `harness.mjs`, which `interact.mjs` shares.
 *
 * Usage:
 *   node scripts/screenshot.mjs <app-url> <out.png> [options]
 *
 * Options:
 *   --locked         stop at the password gate instead of unlocking
 *   --click <label>  click the first button whose text is exactly <label>
 *   --open <text>    open the detail view of the memo containing <text>
 *   --size <WxH>     viewport to emulate (default 1280x1000)
 *
 * Requires the dev server (`pnpm dev`) or a static host to already be running,
 * and Chrome or Edge installed.
 */

import { resolve } from 'node:path'

import { openApp } from './harness.mjs'

const argv = process.argv.slice(2)
const url = argv[0]
const outArg = argv[1]
if (url === undefined || outArg === undefined) {
  console.error(
    'usage: node scripts/screenshot.mjs <app-url> <out.png> [--locked] [--click TEXT] [--size WxH]',
  )
  process.exit(2)
}

/**
 * Parse the flags.
 * @param args - everything after the two positional arguments.
 * @returns the options.
 */
function parseOptions(args) {
  const options = { stopAtGate: false, setup: false, click: null, open: null, width: 1280, height: 1000 }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--locked') options.stopAtGate = true
    else if (arg === '--setup') options.setup = true
    else if (arg === '--click') options.click = args[index += 1] ?? null
    else if (arg === '--open') options.open = args[index += 1] ?? null
    else if (arg === '--size') {
      const [width, height] = (args[index += 1] ?? '').split('x').map(Number)
      if (!width || !height) throw new Error('--size wants WxH, e.g. 420x900')
      options.width = width
      options.height = height
    } else if (arg !== undefined) {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return options
}

const options = parseOptions(argv.slice(2))
const out = resolve(outArg)

const app = await openApp(url, { width: options.width, height: options.height, setup: options.setup })
try {
  if (options.stopAtGate) {
    await app.waitFor('document.querySelector(".fl-gate") !== null', 'the password gate')
  } else {
    if (options.setup !== true) await app.unlock()
  }

  if (options.click !== null) {
    await app.clickLabel(options.click)
    await new Promise((ready) => setTimeout(ready, 500))
  }

  // Opens the detail view of a *specific* memo. Clicking the first 详情 button only
  // ever reaches the newest note, which is never the one with backlinks.
  if (options.open !== null) {
    const opened = await app.evaluate(`(() => {
      const wanted = ${JSON.stringify(options.open)};
      const memo = [...document.querySelectorAll('.fl-memo')]
        .find((node) => node.textContent.includes(wanted));
      if (memo === undefined) return false;
      const button = [...memo.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.trim() === '详情');
      if (button === undefined) return false;
      button.click();
      return true;
    })()`)
    if (opened !== true) throw new Error(`no memo containing ${JSON.stringify(options.open)}`)
    await new Promise((ready) => setTimeout(ready, 500))
  }

  await new Promise((ready) => setTimeout(ready, 600))
  await app.screenshot(out)
  console.log(`wrote ${out}`)
} finally {
  app.close()
}
