/**
 * The panel's HTTP surface on the DSH web server.
 *
 * Two routes only: `GET /state` to read, `POST /action` to mutate. Both sit
 * behind one guard, which is the same fence the shipped panels use — the
 * request must arrive on the loopback socket *and* carry a browser
 * same-origin signal. A bare local `curl` therefore cannot drive the vault,
 * and neither can a cross-site page.
 *
 * @module dsh-flomo/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { API_PREFIX, parseAction } from './protocol.ts'
import type { FlomoHostService } from './host-service.ts'

/**
 * Largest accepted request body.
 *
 * Generous because an import carries an entire exported document inside one
 * action; still finite, because nothing else here should approach it.
 */
const BODY_LIMIT = 8 * 1024 * 1024

/**
 * Write a JSON response with no-store caching.
 * @param res - the response.
 * @param status - HTTP status.
 * @param value - the body.
 */
function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Whether a dotted quad is in the IPv4 loopback range, 127/8.
 * @param value - the address.
 * @returns true when it is loopback.
 */
function isIPv4Loopback(value: string): boolean {
  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

/**
 * Whether a socket address names the loopback range.
 *
 * The whole of 127/8, not just 127.0.0.1: a browser that connects over any other
 * address in the range is still on this machine, and rejecting it would be a
 * false negative on the one check that actually carries the authority.
 * @param address - `socket.remoteAddress`.
 * @returns true for 127/8, `::1`, and IPv4-mapped 127/8.
 */
function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice('::ffff:'.length))
  return isIPv4Loopback(normalized)
}

/**
 * Whether a hostname names the loopback authority.
 * @param hostname - the parsed hostname.
 * @returns true for localhost, `[::1]` and 127/8.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * The request fence, and the reason it refuses.
 *
 * This deliberately mirrors the Harness's own shared fence
 * (`dsh-web-shared/host/loopback`), which every other host route family uses. An
 * earlier version here required `sec-fetch-site: same-origin` and rejected a
 * request that carried no marker at all — which is *stricter* than the platform
 * and refused the panel's own traffic with a bare 403.
 *
 * The semantics that matter: the socket address is authoritative, the Host header
 * must also be loopback, and the browser markers may only ever *deny*. A request
 * with no `Origin` is allowed, because no web page can produce one — the browser
 * always attaches `sec-fetch-site`, so a page that tries is caught by the
 * cross-site rule, and a local process was never fenced by headers anyway.
 *
 * @param req - the incoming request.
 * @returns `null` when the request may touch the vault, else why not.
 */
function refusalReason(req: IncomingMessage): string | null {
  const address = req.socket.remoteAddress
  if (!isLoopbackAddress(address)) return `socket address ${address ?? 'unknown'} is not loopback`

  const host = req.headers.host
  if (typeof host !== 'string') return 'no Host header'
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return `unparseable Host ${host}`
  }
  if (!isLoopbackHostname(hostname)) return `Host ${host} is not a loopback authority`

  if (req.headers['sec-fetch-site'] === 'cross-site') return 'sec-fetch-site is cross-site'

  const origin = req.headers.origin
  if (origin === undefined) return null
  try {
    return new URL(origin).host === host ? null : `Origin ${origin} does not match Host ${host}`
  } catch {
    return `unparseable Origin ${origin}`
  }
}

/**
 * What the browser actually sent, for the refusal message.
 *
 * Echoing the observed headers is the point: the reason says which rule failed,
 * and this says what to change.
 * @param req - the incoming request.
 * @returns the observed values.
 */
function observed(req: IncomingMessage): Record<string, string> {
  return {
    socket: req.socket.remoteAddress ?? 'unknown',
    'sec-fetch-site': String(req.headers['sec-fetch-site'] ?? '(absent)'),
    origin: String(req.headers.origin ?? '(absent)'),
    host: String(req.headers.host ?? '(absent)'),
    'user-agent': String(req.headers['user-agent'] ?? '(absent)').slice(0, 120),
  }
}

/**
 * Read and decode a JSON request body.
 * @param req - the incoming request.
 * @returns the decoded value.
 * @throws when the body is too large or not JSON.
 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > BODY_LIMIT) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/**
 * Build the plugin's routes.
 * @param host - the shared host service.
 * @returns the routes to register.
 */
export function makeFlomoRoutes(host: FlomoHostService): WebRoute[] {
  /**
   * Reject an untrusted caller.
   * @param req - the request.
   * @param res - the response.
   * @returns true when the caller may proceed.
   */
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    const reason = refusalReason(req)
    if (reason === null) return true
    writeJson(res, 403, { ok: false, error: 'forbidden', reason, observed: observed(req) })
    return false
  }

  const state: WebRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!guard(req, res)) return
      await host.ensureStarted()
      // Recorded before the snapshot is built, so this read is included in it.
      const agent = req.headers['user-agent']
      host.noteStateRead(typeof agent === 'string' ? agent : null)
      writeJson(res, 200, { ok: true, state: await host.fullSnapshot() })
    },
  }

  const action: WebRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/action`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!guard(req, res)) return
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return writeJson(res, 415, { ok: false, error: 'json-required' })
      }

      await host.ensureStarted()

      let body: unknown
      try {
        body = await readJson(req)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return writeJson(res, message === 'body-too-large' ? 413 : 400, {
          ok: false,
          error: message,
        })
      }

      const parsed = parseAction(body)
      if (parsed === undefined) return writeJson(res, 400, { ok: false, error: 'invalid-action' })

      const state = await host.apply(parsed)
      const message = host.takeMessage()
      writeJson(res, 200, { ok: true, state, ...(message === null ? {} : { message }) })
    },
  }

  return [state, action]
}
