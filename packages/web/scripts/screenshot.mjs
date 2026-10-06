/**
 * Screenshot the running app with a real browser.
 *
 * The stylesheet is a few hundred lines that nobody has ever looked at, and no
 * amount of unit testing substitutes for seeing it. This drives headless Chrome
 * over the DevTools Protocol: it stubs `fetch` so the **real** app runs its
 * **real** code path against a **real** encrypted vault, unlocks it, and captures
 * the result.
 *
 * Nothing here ships. The mock lives entirely in the injected page script, so
 * what gets photographed is the application, not a demo build of it.
 *
 * Usage:
 *   node scripts/screenshot.mjs <app-url> <out.png> [--locked]
 *
 * Requires the dev server (`pnpm dev`) or a static host to already be running,
 * and Chrome or Edge installed.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FlomoVault, parseTags } from '../../core/src/index.ts'
import { MemoryStore } from '../../core/src/testing.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** Chrome and Edge, in the order worth trying. */
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'google-chrome',
  'chromium',
]

const DEBUG_PORT = 9333

/**
 * Build an encrypted vault fixture with believable content.
 *
 * Memos are merged rather than added, because `add` stamps `createdAt` from the
 * clock and a screenshot of ten notes all written in the same second would show
 * nothing about day grouping.
 * @returns the vault header and every shard, base64-encoded as GitHub would send them.
 */
async function fixture() {
  const store = new MemoryStore()
  const { vault } = await FlomoVault.create(store, 'demo')

  const day = (offset, hour, minute) => {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
  }

  const samples = [
    [0, 9, 12, '把「客户端加密」这件事想清楚了：站点壳可以完全公开，因为里面没有任何数据。仓库里是密文，连 GitHub 自己都读不了。 #架构'],
    [0, 11, 40, '读完《深度工作》第三章。核心观点是：**专注不是意志力问题，是环境设计问题**。\n\n想到 [[心流]] 里说的注意力结构，其实是同一件事的两种说法。 #读书'],
    [0, 14, 5, '记一个今天踩的坑：\n\n```js\n// esbuild 会把 "\\n" 打印成跨行的模板字符串\ncontent.split("\\n")  // 逐行加缩进就变成了 "\\n\\t\\t"\n```\n\n**任何逐行改写打包产物的东西都必须知道哪些行在字符串里。** #工程'],
    [0, 16, 30, '> 我们高估了一年能做的事，低估了十年能做的事。\n\n这句话每次看到都还是有感觉。 #摘录'],
    [1, 8, 20, '重新想了下反向链接的解析规则：关键是**判定"散文"之前先抹掉链接标记**，否则两条都写了同一个链接的笔记会互相成为反向链接。 #架构'],
    [1, 15, 50, '晚饭后散步 40 分钟。 #生活'],
    [2, 10, 10, '心流出现的三个条件：明确的目标、即时的反馈、挑战与技能的匹配。 #读书'],
    [3, 21, 5, '今天把每月分片的理由写进文档了：单文件写爆 1MB 后 Contents API 会变慢，分片后每次只改一个月。 #工程'],
    [5, 13, 25, '一个反直觉的取舍：**导入只增不改**。拿备份覆盖到在用的库上时，永远不会悄悄回滚较新的编辑。代价是导入无法更新已有记录 —— 这是刻意选的安全那一侧。 #架构'],
    [9, 19, 45, '开始用 [[深度工作]] 里那个「关机仪式」：下班前写下明天的第一件事。 #读书'],
  ]

  vault.merge(
    samples.map(([offset, hour, minute, content], index) => ({
      id: `demo-${index}`,
      content: String(content),
      createdAt: day(Number(offset), Number(hour), Number(minute)),
      updatedAt: day(Number(offset), Number(hour), Number(minute)),
      tags: parseTags(String(content)),
    })),
  )
  await vault.flush()

  const encode = (text) => Buffer.from(text, 'utf8').toString('base64')
  const header = store.raw('vault.json')
  if (header === undefined) throw new Error('fixture: no vault header was written')

  const shards = store
    .paths()
    .filter((path) => path.startsWith('data/'))
    .map((path) => ({
      path,
      name: path.slice('data/'.length),
      content: encode(store.raw(path) ?? ''),
      sha: `sha-${path}`,
    }))

  return {
    owner: 'demo',
    repo: 'flomo-demo',
    vault: { content: encode(header), sha: 'sha-vault' },
    shards,
  }
}

/**
 * The script injected into the page before the app loads.
 *
 * It replaces `fetch` with a Contents API over the fixture and seeds the stored
 * connection, so the application's own session, crypto and rendering all run
 * unmodified.
 * @param data - the fixture.
 * @returns the source to evaluate.
 */
function bootstrap(data) {
  return `(() => {
  try {
  const VAULT = ${JSON.stringify(data.vault)};
  const SHARDS = ${JSON.stringify(data.shards)};
  const OWNER = ${JSON.stringify(data.owner)};
  const REPO = ${JSON.stringify(data.repo)};
  const prefix = '/repos/' + OWNER + '/' + REPO + '/contents/';

  localStorage.setItem('flomo-sim:config:v1', JSON.stringify({
    owner: OWNER, repo: REPO, token: 'demo-token', remember: true,
  }));

  const reply = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  window.fetch = async (input, init) => {
    const url = String((input && input.url) || input);
    const path = url.slice(url.indexOf(prefix) + prefix.length).split('?')[0];
    const method = (init && init.method) || 'GET';

    if (method === 'PUT') return reply({ content: { sha: 'sha-written' } });

    if (path === 'vault.json') return reply(VAULT);
    if (path === 'data') {
      return reply(SHARDS.map((s) => ({
        type: 'file', name: s.name, path: s.path, sha: s.sha,
      })));
    }
    const shard = SHARDS.find((s) => s.path === path);
    if (shard) return reply({ content: shard.content, sha: shard.sha });
    return reply({ message: 'Not Found' }, 404);
  };
  } catch (error) {
    // Runs before every document script, including on origins where storage is
    // unavailable; failing loudly here would break the page it is meant to help.
    console.error('[screenshot] bootstrap failed', error);
  }
})()`
}

/** Poll `http://127.0.0.1:<port>/json/version` until Chrome answers. */
async function waitForDebugger() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((ready) => setTimeout(ready, 100))
  }
  throw new Error('chrome never opened its debug port')
}

/**
 * Open a minimal DevTools Protocol session.
 * @returns `send` plus `close`.
 */
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = list.find((target) => target.type === 'page')
  if (page === undefined) throw new Error('no page target')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ready, fail) => {
    socket.onopen = ready
    socket.onerror = fail
  })

  let next = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }

  return {
    close: () => socket.close(),
    send: (method, params) =>
      new Promise((resolvePromise, rejectPromise) => {
        next += 1
        pending.set(next, { resolve: resolvePromise, reject: rejectPromise })
        socket.send(JSON.stringify({ id: next, method, params }))
      }),
  }
}

const [url, outArg, ...flags] = process.argv.slice(2)
if (url === undefined || outArg === undefined) {
  console.error('usage: node scripts/screenshot.mjs <app-url> <out.png> [--locked]')
  process.exit(2)
}
const out = resolve(outArg)
const stopAtGate = flags.includes('--locked')

const data = await fixture()
// A bare name (no path separator) is left to PATH; a path must actually exist.
const browser = BROWSERS.find(
  (candidate) => !candidate.includes('\\') || existsSync(candidate),
)
if (browser === undefined) {
  console.error('no Chrome or Edge found; install one or add its path to BROWSERS')
  process.exit(2)
}
const profile = join(here, '..', 'node_modules', '.chrome-screenshot')
await mkdir(profile, { recursive: true })

const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const cdp = await (async () => {
  await waitForDebugger()
  return connect()
})()

/**
 * Evaluate an expression in the page and return its value.
 * @param expression - the source to run.
 * @returns the value.
 */
const evaluate = async (expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  return result.result?.value
}

/**
 * Wait for an expression to become truthy.
 *
 * On timeout it prints what the page was actually showing: a bare "timed out"
 * says nothing about whether the app errored, stayed locked, or never mounted.
 * @param expression - the condition.
 * @param label - what is being waited for.
 */
const waitFor = async (expression, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(expression)) return
    await new Promise((ready) => setTimeout(ready, 150))
  }
  const text = await evaluate('document.body.innerText.slice(0, 600)')
  throw new Error(`timed out waiting for ${label}\n--- page said ---\n${text}`)
}

try {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  // Injected before any document script, on every navigation. Setting the stub
  // from a normal evaluate and then reloading would wipe it — which is exactly
  // what happened the first time this was written, and the app quietly went to
  // the real api.github.com and came back with "Bad credentials".
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap(data) })

  await cdp.send('Page.navigate', { url })
  await waitFor('document.querySelector(".fl-root") !== null', 'the app to mount')

  if (stopAtGate) {
    await waitFor('document.querySelector(".fl-gate") !== null', 'the password gate')
  } else {
    // Type into the field the way a person does. A synthetic `input` event built
    // from a native setter is the usual trick, but React's synthetic event system
    // does not always see it — and a screenshot script that silently fails to
    // unlock is worse than one that does not try.
    await waitFor('document.querySelector(".fl-gate input[type=password]") !== null', 'the gate')
    await evaluate('document.querySelector(".fl-gate input[type=password]").focus()')
    await cdp.send('Input.insertText', { text: 'demo' })
    await evaluate('document.querySelector(".fl-gate form").requestSubmit()')
    await waitFor('document.querySelector(".fl-composer") !== null', 'the feed to unlock')
  }

  await new Promise((ready) => setTimeout(ready, 600))
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(out, Buffer.from(shot.data, 'base64'))
  console.log(`wrote ${out}`)
} finally {
  cdp.close()
  child.kill()
}
