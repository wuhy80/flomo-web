/**
 * Shape checks for the connection form.
 *
 * These cannot prove a token works — only GitHub can, and `verifyAccess` asks it
 * — but they catch the two paste accidents that otherwise cost a round trip and,
 * worse, come back as a 401 that reads like a repository problem: a truncated
 * token, and one that still carries GitHub's "copied" furniture.
 *
 * Kept in their own module, apart from the form, so the rules can be tested
 * without a DOM or a JSX transform.
 *
 * @module @flomo/web/connection-rules
 */

/** GitHub account names: alphanumerics and inner hyphens, at most 39 characters. */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

/** Repository names GitHub accepts: no spaces, no slashes, no leading dot. */
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Tokens GitHub actually issues.
 *
 * `github_pat_` is the fine-grained format the guide asks for; the `gh*_`
 * prefixes are the classic and app formats, allowed so an existing working
 * token is never rejected by a rule added later.
 */
const TOKEN_RE = /^(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/

/**
 * Whether a token at least looks like one of GitHub's.
 * @param token - the token field, already trimmed.
 * @returns true when the shape is plausible.
 */
export function looksLikeToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

/**
 * Explain why the typed connection details cannot be right, before any request.
 * @param owner - the owner field.
 * @param repo - the repository field.
 * @param token - the token field.
 * @returns a message, or null when every field is at least well-shaped.
 */
export function formatProblem(owner: string, repo: string, token: string): string | null {
  if (!OWNER_RE.test(owner)) {
    return 'GitHub 用户名格式不对：只能包含字母、数字与连字符，且不能以连字符开头或结尾。'
  }
  if (!REPO_RE.test(repo)) {
    return '仓库名格式不对：不能包含空格或斜杠，不能以点开头。'
  }
  if (!looksLikeToken(token)) {
    return '令牌格式不对：应以 github_pat_ 或 ghp_ 开头，且不含空格或换行。请重新复制完整令牌。'
  }
  return null
}
