/**
 * The password gate.
 *
 * Because the vault is encrypted client-side, this is not a login form: there
 * is nothing to authenticate against. Unlocking *is* deriving the key and
 * proving it opens the header, which is why a wrong password and a corrupt
 * repository are both surfaced as "could not open".
 *
 * Two things follow from that, and both are here:
 *
 * - Creating a vault is irreversible from the browser's point of view, so the
 *   password is checked against {@link checkNewPassword} *before* anything is
 *   minted. A typo can no longer become the only key to the data.
 * - If a vault exists but cannot be opened — the classic case being a first
 *   initialization that went in wrong — the gate offers
 *   {@link GateMode | re-initialization}: a new vault in the same repository,
 *   with the old ciphertext archived rather than deleted.
 *
 * @module @flomo/ui/UnlockGate
 */

import type * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { checkNewPassword, canSubmitUnlock } from './password-policy.ts'
import type { SessionStatus, UnlockOptions } from './session.ts'

/** Which form the gate is showing. */
type GateMode =
  /** Open an existing vault with the password. */
  | 'unlock'
  /** Create a vault in a repository that has none. */
  | 'create'
  /** Open with the base64 recovery code instead of the password. */
  | 'recovery'
  /**
   * Replace the existing vault with a new one, for when the password is lost
   * and there is no recovery code — or when the first attempt went in wrong.
   */
  | 'reinitialize'

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
  /**
   * Re-mint the vault under a new password, archiving the old ciphertext.
   *
   * Absent on backends that cannot rewrite the repository (the DSH panel speaks
   * a host protocol that does not), in which case the destructive path is
   * simply not offered.
   */
  onReinitialize?: (password: string, options: UnlockOptions) => void
}

/**
 * The gate screen.
 * @param props - vault presence, status, and the entry actions.
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
  onReinitialize,
}: UnlockGateProps): React.ReactElement {
  const [mode, setMode] = useState<GateMode>(hasVault ? 'unlock' : 'create')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [reveal, setReveal] = useState(false)

  const busy = status === 'unlocking'
  const creating = mode === 'create' || mode === 'reinitialize'

  // One policy for both paths that mint a key. Re-initialization is the more
  // dangerous of the two, so it certainly does not get a weaker check.
  const verdict = useMemo(() => checkNewPassword(password, confirm), [password, confirm])

  const canSubmit =
    !busy &&
    (mode === 'recovery'
      ? code.trim().length > 0
      : creating
        ? verdict.ok
        : canSubmitUnlock(password))

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      if (!canSubmit) return
      const options: UnlockOptions = { remember }
      if (mode === 'create') onCreate(password, options)
      else if (mode === 'unlock') onUnlock(password, options)
      else if (mode === 'reinitialize') onReinitialize?.(password, options)
      else onUnlockWithRecovery(code.trim(), options)
    },
    [canSubmit, mode, password, code, remember, onCreate, onUnlock, onUnlockWithRecovery, onReinitialize],
  )

  /**
   * Switch forms and clear the secrets typed into the previous one.
   *
   * Carrying a half-typed password across a mode change is how a "wrong
   * password" gets created in the first place.
   * @param next - the mode to show.
   */
  const go = useCallback((next: GateMode) => {
    setPassword('')
    setConfirm('')
    setCode('')
    setReveal(false)
    setMode(next)
  }, [])

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

  const title =
    mode === 'create'
      ? '创建保险库'
      : mode === 'reinitialize'
        ? '重新初始化保险库'
        : mode === 'recovery'
          ? '使用恢复码'
          : '解锁'

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
              <h1 className="fl-gate-title">{title}</h1>
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
              <h1 className="fl-gate-title">{title}</h1>
              <p className="fl-gate-sub">
                {mode === 'create'
                  ? '密码只在本机使用，不会上传到任何地方。'
                  : mode === 'reinitialize'
                    ? '为这个仓库换一把新锁。旧的加密笔记会移动到 data/bak- 备份目录，不会被删除。'
                    : '输入密码以解密你的笔记。'}
              </p>

              {mode === 'reinitialize' ? (
                <div className="fl-gate-warning" role="alert">
                  这是一次本机重置：会清除这台浏览器记住的密钥与离线缓存，并把仓库里的
                  <code>vault.json</code> 换成本次设置的新密码。
                  <strong>旧的笔记不会被删除，但新密码打不开它们</strong>
                  ——要读回旧内容，仍需要旧密码或旧恢复码。没有笔记时，这一步是安全的。
                </div>
              ) : null}

              <label className="fl-field">
                <span className="fl-field-label">{creating ? '新密码' : '密码'}</span>
                <input
                  className="fl-input"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  autoFocus
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  spellCheck={false}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              {creating ? (
                <label className="fl-field">
                  <span className="fl-field-label">再输一次</span>
                  <input
                    className="fl-input"
                    type={reveal ? 'text' : 'password'}
                    value={confirm}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </label>
              ) : null}

              {creating ? (
                <>
                  <label className="fl-gate-remember" title="显示输入内容，避免中文输入法或大小写把密码输错">
                    <input
                      type="checkbox"
                      checked={reveal}
                      onChange={(event) => setReveal(event.target.checked)}
                    />
                    <span>显示密码</span>
                  </label>
                  <ul className="fl-gate-rules" aria-label="密码要求">
                    {verdict.rules.map((rule) => (
                      <li key={rule.id} data-ok={rule.ok ? 'true' : 'false'}>
                        <span aria-hidden="true">{rule.ok ? '✓' : '·'}</span> {rule.label}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}

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
            className={`fl-button fl-button-primary fl-gate-submit${mode === 'reinitialize' ? ' fl-gate-submit-danger' : ''}`}
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <span className="fl-spinner" />
                正在派生密钥…
              </>
            ) : mode === 'create' ? (
              '创建'
            ) : mode === 'reinitialize' ? (
              '清除本机并重新初始化'
            ) : mode === 'recovery' ? (
              '用恢复码打开'
            ) : (
              '解锁'
            )}
          </button>

          {mode === 'recovery' ? (
            <button type="button" className="fl-gate-switch" onClick={() => go(hasVault ? 'unlock' : 'create')}>
              改用密码
            </button>
          ) : (
            <button type="button" className="fl-gate-switch" onClick={() => go('recovery')}>
              忘记了密码？用恢复码
            </button>
          )}

          {hasVault && mode === 'create' ? (
            <button type="button" className="fl-gate-switch" onClick={() => go('unlock')}>
              其实已有保险库，去解锁
            </button>
          ) : null}

          {/* The escape hatch sits last and out of the way: it is for the day the
              password stops working, not a button to press on the way in. */}
          {hasVault && mode === 'unlock' && onReinitialize !== undefined ? (
            <button type="button" className="fl-gate-switch" onClick={() => go('reinitialize')}>
              密码始终不对？清除本机记录并重新初始化
            </button>
          ) : null}

          {mode === 'reinitialize' ? (
            <button type="button" className="fl-gate-switch" onClick={() => go('unlock')}>
              取消，回到解锁
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
