/**
 * The whole journey, over the wire.
 *
 * Everything goes through the plugin's real HTTP surface, in the order a person
 * would click: configure, create, capture, save, then read it back from both the
 * panel's route and the agent's tool. Core already tests the vault; what is
 * checked here is the seams between the halves, and — the part nothing else
 * asserts — that no plaintext, password or token ends up anywhere it should not.
 *
 * The markers are distinctive strings rather than realistic text, so a failure
 * names exactly which secret leaked and into which file.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, describe, it } from 'node:test'

import { MemoryStore } from '@flomo/core/testing'
import type { Memo } from '@flomo/core'

import { TOKEN_REF } from '../src/host-service.ts'
import { API_PREFIX } from '../src/protocol.ts'
import { buildFlomoTools, identityDefineTool } from '../src/host/tools.ts'

import { cleanupTempDirs, makeHost, makeTempDir, serve } from './support.ts'

after(cleanupTempDirs)

/** A string that must never appear outside the decrypted memo. */
const MEMO_MARKER = '绝密标记-Zx9'
/** A password that must never appear anywhere at all. */
const PASSWORD = '绝密口令-Pw7'
/** A token that belongs in the credential store and nowhere else. */
const TOKEN = 'ghp_绝密令牌-Zx9'

/** The state the action route hands back. */
interface ActionResult {
  ok: boolean
  state: {
    status: string
    memos: Memo[]
    recoveryCode: string | null
    error: string | null
  }
}

describe('the whole journey over the wire', () => {
  it('configures, creates, captures, saves and finds, leaving no secret behind', async () => {
    const dir = await makeTempDir()
    const backing = new MemoryStore()
    const { host, credentials, configPath } = await makeHost(dir, backing)
    const { server, base } = await serve(host)
    const headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

    /**
     * Post an action the way the panel does.
     * @param body - the action payload.
     * @returns the resulting state.
     */
    const act = async (body: unknown): Promise<ActionResult> => {
      const response = await fetch(`${base}${API_PREFIX}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 200, `action failed: ${JSON.stringify(body)}`)
      return (await response.json()) as ActionResult
    }

    try {
      // 1. Connect a repository.
      const configured = await act({
        kind: 'configure',
        owner: 'me',
        repo: 'flomo-data',
        token: TOKEN,
      })
      assert.equal(configured.state.status, 'locked', 'an existing vault starts locked')

      // 2. Create the vault, which is the one time the recovery code is shown.
      const created = await act({ kind: 'create', password: PASSWORD })
      assert.equal(created.state.status, 'unlocked')
      const recoveryCode = created.state.recoveryCode
      assert.ok(recoveryCode, 'creating a vault must hand back a recovery code')

      // 3. Capture.
      const added = await act({ kind: 'add', content: `一条真正的记录 ${MEMO_MARKER} #旅程` })
      assert.equal(added.state.memos.length, 1)
      assert.deepEqual(added.state.memos[0]?.tags, ['旅程'], 'tags are parsed on capture')

      // 4. Save.
      const saved = await act({ kind: 'save' })
      assert.equal(saved.state.error, null)

      // 5. The panel's read model agrees.
      const state = await fetch(`${base}${API_PREFIX}/state`, { headers })
      const stateBody = (await state.json()) as { state: { memos: Memo[] } }
      assert.equal(stateBody.state.memos.length, 1)

      // 6. And so does the agent, which is the point of the two halves sharing a
      //    service: a memo captured in the panel must be visible in chat.
      const search = buildFlomoTools(host, identityDefineTool).find(
        (tool) => tool.name === 'flomo_search',
      )
      assert.ok(search)
      const found = await search.execute({ query: MEMO_MARKER }, {})
      assert.equal((found as { ok: boolean }).ok, true)
      assert.ok(
        JSON.stringify(found).includes(MEMO_MARKER),
        'a memo captured through the panel must be findable by the agent',
      )

      // 7. Nothing in the repository is readable.
      const paths = backing.paths()
      assert.ok(paths.includes('vault.json'), 'the header landed')
      assert.ok(
        paths.some((path) => path.startsWith('data/')),
        'the memo landed in a monthly shard',
      )
      for (const path of paths) {
        const raw = backing.raw(path) ?? ''
        assert.ok(!raw.includes(MEMO_MARKER), `${path} must not contain the memo body`)
        assert.ok(!raw.includes(PASSWORD), `${path} must not contain the password`)
        assert.ok(!raw.includes(TOKEN), `${path} must not contain the token`)
      }

      // 8. The settings file holds coordinates, not secrets.
      const config = await readFile(configPath, 'utf8')
      assert.ok(config.includes('flomo-data'), 'the repository coordinates are remembered')
      assert.ok(!config.includes(MEMO_MARKER), 'the settings file must not hold notes')
      assert.ok(!config.includes(PASSWORD), 'the settings file must not hold the password')
      assert.ok(
        !config.includes(TOKEN),
        'the token belongs in the credential store, not the settings file',
      )
      assert.ok(
        !config.includes(recoveryCode),
        'the recovery code is shown once and must never be stored',
      )
      assert.equal(credentials.store.get(TOKEN_REF), TOKEN, 'the token is in the credential store')
    } finally {
      server.close()
    }
  })

  it('reopens the same vault from a fresh service, without the recovery code', async () => {
    const dir = await makeTempDir()
    const backing = new MemoryStore()
    const first = await makeHost(dir, backing)
    const { server, base } = await serve(first.host)
    const headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

    try {
      const post = (body: unknown): Promise<Response> =>
        fetch(`${base}${API_PREFIX}/action`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })

      await post({ kind: 'configure', owner: 'me', repo: 'flomo-data', token: TOKEN })
      await post({ kind: 'create', password: PASSWORD })
      await post({ kind: 'add', content: `持久化 ${MEMO_MARKER}` })
      await post({ kind: 'save' })
    } finally {
      server.close()
    }

    // A second service over the same repository, the same settings file and the
    // same credential store, as a restarted DSH would build. A fresh directory
    // would be a machine that had never been configured, which is a different
    // scenario — and a fresh credential store would lose the token.
    const second = await makeHost(dir, backing, first.credentials)
    const reopened = await serve(second.host)
    try {
      const unlock = await fetch(`${reopened.base}${API_PREFIX}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'unlock', password: PASSWORD }),
      })
      const body = (await unlock.json()) as ActionResult
      assert.equal(body.state.status, 'unlocked')
      assert.equal(body.state.memos.length, 1, 'the memo survived the round trip')
      assert.ok(
        body.state.memos[0]?.content.includes(MEMO_MARKER),
        'and it decrypted back to exactly what was written',
      )
    } finally {
      reopened.server.close()
    }
  })
})
