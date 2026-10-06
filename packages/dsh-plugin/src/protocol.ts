/**
 * The wire contract between the `dsh-flomo` host half and its browser half.
 *
 * Both halves are bundled from this repository, so the shapes below are shared
 * by import rather than duplicated. Only two routes exist: a `GET /state` for
 * reads and a `POST /action` for everything that mutates, which keeps a single
 * guard in front of the whole surface.
 *
 * @module dsh-flomo/protocol
 */

import type { Memo } from '@flomo/core'

/** Base path of the plugin's HTTP surface on the DSH web server. */
export const API_PREFIX = '/flomo-sim/api'

/** Where the vault currently is. */
export type HostStatus =
  /** No repository configured yet. */
  | 'unconfigured'
  /** Configured, but no password has been supplied. */
  | 'locked'
  /** Open; memos are available. */
  | 'unlocked'

/** Everything the panel needs to render. */
export interface HostState {
  status: HostStatus
  /** Repository coordinates, once configured. */
  owner: string | null
  repo: string | null
  branch: string | null
  /** Whether a PAT is present in the credential store. */
  hasToken: boolean
  /** Whether a password is stored, enabling unattended unlock. */
  hasStoredPassword: boolean
  /** All memos, newest first. Empty unless unlocked. */
  memos: Memo[]
  /** User-facing failure text. */
  error: string | null
  /** Present only in the response that created a vault. */
  recoveryCode: string | null
  /** Whether the agent-facing tools registered with the Harness registry. */
  toolsRegistered: boolean
  /** Why the tools are unavailable, when they are. */
  toolsError: string | null
  /**
   * Distinct user agents that have read this state, newest first, capped.
   *
   * The panel reads it on mount, so a browser user agent appearing here is
   * evidence that the browser half actually loaded and mounted — which is
   * otherwise invisible from outside the GUI, since the shell's own index
   * requires auth that only the desktop shell holds.
   */
  stateClients: string[]
}

/** Every mutation the panel or an agent tool may request. */
export type FlomoAction =
  | {
      kind: 'configure'
      owner: string
      repo: string
      branch?: string
      /** Omit to keep the currently stored token. */
      token?: string
    }
  | { kind: 'unlock'; password: string }
  | { kind: 'create'; password: string }
  | { kind: 'recovery'; code: string }
  | { kind: 'lock' }
  | { kind: 'add'; content: string }
  | { kind: 'edit'; id: string; content: string }
  | { kind: 'remove'; id: string }
  | { kind: 'pin'; id: string; pinned?: boolean }
  | { kind: 'save' }
  /** Merge an exported document; the payload is the raw file text. */
  | { kind: 'import'; payload: string }

/** The `POST /action` response envelope. */
export interface ActionResponse {
  ok: boolean
  state: HostState
  /** Optional human-readable outcome, currently only an import summary. */
  message?: string
}

/**
 * Narrow an untrusted decoded body into a {@link FlomoAction}.
 *
 * Hand-rolled rather than schema-driven so the plugin carries no runtime
 * dependency: the surface is small and every field is checked here.
 * @param value - the decoded JSON body.
 * @returns the action, or `undefined` when the shape is wrong.
 */
export function parseAction(value: unknown): FlomoAction | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const str = (key: string): string | undefined =>
    typeof v[key] === 'string' ? (v[key] as string) : undefined

  switch (v.kind) {
    case 'configure': {
      const owner = str('owner')
      const repo = str('repo')
      if (!owner || !repo) return undefined
      const branch = str('branch')
      const token = str('token')
      return { kind: 'configure', owner, repo, ...(branch ? { branch } : {}), ...(token ? { token } : {}) }
    }
    case 'unlock':
    case 'create': {
      const password = str('password')
      return password ? { kind: v.kind, password } : undefined
    }
    case 'recovery': {
      const code = str('code')
      return code ? { kind: 'recovery', code } : undefined
    }
    case 'lock':
    case 'save':
      return { kind: v.kind }
    case 'import': {
      const payload = str('payload')
      return payload ? { kind: 'import', payload } : undefined
    }
    case 'add': {
      const content = str('content')
      return content ? { kind: 'add', content } : undefined
    }
    case 'edit': {
      const id = str('id')
      const content = str('content')
      return id && content ? { kind: 'edit', id, content } : undefined
    }
    case 'remove': {
      const id = str('id')
      return id ? { kind: 'remove', id } : undefined
    }
    case 'pin': {
      const id = str('id')
      if (!id) return undefined
      const pinned = typeof v.pinned === 'boolean' ? v.pinned : undefined
      return { kind: 'pin', id, ...(pinned === undefined ? {} : { pinned }) }
    }
    default:
      return undefined
  }
}
