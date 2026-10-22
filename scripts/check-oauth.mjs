/**
 * Pre-flight check for the GitHub login configuration.
 *
 * This exists because every way the login can be misconfigured fails the same
 * way from the outside: you click the button, GitHub sends you back, and
 * *something* goes wrong — with the reason visible only in a devtools console
 * you may not have open. A wrong client id, a Worker that was never deployed, a
 * relay pointed at a different site, an account gate set to the wrong login: all
 * of them look identical from the page.
 *
 * So this checks each link in the chain separately, offline where it can and
 * over the network where it must, and names the one that is wrong.
 *
 * Plain JavaScript on purpose: `.mjs` is not type-stripped the way `.ts` is, so
 * annotations here would be a syntax error rather than documentation.
 *
 * Run it with `pnpm check:oauth`.
 *
 * @module flomo-sim/check-oauth
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OAUTH_FILE = join(here, '..', 'packages', 'web', 'src', 'oauth.ts')

/** The site this repository is deployed to, used as the expected origin. */
const EXPECTED_ORIGIN = 'https://wuhy80.github.io'

/** Every result, in the order it was found. */
const checks = []

/**
 * Record one result.
 * @param {boolean} ok - whether it passed.
 * @param {string} what - the thing checked.
 * @param {string} detail - what was found, phrased for a person.
 */
function record(ok, what, detail) {
  checks.push({ ok, what, detail })
}

/**
 * Read a `const NAME = '...'` string out of the OAuth module.
 *
 * Parsed with a regex rather than imported: the module reads `window` at import
 * time and is written in TypeScript, so importing it here would need a bundler
 * and a fake DOM to answer a question that is really just "what is in the file".
 * @param {string} source - the module's text.
 * @param {string} name - the exported constant.
 * @returns {string | null} the literal value, or null when it is not a plain string literal.
 */
function constantOf(source, name) {
  const match = new RegExp(`export const ${name}\\s*=\\s*(['"])(.*?)\\1`, 's').exec(source)
  return match?.[2] ?? null
}

/**
 * Ask the relay to describe itself.
 * @param {string} relayUrl - the configured relay base URL.
 * @returns {Promise<{ok: true, body: Record<string, unknown>} | {ok: false, detail: string}>} the result.
 */
async function probeRelay(relayUrl) {
  try {
    const response = await fetch(relayUrl.replace(/\/+$/, '') + '/', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return { ok: false, detail: `GET / 返回 HTTP ${response.status}，中转没有正常响应。` }
    }
    const body = await response.json()
    return { ok: true, body }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, detail: `连不上中转：${message}` }
  }
}

/**
 * Run every check and print the report.
 * @returns {Promise<number>} the process exit code.
 */
async function main() {
  let source
  try {
    source = await readFile(OAUTH_FILE, 'utf8')
  } catch {
    console.error(`读不到 ${OAUTH_FILE}`)
    return 1
  }

  const clientId = constantOf(source, 'GITHUB_CLIENT_ID') ?? ''
  const relayUrl = constantOf(source, 'RELAY_URL') ?? ''

  // 1. Client id
  if (clientId === '') {
    record(false, 'GitHub Client ID', '还没填。在 OAuth App 设置页复制 Client ID。')
  } else if (!/^[A-Za-z0-9_]{10,}$/.test(clientId)) {
    record(
      false,
      'GitHub Client ID',
      `"${clientId}" 看起来不像 Client ID（应当是 20 位左右的字母数字）。`,
    )
  } else {
    record(true, 'GitHub Client ID', `${clientId.slice(0, 6)}…（已填）`)
  }

  // 2. Relay URL
  if (relayUrl === '') {
    record(false, '中转地址', '还没填。`wrangler deploy` 会打印 workers.dev 地址。')
  } else if (!relayUrl.startsWith('https://')) {
    record(
      false,
      '中转地址',
      `"${relayUrl}" 不是 HTTPS。回调页面在 HTTPS 下，混合内容会被浏览器拦掉。`,
    )
  } else if (relayUrl.endsWith('/')) {
    record(false, '中转地址', `"${relayUrl}" 末尾多了斜杠，前端会拼成 //exchange。`)
  } else {
    record(true, '中转地址', relayUrl)
  }

  // 3. The relay itself — the only check that needs the network.
  if (relayUrl.startsWith('https://') && !relayUrl.endsWith('/')) {
    const probe = await probeRelay(relayUrl)
    if (!probe.ok) {
      record(false, '中转在线', probe.detail)
    } else if (probe.body['service'] !== 'flomo-oauth-relay') {
      record(
        false,
        '中转在线',
        `那个地址返回的不是本中转：${JSON.stringify(probe.body).slice(0, 120)}`,
      )
    } else {
      record(true, '中转在线', '响应正常。')

      const allowedLogin = String(probe.body['allowedLogin'] ?? '')
      if (allowedLogin.toLowerCase() === 'wuhy80') {
        record(true, '中转放行的账号', allowedLogin)
      } else {
        record(
          false,
          '中转放行的账号',
          `是 "${allowedLogin}"，不是 wuhy80。改 relay/wrangler.toml 的 ALLOWED_LOGIN 后重新部署。`,
        )
      }

      const allowedOrigin = String(probe.body['allowedOrigin'] ?? '')
      if (allowedOrigin === EXPECTED_ORIGIN) {
        record(true, '中转放行的来源', allowedOrigin)
      } else {
        record(
          false,
          '中转放行的来源',
          `是 "${allowedOrigin}"，而站点是 ${EXPECTED_ORIGIN}。改 relay/wrangler.toml 的 ALLOWED_ORIGIN 后重新部署。`,
        )
      }
    }
  } else {
    record(false, '中转在线', '地址无效，跳过。')
  }

  // 4. The callback URL the OAuth App must have registered.
  record(
    true,
    'OAuth App 回调地址应为',
    `${EXPECTED_ORIGIN}/flomo-web/  （在 https://github.com/settings/applications/new 里核对）`,
  )

  for (const check of checks) {
    console.log(`${check.ok ? '  ok  ' : ' FAIL '} ${check.what}\n         ${check.detail}`)
  }

  const failed = checks.filter((check) => !check.ok).length
  if (failed === 0) {
    console.log('\n全部通过，可以 pnpm build 后发布了。')
    return 0
  }
  console.log(`\n${failed} 项没通过。上面的 FAIL 就是登录失败的原因。`)
  return 1
}

process.exitCode = await main()
