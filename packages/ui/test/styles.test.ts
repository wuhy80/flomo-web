/**
 * Stylesheet coverage.
 *
 * There is no browser in this environment, so the visual layer cannot be looked
 * at — but the failure that a browser would catch most often is not subtle: a
 * component asking for a class the stylesheet never defines, which renders as an
 * unstyled element and looks like a layout bug rather than a typo.
 *
 * This checks the two directions. Used-but-undefined is a real defect. Defined-
 * but-unused is rot, and it is how a stylesheet drifts away from the components
 * it is supposed to serve.
 */

import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { FLOMO_CSS } from '../src/styles.ts'

const uiRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packagesRoot = dirname(uiRoot)

/**
 * Every directory whose components render against this stylesheet.
 *
 * The consumers matter as much as the owner: `@flomo/ui` is styled here but
 * composed in the web app and the DSH panel, so scanning only `ui/src` reported
 * classes those packages use as dead.
 */
const consumerDirs = [
  join(uiRoot, 'src'),
  join(packagesRoot, 'web', 'src'),
  join(packagesRoot, 'dsh-plugin', 'src', 'client'),
]

/**
 * Every `.fl-…` class the stylesheet defines.
 * @param css - the stylesheet text.
 * @returns the class names.
 */
function definedClasses(css: string): Set<string> {
  const found = new Set<string>()
  for (const match of css.matchAll(/\.(fl-[a-z0-9-]+)/g)) {
    if (match[1] !== undefined) found.add(match[1])
  }
  return found
}

/**
 * Every `fl-…` token the components mention, with the files that do.
 *
 * Scanning tokens rather than whole string literals is the point: compound class
 * strings such as `"fl-button fl-button-primary"` are the common case, and
 * requiring a literal to hold exactly one class silently reported every modifier
 * as dead.
 * @returns class name to the files using it.
 */
async function usedClasses(): Promise<Map<string, string[]>> {
  const uses = new Map<string, string[]>()
  const scanned: string[] = []

  for (const dir of consumerDirs) {
    let files: string[]
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith('.tsx'))
    } catch {
      // A missing consumer directory means this test is not checking what it
      // claims to, which is worse than a failure.
      throw new Error(`stylesheet test: no such component directory: ${dir}`)
    }
    scanned.push(`${dir} (${files.length})`)

    for (const file of files) {
      const text = await readFile(join(dir, file), 'utf8')
      for (const match of text.matchAll(/\bfl-[a-z0-9-]+/g)) {
        const name = match[0]
        const owners = uses.get(name) ?? []
        if (!owners.includes(file)) owners.push(file)
        uses.set(name, owners)
      }
    }
  }

  assert.equal(scanned.length, consumerDirs.length, 'every consumer must be scanned')
  return uses
}

describe('stylesheet', () => {
  it('has no backtick inside the stylesheet literal', async () => {
    // The stylesheet is a template literal, so one backtick in a CSS comment
    // terminates it and the module stops parsing. That has happened twice now,
    // both times inside a comment nobody thought of as code.
    const source = await readFile(join(uiRoot, 'src', 'styles.ts'), 'utf8')
    const opener = 'export const FLOMO_CSS = `'
    const start = source.indexOf(opener)
    assert.ok(start >= 0, 'the stylesheet literal was not found')

    const end = source.indexOf('\n`', start)
    assert.ok(end > start, 'the stylesheet literal is not terminated on its own line')

    const body = source.slice(start + opener.length, end)
    const offender = body.indexOf('`')
    assert.equal(
      offender,
      -1,
      `a backtick at offset ${offender} would terminate the literal: ` +
        JSON.stringify(body.slice(Math.max(0, offender - 40), offender + 40)),
    )
  })

  it('has balanced braces', () => {
    const open = (FLOMO_CSS.match(/\{/g) ?? []).length
    const close = (FLOMO_CSS.match(/\}/g) ?? []).length
    assert.equal(open, close, 'an unbalanced brace silently swallows every later rule')
    assert.ok(open > 100, 'the stylesheet should not be empty')
  })

  it('defines every class the components ask for', async () => {
    const defined = definedClasses(FLOMO_CSS)
    const used = await usedClasses()

    const missing = [...used.keys()].filter((name) => !defined.has(name)).sort()
    assert.deepEqual(
      missing,
      [],
      'these classes are used by a component but have no rule in the stylesheet',
    )
  })

  it('has no rule for a class nothing uses', async () => {
    const defined = definedClasses(FLOMO_CSS)
    const used = await usedClasses()

    const unused = [...defined].filter((name) => !used.has(name)).sort()
    assert.deepEqual(unused, [], 'these rules are dead; delete them or wire them up')
  })

  it('gives every class name the fl- prefix, so nothing leaks into the host page', () => {
    // The DSH panel injects this stylesheet into a page it does not own. An
    // unprefixed selector would restyle the surrounding application.
    const selectors = FLOMO_CSS.split('{')
      .slice(0, -1)
      .map((chunk) => chunk.split('}').pop() ?? '')
      .join(' ')
    for (const match of selectors.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      const name = match[1] ?? ''
      assert.ok(
        name.startsWith('fl-'),
        `selector .${name} is not namespaced; the panel shares a document with the host`,
      )
    }
  })
})
