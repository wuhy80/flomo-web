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

/** Largest accepted request body. A memo is text; anything larger is abuse. */
const BODY_LIMIT = 2 * 1024 * 1024

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
 * Whether an address is this machine.
 * @param address - `socket.remoteAddress`.
 * @returns true for the IPv4 and IPv6 loopback forms.
 */
function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * The request fence.
 *
 * The socket check carries the authority; the same-origin marker is a tripwire
 * that keeps a header-less local script out. A forged Origin passes the marker,
 * which is exactly why the socket check is not optional.
 * @param req - the incoming request.
 * @returns whether the request may touch the vault.
 */
function isTrusted(req: IncomingMessage): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false

  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  if (req.headers['sec-fetch-site'] === 'cross-site') return false

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
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
    if (isTrusted(req)) return true
    writeJson(res, 403, { ok: false, error: 'forbidden' })
    return false
  }

  const state: WebRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: async (req, res) => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!guard(req, res)) return
      await host.ensureStarted()
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

      writeJson(res, 200, { ok: true, state: await host.apply(parsed) })
    },
  }

  return [state, action]
}
