/**
 * The host-side owner of the vault.
 *
 * Everything that needs the data — the browser panel and the agent tools —
 * goes through this one object, so a memo written from a chat message appears
 * in the panel immediately and vice versa. The PAT and (optionally) the
 * password live in the DSH credential store; neither is ever sent to the
 * browser.
 *
 * Storing the password is optional and off by default. When it is absent the
 * panel must unlock interactively and the key lives only in host memory.
 *
 * @module dsh-flomo/host-service
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  FlomoVault,
  GitHubContentsStore,
  WrongPasswordError,
  corpusStats,
  dailyReview,
  describeImportResult,
  parseMemosJson,
  randomWalk,
  searchMemos,
  tagStats,
} from '@flomo/core'
import type { CorpusStats, Memo, TagStat, TextStore } from '@flomo/core'

import type { FlomoAction, HostState, HostStatus } from './protocol.ts'

/** Credential reference holding the fine-grained PAT. */
export const TOKEN_REF = 'FLOMO_GITHUB_TOKEN'

/**
 * Optional credential reference holding the vault password.
 *
 * Setting it lets the agent tools work without anyone unlocking the panel
 * first. It is a genuine trade-off — the password then sits in the DSH
 * credential store — so it is never written unless the user asks for it.
 */
export const PASSWORD_REF = 'FLOMO_PASSWORD'

/**
 * Default location of the non-secret connection settings.
 *
 * `FLOMO_CONFIG_PATH` overrides it, which lets a test point the plugin at a
 * scratch file instead of the user's real settings, and lets anyone relocate
 * the plugin's state deliberately.
 */
export const DEFAULT_CONFIG_PATH =
  process.env['FLOMO_CONFIG_PATH'] ?? join(homedir(), '.dsh', 'flomo.json')

/** The slice of the credentials service this plugin uses. */
export interface CredentialsFace {
  resolve(ref: string): Promise<{ value: string } | undefined>
  set(ref: string, value: string): Promise<void>
}

/** Non-secret settings persisted to `~/.dsh/flomo.json`. */
interface StoredConfig {
  owner: string
  repo: string
  branch?: string
}

/** Auto-save debounce, matching the web app's feel. */
const AUTOSAVE_MS = 1500

/** How many memos the agent-facing listings return by default. */
export const DEFAULT_LIST_LIMIT = 20

/** Turn an unknown thrown value into user-facing text. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Connection coordinates as the store factory receives them. */
export interface ResolvedStoreOptions {
  token: string
  owner: string
  repo: string
  branch?: string
}

/** Everything the host service needs injected. */
export interface FlomoHostOptions {
  /** The credentials service, when the deployment has one. */
  credentials?: CredentialsFace
  /** Where the non-secret settings live. */
  configPath?: string
  /**
   * Builds the backing store. Defaults to the real GitHub client; tests inject
   * an in-memory one so the whole host half can be exercised offline.
   */
  createStore?: (options: ResolvedStoreOptions) => TextStore
}

/** The host vault service. */
export class FlomoHostService {
  private readonly credentials: CredentialsFace | undefined
  private readonly configPath: string
  private readonly createStore: (options: ResolvedStoreOptions) => TextStore

  private config: StoredConfig | null = null
  private token: string | null = null
  private vault: FlomoVault | null = null
  private error: string | null = null
  private recoveryCode: string | null = null
  private lastSavedAt: string | null = null
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  private started: Promise<void> | null = null
  private toolsRegistered = false
  private toolsError: string | null = null
  private lastMessage: string | null = null

  /**
   * @param options - the credentials service, config path and store factory.
   */
  constructor(options: FlomoHostOptions = {}) {
    this.credentials = options.credentials
    this.configPath = options.configPath ?? DEFAULT_CONFIG_PATH
    this.createStore =
      options.createStore ?? ((settings) => new GitHubContentsStore(settings))
  }

  /**
   * Run {@link start} at most once, whoever asks first.
   *
   * Activation is synchronous in Cordis, so the first HTTP request or tool call
   * may well arrive before the async boot finishes; routing both through this
   * latch is what stops a request from observing a half-loaded service.
   * @returns a promise resolving once settings have been read.
   */
  ensureStarted(): Promise<void> {
    this.started ??= this.start()
    return this.started
  }

  /**
   * Load persisted settings, then try to open the vault unattended.
   *
   * A missing or unreadable config is not an error: it is simply the first-run
   * state, which the panel renders as a connection form.
   */
  async start(): Promise<void> {
    await this.loadConfig()
    await this.loadToken()
    if (this.isConfigured && this.token) await this.tryAutoUnlock()
  }

  /** Read `~/.dsh/flomo.json`. */
  private async loadConfig(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredConfig>
      if (typeof parsed.owner === 'string' && typeof parsed.repo === 'string') {
        this.config = {
          owner: parsed.owner,
          repo: parsed.repo,
          ...(typeof parsed.branch === 'string' && parsed.branch !== ''
            ? { branch: parsed.branch }
            : {}),
        }
      }
    } catch {
      // Absent on first run, which is expected rather than exceptional.
    }
  }

  /** Persist `~/.dsh/flomo.json`. */
  private async saveConfig(): Promise<void> {
    if (!this.config) return
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8')
  }

  /** Resolve the PAT from the credential store. */
  private async loadToken(): Promise<void> {
    try {
      const resolved = await this.credentials?.resolve(TOKEN_REF)
      this.token = resolved?.value ?? null
    } catch (error) {
      this.error = `读取凭据失败：${describe(error)}`
      this.token = null
    }
  }

  /** @returns whether a repository is configured. */
  get isConfigured(): boolean {
    return this.config !== null
  }

  /** @returns the current vault, when unlocked. */
  get unlockedVault(): FlomoVault | null {
    return this.vault
  }

  /**
   * Build a store for the configured repository.
   * @returns the store, or `null` when unconfigured.
   */
  private store(): TextStore | null {
    if (!this.config || !this.token) return null
    const options: ResolvedStoreOptions = {
      token: this.token,
      owner: this.config.owner,
      repo: this.config.repo,
      ...(this.config.branch ? { branch: this.config.branch } : {}),
    }
    return this.createStore(options)
  }

  /**
   * Unlock using the stored password, if there is one.
   *
   * Failures are recorded as an error rather than thrown: a stale stored
   * password must leave the panel usable so the user can unlock by hand.
   */
  private async tryAutoUnlock(): Promise<void> {
    const store = this.store()
    if (!store) return
    try {
      const resolved = await this.credentials?.resolve(PASSWORD_REF)
      if (!resolved?.value) return
      const vault = await FlomoVault.open(store, resolved.value)
      await vault.loadAll()
      this.vault = vault
      this.error = null
    } catch (error) {
      this.error =
        error instanceof WrongPasswordError
          ? '已保存的密码无法解锁该保险库，请在面板里手动解锁。'
          : `自动解锁失败：${describe(error)}`
    }
  }

  /** @returns the current status. */
  private status(): HostStatus {
    if (!this.config || !this.token) return 'unconfigured'
    return this.vault ? 'unlocked' : 'locked'
  }

  /**
   * The panel's read model.
   * @returns the current state, including every memo when unlocked.
   */
  snapshot(): HostState {
    return {
      status: this.status(),
      owner: this.config?.owner ?? null,
      repo: this.config?.repo ?? null,
      branch: this.config?.branch ?? null,
      hasToken: this.token !== null,
      hasStoredPassword: false,
      memos: this.vault ? this.vault.all() : [],
      error: this.error,
      recoveryCode: this.recoveryCode,
      toolsRegistered: this.toolsRegistered,
      toolsError: this.toolsError,
    }
  }

  /**
   * Record how the agent-tool registration went.
   *
   * Surfaced through the state route so the panel — and a human debugging a
   * deployment — can see whether the tools are actually available, instead of
   * having to infer it from silence.
   * @param registered - whether the tools are in the registry.
   * @param error - why they are not, when they are not.
   */
  setToolsStatus(registered: boolean, error: string | null = null): void {
    this.toolsRegistered = registered
    this.toolsError = error
  }

  /**
   * The panel's read model with the stored-password flag resolved.
   *
   * `hasStoredPassword` needs an async credential lookup, so it is filled in
   * here rather than in the synchronous {@link snapshot}.
   * @returns the state, ready to serialize.
   */
  async fullSnapshot(): Promise<HostState> {
    const base = this.snapshot()
    let hasStoredPassword = false
    try {
      hasStoredPassword = (await this.credentials?.resolve(PASSWORD_REF))?.value !== undefined
    } catch {
      // A credentials failure must not blank the panel.
    }
    return { ...base, hasStoredPassword }
  }

  /**
   * Apply one action and return the resulting state.
   *
   * Domain failures are reported through `state.error` rather than by throwing,
   * so one bad action never takes the panel down.
   * @param action - the requested mutation.
   * @returns the state after the attempt.
   */
  async apply(action: FlomoAction): Promise<HostState> {
    await this.ensureStarted()
    // Both are per-action: cleared up front so a stale message or a stale error
    // can never be read as the outcome of the action that just ran.
    this.lastMessage = null
    this.error = null
    try {
      await this.applyInner(action)
    } catch (error) {
      this.error = describe(error)
    }
    return this.fullSnapshot()
  }

  /**
   * Read and clear the message left by the most recent {@link apply}.
   *
   * A take-style accessor rather than a snapshot field, because it belongs to
   * one response and must not persist into the next one.
   * @returns the message, or `null` when the last action had nothing to say.
   */
  takeMessage(): string | null {
    const message = this.lastMessage
    this.lastMessage = null
    return message
  }

  /**
   * The mutation switch behind {@link apply}.
   * @param action - the requested mutation.
   */
  private async applyInner(action: FlomoAction): Promise<void> {
    switch (action.kind) {
      case 'configure': {
        this.config = {
          owner: action.owner,
          repo: action.repo,
          ...(action.branch ? { branch: action.branch } : {}),
        }
        await this.saveConfig()
        if (action.token) {
          if (!this.credentials) throw new Error('当前部署没有凭据服务，无法保存 token。')
          await this.credentials.set(TOKEN_REF, action.token)
        }
        await this.loadToken()
        // A different repository means a different vault; drop the old one.
        this.vault = null
        this.error = null
        await this.tryAutoUnlock()
        return
      }

      case 'unlock': {
        const store = this.store()
        if (!store) throw new Error('请先配置数据仓库和 token。')
        const vault = await FlomoVault.open(store, action.password)
        await vault.loadAll()
        this.vault = vault
        this.error = null
        return
      }

      case 'create': {
        const store = this.store()
        if (!store) throw new Error('请先配置数据仓库和 token。')
        const { vault, recoveryCode } = await FlomoVault.create(store, action.password)
        this.vault = vault
        this.recoveryCode = recoveryCode
        this.error = null
        return
      }

      case 'recovery': {
        const store = this.store()
        if (!store) throw new Error('请先配置数据仓库和 token。')
        const vault = await FlomoVault.openWithRecovery(store, action.code)
        await vault.loadAll()
        this.vault = vault
        this.error = null
        return
      }

      case 'lock':
        await this.save()
        this.vault = null
        this.recoveryCode = null
        return

      case 'add':
        this.requireVault().add(action.content)
        this.scheduleAutoSave()
        return

      case 'edit':
        this.requireVault().edit(action.id, action.content)
        this.scheduleAutoSave()
        return

      case 'remove':
        this.requireVault().remove(action.id)
        this.scheduleAutoSave()
        return

      case 'pin':
        this.requireVault().pin(action.id, action.pinned)
        this.scheduleAutoSave()
        return

      case 'save':
        await this.save()
        return

      case 'import': {
        const vault = this.requireVault()
        const result = parseMemosJson(action.payload)
        const { added, duplicates } = vault.merge(result.memos)
        await this.save()
        this.lastMessage = describeImportResult(added, duplicates, result)
        return
      }
    }
  }

  /**
   * @returns the unlocked vault.
   * @throws when the vault is locked.
   */
  private requireVault(): FlomoVault {
    if (!this.vault) throw new Error('保险库尚未解锁。')
    return this.vault
  }

  /** Arm the debounced auto-save. */
  private scheduleAutoSave(): void {
    if (this.autoSaveTimer !== null) clearTimeout(this.autoSaveTimer)
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null
      void this.save()
    }, AUTOSAVE_MS)
  }

  /**
   * Push pending shards.
   * @returns the months written.
   */
  async save(): Promise<string[]> {
    if (!this.vault || this.vault.dirtyMonths.length === 0) return []
    const written = await this.vault.flush()
    this.lastSavedAt = new Date().toISOString()
    this.error = null
    return written
  }

  /**
   * Record a memo and push it immediately.
   *
   * Agent tool calls use this rather than the debounced path: a tool call
   * should be durable before it reports success.
   * @param content - the memo body.
   * @returns the stored memo.
   */
  async addAndSave(content: string): Promise<Memo> {
    const memo = this.requireVault().add(content)
    await this.save()
    return memo
  }

  /** @returns when the vault was last written, or null. */
  get savedAt(): string | null {
    return this.lastSavedAt
  }

  // ── read helpers shared with the agent tools ──────────────────────────

  /** @returns every memo, newest first. */
  memos(): Memo[] {
    return this.vault ? this.vault.all() : []
  }

  /**
   * Full-text and tag search.
   * @param query - free text, matched case-insensitively.
   * @param tag - optional tag filter.
   * @param limit - maximum results.
   * @returns matching memos, newest first.
   */
  search(query: string, tag?: string, limit: number = DEFAULT_LIST_LIMIT): Memo[] {
    return searchMemos(this.memos(), {
      text: query,
      ...(tag ? { tag } : {}),
      limit,
    })
  }

  /**
   * The newest memos.
   * @param limit - how many.
   * @returns the memos.
   */
  recent(limit: number = DEFAULT_LIST_LIMIT): Memo[] {
    return this.memos().slice(0, limit)
  }

  /**
   * The daily review: a stable set of older notes for today.
   * @param count - how many.
   * @returns the memos.
   */
  review(count = 3): Memo[] {
    return dailyReview(this.memos(), count)
  }

  /**
   * One memo at random.
   * @returns the memo, or null when the vault is empty.
   */
  random(): Memo | null {
    return randomWalk(this.memos())
  }

  /** @returns tag frequencies. */
  tags(): TagStat[] {
    return tagStats(this.memos())
  }

  /** @returns headline corpus numbers. */
  stats(): CorpusStats {
    return corpusStats(this.memos(), this.tags().length)
  }

  /** Release the auto-save timer. */
  dispose(): void {
    if (this.autoSaveTimer !== null) clearTimeout(this.autoSaveTimer)
    this.autoSaveTimer = null
  }
}
