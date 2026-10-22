/**
 * Cloudflare Worker entry point for the flomo OAuth relay.
 *
 * Nothing but wiring lives here: the request handling is in
 * {@link module:flomo-oauth-relay/handler}, where it can be tested against a
 * stubbed GitHub instead of only against the real one.
 *
 * @module flomo-oauth-relay/worker
 */

import { handleRequest } from './handler.ts'
import type { RelayEnv } from './handler.ts'

export default {
  /**
   * @param request - the incoming request.
   * @param env - the Worker's environment: two secrets, the allowed origin, and
   * the one account this deployment serves.
   * @returns the relay's response.
   */
  fetch(request: Request, env: RelayEnv): Promise<Response> {
    return handleRequest(request, env)
  },
}
