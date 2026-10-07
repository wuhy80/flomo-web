/**
 * The password gate.
 *
 * Because the vault is encrypted client-side, this is not a login form: there
 * is nothing to authenticate against. Unlocking *is* deriving the key and
 * proving it opens the header, which is why a wrong password and a corrupt
 * repository are both surfaced as "could not open".
 *
 * @module @flomo/ui/UnlockGate
 */

import type * as React from 'react'
import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'

import type { SessionStatus, UnlockOptions } from './session.ts'

/** Which form the gate is showing. */
type GateMode =
  /** Open an existing vault with the password. */
  | 'unlock'
  /** Create a vault in a repository that has none. */
  | 'create'
  /** Open with the base64 recovery code instead of the password. */
  | 'recovery'

export interface UnlockGateProps {
  /** Whether a vault already exists remotely. */
  hasVault: boolean
  status: SessionStatus
  error: string | null
  /** Set immediately after creating a vault; the user must save it. */
  recoveryCode: string | null
  brand?: string
  onCreate: (password: string, options: UnlockOptions) => void
  onUnlock: (password: string, options: UnlockOptions) => void
  onUnlockWithRecovery: (code: string, options: UnlockOptions) => void
  onDismissRecovery: () => void
}

/**
 * The gate screen.
 * @param props - vault presence, status, and the three entry actions.
 * @returns the gate element.
 */
export function UnlockGate({
  hasVault,
  status,
  error,
  recoveryCode,
  brand = 'flomo',
  onCreate,
  onUnlock,
  onUnlockWithRecovery,
  onDismissRecovery,
}: UnlockGateProps): React.ReactElement {
  const [mode, setMode] = useState<GateMode>(hasVault ? 'unlock' : 'create')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)

  const busy = status === 'unlocking'
  const mismatch = mode === 'create' && confirm.length > 0 && password !== confirm
  const canSubmit =
    !busy &&
    (mode === 'recovery'
      ? code.trim().length > 0
      : password.length > 0 && (mode !== 'create' || password === confirm))

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      if (!canSubmit) return
      const options: UnlockOptions = { remember }
      if (mode === 'create') onCreate(password, options)
      else if (mode === 'unlock') onUnlock(password, options)
      else onUnlockWithRecovery(code.trim(), options)
    },
    [canSubmit, mode, password, code, remember, onCreate, onUnlock, onUnlockWithRecovery],
  )

  // The recovery code is shown exactly once, immediately after creation, and is
  // never written to the repository — losing it plus the password loses the data.
  if (recoveryCode) {
    return (
      <div className="fl-root">
        <div className="fl-gate">
          <div className="fl-gate-card">
            <div className="fl-gate-brand">
              <span className="fl-brand-dot" aria-hidden="true" />
              {brand}
            </div>
            <h1 className="fl-gate-title">保险库已创建</h1>
            <p className="fl-gate-sub">请立刻保存下面这串恢复码。</p>

            <div className="fl-recovery">
              <div className="fl-recovery-title">恢复码（只显示这一次）</div>
              <div className="fl-recovery-text">{recoveryCode}</div>
              <p className="fl-recovery-hint">
                它等同于你的密码。忘掉密码时，只能靠它取回数据。请抄写到密码管理器或纸上，
                <strong>不要</strong>放进这个仓库里。
              </p>
            </div>

            <button
              type="button"
              className="fl-button fl-button-primary fl-gate-submit"
              style={{ marginTop: 18 }}
              onClick={onDismissRecovery}
            >
              我已妥善保存，进入
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fl-root">
      <div className="fl-gate">
        <form className="fl-gate-card" onSubmit={submit}>
          <div className="fl-gate-brand">
            <span className="fl-brand-dot" aria-hidden="true" />
            {brand}
          </div>

          {mode === 'recovery' ? (
            <>
              <h1 className="fl-gate-title">使用恢复码</h1>
              <p className="fl-gate-sub">粘贴创建保险库时保存的那串恢复码。</p>
              <label className="fl-field">
                <span className="fl-field-label">恢复码</span>
                <input
                  className="fl-input"
                  type="text"
                  value={code}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="base64…"
                />
              </label>
            </>
          ) : (
            <>
              <h1 className="fl-gate-title">{mode === 'create' ? '创建保险库' : '解锁'}</h1>
              <p className="fl-gate-sub">
                {mode === 'create'
                  ? '密码只在本机使用，不会上传到任何地方。'
                  : '输入密码以解密你的笔记。'}
              </p>

              <label className="fl-field">
                <span className="fl-field-label">密码</span>
                <input
                  className="fl-input"
                  type="password"
                  value={password}
                  autoFocus
                  autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              {mode === 'create' ? (
                <label className="fl-field">
                  <span className="fl-field-label">再输一次</span>
                  <input
                    className="fl-input"
                    type="password"
                    value={confirm}
                    autoComplete="new-password"
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </label>
              ) : null}
            </>
          )}

          {mismatch ? <div className="fl-gate-error">两次输入不一致。</div> : null}
          {error ? <div className="fl-gate-error">{error}</div> : null}

          {mode !== 'recovery' ? (
            <label className="fl-gate-remember" title="在本设备保存派生密钥（并非密码），72 小时内刷新不再询问">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>三天内免输密码</span>
            </label>
          ) : null}

          <button
            type="submit"
            className="fl-button fl-button-primary fl-gate-submit"
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <span className="fl-spinner" />
                正在派生密钥…
              </>
            ) : mode === 'create' ? (
              '创建'
            ) : (
              '解锁'
            )}
          </button>

          {mode === 'recovery' ? (
            <button
              type="button"
              className="fl-gate-switch"
              onClick={() => setMode(hasVault ? 'unlock' : 'create')}
            >
              改用密码
            </button>
          ) : (
            <button
              type="button"
              className="fl-gate-switch"
              onClick={() => setMode('recovery')}
            >
              忘记了密码？用恢复码
            </button>
          )}

          {hasVault && mode === 'create' ? (
            <button type="button" className="fl-gate-switch" onClick={() => setMode('unlock')}>
              其实已有保险库，去解锁
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
