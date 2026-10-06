/**
 * Public surface of the shared flomo UI.
 *
 * @module @flomo/ui
 */

export { Composer } from './Composer.tsx'
export type { ComposerProps } from './Composer.tsx'

export { Feed } from './Feed.tsx'
export type { FeedProps } from './Feed.tsx'

export { FlomoApp } from './FlomoApp.tsx'
export type { FlomoAppProps } from './FlomoApp.tsx'

export { browserCacheArea } from './cache-area.ts'

export { downloadText } from './download.ts'

export { GitHubVaultSession, DEFAULT_AUTOSAVE_MS } from './github-session.ts'
export type { GitHubSessionOptions } from './github-session.ts'

export { Heatmap } from './Heatmap.tsx'
export type { HeatmapProps } from './Heatmap.tsx'

export { MemoItem } from './MemoItem.tsx'
export type { MemoItemProps } from './MemoItem.tsx'

export { Sidebar } from './Sidebar.tsx'
export type { SidebarProps } from './Sidebar.tsx'

export { FLOMO_CSS, STYLE_ELEMENT_ID, injectFlomoStyles } from './styles.ts'

export { UnlockGate } from './UnlockGate.tsx'
export type { UnlockGateProps } from './UnlockGate.tsx'

export { useFlomoSession } from './useFlomoSession.ts'

export { describeError } from './session.ts'
export type { FlomoSession, SessionSnapshot, SessionStatus } from './session.ts'

export { isTypingTarget, resolveShortcut, useShortcuts } from './shortcuts.ts'
export type { ShortcutAction, ShortcutEvent } from './shortcuts.ts'

export { sameView, showsComposer, viewTitle } from './views.ts'
export type { FlomoView } from './views.ts'
