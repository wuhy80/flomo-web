/**
 * Deployment smoke test for the built site.
 *
 * A build command will happily produce a `dist/` that a browser cannot use: an
 * asset URL that resolves to nothing, a service worker that was never copied, an
 * absolute `/assets/...` path that works at a domain root and 404s the moment the
 * site is deployed under a project subpath. None of those fail the build. All of
 * them fail the user.
 *
 * So this serves `dist/` the way GitHub Pages does — plain static files, no SPA
 * fallback, no rewriting — and checks what actually comes back over HTTP.
 *
 * Run after a build: `pnpm --filter @flomo/web build && pnpm --filter @flomo/web smoke`.
 */

import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/** Content types a static host would send. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const failures = []

/**
 * Record one assertion.
 * @param {boolean} ok - whether it held.
 * @param {string} label - what was checked.
 * @param {string} [detail] - extra context on failure.
 */
function check(ok, label, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
    return
  }
  failures.push(detail === '' ? label : `${label} — ${detail}`)
  console.log(`  FAIL  ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/**
 * Serve `dist/` as plain static files.
 * @returns {Promise<import('node:http').Server>} the listening server.
 */
function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    const target = resolve(join(dist, pathname))
    if (target !== dist && !target.startsWith(dist + sep)) {
      res.writeHead(403).end('forbidden')
      return
    }

    try {
      const info = await stat(target)
      if (!info.isFile()) throw new Error('not a file')
      const body = await readFile(target)
      res.writeHead(200, {
        'content-type': MIME[extname(target)] ?? 'application/octet-stream',
        'content-length': body.length,
      })
      res.end(body)
    } catch {
      // GitHub Pages answers 404 here: it has no SPA fallback, so a route the
      // site does not have is genuinely missing rather than silently rewritten.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  })

  return new Promise((ready) => server.listen(0, '127.0.0.1', () => ready(server)))
}

/**
 * Extract every same-origin URL an HTML document references.
 * @param {string} html - the document.
 * @returns {string[]} the referenced URLs.
 */
function references(html) {
  const found = []
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1]
    if (value === undefined) continue
    if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('data:')) continue
    found.push(value)
  }
  return found
}

const server = await serve()
const { port } = server.address()
const base = `http://127.0.0.1:${port}`

try {
  console.log(`serving ${dist}\n`)

  // ── the files a deploy must contain ───────────────────────────────────────
  let html = ''
  for (const file of ['index.html', 'sw.js', 'manifest.webmanifest']) {
    try {
      html = file === 'index.html' ? await readFile(join(dist, file), 'utf8') : html
      await stat(join(dist, file))
      check(true, `dist/${file} exists`)
    } catch {
      check(false, `dist/${file} exists`, 'missing from the build output')
    }
  }

  // ── the document ──────────────────────────────────────────────────────────
  check(html.includes('<div id="root">'), 'index.html has the mount point')
  check(
    /<script[^>]+type="module"/.test(html),
    'index.html loads a module entry',
  )

  const refs = references(html)
  const absolute = refs.filter((value) => value.startsWith('/'))
  check(
    absolute.length === 0,
    'every reference is relative, so a project-subpath deploy works',
    absolute.join(', '),
  )

  for (const ref of refs) {
    const response = await fetch(new URL(ref, `${base}/`))
    check(response.ok, `index.html reference resolves: ${ref}`, `HTTP ${response.status}`)
  }

  // ── what the host actually returns ────────────────────────────────────────
  const root = await fetch(`${base}/`)
  check(root.status === 200, 'GET / answers 200', `HTTP ${root.status}`)
  check(
    (root.headers.get('content-type') ?? '').startsWith('text/html'),
    'GET / is served as HTML',
  )

  const entry = refs.find((value) => value.endsWith('.js'))
  if (entry === undefined) {
    check(false, 'index.html references a JavaScript entry')
  } else {
    const response = await fetch(new URL(entry, `${base}/`))
    const type = response.headers.get('content-type') ?? ''
    check(response.status === 200, `GET ${entry} answers 200`, `HTTP ${response.status}`)
    check(type.startsWith('text/javascript'), `${entry} is served as JavaScript`, type)
    check(
      /-[A-Za-z0-9_-]{8,}\.js$/.test(entry),
      'the entry filename is content-hashed, which the service worker relies on',
      entry,
    )
  }

  const worker = await fetch(`${base}/sw.js`)
  check(worker.status === 200, 'GET /sw.js answers 200', `HTTP ${worker.status}`)
  check(
    (worker.headers.get('content-type') ?? '').startsWith('text/javascript'),
    'sw.js is served as JavaScript, or the browser refuses to register it',
  )

  const manifest = await fetch(`${base}/manifest.webmanifest`)
  check(manifest.status === 200, 'GET /manifest.webmanifest answers 200')

  // ── the shell the worker promises to precache ─────────────────────────────
  // Guarded: a missing sw.js must be reported as a failed check with the rest of
  // the summary, not as a stack trace that hides every other finding.
  let swSource = ''
  try {
    swSource = await readFile(join(dist, 'sw.js'), 'utf8')
  } catch {
    check(false, 'sw.js is readable', 'missing from the build output')
  }

  const listMatch = /SHELL_URLS\s*=\s*\[([^\]]*)\]/.exec(swSource)
  const shell =
    listMatch === null
      ? []
      : [...(listMatch[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])

  check(shell.length > 0, 'sw.js declares a shell to precache')
  for (const url of shell) {
    const response = await fetch(new URL(url, `${base}/`))
    check(response.ok, `precached shell URL resolves: ${url}`, `HTTP ${response.status}`)
  }
} finally {
  server.close()
}

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('all deployment checks passed')
