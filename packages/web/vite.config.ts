/**
 * Vite configuration for the flomo-sim web app.
 *
 * `@flomo/core` and `@flomo/ui` ship raw TypeScript rather than build output,
 * so they are aliased straight at their source entry points. That keeps the
 * monorepo free of a build-ordering problem: nothing has to be compiled before
 * the app can be compiled.
 *
 * `base: './'` produces relative asset URLs, which is what lets the same build
 * work both at a domain root and under a GitHub Pages project path such as
 * `/flomo-web/`.
 */

import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@flomo/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@flomo/ui': fileURLToPath(new URL('../ui/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5273,
  },
})
