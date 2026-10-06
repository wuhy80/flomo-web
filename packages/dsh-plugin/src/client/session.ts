/**
 * The browser-side session for the DSH panel: a {@link FlomoSession} that is a
 * thin view over the host half.
 *
 * Nothing secret ever reaches this file. The PAT, the password and the derived
 * key all stay in the host process; the browser only sends an action and
 * receives the resulting state. That is the whole reason this exists instead of
 * reusing the web app's direct-to-GitHub session.
 *
 * @module dsh-flomo/client/session
 */

import { tagStats } from '@flomo/core'
import type { FlomoSession, SessionSnapshot, SessionStatus } from '@flomo/ui'

import { API_PREFIX } from '../protocol.ts'
import type { ActionResponse, FlomoAction, HostState } from '../protocol.ts'

/** The empty snapshot a session starts from. */
const INITIAL: SessionSnapshot = {
  status: 'probing',
  memos: [],
  tags: [],
  error: null,
  saving: false,
  lastSavedAt: null,
  recoveryCode: null,
}

/** Repository coordinates plus an optional replacement token. */
export interface HostConnectionInput {
  owner: string
  repo: string
  branch?: string
  /** Omit to keep the token already stored on the host. */
  token?: string
}

/** A session whose state lives in the DSH host process. */
export class HostFlomoSession implements FlomoSession {
  private snapshot: SessionSnapshot = INITIAL
  private readonly listeners = new Set<() => void>()
  private pending = 0

  /**
   * The connection facts, mirrored out of the snapshot's shape so the settings
   * card can show them.
   *
   * Kept off {@link SessionSnapshot} on purpose: the shared snapshot is the
   * contract both sessions implement, and only this one has a repository to
   * name. It is refreshed on every state adoption, which is also when the
   * snapshot notifies, so a render always sees a current value.
   */
  connection: {
    owner: string | null
    repo: string | null
    branch: string | null
    hasToken: boolean
    hasStoredPassword: boolean
  } = { owner: null, repo: null, branch: null, hasToken: false, hasStoredPassword: false }

  /**
   * Subscribe to snapshot changes.
   * @param listener - notified after every transition.
   * @returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** @returns the current snapshot; stable between changes. */
  getSnapshot(): SessionSnapshot {
    return this.snapshot
  }

  /**
   * Replace part of the snapshot and notify.
   * @param patch - fields to merge.
   */
  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  /**
   * Project a host state onto the shared snapshot shape.
   * @param state - the state the host returned.
   */
  private adopt(state: HostState): void {
    const status: SessionStatus = state.status
    this.connection = {
      owner: state.owner,
      repo: state.repo,
      branch: state.branch,
      hasToken: state.hasToken,
      hasStoredPassword: state.hasStoredPassword,
    }
    this.update({
      status,
      memos: state.memos,
      tags: tagStats(state.memos),
      error: state.error,
      recoveryCode: state.recoveryCode,
      saving: false,
    })
  }

  /**
   * Issue a request against the plugin's own routes.
   * @param path - route suffix below {@link API_PREFIX}.
   * @param init - fetch options.
   * @returns the decoded response.
   * @throws when the response is not a usable action envelope.
   */
  private async request(path: string, init?: RequestInit): Promise<ActionResponse> {
    const response = await fetch(`${API_PREFIX}${path}`, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...init,
    })
    if (!response.ok) {
      throw new Error(`flomo host 返回 HTTP ${response.status}`)
    }
    const body = (await response.json()) as ActionResponse
    if (typeof body !== 'object' || body === null || typeof body.state !== 'object') {
      throw new Error('flomo host 返回了无法识别的响应。')
    }
    return body
  }

  /**
   * Run one action and adopt the resulting state.
   *
   * The in-flight counter drives the "保存中" indicator; it is a counter rather
   * than a flag so that overlapping actions cannot clear it early.
   * @param action - the action to send.
   */
  private async act(action: FlomoAction): Promise<void> {
    this.pending += 1
    this.update({ saving: true, error: null })
    try {
      const body = await this.request('/action', {
        method: 'POST',
        body: JSON.stringify(action),
      })
      this.adopt(body.state)
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.pending -= 1
      if (this.pending <= 0) this.update({ saving: false })
    }
  }

  /** {@inheritDoc FlomoSession.refresh} */
  async refresh(): Promise<void> {
    this.update({ status: 'probing', error: null })
    try {
      const body = await this.request('/state')
      this.adopt(body.state)
    } catch (error) {
      this.update({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Point the host at a repository.
   * @param input - owner, repo, optional branch and token.
   */
  async configure(input: HostConnectionInput): Promise<void> {
    await this.act({
      kind: 'configure',
      owner: input.owner,
      repo: input.repo,
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.token ? { token: input.token } : {}),
    })
  }

  /** {@inheritDoc FlomoSession.create} */
  async create(password: string): Promise<void> {
    this.update({ status: 'unlocking' })
    await this.act({ kind: 'create', password })
  }

  /** {@inheritDoc FlomoSession.unlock} */
  async unlock(password: string): Promise<void> {
    this.update({ status: 'unlocking' })
    await this.act({ kind: 'unlock', password })
  }

  /** {@inheritDoc FlomoSession.unlockWithRecovery} */
  async unlockWithRecovery(code: string): Promise<void> {
    this.update({ status: 'unlocking' })
    await this.act({ kind: 'recovery', code })
  }

  /** {@inheritDoc FlomoSession.dismissRecovery} */
  dismissRecovery(): void {
    // The host already treats the code as one-shot, so forgetting it locally is
    // enough to move past the reveal screen.
    this.update({ recoveryCode: null })
  }

  /** Drop the key in the host process and return to the locked screen. */
  async lock(): Promise<void> {
    await this.act({ kind: 'lock' })
  }

  /** {@inheritDoc FlomoSession.add} */
  add(content: string): void {
    void this.act({ kind: 'add', content })
  }

  /** {@inheritDoc FlomoSession.edit} */
  edit(id: string, content: string): void {
    void this.act({ kind: 'edit', id, content })
  }

  /** {@inheritDoc FlomoSession.remove} */
  remove(id: string): void {
    void this.act({ kind: 'remove', id })
  }

  /** {@inheritDoc FlomoSession.pin} */
  pin(id: string, pinned?: boolean): void {
    void this.act({ kind: 'pin', id, ...(pinned === undefined ? {} : { pinned }) })
  }

  /** {@inheritDoc FlomoSession.save} */
  async save(): Promise<void> {
    await this.act({ kind: 'save' })
  }
}
