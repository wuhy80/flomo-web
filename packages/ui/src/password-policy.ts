/**
 * The rules a vault password must satisfy *before* anything is created.
 *
 * There is no recovery to this operation in the database sense: the vault key is
 * derived from whatever was typed, so a password that went in as a typo can only
 * be replaced by re-initializing. Checking the shape up front — and refusing to
 * mint a vault from a password the user cannot retype — is therefore worth more
 * than it looks.
 *
 * The rules are deliberately about *typing accidents*, not entropy: this is a
 * single-user, offline vault whose ciphertext is protected by PBKDF2, and a
 * length floor plus "no invisible edge whitespace" catches the two ways a
 * correct-looking password silently stops working.
 *
 * @module @flomo/ui/password-policy
 */

/** Shortest password the create form accepts. */
export const MIN_PASSWORD_LENGTH = 8

/** One rule shown in the live checklist. */
export interface PasswordRule {
  /** Stable id, for tests and React keys. */
  readonly id: 'length' | 'edges' | 'match'
  /** What the rule asks for, as shown to the user. */
  readonly label: string
  /** Whether the current input satisfies it. */
  readonly ok: boolean
}

/** The verdict on a candidate password. */
export interface PasswordVerdict {
  /** True only when every rule passes. */
  readonly ok: boolean
  /** Every rule, in display order. */
  readonly rules: readonly PasswordRule[]
  /** The failed rules' labels — what to say when the user tries to submit. */
  readonly problems: readonly string[]
}

/**
 * Count a password in characters as a person would, not in UTF-16 units, so one
 * emoji is one character rather than two.
 * @param text - the password.
 * @returns the character count.
 */
function charCount(text: string): number {
  return Array.from(text).length
}

/**
 * Check a new password against the create rules.
 *
 * `confirm` is checked for equality only once something has been typed into it,
 * so the checklist does not scold the user for a field they have not reached
 * yet; `ok` still requires the match, so the form cannot submit early.
 * @param password - the password field.
 * @param confirm - the confirmation field.
 * @returns the verdict, with every rule's state for a live checklist.
 */
export function checkNewPassword(password: string, confirm: string): PasswordVerdict {
  const lengthOk = charCount(password) >= MIN_PASSWORD_LENGTH
  const edgesOk = password.length > 0 && password === password.trim()
  const matchOk = password.length > 0 && password === confirm

  const rules: PasswordRule[] = [
    { id: 'length', label: `至少 ${MIN_PASSWORD_LENGTH} 个字符`, ok: lengthOk },
    { id: 'edges', label: '首尾没有空格', ok: edgesOk },
    { id: 'match', label: '两次输入一致', ok: matchOk },
  ]

  return {
    ok: lengthOk && edgesOk && matchOk,
    rules,
    problems: rules.filter((rule) => !rule.ok).map((rule) => rule.label),
  }
}

/**
 * Whether a password *of an existing vault* is worth sending.
 *
 * Unlock deliberately does not apply {@link checkNewPassword}: a vault created
 * by an older build, or by the host, may legitimately hold a shorter password,
 * and refusing to even try would lock its owner out. This only rejects input
 * that cannot possibly be a password — an empty field.
 * @param password - the password field.
 * @returns whether to enable the unlock button.
 */
export function canSubmitUnlock(password: string): boolean {
  return password.length > 0
}
