/**
 * Build both faces of `dsh-flomo`.
 *
 * The two halves are wrapped very differently, and both shapes are dictated by
 * the DSH loader rather than by preference:
 *
 * - The **host** half is a plain Node ESM module. `@deepseek-ai/*` packages are
 *   left external because the Harness supplies them at runtime.
 * - The **browser** half must arrive as a CommonJS factory registered with
 *   `window.__ModuleLoader__.load({ id, factory })`, drawing React from the
 *   `require` the factory is handed. So it is bundled to CJS with React
 *   external, then wrapped in that envelope.
 *
 * `@flomo/core` and `@flomo/ui` are bundled inline; they ship raw TypeScript
 * and are not resolvable from the DSH profile, so inlining is what keeps this
 * plugin a single self-contained folder.
 *
 * Usage: `node build.mjs` or `node build.mjs --watch`.
 */

import { rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(resolve(here, 'package.json'), 'utf8'))
const watch = process.argv.includes('--watch')

const lib = resolve(here, 'lib')
const clientBodyPath = resolve(lib, '.client.body.cjs')

/** Shared esbuild settings. */
const shared = {
  bundle: true,
  logLevel: 'info',
  minify: !watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  alias: {
    '@flomo/core': resolve(here, '../core/src/index.ts'),
    '@flomo/ui': resolve(here, '../ui/src/index.ts'),
  },
}

/** Host half: Node ESM, Harness packages left external. */
const hostOptions = {
  ...shared,
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(lib, 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['@deepseek-ai/*'],
  sourcemap: watch,
}

/** Browser half, bundled to CJS before being wrapped. */
const clientOptions = {
  ...shared,
  entryPoints: [resolve(here, 'src/client/index.ts')],
  outfile: clientBodyPath,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  // Off on purpose: the envelope wrapper shifts every line, so a map emitted
  // here would point at the wrong offsets once wrapped.
  sourcemap: false,
}

/**
 * Wrap the built CJS body in the module-loader envelope the web shell expects.
 *
 * The body is inserted **verbatim and unindented**. An earlier version re-indented
 * every line for readability, which silently corrupted the code: esbuild's
 * minifier prints a `"\n"` string as a template literal spanning two source lines,
 * and prefixing each line with the wrapper's indentation injected that
 * indentation *into the string*, turning every `split("\n")` into `split("\n\t\t")`.
 *
 * The indentation was cosmetic; the corruption was not. Anything that rewrites a
 * bundle line by line has to know which lines are inside string literals, and the
 * only safe amount of that is none.
 */
async function wrapClientBundle() {
  const body = await readFile(clientBodyPath, 'utf8')
  const wrapped =
    [
      'window.__ModuleLoader__.load({',
      `\tid: ${JSON.stringify(pkg.name)},`,
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
      '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
      body,
      '\t\treturn module.exports;',
      '\t}',
      '});',
      '',
    ].join('\n') + '\n'

  await writeFile(resolve(lib, 'client.js'), wrapped, 'utf8')
  await rm(clientBodyPath, { force: true })
}

/** Re-wrap the browser bundle whenever esbuild finishes a successful build. */
const wrapPlugin = {
  name: 'flomo-wrap-module-loader',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      await wrapClientBundle()
      console.log(`[flomo] lib/client.js ← ${pkg.name}`)
    })
  },
}

async function main() {
  await mkdir(lib, { recursive: true })

  if (watch) {
    const hostCtx = await esbuild.context(hostOptions)
    const clientCtx = await esbuild.context({ ...clientOptions, plugins: [wrapPlugin] })
    await hostCtx.watch()
    await clientCtx.watch()
    console.log('[flomo] watching for changes…')
    return
  }

  await esbuild.build(hostOptions)
  await esbuild.build({ ...clientOptions, plugins: [wrapPlugin] })
  console.log('[flomo] build complete: lib/index.js, lib/client.js')
}

await main()
