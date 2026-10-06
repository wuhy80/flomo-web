/**
 * First-run connection form.
 *
 * @module @flomo/web/SetupForm
 */

import type * as React from 'react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { createPrivateRepo } from '@flomo/core'
import { injectFlomoStyles } from '@flomo/ui'

import type { WebConfig } from './config.ts'

export interface SetupFormProps {
  /** Pre-fill from an existing config when re-editing. */
  initial?: WebConfig | null
  onSubmit: (config: WebConfig) => void
  onCancel?: () => void
}

/**
 * Collect the repository coordinates and PAT.
 * @param props - initial values and the submit handler.
 * @returns the form element.
 */
export function SetupForm({ initial, onSubmit, onCancel }: SetupFormProps): React.ReactElement {
  injectFlomoStyles()

  const [owner, setOwner] = useState(initial?.owner ?? '')
  const [repo, setRepo] = useState(initial?.repo ?? 'flomo-data')
  const [branch, setBranch] = useState(initial?.branch ?? '')
  const [token, setToken] = useState(initial?.token ?? '')
  const [remember, setRemember] = useState(initial?.remember ?? true)
  const [creating, setCreating] = useState(false)
  const [createNote, setCreateNote] = useState<string | null>(null)

  const valid = owner.trim() && repo.trim() && token.trim()
  const canCreate = token.trim() !== '' && repo.trim() !== '' && !creating

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
      const created = await createPrivateRepo(token.trim(), repo.trim())
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
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
              className="fl-button fl-button-ghost"
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
            <span className="fl-field-label">细粒度访问令牌（PAT）</span>
            <input
              className="fl-input"
              type="password"
              value={token}
              spellCheck={false}
              autoComplete="off"
              placeholder="github_pat_…"
              onChange={(event) => setToken(event.target.value)}
            />
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

          <button
            type="submit"
            className="fl-button fl-button-primary fl-gate-submit"
            disabled={!valid}
          >
            连接
          </button>

          {onCancel ? (
            <button type="button" className="fl-gate-switch" onClick={onCancel}>
              取消
            </button>
          ) : null}

          <p className="fl-recovery-hint" style={{ marginTop: 18, textAlign: 'left' }}>
            令牌权限只需 <code>Contents: Read and write</code>，范围限定在这一个仓库。
            在 GitHub 的 Settings → Developer settings → Fine-grained tokens 创建。
          </p>
        </form>
      </div>
    </div>
  )
}
