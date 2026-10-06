/**
 * Browser entry point.
 *
 * @module @flomo/web/main
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.tsx'
import './global.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器。')

// Registered only in a production build: a service worker in development fights
// Vite's own module graph and makes hot reload unreliable.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative, so the scope follows the `base: './'` deployment path — the same
    // build then works at a domain root and under a project subpath.
    void navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((error: unknown) => {
        console.warn('[flomo] service worker registration failed:', error)
      })
  })
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
