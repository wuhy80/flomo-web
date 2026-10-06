/**
 * The flomo look, as a single injectable stylesheet.
 *
 * It is exported as a string rather than a `.css` file on purpose: the web app
 * is bundled by Vite and the DSH panel by esbuild, and a plain string injects
 * identically in both with no loader configuration. The cost is losing editor
 * syntax highlighting here; the benefit is that there is exactly one styling
 * path to debug.
 *
 * Every colour is a custom property on `.fl-root`. The DSH panel overrides them
 * to follow the host theme, and the web app simply takes the defaults.
 *
 * @module @flomo/ui/styles
 */

/** `id` of the injected `<style>` element, so injection stays idempotent. */
export const STYLE_ELEMENT_ID = 'flomo-sim-styles'

/** The complete stylesheet. */
export const FLOMO_CSS = `
.fl-root {
  --flomo-bg: #ffffff;
  --flomo-bg-sunken: #fafafa;
  --flomo-text: #2b2b2b;
  --flomo-text-soft: #8a8a8a;
  --flomo-text-faint: #b8b8b8;
  --flomo-border: #efefef;
  --flomo-border-strong: #e3e3e3;
  --flomo-green: #18a058;
  --flomo-green-soft: #eaf6f0;
  --flomo-hover: #f7f7f7;
  --flomo-danger: #d03050;
  --flomo-radius: 10px;
  --flomo-radius-sm: 6px;
  --flomo-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  --flomo-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  display: flex;
  /* The host is display:flex (to make the app fill the page height), which makes
     this element a flex item — and a flex item with no width shrinks to its
     content. Without this the whole app is only as wide as its widest child,
     which is invisible in the feed and glaring on the centred gate screens. */
  width: 100%;
  height: 100%;
  min-height: 0;
  font-family: var(--flomo-font);
  font-size: 15px;
  color: var(--flomo-text);
  background: var(--flomo-bg);
  -webkit-font-smoothing: antialiased;
}

.fl-root *,
.fl-root *::before,
.fl-root *::after { box-sizing: border-box; }

/* ── sidebar ─────────────────────────────────────────────────────────── */

.fl-sidebar {
  width: 210px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 20px 12px 12px;
  border-right: 1px solid var(--flomo-border);
  overflow-y: auto;
}

.fl-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 18px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.fl-brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--flomo-green);
  flex: none;
}

.fl-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--flomo-radius-sm);
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.fl-nav-item:hover { background: var(--flomo-hover); }

.fl-nav-item[aria-current="true"] {
  background: var(--flomo-green-soft);
  color: var(--flomo-green);
  font-weight: 600;
}

.fl-nav-count {
  font-size: 12px;
  color: var(--flomo-text-faint);
  font-variant-numeric: tabular-nums;
}

.fl-sidebar-section {
  margin: 18px 10px 6px;
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--flomo-text-faint);
}

.fl-tag-list { display: flex; flex-direction: column; gap: 1px; }

.fl-tag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--flomo-radius-sm);
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.fl-tag-row:hover { background: var(--flomo-hover); }
.fl-tag-row[aria-current="true"] { color: var(--flomo-green); font-weight: 600; }

.fl-tag-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fl-sidebar-foot { margin-top: auto; padding-top: 16px; }

.fl-shortcut-hint {
  padding: 12px 10px 0;
  font-size: 11.5px;
  line-height: 1.9;
  color: var(--flomo-text-faint);
}

.fl-shortcut-hint kbd {
  font-family: var(--flomo-mono);
  font-size: 10.5px;
  padding: 1px 4px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: 4px;
  background: var(--flomo-bg-sunken);
  color: var(--flomo-text-soft);
}

/* ── main column ─────────────────────────────────────────────────────── */

.fl-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.fl-column {
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 28px 120px;
}

.fl-column-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.fl-column-title { font-size: 19px; font-weight: 600; margin: 0; }

.fl-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  padding: 6px 10px;
  min-width: 200px;
  background: var(--flomo-bg);
}

.fl-search:focus-within { border-color: var(--flomo-green); }

.fl-search input {
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  color: inherit;
  width: 100%;
  min-width: 0;
}

.fl-search input::placeholder { color: var(--flomo-text-faint); }

/* ── composer ────────────────────────────────────────────────────────── */

.fl-composer {
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius);
  padding: 12px 14px 8px;
  margin-bottom: 26px;
  background: var(--flomo-bg);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.fl-composer:focus-within {
  border-color: var(--flomo-green);
  box-shadow: 0 0 0 3px var(--flomo-green-soft);
}

.fl-composer textarea {
  display: block;
  width: 100%;
  min-height: 58px;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  line-height: 1.75;
}

.fl-composer textarea::placeholder { color: var(--flomo-text-faint); }

.fl-composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}

.fl-composer-hint { font-size: 12px; color: var(--flomo-text-faint); }

.fl-suggest {
  list-style: none;
  margin: 8px 0 0;
  padding: 4px;
  max-height: 216px;
  overflow-y: auto;
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-bg);
}

.fl-suggest-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}

.fl-suggest-item[data-active="true"] {
  background: var(--flomo-green-soft);
  color: var(--flomo-green);
}

.fl-composer-actions { display: flex; align-items: center; gap: 8px; }

.fl-button {
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-bg);
  color: var(--flomo-text);
  font: inherit;
  font-size: 13px;
  padding: 6px 14px;
  cursor: pointer;
}

.fl-button:hover { background: var(--flomo-hover); }
.fl-button:disabled { opacity: 0.45; cursor: default; }
.fl-button:disabled:hover { background: var(--flomo-bg); }

.fl-button-primary {
  background: var(--flomo-green);
  border-color: var(--flomo-green);
  color: #fff;
}

.fl-button-primary:hover { background: #14904f; }
.fl-button-primary:disabled:hover { background: var(--flomo-green); }

.fl-button-ghost { border-color: transparent; color: var(--flomo-text-soft); }
.fl-button-ghost:hover { background: var(--flomo-hover); color: var(--flomo-text); }
.fl-button-danger { color: var(--flomo-danger); border-color: transparent; }
.fl-button-danger:hover { background: #fdf0f3; }

/* ── feed ────────────────────────────────────────────────────────────── */

.fl-day {
  padding: 16px 0 4px;
  font-size: 12px;
  color: var(--flomo-text-soft);
  letter-spacing: 0.3px;
}

.fl-memo {
  position: relative;
  padding: 14px 2px 12px;
  border-bottom: 1px solid var(--flomo-border);
}

.fl-memo:last-child { border-bottom: 0; }

.fl-memo-body {
  font-size: 15px;
  line-height: 1.78;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.fl-memo-body code {
  font-family: var(--flomo-mono);
  font-size: 0.9em;
  background: var(--flomo-bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
}

.fl-memo-body .fl-para { margin: 0; }
.fl-memo-body .fl-para + .fl-para { margin-top: 0.75em; }

.fl-quote {
  margin: 0.6em 0;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--flomo-border-strong);
  color: var(--flomo-text-soft);
}

/* white-space: pre overrides the body's pre-wrap, so a long line of code
   scrolls sideways rather than wrapping into something the user did not write. */
.fl-code {
  margin: 0.6em 0;
  padding: 10px 12px;
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-bg-sunken);
  overflow-x: auto;
  font-family: var(--flomo-mono);
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre;
  tab-size: 2;
}

.fl-code code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  border-radius: 0;
}

.fl-memo-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--flomo-text-faint);
  min-height: 18px;
}

.fl-memo-tags { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }

.fl-memo-tag { color: var(--flomo-text-soft); cursor: pointer; }
.fl-memo-tag:hover { color: var(--flomo-green); }

/* A [[link]] is prose that happens to be navigable, so it reads as emphasis
   rather than as a tag: green and underlined on hover, not grey. */
.fl-memo-link { color: var(--flomo-green); cursor: pointer; }
.fl-memo-link:hover { text-decoration: underline; }

.fl-link-list { display: flex; flex-direction: column; gap: 1px; }

.fl-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--flomo-radius-sm);
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}

.fl-link-row:hover { background: var(--flomo-hover); }

.fl-review-note code,
.fl-recovery-hint code {
  font-family: var(--flomo-mono);
  font-size: 0.92em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--flomo-bg-sunken);
}

.fl-memo-pin { color: var(--flomo-green); font-size: 11px; }

.fl-memo-actions {
  position: absolute;
  top: 12px;
  right: 0;
  display: none;
  gap: 4px;
  background: var(--flomo-bg);
  padding-left: 10px;
}

.fl-memo:hover .fl-memo-actions { display: flex; }

.fl-icon-button {
  border: 0;
  background: transparent;
  color: var(--flomo-text-faint);
  font: inherit;
  font-size: 12px;
  padding: 3px 7px;
  border-radius: 5px;
  cursor: pointer;
}

.fl-icon-button:hover { background: var(--flomo-hover); color: var(--flomo-text); }

.fl-memo-edit { display: flex; flex-direction: column; gap: 8px; }

.fl-memo-edit textarea {
  width: 100%;
  min-height: 72px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  padding: 8px 10px;
  font: inherit;
  font-size: 15px;
  line-height: 1.75;
  resize: vertical;
  color: inherit;
  background: var(--flomo-bg);
  outline: 0;
}

.fl-memo-edit textarea:focus { border-color: var(--flomo-green); }
.fl-memo-edit-actions { display: flex; gap: 8px; }

/* ── empty / states ──────────────────────────────────────────────────── */

.fl-empty {
  padding: 64px 0;
  text-align: center;
  color: var(--flomo-text-faint);
  font-size: 14px;
  line-height: 2;
}

.fl-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 16px;
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-bg-sunken);
  font-size: 12.5px;
  color: var(--flomo-text-soft);
}

.fl-notice-error { background: #fdf0f3; color: var(--flomo-danger); }

/* ── unlock gate ─────────────────────────────────────────────────────── */

.fl-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100%;
  padding: 40px 20px;
  background: var(--flomo-bg);
}

.fl-gate-card { width: 100%; max-width: 360px; }

.fl-gate-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 28px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--flomo-text);
}

.fl-gate-title { margin: 0 0 6px; font-size: 15px; font-weight: 600; text-align: center; }

.fl-gate-sub {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--flomo-text-soft);
  text-align: center;
}

.fl-field { display: block; margin-bottom: 12px; }

.fl-field-label {
  display: block;
  margin-bottom: 5px;
  font-size: 12.5px;
  color: var(--flomo-text-soft);
}

.fl-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: var(--flomo-bg);
  outline: 0;
}

.fl-input:focus { border-color: var(--flomo-green); }

.fl-gate-error {
  margin-bottom: 12px;
  padding: 8px 11px;
  border-radius: var(--flomo-radius-sm);
  background: #fdf0f3;
  color: var(--flomo-danger);
  font-size: 12.5px;
  line-height: 1.6;
}

.fl-gate-submit { width: 100%; padding: 10px; font-size: 14px; }

.fl-gate-switch {
  display: block;
  width: 100%;
  margin-top: 14px;
  border: 0;
  background: transparent;
  color: var(--flomo-text-soft);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  text-align: center;
}

.fl-gate-switch:hover { color: var(--flomo-green); }

.fl-recovery {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid var(--flomo-green);
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-green-soft);
}

.fl-recovery-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--flomo-green); }

.fl-recovery-text {
  font-family: var(--flomo-mono);
  font-size: 11.5px;
  line-height: 1.6;
  word-break: break-all;
  padding: 8px;
  border-radius: 5px;
  background: var(--flomo-bg);
  user-select: all;
}

.fl-recovery-hint { margin-top: 8px; font-size: 12px; line-height: 1.65; color: var(--flomo-text-soft); }

.fl-import-report {
  margin: 10px 0 0;
  padding: 9px 11px;
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-green-soft);
  color: var(--flomo-text);
  font-family: var(--flomo-mono);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ── random walk & review ────────────────────────────────────────────── */

.fl-card-lg {
  padding: 22px;
  border: 1px solid var(--flomo-border);
  border-radius: var(--flomo-radius);
}

.fl-card-lg .fl-memo-body { font-size: 16px; }

.fl-review-note { margin-bottom: 18px; font-size: 13px; color: var(--flomo-text-soft); }

/* ── heatmap ─────────────────────────────────────────────────────────── */

.fl-heatmap { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 4px; }
.fl-heatmap-week { display: flex; flex-direction: column; gap: 3px; }

.fl-heatmap-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--flomo-border);
}

.fl-heatmap-cell[data-level="1"] { background: #c6e7d5; }
.fl-heatmap-cell[data-level="2"] { background: #8ed3ae; }
.fl-heatmap-cell[data-level="3"] { background: #47b881; }
.fl-heatmap-cell[data-level="4"] { background: var(--flomo-green); }

.fl-stats-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--flomo-text-soft);
}

.fl-stats-strip strong { color: var(--flomo-text); font-weight: 600; }

/* ── misc ────────────────────────────────────────────────────────────── */

.fl-loading { padding: 80px 0; text-align: center; color: var(--flomo-text-faint); font-size: 14px; }

.fl-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  vertical-align: -2px;
  border: 2px solid var(--flomo-border-strong);
  border-top-color: var(--flomo-green);
  border-radius: 50%;
  animation: fl-spin 0.7s linear infinite;
}

@keyframes fl-spin { to { transform: rotate(360deg); } }

.fl-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .fl-sidebar { display: none; }
  .fl-column { padding: 20px 16px 120px; }
  .fl-memo-actions { display: flex; position: static; margin-top: 6px; padding: 0; }
  .fl-memo-foot { flex-direction: column; align-items: flex-start; gap: 6px; }
  .fl-memo-tags { justify-content: flex-start; }
}
`

/**
 * Inject the stylesheet once per document.
 *
 * Idempotent, so both the web app and the DSH panel can call it on every mount
 * without stacking duplicate `<style>` elements.
 * @param doc - the document to inject into; defaults to the current one.
 * @returns the style element, or `null` when there is no DOM (SSR, tests).
 */
export function injectFlomoStyles(doc: Document | undefined = globalThis.document): HTMLStyleElement | null {
  if (!doc) return null
  const existing = doc.getElementById(STYLE_ELEMENT_ID)
  if (existing instanceof HTMLStyleElement) return existing
  const style = doc.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = FLOMO_CSS
  doc.head.append(style)
  return style
}
