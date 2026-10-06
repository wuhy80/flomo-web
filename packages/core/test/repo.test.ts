/**
 * Assertions about the repository's own configuration.
 *
 * These live under a package because the test glob only collects from packages,
 * but they are about the repository as a whole. Each pins a claim the docs make —
 * and that kind of claim has already gone stale twice here: the README said there
 * was no service worker after one existed, and said a bundle toggle reloads the
 * plugin when it demonstrably does not. Nothing else notices prose drifting away
 * from the code.
 *
 * Only structural claims are pinned. Asserting on sentences would break on every
 * rewording, which is a worse failure than the one it prevents.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Read and parse a JSON file from the repository.
 * @param path - path relative to the repository root.
 * @returns the parsed document.
 */
async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(repoRoot, path), 'utf8')) as Record<string, unknown>
}

describe('repository claims', () => {
  it('keeps the core free of runtime dependencies', async () => {
    // The README calls it "零依赖", and it is what lets the same module run in a
    // browser, in the DSH host process and in a bare test without a build step.
    const pkg = await readJson('packages/core/package.json')
    assert.equal(pkg['dependencies'], undefined, 'core must not depend on anything')
  })

  it('keeps the plugin self-contained', async () => {
    // Its dependencies are build-time only: @flomo/core and @flomo/ui are bundled
    // into lib/, which is what lets a `link:` install work from outside the
    // profile where nothing else resolves.
    const pkg = await readJson('packages/dsh-plugin/package.json')
    assert.equal(pkg['dependencies'], undefined, 'the plugin must bundle what it needs')
  })

  it('typechecks the tests, not only the sources', async () => {
    // Tests are the first consumer of the public API, so checking them checks the
    // API's type contract for free. They were outside `include` until it was
    // widened, which is how a bad cast in a test helper survived.
    const tsconfig = await readFile(join(repoRoot, 'tsconfig.json'), 'utf8')
    assert.match(tsconfig, /"packages\/\*\/test\/\*\*\/\*\.ts"/, 'test files must be included')
    assert.match(tsconfig, /vite\.config\.ts/, 'the Vite config must be included')
  })

  it('collects tests by glob rather than by an explicit list', async () => {
    // A list is silently incomplete: a new test file is simply not run, and
    // nothing says so.
    const pkg = await readJson('package.json')
    const scripts = pkg['scripts'] as Record<string, string>
    const test = scripts['test'] ?? ''
    assert.match(test, /\*\.test\.ts/, 'the test script must glob for test files')
    assert.ok(
      test.includes('"packages/**/*.test.ts"'),
      'the glob must be quoted, or sh expands ** like * and misses deeper tests',
    )
  })
})
