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
  --flomo-blue: #4a7df0;
  --flomo-blue-strong: #2f62d8;
  --flomo-blue-soft: #ecf2fe;
  --flomo-input-bg: #f2f2f2;
  --flomo-radius: 10px;
  --flomo-radius-sm: 6px;
  --flomo-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  --flomo-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  /* flomo centres the whole two-column block as one unit: sidebar and feed sit
     shoulder to shoulder over the grey page, and the page scrolls together.
     The host is display:flex (to make the app fill the page height), which makes
     this element a flex item — and a flex item with no width shrinks to its
     content, hence the explicit width. */
  display: flex;
  justify-content: center;
  gap: 36px;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 0 28px;
  font-family: var(--flomo-font);
  font-size: 15px;
  color: var(--flomo-text);
  background: var(--flomo-bg-sunken);
  -webkit-font-smoothing: antialiased;
}

.fl-root *,
.fl-root *::before,
.fl-root *::after { box-sizing: border-box; }

/* ── sidebar ─────────────────────────────────────────────────────────── */

.fl-sidebar {
  /* Sized to hold flomo's calendar: 289px of grid (fourteen weeks of 16px
     squares at a 21px pitch) plus breathing room. No divider and no independent
     scroll: the sidebar is simply the left half of the centred block, and the
     page scrolls as one. */
  width: 330px;
  flex: none;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 20px 0 24px;
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

.fl-nav-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fl-nav-icon {
  width: 18px;
  flex: none;
  text-align: center;
  font-size: 13px;
  line-height: 1;
}

.fl-nav-item:hover { background: var(--flomo-hover); }

.fl-nav-item[aria-current="true"] {
  background: var(--flomo-green);
  color: #fff;
  font-weight: 600;
}

.fl-nav-item[aria-current="true"]:hover { background: var(--flomo-green); }

.fl-nav-item[aria-current="true"] .fl-nav-count { color: rgba(255, 255, 255, 0.8); }

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

/* A branch is its row plus, when unfolded, the nested branches below it. */
.fl-tag-branch { display: flex; flex-direction: column; gap: 1px; }

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

/* Keep the count and the pin packed on the right when a row carries all three. */
.fl-tag-row .fl-nav-count { margin-left: auto; }

/* The fold arrow heads every tree row — a live toggle on branches, a same-width
   spacer on leaves, so names stay aligned down the list. */
.fl-tag-fold {
  flex: none;
  width: 13px;
  font-size: 10.5px;
  line-height: 1;
  text-align: center;
  color: var(--flomo-text-soft);
  cursor: pointer;
  user-select: none;
}

.fl-tag-fold:hover { color: var(--flomo-text); }

.fl-tag-fold-none { cursor: default; }

/* The pin floats in on hover and stays lit while pressed — the affordance
   flomo uses to lift a tag into its pinned section. */
.fl-tag-pin {
  flex: none;
  border: 0;
  background: transparent;
  padding: 0 2px;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.fl-tag-row:hover .fl-tag-pin,
.fl-tag-pin:focus-visible,
.fl-tag-pin[aria-pressed="true"] { opacity: 1; }

.fl-tag-pin:hover { transform: scale(1.15); }

.fl-tag-pin:focus-visible { outline: 1px solid var(--flomo-green); border-radius: 3px; }

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
  /* Shrink-wraps to the feed's width (at most 70% of the viewport) so the gap
     between the columns stays a gap instead of becoming centring space, and to
     the feed's height so the page — not the column — is what scrolls. */
  flex: 0 1 auto;
  align-self: flex-start;
  width: min(70vw, 860px);
  min-width: 0;
  overflow-x: hidden;
}

.fl-column {
  padding: 24px 0 120px;
}

.fl-column-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.fl-column-title { font-size: 19px; font-weight: 600; margin: 0; }

.fl-title-wrap { position: relative; }

/* The title doubles as the view switcher: a caret marks it as a dropdown, in
   the way flomo's feed header opens one. */
.fl-title-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: -6px;
  padding: 2px 8px 2px 6px;
  border: 0;
  border-radius: var(--flomo-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 19px;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
}

.fl-title-toggle:hover { background: var(--flomo-hover); }

.fl-title-caret { font-size: 11px; color: var(--flomo-text-faint); }

.fl-title-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 160px;
  padding: 5px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.fl-title-menu-item {
  padding: 7px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}

.fl-title-menu-item:hover { background: var(--flomo-hover); }
.fl-title-menu-item[data-current="true"] { color: var(--flomo-green); font-weight: 600; }

/* A grey pill, not a bordered box: flomo's search reads as part of the page
   until it is used, and the Ctrl K hint lives inside the pill at its end. The
   pill itself is white now — the page behind it is the grey. */
.fl-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 6px 14px;
  min-width: 220px;
  background: var(--flomo-bg);
}

.fl-search:focus-within {
  border-color: var(--flomo-border-strong);
  background: var(--flomo-bg);
}

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

.fl-search-kbd { display: flex; gap: 3px; flex: none; }

.fl-search-kbd kbd {
  font-family: var(--flomo-mono);
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: 4px;
  background: var(--flomo-bg);
  color: var(--flomo-text-faint);
}

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
  /* flomo's box is a comfortable paragraph tall before you type; the component
     grows it further with content up to its own cap. */
  min-height: 150px;
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
  margin-top: 6px;
}

.fl-composer-tools { display: flex; align-items: center; gap: 2px; }

.fl-tool-divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--flomo-border-strong);
}

.fl-tool-text { font-size: 13px; font-weight: 600; letter-spacing: 0.2px; }

/* The Aa format menu: a small floating card above the button, one glyph per
   format, exactly flomo's arrangement. */
.fl-aa-wrap { position: relative; display: flex; }

.fl-aa-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: 8px;
  background: var(--flomo-bg);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
}

.fl-aa-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}

.fl-aa-option:hover { background: var(--flomo-hover); }

.fl-aa-u { text-decoration: underline; text-underline-offset: 2px; }

.fl-aa-hl { padding: 0 3px; border-radius: 3px; background: #fff3a3; }

.fl-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--flomo-text-soft);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.fl-tool:hover { background: var(--flomo-hover); color: var(--flomo-text); }

.fl-tool:disabled { opacity: 0.4; cursor: default; }
.fl-tool:disabled:hover { background: transparent; color: var(--flomo-text-soft); }

.fl-composer-side { display: flex; align-items: center; gap: 10px; }

.fl-composer-count {
  font-size: 12px;
  color: var(--flomo-text-faint);
  font-variant-numeric: tabular-nums;
}

/* Pending attachments: flomo shows removable thumbnails with a dashed tile
   that adds the next one, always present so the row reads as a drop zone. */
.fl-composer-attach {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.fl-attach-thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: visible;
}

.fl-attach-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
  display: block;
  border: 1px solid var(--flomo-border);
}

.fl-attach-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.fl-attach-remove:hover { background: rgba(0, 0, 0, 0.75); }

.fl-attach-add {
  width: 72px;
  height: 72px;
  border: 1px dashed var(--flomo-border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--flomo-text-faint);
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.fl-attach-add:hover { border-color: var(--flomo-green); color: var(--flomo-green); }
.fl-attach-add:disabled { cursor: default; opacity: 0.6; }

.fl-attach-error { font-size: 12px; color: var(--flomo-danger); }

/* Attached images on a memo: square tiles under the body, like flomo's. */
.fl-memo-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.fl-memo-image {
  width: 104px;
  height: 104px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--flomo-border);
  display: block;
}

.fl-memo-image-loading,
.fl-memo-image-failed {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--flomo-bg-sunken);
  font-size: 11px;
  color: var(--flomo-text-faint);
}

/* The round send button flomo parks in the composer's bottom-right corner:
   green while there is something to send, quiet grey while there is not. */
.fl-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border: 0;
  border-radius: 50%;
  background: var(--flomo-green);
  color: #fff;
  cursor: pointer;
}

.fl-send:hover { background: #14904f; }

.fl-send:disabled { background: var(--flomo-input-bg); color: var(--flomo-text-faint); cursor: default; }
.fl-send:disabled:hover { background: var(--flomo-input-bg); }

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

.fl-suggest-memo { justify-content: space-between; }

.fl-suggest-memo-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

.fl-suggest-item[data-active="true"] {
  background: var(--flomo-green-soft);
  color: var(--flomo-green);
}

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

.fl-memo {
  position: relative;
  padding: 16px 18px;
  margin-bottom: 12px;
  /* A visible outline: on the grey page the white cards read as one column
     unless each is edged. */
  border: 1px solid var(--flomo-border-strong);
  border-radius: 12px;
  background: var(--flomo-bg);
}

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

/* ── markdown ────────────────────────────────────────────────────────── */

.fl-md-h { font-weight: 600; line-height: 1.4; margin: 0.8em 0 0.3em; }
.fl-md-h:first-child { margin-top: 0; }

.fl-md-h[data-level="1"] { font-size: 21px; }
.fl-md-h[data-level="2"] { font-size: 19px; }
.fl-md-h[data-level="3"] { font-size: 17px; }
.fl-md-h[data-level="4"],
.fl-md-h[data-level="5"],
.fl-md-h[data-level="6"] { font-size: 15.5px; color: var(--flomo-text-soft); }

.fl-md-list { margin: 0.4em 0; padding-left: 1.6em; }
.fl-md-list li { margin: 0.15em 0; }
.fl-md-list li::marker { color: var(--flomo-text-faint); }

/* Nested outlines sit tight under their parent item, one indent step each. */
.fl-md-list .fl-md-list { margin: 0.1em 0; }

.fl-task { display: inline-flex; align-items: baseline; gap: 7px; }
.fl-task-box { color: var(--flomo-green); font-size: 0.95em; }
.fl-task-text { overflow-wrap: anywhere; }
.fl-task-done { color: var(--flomo-text-faint); text-decoration: line-through; }

.fl-md-hr {
  border: 0;
  border-top: 1px solid var(--flomo-border-strong);
  margin: 1em 0;
}

.fl-md-a { color: var(--flomo-blue); text-decoration: none; overflow-wrap: anywhere; }
.fl-md-a:hover { text-decoration: underline; }

.fl-md-img {
  display: block;
  max-width: 100%;
  max-height: 420px;
  border-radius: 8px;
  margin: 0.4em 0;
}

.fl-md-table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 0.6em 0;
  border-collapse: collapse;
  font-size: 14px;
}

.fl-md-table th,
.fl-md-table td {
  border: 1px solid var(--flomo-border-strong);
  padding: 5px 12px;
}

.fl-md-table th { background: var(--flomo-bg-sunken); font-weight: 600; }

del { color: var(--flomo-text-faint); }

.fl-md-u { text-decoration: underline; text-underline-offset: 3px; }

/* flomo's highlight: a warm yellow band behind the text. */
.fl-md-mark {
  background: #fff3a3;
  color: inherit;
  padding: 0 2px;
  border-radius: 3px;
}

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

/* The full stamp sits above the body, like flomo's cards — with no day
   headings in the feed, the date belongs to the note itself. */
.fl-memo-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--flomo-text-faint);
  font-variant-numeric: tabular-nums;
}

.fl-memo-stamp { font-variant-numeric: tabular-nums; }

.fl-memo-pin { color: var(--flomo-green); font-size: 11px; }
.fl-memo-edited { font-size: 11px; }

/* A #tag reads as a pill: light blue, rounded, the way flomo paints it. */
.fl-memo-tag {
  display: inline-block;
  padding: 1px 8px;
  margin: 0 1px;
  border-radius: 999px;
  background: var(--flomo-blue-soft);
  color: var(--flomo-blue);
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
}

.fl-memo-tag:hover {
  background: #dfe9fd;
  color: var(--flomo-blue-strong);
}

/* An @-mention memo reference renders as flomo's MEMO> chip: amber, compact,
   clickable into the referenced note's own page. */
.fl-memo-ref {
  display: inline-block;
  padding: 1px 7px;
  margin: 0 1px;
  border-radius: 999px;
  background: #fff3a3;
  color: #8a6d00;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.fl-memo-ref:hover { background: #ffe566; }

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

.fl-more {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--flomo-text-faint);
  cursor: pointer;
}

.fl-more:hover { background: var(--flomo-hover); color: var(--flomo-text); }

/* flomo's more-menu: a card dropped under the ... button, grouped actions, a
   red delete, and the counts in a footer. */
.fl-memo-menu {
  position: absolute;
  top: 40px;
  right: 10px;
  z-index: 30;
  width: 200px;
  padding: 6px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: 10px;
  background: var(--flomo-bg);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
}

.fl-memo-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--flomo-text);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}

.fl-memo-menu-item:hover { background: var(--flomo-hover); }

.fl-memo-menu-item svg { flex: none; color: var(--flomo-text-soft); }

.fl-memo-menu-item-danger,
.fl-memo-menu-item-danger:hover { color: var(--flomo-danger); background: transparent; }

.fl-memo-menu-item-danger:hover { background: #fdf0f3; }

.fl-memo-menu-divider {
  border: 0;
  border-top: 1px solid var(--flomo-border);
  margin: 6px 4px;
}

.fl-memo-menu-foot {
  padding: 8px 10px 2px;
  border-top: 1px solid var(--flomo-border);
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.9;
  color: var(--flomo-text-faint);
}

.fl-memo-edit { display: flex; flex-direction: column; gap: 8px; }

.fl-memo-edit textarea {
  width: 100%;
  /* Matches the capture box: a paragraph tall at rest, grown to fit the draft
     by the component (capped there), so long notes edit without scrolling a
     postage stamp. */
  min-height: 150px;
  max-height: 480px;
  border: 1px solid var(--flomo-border-strong);
  border-radius: var(--flomo-radius-sm);
  padding: 8px 10px;
  font: inherit;
  font-size: 15px;
  line-height: 1.75;
  resize: none;
  overflow: hidden;
  color: inherit;
  background: var(--flomo-bg);
  outline: 0;
}

.fl-memo-edit textarea:focus { border-color: var(--flomo-green); }

/* The editor's bottom bar: tools on the left, then count, cancel, save —
   the composer's arrangement carried over. */
.fl-memo-edit-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.fl-edit-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--flomo-text-faint);
  font-variant-numeric: tabular-nums;
}

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
  border: 1px solid var(--flomo-border);
  border-radius: var(--flomo-radius-sm);
  background: var(--flomo-bg);
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

.fl-gate-remember {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 0 12px;
  font-size: 12.5px;
  color: var(--flomo-text-soft);
  cursor: pointer;
  user-select: none;
}

.fl-gate-remember input {
  accent-color: var(--flomo-green);
  margin: 0;
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

/* The wrapper scrolls, not the grid, so the month labels travel with the cells
   they label instead of staying behind. */
.fl-heatmap-wrap { overflow-x: auto; padding-bottom: 4px; }

.fl-heatmap-months { position: relative; height: 20px; margin-top: 4px; }

.fl-heatmap-month {
  position: absolute;
  top: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--flomo-text-faint);
  white-space: nowrap;
}

.fl-heatmap { display: flex; gap: 5px; }
.fl-heatmap-week { display: flex; flex-direction: column; gap: 5px; }

.fl-heatmap-cell {
  width: 16px;
  height: 16px;
  border: 0;
  padding: 0;
  border-radius: 4px;
  background: var(--flomo-border);
}

/* flomo marks today with an outlined cell and rings the day currently
   filtered in the feed — both sit above the colour fill. */
.fl-heatmap-today { box-shadow: inset 0 0 0 1.5px var(--flomo-text-soft); }

.fl-heatmap-active {
  box-shadow: inset 0 0 0 1.5px var(--flomo-green);
  border-radius: 4px;
}

/* Past days are doorways into that day's notes, so they take the pointer. */
button.fl-heatmap-cell { cursor: pointer; }
button.fl-heatmap-cell:hover { filter: brightness(0.9); }

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

/* The one count that belongs to the list rather than to the corpus. Quiet, and
   tight against the feed, so it reads as a caption rather than a dashboard. */
.fl-list-stats {
  gap: 16px;
  margin: 14px 0 4px;
  font-size: 12px;
  color: var(--flomo-text-faint);
}

/* The corpus numbers above the calendar, laid out the way flomo lays them out:
   three large quiet grey figures spread across the column, labels beneath, and
   every one of them a button into the stats dialog. */
.fl-corpus-stats {
  display: flex;
  justify-content: space-between;
  padding: 0 10px 16px;
}

.fl-stat-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fl-stat-button strong {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--flomo-text-soft);
  font-variant-numeric: tabular-nums;
}

.fl-stat-button:hover strong { color: var(--flomo-text); }

.fl-stat-button span {
  font-size: 12px;
  color: var(--flomo-text-faint);
}

/* The calendar lives in the column, so it is inset to line up with the rows
   above and below it rather than running to the edges. */
.fl-sidebar .fl-heatmap-wrap { padding: 0 8px 14px; }

/* ── stats modal ─────────────────────────────────────────────────────── */

.fl-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.32);
}

.fl-modal {
  display: flex;
  flex-direction: column;
  width: min(980px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 20px 24px 24px;
  border-radius: 14px;
  background: var(--flomo-bg);
  /* The dialog scrolls by wheel and by drag; the rail itself is visual noise,
     so it is hidden on every engine while the scrolling stays. */
  scrollbar-width: none;
}

.fl-modal::-webkit-scrollbar { display: none; }

.fl-modal-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}

.fl-modal-title { font-size: 16px; font-weight: 600; }

.fl-modal-close {
  position: absolute;
  top: 0;
  right: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  color: var(--flomo-text-soft);
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.fl-modal-close:hover { background: var(--flomo-hover); color: var(--flomo-text); }

/* The 月/年 pill: a quiet grey track with the active side lifted onto white. */
.fl-seg {
  align-self: center;
  display: flex;
  margin-bottom: 18px;
  padding: 3px;
  border-radius: 999px;
  background: var(--flomo-input-bg);
}

.fl-seg-option {
  min-width: 88px;
  padding: 5px 22px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  color: var(--flomo-text-soft);
  cursor: pointer;
}

.fl-seg-option[data-active="true"] {
  background: var(--flomo-bg);
  color: var(--flomo-text);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}

.fl-year-block { margin-bottom: 28px; }
.fl-year-block:last-child { margin-bottom: 0; }

.fl-year-title { margin: 0 0 14px; font-size: 22px; font-weight: 600; }

.fl-year-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 14px;
}

.fl-year-head .fl-year-title { margin: 0; }

.fl-month-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
}

.fl-month-card {
  padding: 18px 18px 14px;
  border: 1px solid var(--flomo-border);
  border-radius: 12px;
}

.fl-month-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.fl-month-title { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: 1px; }

.fl-card-export {
  display: flex;
  border: 0;
  background: transparent;
  color: var(--flomo-text-faint);
  padding: 4px;
  border-radius: 6px;
  cursor: pointer;
}

.fl-card-export:hover { background: var(--flomo-hover); color: var(--flomo-text); }

.fl-card-export:disabled { opacity: 0.35; cursor: default; }
.fl-card-export:disabled:hover { background: transparent; color: var(--flomo-text-faint); }

.fl-month-stats {
  display: flex;
  justify-content: space-between;
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--flomo-text-faint);
}

.fl-month-stats strong { color: var(--flomo-text-soft); font-weight: 600; }

.fl-cal-weekdays,
.fl-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px 4px; }

.fl-cal-weekdays { margin-bottom: 2px; }

.fl-cal-weekdays span {
  text-align: center;
  font-size: 11.5px;
  color: var(--flomo-text-faint);
}

.fl-cal-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.fl-cal-num {
  font-size: 11px;
  line-height: 1;
  color: var(--flomo-text-faint);
  font-variant-numeric: tabular-nums;
}

.fl-cal-cell {
  width: 100%;
  height: 26px;
  border: 0;
  padding: 0;
  border-radius: 4px;
  background: var(--flomo-border);
}

button.fl-cal-cell { cursor: pointer; }
button.fl-cal-cell:hover { filter: brightness(0.9); }

/* The month cards shade by the same scale as the sidebar calendar. */
.fl-cal-cell[data-level="1"] { background: #c6e7d5; }
.fl-cal-cell[data-level="2"] { background: #8ed3ae; }
.fl-cal-cell[data-level="3"] { background: #47b881; }
.fl-cal-cell[data-level="4"] { background: var(--flomo-green); }

/* The three per-year charts: notes blue, characters green, days red — each
   twelve monthly bars over a right-hand tick rail, flomo's 年 view. */
.fl-chart-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
}

.fl-chart-card {
  padding: 18px 18px 12px;
  border: 1px solid var(--flomo-border);
  border-radius: 12px;
}

.fl-chart-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 12px; }

.fl-chart-num { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }

.fl-chart-unit { font-size: 12.5px; color: var(--flomo-text-faint); }

.fl-chart-body { display: flex; gap: 10px; }

.fl-chart-plot { flex: 1; min-width: 0; }

.fl-chart-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 230px;
  padding: 0 6px;
}

.fl-chart-bar {
  width: 14px;
  border-radius: 4px 4px 0 0;
  background: var(--flomo-border);
}

.fl-chart-bar[data-tone="blue"] { background: #6f86ff; }
.fl-chart-bar[data-tone="green"] { background: #3ec57a; }
.fl-chart-bar[data-tone="red"] { background: #f2857d; }

.fl-chart-months {
  display: flex;
  justify-content: space-between;
  padding: 6px 6px 0;
}

.fl-chart-months span { font-size: 10.5px; color: var(--flomo-text-faint); }

.fl-chart-ticks {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 230px;
  padding: 0 0 26px 6px;
  border-left: 1px dashed var(--flomo-border-strong);
  text-align: right;
}

.fl-chart-ticks span {
  font-size: 10.5px;
  line-height: 1;
  color: var(--flomo-text-faint);
  font-variant-numeric: tabular-nums;
}

/* ── AI 洞察 ─────────────────────────────────────────────────────────── */

.fl-insight-hero { margin-bottom: 18px; }

.fl-insight-slogan { margin: 0 0 6px; font-size: 20px; font-weight: 600; }

.fl-insight-slogan-accent { color: var(--flomo-green); }

.fl-insight-statsline { margin: 0 0 10px; font-size: 12.5px; color: var(--flomo-text-faint); }

.fl-insight-scope { display: flex; flex-wrap: wrap; gap: 6px; }

.fl-insight-scope-option {
  border: 1px solid var(--flomo-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--flomo-text-soft);
  font: inherit;
  font-size: 12px;
  padding: 3px 12px;
  cursor: pointer;
}

.fl-insight-scope-option:hover { background: var(--flomo-hover); }

.fl-insight-scope-option[data-active="true"] {
  background: var(--flomo-green);
  border-color: var(--flomo-green);
  color: #fff;
}

.fl-insight-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.fl-insight-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.fl-insight-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--flomo-border);
  border-radius: 12px;
  background: var(--flomo-bg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fl-insight-card:hover { border-color: var(--flomo-green); }

.fl-insight-card:disabled { opacity: 0.5; cursor: default; }

.fl-insight-emoji { font-size: 26px; flex: none; }

.fl-insight-card-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

.fl-insight-name { font-weight: 600; }

.fl-insight-by {
  font-style: normal;
  font-weight: 400;
  font-size: 11.5px;
  color: var(--flomo-text-faint);
}

.fl-insight-desc {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--flomo-text-soft);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fl-insight-running {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 4px;
  font-size: 13px;
  color: var(--flomo-text-soft);
}

.fl-insight-result {
  border: 1px solid var(--flomo-border);
  border-radius: 12px;
  background: var(--flomo-bg);
  padding: 18px 20px;
}

.fl-insight-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--flomo-text-soft);
  margin-bottom: 10px;
}

.fl-insight-result-actions { display: flex; gap: 8px; }

.fl-insight-result-body { font-size: 14.5px; line-height: 1.85; }

.fl-insight-save-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }

.fl-insight-saved { font-size: 12.5px; color: var(--flomo-green); }

/* ── 记录统计页: month digest, trailing-year heatmap, chart cards ───── */

/* 月度: the month picker, five headline numbers, one bar per day. */
.fl-ms { margin-bottom: 26px; }

.fl-ms-select {
  appearance: none;
  border: 0;
  background: transparent
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6'%3E%3Cpath d='M1 1.5l3 3 3-3' fill='none' stroke='%238a8a8a' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E")
    no-repeat right center;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--flomo-text);
  padding: 0 14px 0 0;
  cursor: pointer;
}

.fl-ms-nums {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 34px;
  margin: 12px 0 18px;
}

.fl-ms-num { display: flex; flex-direction: column; gap: 3px; }

.fl-ms-num strong {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--flomo-text);
}

.fl-ms-num span { font-size: 11px; color: var(--flomo-text-faint); }

.fl-ms-chart { display: flex; gap: 10px; }

.fl-ms-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 160px;
  border-bottom: 1px solid var(--flomo-border-strong);
}

.fl-ms-bars i {
  flex: 1 1 0;
  min-width: 2px;
  border-radius: 1.5px 1.5px 0 0;
  background: var(--flomo-green);
  opacity: 0.85;
}

.fl-ms-bars i[data-on="false"] { background: var(--flomo-border); opacity: 1; }

.fl-ms-ticks {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  height: 160px;
  font-size: 10px;
  color: var(--flomo-text-faint);
}

/* 最近一年: 53 fluid week columns, month labels below, weekday rail right. */
.fl-ry { margin-bottom: 26px; }

.fl-ry-title {
  margin: 0 0 12px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--flomo-text);
}

.fl-ry-grid { display: flex; gap: 8px; }

.fl-ry-columns { flex: 1; min-width: 0; }

.fl-ry-weeks { display: flex; gap: 3px; }

.fl-ry-week {
  flex: 1 1 0;
  min-width: 0;
  display: grid;
  grid-template-rows: repeat(7, auto);
  /* The final column holds fewer than 7 days; without this, the flex-stretch
     slack inflates its rows into tall pills instead of leaving them square. */
  align-content: start;
  gap: 3px;
}

.fl-ry-cell {
  width: 100%;
  aspect-ratio: 1;
  border: 0;
  padding: 0;
  border-radius: 2px;
  background: var(--flomo-border);
  font: inherit;
}

button.fl-ry-cell { cursor: pointer; }
button.fl-ry-cell:hover { box-shadow: 0 0 0 1.5px var(--flomo-green); }

.fl-ry-cell[data-level="1"] { background: #c6e7d5; }
.fl-ry-cell[data-level="2"] { background: #8ed3ae; }
.fl-ry-cell[data-level="3"] { background: #47b881; }
.fl-ry-cell[data-level="4"] { background: var(--flomo-green); }

.fl-ry-cell[data-today="true"] { box-shadow: inset 0 0 0 1.5px var(--flomo-text-soft); }

.fl-ry-rail {
  align-self: flex-start;
  display: grid;
  gap: 3px;
}

.fl-ry-rail span {
  font-size: 10px;
  color: var(--flomo-text-faint);
  display: flex;
  align-items: center;
}

/* Month labels sit *under* the grid, the axis reading up into the cells; each
   anchors to the column where its month begins ((100% + gap) / 53 = one pitch). */
.fl-ry-months {
  position: relative;
  margin-top: 6px;
  height: 15px;
  font-size: 10.5px;
  color: var(--flomo-text-faint);
}

.fl-ry-months span { position: absolute; top: 0; white-space: nowrap; }

/* 图表卡片: the six PRO cards and the lightbox 查看 opens. */
.fl-chart-svg { display: block; width: 100%; height: auto; }

.fl-chart-label { font-size: 10px; fill: var(--flomo-text-soft); }
.fl-chart-label-faint { fill: var(--flomo-text-faint); }
.fl-chart-label-inverse { fill: #fff; font-weight: 600; }

.fl-chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 90px;
  height: 100%;
  font-size: 12px;
  color: var(--flomo-text-faint);
}

.fl-donut { width: 100%; }

.fl-donut-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--flomo-text-soft);
}

.fl-donut-legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 5px;
}

.fl-pcards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.fl-pcard {
  display: flex;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--flomo-border);
  border-radius: var(--flomo-radius);
  background: var(--flomo-bg);
}

.fl-pcard-chart {
  flex: 0 0 118px;
  align-self: center;
}

.fl-pcard-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.fl-pcard-meta h3 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--flomo-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.fl-pcard-pro {
  font-style: normal;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #f5c451;
  background: #2b2b2b;
  padding: 1px 5px;
  border-radius: 4px;
}

.fl-pcard-meta p {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--flomo-text-faint);
}

.fl-pcard-view {
  border: 0;
  background: none;
  padding: 0;
  margin-top: auto;
  font: inherit;
  font-size: 12px;
  color: var(--flomo-blue);
  cursor: pointer;
}

.fl-pcard-view:hover { text-decoration: underline; }

.fl-chartbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.32);
}

.fl-chartbox {
  width: min(560px, 100%);
  max-height: calc(100vh - 64px);
  overflow: auto;
  background: var(--flomo-bg);
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18);
}

.fl-chartbox-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.fl-chartbox-head h3 { margin: 0; font-size: 14px; color: var(--flomo-text); }

.fl-chartbox-close {
  border: 0;
  background: none;
  padding: 0 2px;
  font-size: 18px;
  line-height: 1;
  color: var(--flomo-text-faint);
  cursor: pointer;
}

.fl-chartbox-close:hover { color: var(--flomo-text); }

/* 每日回顾 scope settings: rows of label + segmented options. */
.fl-review-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--flomo-border);
  border-radius: 12px;
  background: var(--flomo-bg);
}

.fl-review-setting { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }

.fl-review-label {
  flex: none;
  width: 60px;
  font-size: 12px;
  color: var(--flomo-text-faint);
}

.fl-review-options { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.fl-review-option {
  border: 1px solid var(--flomo-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--flomo-text-soft);
  font: inherit;
  font-size: 12px;
  padding: 3px 12px;
  cursor: pointer;
}

.fl-review-option:hover { background: var(--flomo-hover); }

.fl-review-option[data-active="true"] {
  background: var(--flomo-green);
  border-color: var(--flomo-green);
  color: #fff;
}

.fl-review-tag {
  border: 1px solid var(--flomo-border-strong);
  border-radius: 6px;
  background: var(--flomo-bg);
  color: var(--flomo-text);
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
}

.fl-insight-history { margin-top: 18px; }

.fl-insight-history-toggle {
  border: 0;
  background: transparent;
  color: var(--flomo-text-soft);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
}

.fl-insight-history-toggle:hover { color: var(--flomo-green); }

.fl-insight-history-empty { font-size: 13px; color: var(--flomo-text-faint); }

.fl-insight-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--flomo-border);
}

.fl-insight-history-open {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--flomo-text);
  cursor: pointer;
  padding: 4px 0;
  text-align: left;
}

.fl-insight-history-open:hover { color: var(--flomo-green); }

.fl-insight-history-time { font-size: 11.5px; color: var(--flomo-text-faint); }

.fl-settings-title { margin: 0 0 8px; font-size: 15px; font-weight: 600; }

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
  /* The sidebar becomes a horizontal strip rather than disappearing. Hiding it
     outright — which is what this used to do — leaves a phone with no way to
     reach the review, the random walk, the settings or any tag: the app quietly
     loses most of its navigation on the device it is most likely to be used on. */
  .fl-root { flex-direction: column; gap: 0; padding: 0; }

  .fl-sidebar {
    width: 100%;
    align-self: auto;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    padding: 8px 10px;
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid var(--flomo-border);
  }

  .fl-brand { padding: 0 8px 0 2px; font-size: 14px; }
  .fl-sidebar-section { display: none; }
  .fl-tag-list { flex-direction: row; gap: 2px; }
  /* Even at 156px tall, the calendar is a third of a phone screen, and in a
     horizontal strip half of it is clipped off-screen anyway. The stacked
     corpus numbers read no better sideways, so the strip keeps what a phone
     can actually use: the navigation and the tags. */
  .fl-corpus-stats,
  .fl-sidebar .fl-heatmap-wrap { display: none; }

  .fl-nav-item,
  .fl-tag-row {
    width: auto;
    white-space: nowrap;
    padding: 6px 10px;
    font-size: 13px;
  }

  .fl-sidebar-foot { margin: 0; padding: 0; display: flex; gap: 2px; }
  /* No keyboard to hint at, and no room for the stats. */
  .fl-sidebar-foot .fl-stats-strip,
  .fl-shortcut-hint { display: none; }

  .fl-main { flex: 1; width: auto; min-height: 0; }
  .fl-column { padding: 16px 14px 80px; }
  .fl-column-head { margin-bottom: 14px; }
  .fl-column-title { font-size: 17px; }
  .fl-title-toggle { font-size: 17px; }
  .fl-search { min-width: 0; flex: 1; }
  /* No physical keyboard on this size, so the hint is only noise. */
  .fl-search-kbd { display: none; }

  .fl-memo { display: flex; flex-direction: column; }
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
