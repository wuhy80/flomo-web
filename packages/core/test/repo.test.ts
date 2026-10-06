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

/**
 * Read a text file from the repository.
 * @param path - path relative to the repository root.
 * @returns the file's contents.
 */
async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8')
}

/**
 * Pull a single-quoted string constant out of a source file.
 *
 * Reading the value out of the code rather than restating it is the whole point:
 * the assertion is that the docs and the code agree, so neither can be the source
 * of truth in the test itself.
 * @param source - the file's contents.
 * @param name - the exported constant's name.
 * @returns its value.
 */
function constant(source: string, name: string): string {
  const match = new RegExp(`export const ${name} = '([^']+)'`).exec(source)
  assert.ok(match?.[1], `could not find ${name} in the source`)
  return match[1]
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

describe('documented identifiers', () => {
  // Everything here is a string a user has to type by hand. Getting one wrong
  // does not produce an error — it produces a setting that silently does nothing,
  // which is the worst way for documentation to be wrong.

  it('names the credential refs the code actually resolves', async () => {
    const source = await readText('packages/dsh-plugin/src/host-service.ts')
    const readme = await readText('README.md')

    for (const name of ['TOKEN_REF', 'PASSWORD_REF']) {
      const ref = constant(source, name)
      assert.ok(
        readme.includes(ref),
        `the README must name ${ref} (the value of ${name}), or a user will set a credential nothing reads`,
      )
    }
  })

  it('documents the settings file the host actually reads', async () => {
    const source = await readText('packages/dsh-plugin/src/host-service.ts')
    const readme = await readText('README.md')

    assert.match(source, /homedir\(\),\s*'\.dsh',\s*'flomo\.json'/, 'the default config path moved')
    assert.ok(
      readme.includes('~/.dsh/flomo.json'),
      'the README must document where the settings file lives',
    )
  })

  it('lists every agent tool the plugin registers', async () => {
    const source = await readText('packages/dsh-plugin/src/host/tools.ts')
    const readme = await readText('README.md')

    const block = /FLOMO_TOOL_NAMES = \[([^\]]*)\]/.exec(source)?.[1]
    assert.ok(block, 'could not find FLOMO_TOOL_NAMES')

    const names = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '')
    assert.ok(names.length > 0, 'the tool list is empty')
    for (const name of names) {
      assert.ok(readme.includes(name), `the README must document the ${name} tool`)
    }
  })

  it('names the plugin by its real package name', async () => {
    const pkg = await readJson('packages/dsh-plugin/package.json')
    const name = pkg['name']
    assert.equal(typeof name, 'string')

    // The install instruction and the profile row both use this, so a rename that
    // misses the docs leaves the reader with a plugin that will not resolve.
    for (const path of ['README.md', 'docs/DEVELOPING.md']) {
      assert.ok((await readText(path)).includes(String(name)), `${path} must name ${String(name)}`)
    }
  })
})
