/**
 * Client half of `dsh-flomo`.
 *
 * Failure policy matches the shipped panels: a DOM-mounting problem is reported
 * rather than thrown, because the web shell fails its whole boot when a plugin's
 * `apply` throws, and an external plugin must never take the GUI down.
 *
 * @module dsh-flomo/client
 */

import { registerFlomoPanel } from './panel.tsx'
import type { ClientContext } from './panel.tsx'
import { HostFlomoSession } from './session.ts'

/** Client services this plugin needs before it can mount. */
export const inject = ['slots']

/**
 * Mount the sidebar row and the flomo page.
 * @param ctx - the client root context (service: slots).
 */
export function apply(ctx: ClientContext): void {
  const session = new HostFlomoSession()
  let dispose: (() => void) | undefined

  try {
    dispose = registerFlomoPanel(ctx, session)
  } catch (error) {
    console.error('[flomo] 面板注册失败：', error)
    return
  }

  ctx.effect?.(() => dispose, 'flomo: sidebar entry and main view')
}
