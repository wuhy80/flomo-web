/**
 * The web app root: connection settings, then the shared flomo shell.
 *
 * @module @flomo/web/App
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FlomoApp, GitHubVaultSession, browserCacheArea } from '@flomo/ui'

import { clearConfig, configFromLogin, loadConfig, saveConfig } from './config.ts'
import type { WebConfig } from './config.ts'
import {
  beginLogin,
  clearCallbackFromUrl,
  oauthConfigured,
  refreshSession,
  takeCallback,
} from './oauth.ts'
import { SetupForm } from './SetupForm.tsx'

/**
 * Renew an OAuth token this far before it lapses, so a save does not race the
 * expiry. Five minutes is long enough to cover a slow write and short enough
 * that the token in hand is still the useful one.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * Whether a stored token is worth renewing before use.
 * @param config - the stored config.
 * @returns true when it is an OAuth token with a refresh token and little time left.
 */
function needsRefresh(config: WebConfig): boolean {
  return (
    config.auth === 'oauth' &&
    typeof config.refreshToken === 'string' &&
    typeof config.expiresAt === 'number' &&
    config.expiresAt - Date.now() < REFRESH_MARGIN_MS
  )
}

/**
 * The current query string, or `''` where there is no document.
 *
 * Guarded twice on purpose: server rendering has no `window` at all, and a test
 * harness may install one that has storage but no `location`.
 * @returns `location.search`, or an empty string.
 */
function currentSearch(): string {
  try {
    return typeof window === 'undefined' ? '' : (window.location?.search ?? '')
  } catch {
    return ''
  }
}

/**
 * The application.
 * @returns the app element.
 */
export function App(): React.ReactElement {
  // Started synchronously from the initial state so the first paint never shows
  // a setup form to someone who is in fact mid-callback: a `?code=` in the URL
  // means the answer is already on its way.
  const [callback, setCallback] = useState<'idle' | 'pending'>(() => {
    const search = currentSearch()
    return search.includes('code=') || search.includes('error=') ? 'pending' : 'idle'
  })

  const [config, setConfig] = useState<WebConfig | null>(() => loadConfig())
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [renewing, setRenewing] = useState(false)

  /**
   * The token a refresh was already attempted for.
   *
   * Without this, a relay that answers with a short lifetime (or no lifetime at
   * all, but a token the margin still considers stale) would make the refresh
   * effect re-trigger itself forever: each answer produces a new config object,
   * which is this effect's dependency, and the new token would look stale again
   * on the next pass. One attempt per token is the correct unit.
   */
  const refreshAttemptedFor = useRef<string | null>(null)

  useEffect(() => {
    if (callback === 'idle') return
    let cancelled = false

    void (async () => {
      const result = await takeCallback(currentSearch())
      // The parameters are spent either way; leaving a `code` in the address bar
      // puts it in the next bookmark and screenshot for no benefit.
      clearCallbackFromUrl()
      if (cancelled) return

      // Unconditionally, and before any early return: a callback that produced
      // nothing usable must still stop the "正在完成登录" screen, or the app is
      // stuck on it for as long as the tab lives.
      setCallback('idle')

      if (result.kind === 'none') {
        // A `?code=` that was not an OAuth callback after all (or one already
        // spent): fall through to the normal first-run experience.
        setEditing(true)
        return
      }
      if (result.kind === 'error') {
        setNotice(result.message)
        setEditing(true)
        return
      }

      // Repository and branch are kept from an existing config: a refresh must
      // not quietly move the vault back to the default repository name.
      const next = configFromLogin(result.session, loadConfig() ?? undefined)
      saveConfig(next)
      setConfig(next)
      setEditing(false)
      setNotice(null)
    })()

    return () => {
      cancelled = true
    }
    // Runs once, for the load that carried the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!config || !needsRefresh(config)) return
    // One attempt per token: see `refreshAttemptedFor`. A second pass over the
    // same token can only repeat the same answer.
    if (refreshAttemptedFor.current === config.token) return
    refreshAttemptedFor.current = config.token

    let cancelled = false
    setRenewing(true)

    void (async () => {
      const refreshToken = config.refreshToken
      if (refreshToken === undefined) return
      const session = await refreshSession(refreshToken)
      if (cancelled) return
      setRenewing(false)
      // A failed renewal is not an error worth a banner: the token still works
      // until it lapses, and the session will say so then with a real message.
      if (session === null) return
      const next = configFromLogin(session, config)
      saveConfig(next)
      setConfig(next)
    })()

    return () => {
      cancelled = true
    }
  }, [config])

  const session = useMemo(
    () =>
      config
        ? new GitHubVaultSession({
            owner: config.owner,
            repo: config.repo,
            token: config.token,
            ...(config.branch ? { branch: config.branch } : {}),
            // Ciphertext only, so offline reading costs nothing in secrecy.
            cache: browserCacheArea(),
          })
        : null,
    [config],
  )

  useEffect(() => {
    if (!session) return
    return () => session.dispose()
  }, [session])

  const handleSubmit = useCallback((next: WebConfig) => {
    saveConfig(next)
    setConfig(next)
    setEditing(false)
    setNotice(null)
  }, [])

  const handleDisconnect = useCallback(() => {
    // Drop the cached ciphertext too: it is harmless, but "clear this device's
    // credentials" leaving blobs behind would be surprising.
    session?.clearCache()
    clearConfig()
    setConfig(null)
    setEditing(false)
  }, [session])

  if (callback === 'pending' || renewing) {
    return (
      <div className="fl-root">
        <div className="fl-gate">
          <div className="fl-gate-card" style={{ maxWidth: 420 }}>
            <div className="fl-gate-brand">
              <span className="fl-brand-dot" aria-hidden="true" />
              flomo
            </div>
            <h1 className="fl-gate-title">{renewing ? '正在续期登录…' : '正在完成 GitHub 登录…'}</h1>
            <p className="fl-gate-sub">稍等，正在和 GitHub 确认身份。</p>
          </div>
        </div>
      </div>
    )
  }

  if (!session || editing) {
    return (
      <SetupForm
        {...(config ? { initial: config } : {})}
        onSubmit={handleSubmit}
        notice={notice}
        {...(config ? { onCancel: () => setEditing(false) } : {})}
      />
    )
  }

  return (
    <FlomoApp
      session={session}
      renderSettingsExtra={() => {
        // Re-checked here rather than relying on the narrowing above, which
        // does not survive into a closure that runs after this render.
        if (!config) return null
        return (
          <div className="fl-card-lg" style={{ marginTop: 16 }}>
            <div className="fl-recovery-title" style={{ color: 'var(--flomo-text)' }}>
              数据仓库
            </div>
            <p className="fl-review-note" style={{ marginTop: 10 }}>
              {config.owner}/{config.repo}
              {config.branch ? ` @ ${config.branch}` : ''}
            </p>
            <p className="fl-recovery-hint">
              {config.auth === 'oauth'
                ? `已用 GitHub 账号 ${config.login ?? config.owner} 登录。`
                : '使用手动填写的访问令牌。'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="fl-button" onClick={() => setEditing(true)}>
                修改连接
              </button>
              {oauthConfigured() ? (
                <button
                  type="button"
                  className="fl-button"
                  onClick={() => {
                    void beginLogin()
                  }}
                >
                  重新用 GitHub 登录
                </button>
              ) : null}
              <button
                type="button"
                className="fl-button fl-button-danger"
                onClick={handleDisconnect}
              >
                断开并清除本机凭据
              </button>
            </div>
            <p className="fl-recovery-hint">
              断开只会清除这台设备上保存的 token，仓库里的笔记不受影响。
            </p>
          </div>
        )
      }}
    />
  )
}
