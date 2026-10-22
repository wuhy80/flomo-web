/**
 * First-run connection form.
 *
 * @module @flomo/web/SetupForm
 */

import type * as React from 'react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { createPrivateRepo, GitHubContentsStore } from '@flomo/core'
import { injectFlomoStyles } from '@flomo/ui'

import type { WebConfig } from './config.ts'
import { TOKEN_CREATE_URL, TOKEN_MANAGE_URL, formatProblem, looksLikeToken } from './connection-rules.ts'
import { beginLogin, oauthConfigured } from './oauth.ts'

export interface SetupFormProps {
  /** Pre-fill from an existing config when re-editing. */
  initial?: WebConfig | null
  onSubmit: (config: WebConfig) => void
  onCancel?: () => void
  /**
   * Something to say before the user does anything.
   *
   * Used for how a GitHub login ended when it failed. Reported here rather than
   * from `App` so the message sits beside the control that produced it.
   */
  notice?: string | null
}

/**
 * Collect the repository coordinates and PAT.
 * @param props - initial values and the submit handler.
 * @returns the form element.
 */
export function SetupForm({
  initial,
  onSubmit,
  onCancel,
  notice = null,
}: SetupFormProps): React.ReactElement {
  injectFlomoStyles()

  // The GitHub login is the front door when it is configured; the PAT form is
  // the way in for a deployment with no relay — which is every fork that has not
  // stood one up — and the way back in when the relay is unreachable.
  const [mode, setMode] = useState<'oauth' | 'pat'>(oauthConfigured() ? 'oauth' : 'pat')
  const [signingIn, setSigningIn] = useState(false)

  const [owner, setOwner] = useState(initial?.owner ?? '')
  const [repo, setRepo] = useState(initial?.repo ?? 'flomo-data')
  const [branch, setBranch] = useState(initial?.branch ?? '')
  const [token, setToken] = useState(initial?.token ?? '')
  const [remember, setRemember] = useState(initial?.remember ?? true)
  const [creating, setCreating] = useState(false)
  const [createNote, setCreateNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Well-shaped is not the same as working (`verifyAccess` still runs), but it
  // is what stops a truncated paste from being saved as a connection that can
  // only ever fail at unlock time.
  const shapeProblem =
    mode === 'pat' ? formatProblem(owner.trim(), repo.trim(), token.trim()) : null
  const valid = owner.trim() !== '' && repo.trim() !== '' && token.trim() !== '' && shapeProblem === null
  const canCreate =
    looksLikeToken(token.trim()) && repo.trim() !== '' && !creating

  /**
   * Create the data repository on the user's own account.
   *
   * Deliberately optional. It needs a broader token scope than anything else here
   * ever uses, and pushing someone into granting `Administration: write` just to
   * save one trip to github.com would be the wrong trade.
   */
  const createRepository = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    setCreateNote(null)
    try {
      const created = await createPrivateRepo({ token: token.trim(), name: repo.trim() })
      // The authenticated account, whatever was typed into the owner field.
      setOwner(created.owner)
      setRepo(created.repo)
      setCreateNote(`已创建私有仓库 ${created.owner}/${created.repo}。`)
    } catch (error) {
      setCreateNote(`创建失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCreating(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (checking) return
    // The button is disabled in this state too, but Enter can still submit a
    // form: say what is wrong instead of doing nothing.
    if (!valid) {
      setError(shapeProblem ?? '请把用户名、仓库名和令牌都填写完整。')
      return
    }
    setError(null)
    setChecking(true)
    try {
      // 连接前先向 GitHub 问一次仓库元数据：错误的令牌在这里就被拦下，
      // 而不是等到解锁时变成一条像是密码问题的 Bad credentials。
      const store = new GitHubContentsStore({
        token: token.trim(),
        owner: owner.trim(),
        repo: repo.trim(),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
      })
      const check = await store.verifyAccess()
      if (!check.ok) {
        setError(check.message ?? '连接校验失败，请重试。')
        setChecking(false)
        return
      }
    } catch {
      setError('连接校验失败，请重试。')
      setChecking(false)
      return
    }
    setChecking(false)
    onSubmit({
      owner: owner.trim(),
      repo: repo.trim(),
      ...(branch.trim() ? { branch: branch.trim() } : {}),
      token: token.trim(),
      remember,
    })
  }

  return (
    <div className="fl-root">
      <div className="fl-gate">
        <form className="fl-gate-card" style={{ maxWidth: 420 }} onSubmit={submit}>
          <div className="fl-gate-brand">
            <span className="fl-brand-dot" aria-hidden="true" />
            flomo
          </div>
          <h1 className="fl-gate-title">连接你的数据仓库</h1>
          <p className="fl-gate-sub">
            笔记会加密后存进一个<strong>私有</strong>仓库。即使这个 token 泄露，对方拿到的也只是密文。
          </p>

          {notice !== null ? (
            <div className="fl-gate-error" role="alert">
              {notice}
            </div>
          ) : null}

          {mode === 'oauth' ? (
            <>
              <button
                type="button"
                className="fl-button fl-button-primary fl-gate-submit"
                disabled={signingIn}
                onClick={() => {
                  setSigningIn(true)
                  void beginLogin()
                }}
              >
                {signingIn ? '正在跳转到 GitHub…' : '用 GitHub 登录'}
              </button>
              <p className="fl-recovery-hint" style={{ marginTop: 10, textAlign: 'left' }}>
                登录只解决「怎么读写这个私有仓库」。
                <strong>笔记仍然要用你的密码解密</strong> —— GitHub 和登录中转都拿不到明文。
              </p>
              <button type="button" className="fl-gate-switch" onClick={() => setMode('pat')}>
                改用手动令牌
              </button>
            </>
          ) : null}

          {mode === 'pat' ? (
            <>
              <label className="fl-field">
                <span className="fl-field-label">GitHub 用户名</span>
                <input
                  className="fl-input"
                  value={owner}
                  autoFocus
                  spellCheck={false}
                  placeholder="your-name"
                  onChange={(event) => setOwner(event.target.value)}
                />
              </label>

              <label className="fl-field">
                <span className="fl-field-label">私有仓库名</span>
                <input
                  className="fl-input"
                  value={repo}
                  spellCheck={false}
                  placeholder="flomo-data"
                  onChange={(event) => setRepo(event.target.value)}
                />
              </label>

              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="fl-button"
                  disabled={!canCreate}
                  onClick={() => void createRepository()}
                >
                  {creating ? '创建中…' : '在我的账号下创建这个私有仓库'}
                </button>
                <p className="fl-recovery-hint" style={{ marginTop: 2 }}>
                  可选。这一步需要令牌额外具备 <code>Administration: Read and write</code>。
                  如果你自己已经建好仓库，就<strong>不要</strong>授予这个权限。
                </p>
                {createNote ? <div className="fl-import-report">{createNote}</div> : null}
              </div>

              <label className="fl-field">
                <span className="fl-field-label">分支（可留空，默认分支）</span>
                <input
                  className="fl-input"
                  value={branch}
                  spellCheck={false}
                  placeholder="main"
                  onChange={(event) => setBranch(event.target.value)}
                />
              </label>

              <label className="fl-field">
                <span
                  className="fl-field-label"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
                >
                  <span>细粒度访问令牌（PAT）</span>
                  <a
                    className="fl-md-a"
                    style={{ fontSize: 12 }}
                    href={TOKEN_CREATE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    还没有？去创建 ↗
                  </a>
                </span>
                <input
                  className="fl-input"
                  type="password"
                  value={token}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="github_pat_…"
                  onChange={(event) => setToken(event.target.value)}
                />
                <span className="fl-recovery-hint" style={{ display: 'block', marginTop: 5 }}>
                  创建时的三件事：<strong>Repository access</strong> 选「Only select repositories」
                  并勾上这个笔记仓库；权限里只勾 <strong>Contents: Read and write</strong>；
                  其它一律不用给。上面那个链接会把名称、说明和这项权限预先填好。
                </span>
              </label>

              <label className="fl-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span className="fl-field-label" style={{ margin: 0 }}>
                  在这台设备上记住
                </span>
              </label>

              {error !== null ? (
                <div className="fl-gate-error" role="alert">
                  {error}
                </div>
              ) : null}

              {shapeProblem !== null && token.trim() !== '' ? (
                <p className="fl-recovery-hint" style={{ marginTop: 0, color: 'var(--flomo-danger)' }}>
                  {shapeProblem}
                </p>
              ) : null}

              <button
                type="submit"
                className="fl-button fl-button-primary fl-gate-submit"
                disabled={!valid || checking}
              >
                {checking ? '校验中…' : '连接'}
              </button>

              <p className="fl-recovery-hint" style={{ marginTop: 18, textAlign: 'left' }}>
                令牌过期或需要换一个时，到同一个页面删旧建新；换好后回到这里重新连接即可。
              </p>{' '}
              <a
                className="fl-md-a"
                href={TOKEN_MANAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                管理或续期已创建的令牌 ↗
              </a>
            </>
          ) : null}

          {onCancel ? (
            <button type="button" className="fl-gate-switch" onClick={onCancel}>
              取消
            </button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
