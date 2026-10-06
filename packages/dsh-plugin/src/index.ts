/**
 * Host loader entry for `dsh-flomo`.
 *
 * The host half owns the vault: the PAT, the derived key, the decrypted memos
 * and every write to GitHub. The browser half is a same-origin view over it,
 * and the agent tools drive the very same object — which is what makes a memo
 * captured in a chat turn appear in the sidebar panel without a refresh.
 *
 * Failure policy: a missing optional service (the tool registry, the
 * credentials store) degrades the surface rather than failing the boot, since
 * a plugin that throws during `apply` takes the whole harness down with it.
 *
 * @module dsh-flomo
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { FlomoHostService } from './host-service.ts'
import type { CredentialsFace } from './host-service.ts'
import { buildFlomoTools, identityDefineTool } from './host/tools.ts'
import type { DefineTool } from './host/tools.ts'
import { makeFlomoRoutes } from './routes.ts'

/** Loader entry name. */
export const name = 'flomo'

/** The one service this plugin cannot work without. */
export const inject = ['webServer']

/** The slice of the tool registry this plugin uses. */
interface ToolRegistryFace {
  register(definition: ToolDefinition): () => void
}

/**
 * The context shape this plugin consumes, spelled structurally so the plugin
 * needs no compile-time dependency on the Harness packages.
 */
interface HostContext {
  get(name: string): unknown
  effect(callback: () => (() => void) | void, label?: string): void
  webServer: { register(route: WebRoute): () => void }
  inject?: (names: readonly string[], callback: (scoped: HostContext) => unknown) => unknown
}

/**
 * Activate the host half.
 * @param ctx - the plugin context (webServer injected).
 */
export function apply(ctx: HostContext): void {
  const credentials = ctx.get('credentials') as CredentialsFace | undefined

  // Mount even without a credentials service: the panel must still be able to
  // explain what is missing. A `configure` that carries a token fails with that
  // message rather than the whole plugin disappearing.
  const host = new FlomoHostService(
    credentials ? { credentials } : {},
  )
  void host.ensureStarted()

  let disposeTools: (() => void) | undefined
  let cancelled = false

  /**
   * Load the tool package and register the agent tools.
   *
   * `@deepseek-ai/dsh-tools` is supplied by the Harness at runtime and is not
   * resolvable from every plugin location, so it is imported lazily rather than
   * at module scope. That way an unresolvable import costs the agent tools and
   * nothing else — a static import would take the whole plugin, panel included,
   * down with it.
   *
   * The registry may also activate after this row, so this runs from the mount
   * effect and again from the scoped injection below.
   */
  const registerTools = async (): Promise<void> => {
    if (disposeTools !== undefined || cancelled) return

    const tools = ctx.get('tools') as ToolRegistryFace | undefined
    if (tools === undefined || typeof tools.register !== 'function') {
      host.setToolsStatus(false, '当前部署没有 tools 服务。')
      return
    }

    // Prefer the Harness's own helper, but do not depend on it being reachable:
    // a `link:`-installed plugin can resolve from outside the profile, where
    // the Harness packages are not on disk. The identity fallback keeps the
    // tools working in that case rather than silently dropping them.
    let defineTool: DefineTool = identityDefineTool
    try {
      const module = (await import('@deepseek-ai/dsh-tools')) as { defineTool?: DefineTool }
      if (typeof module.defineTool === 'function') defineTool = module.defineTool
    } catch {
      // Expected when the plugin is symlinked outside the profile.
    }

    if (cancelled || disposeTools !== undefined) return

    // Registered one at a time, collecting failures rather than letting the first
    // throw abandon the rest. All six share a shape today, so in practice they
    // fail together — but a single rejected definition must not be able to take
    // the other five with it, and the message names which one was refused.
    const disposers: Array<() => void> = []
    const failures: string[] = []

    for (const tool of buildFlomoTools(host, defineTool)) {
      try {
        disposers.push(tools.register(tool))
      } catch (error) {
        failures.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    disposeTools = () => {
      for (const dispose of disposers.splice(0)) dispose()
    }

    if (failures.length === 0) {
      host.setToolsStatus(true, null)
    } else {
      host.setToolsStatus(false, failures.join(' | '))
      console.warn('[flomo] 部分 agent 工具注册失败：', failures)
    }
  }

  ctx.effect(() => {
    cancelled = false
    const disposers: Array<() => void> = []
    for (const route of makeFlomoRoutes(host)) disposers.push(ctx.webServer.register(route))
    void registerTools()

    return () => {
      cancelled = true
      for (const dispose of disposers.splice(0)) dispose()
      disposeTools?.()
      disposeTools = undefined
      host.dispose()
    }
  }, 'flomo: vault routes and agent tools')

  // A tool registry that activates after this row is picked up here. Cordis
  // runs the callback again when the providing fiber changes, so the old
  // disposer is released first — otherwise the second registry would be
  // short-circuited by the stale guard.
  ctx.inject?.(['tools'], () => {
    void registerTools()
    return () => {
      disposeTools?.()
      disposeTools = undefined
    }
  })
}
