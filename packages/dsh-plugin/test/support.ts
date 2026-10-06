/**
 * Shared fixtures for the plugin's integration tests.
 *
 * Not named `*.test.ts`, so the runner's glob does not collect it as a suite.
 *
 * These were duplicated between two test files, and `serve` in particular is
 * subtle enough that two copies would eventually disagree — one file would then
 * be testing a request path the other no longer used.
 *
 * @module dsh-flomo/test/support
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryStore } from '@flomo/core/testing'

import { FlomoHostService } from '../src/host-service.ts'
import { makeFlomoRoutes } from '../src/routes.ts'

/** Directories to remove when a suite finishes. */
const temporaryDirs: string[] = []

/**
 * Create a temporary directory that the suite will clean up.
 * @returns its path.
 */
export async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'flomo-host-'))
  temporaryDirs.push(dir)
  return dir
}

/** Remove every directory `makeTempDir` handed out. Register with `after`. */
export async function cleanupTempDirs(): Promise<void> {
  for (const dir of temporaryDirs.splice(0)) await rm(dir, { recursive: true, force: true })
}

/** The shape of the fake credential store. */
export interface FakeCredentials {
  store: Map<string, string>
  resolve: (ref: string) => Promise<{ value: string } | undefined>
  set: (ref: string, value: string) => Promise<void>
}

/**
 * A stand-in for the DSH credential store.
 * @returns a credentials face plus its backing map, for assertions.
 */
export function fakeCredentials(): FakeCredentials {
  const store = new Map<string, string>()
  return {
    store,
    async resolve(ref) {
      const value = store.get(ref)
      return value === undefined ? undefined : { value }
    },
    async set(ref, value) {
      store.set(ref, value)
    },
  }
}

/** What {@link makeHost} returns. */
export interface HostFixture {
  host: FlomoHostService
  backing: MemoryStore
  credentials: FakeCredentials
  /** Where the settings file lives. */
  configPath: string
}

/**
 * Build a service wired to a fresh in-memory repository.
 * @param dir - directory for the settings file.
 * @param backing - the fake repository to write into.
 * @param credentials - an existing credential store to reuse, for simulating a
 * restart on the same machine; a fresh one otherwise.
 * @returns the service and its collaborators.
 */
export async function makeHost(
  dir: string,
  backing: MemoryStore,
  credentials: FakeCredentials = fakeCredentials(),
): Promise<HostFixture> {
  const configPath = join(dir, 'flomo.json')
  const host = new FlomoHostService({ credentials, configPath, createStore: () => backing })
  await host.ensureStarted()
  return { host, backing, credentials, configPath }
}

/**
 * Serve the plugin's routes over a real loopback socket.
 * @param host - the service to expose.
 * @returns the server and its base URL.
 */
export async function serve(host: FlomoHostService): Promise<{ server: Server; base: string }> {
  const routes = makeFlomoRoutes(host)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? ''
    const route = routes.find((candidate) => url.startsWith(candidate.path))
    if (!route) {
      res.writeHead(404).end()
      return
    }
    void Promise.resolve(route.handler(req, res))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, base: `http://127.0.0.1:${address.port}` }
}
