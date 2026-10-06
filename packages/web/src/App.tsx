/**
 * The web app root: connection settings, then the shared flomo shell.
 *
 * @module @flomo/web/App
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { FlomoApp, GitHubVaultSession, browserCacheArea } from '@flomo/ui'

import { clearConfig, loadConfig, saveConfig } from './config.ts'
import type { WebConfig } from './config.ts'
import { SetupForm } from './SetupForm.tsx'

/**
 * The application.
 * @returns the app element.
 */
export function App(): React.ReactElement {
  const [config, setConfig] = useState<WebConfig | null>(() => loadConfig())
  const [editing, setEditing] = useState(false)

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
  }, [])

  const handleDisconnect = useCallback(() => {
    // Drop the cached ciphertext too: it is harmless, but "clear this device's
    // credentials" leaving blobs behind would be surprising.
    session?.clearCache()
    clearConfig()
    setConfig(null)
    setEditing(false)
  }, [session])

  if (!session || editing) {
    return (
      <SetupForm
        {...(config ? { initial: config } : {})}
        onSubmit={handleSubmit}
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="fl-button" onClick={() => setEditing(true)}>
                修改连接
              </button>
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
