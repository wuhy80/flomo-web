/**
 * The DSH panel: a sidebar row and a full center-column flomo page.
 *
 * The panel is registered the way every shipped panel is — a row in the
 * shell's own global panel list and an occupant of the layout's keyed `main`
 * slot — rather than by taking over DOM. The shell therefore owns the row box,
 * the label, the active highlight, the collapsed rail and the panel switch, and
 * this file only supplies the glyph and the page.
 *
 * @module dsh-flomo/client/panel
 */

import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'

import { FlomoApp } from '@flomo/ui'

import type { HostFlomoSession } from './session.ts'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export const FLOMO_PANEL_ID = 'flomo'

/** Row order among the shell's global panel rows (Plugins is 0, Schedule 10). */
const PANEL_ORDER = 30

/** The context face this plugin needs from the client runtime. */
export interface ClientContext {
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  effect?: (callback: () => (() => void) | void, label?: string) => void
}

/**
 * The sidebar glyph, drawn at the size and state the shell asks for.
 * @param props - the shell's icon share.
 * @returns the glyph.
 */
export function FlomoPanelIcon({ size }: { size: number; active: boolean }): React.ReactElement {
  return (
    <svg
      data-dsh-panel-entry={FLOMO_PANEL_ID}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2" width="11" height="12" rx="2" />
      <path d="M5.2 5.6h5.6M5.2 8h5.6M5.2 10.4h3.2" />
    </svg>
  )
}

/**
 * The connection facts, spelled out so the panel survives a session that does
 * not carry them.
 *
 * {@link HostFlomoSession} always initializes this, but the panel is a boundary
 * that a future or alternative session implementation could cross, and reading
 * a missing field here would blank the entire sidebar page rather than degrade.
 */
const EMPTY_CONNECTION = {
  owner: null as string | null,
  repo: null as string | null,
  branch: null as string | null,
  hasToken: false,
  hasStoredPassword: false,
  toolsRegistered: false,
  toolsError: null as string | null,
}

/**
 * Read a session's connection facts, tolerating their absence.
 * @param session - the host session.
 * @returns its connection facts, or an empty set.
 */
function connectionOf(session: HostFlomoSession): typeof EMPTY_CONNECTION {
  return session.connection ?? EMPTY_CONNECTION
}

/**
 * First-run connection form, shown when the host has no repository yet.
 * @param props - the host session to configure.
 * @returns the form.
 */
function HostSetup({ session }: { session: HostFlomoSession }): React.ReactElement {
  const connection = connectionOf(session)
  const [owner, setOwner] = useState(connection.owner ?? '')
  const [repo, setRepo] = useState(connection.repo ?? 'flomo-data')
  const [branch, setBranch] = useState(connection.branch ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = owner.trim() !== '' && repo.trim() !== '' && token.trim() !== ''

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      if (!valid || busy) return
      setBusy(true)
      void session
        .configure({
          owner: owner.trim(),
          repo: repo.trim(),
          ...(branch.trim() ? { branch: branch.trim() } : {}),
          token: token.trim(),
        })
        .finally(() => setBusy(false))
    },
    [valid, busy, session, owner, repo, branch, token],
  )

  return (
    <form onSubmit={submit}>
      <h2 className="fl-column-title">连接 flomo 数据仓库</h2>
      <p className="fl-gate-sub" style={{ marginTop: 10 }}>
        token 会存进 DSH 凭据中心，<strong>不会</strong>发到浏览器。笔记以 AES-256-GCM
        加密后写入这个私有仓库。
      </p>

      <label className="fl-field">
        <span className="fl-field-label">GitHub 用户名</span>
        <input className="fl-input" value={owner} spellCheck={false} onChange={(e) => setOwner(e.target.value)} />
      </label>

      <label className="fl-field">
        <span className="fl-field-label">私有仓库名</span>
        <input className="fl-input" value={repo} spellCheck={false} onChange={(e) => setRepo(e.target.value)} />
      </label>

      <label className="fl-field">
        <span className="fl-field-label">分支（可留空）</span>
        <input className="fl-input" value={branch} spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
      </label>

      <label className="fl-field">
        <span className="fl-field-label">细粒度访问令牌（PAT）</span>
        <input
          className="fl-input"
          type="password"
          value={token}
          spellCheck={false}
          autoComplete="off"
          placeholder="github_pat_…"
          onChange={(e) => setToken(e.target.value)}
        />
      </label>

      {session.getSnapshot().error ? (
        <div className="fl-gate-error">{session.getSnapshot().error}</div>
      ) : null}

      <button type="submit" className="fl-button fl-button-primary" disabled={!valid || busy}>
        {busy ? '连接中…' : '连接'}
      </button>
    </form>
  )
}

/**
 * Settings content specific to the DSH panel.
 * @param props - the host session.
 * @returns the settings block.
 */
function HostSettings({ session }: { session: HostFlomoSession }): React.ReactElement {
  const { owner, repo, branch, hasStoredPassword, toolsRegistered, toolsError } =
    connectionOf(session)
  return (
    <div className="fl-card-lg" style={{ marginTop: 16 }}>
      <div className="fl-recovery-title" style={{ color: 'var(--flomo-text)' }}>
        由 DSH 宿主托管
      </div>
      <p className="fl-review-note" style={{ marginTop: 10 }}>
        {owner && repo ? `${owner}/${repo}${branch ? ` @ ${branch}` : ''}` : '尚未配置仓库'}
      </p>
      <p className="fl-recovery-hint">
        {hasStoredPassword
          ? '宿主存有密码，agent 工具无需手动解锁即可读写笔记。'
          : '宿主没有存密码：本次解锁的密钥只存在于内存中，DSH 重启后需要重新解锁。'}
      </p>
      {/* Shown here and not only in the state route: a tool that failed to
          register is otherwise completely invisible, and "the agent cannot see my
          notes" is a confusing thing to debug from the outside. */}
      <p className="fl-recovery-hint">
        agent 工具：
        {toolsRegistered ? (
          <strong>已注册</strong>
        ) : (
          <>
            <strong style={{ color: 'var(--flomo-danger)' }}>未注册</strong>
            {toolsError ? ` —— ${toolsError}` : ''}
          </>
        )}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="fl-button" onClick={() => void session.save()}>
          立即保存
        </button>
        <button type="button" className="fl-button fl-button-danger" onClick={() => void session.lock()}>
          锁定
        </button>
      </div>
    </div>
  )
}

/**
 * The center-column page.
 * @param props - the injected host session.
 * @returns the page.
 */
export function FlomoPanel({ session }: { session: HostFlomoSession }): React.ReactElement {
  return (
    <div style={{ height: '100%', minHeight: 0 }} data-dsh-plugin="flomo">
      <FlomoApp
        session={session}
        showSettings
        renderUnconfigured={() => <HostSetup session={session} />}
        renderSettingsExtra={() => <HostSettings session={session} />}
      />
    </div>
  )
}

/**
 * Register the sidebar row and the center-column page.
 *
 * Both seats are declared by shell plugins this package does not depend on at
 * runtime, so each registration goes through `slots.inject`: the callback runs
 * only once the owning shell entry has declared the seat, which makes load
 * order irrelevant and leaves the panel simply absent on a shell that cannot
 * serve it, instead of failing the boot.
 * @param ctx - client root context (service: slots).
 * @param session - the host-backed session the page drives.
 * @returns a disposer releasing both registrations.
 */
export function registerFlomoPanel(ctx: ClientContext, session: HostFlomoSession): () => void {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: FLOMO_PANEL_ID,
          order: PANEL_ORDER,
          label: () => 'flomo',
        },
        FlomoPanelIcon,
      ),
    ),
  )

  disposers.push(
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        {
          name: 'main',
          key: FLOMO_PANEL_ID,
          inject: () => ({ session }),
        },
        FlomoPanel,
      ),
    ),
  )

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
