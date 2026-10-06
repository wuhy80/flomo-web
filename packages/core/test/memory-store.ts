/**
 * Re-export of the shared fake repository.
 *
 * The implementation lives in `src/testing.ts` so that the DSH plugin's suite
 * can import it through the `@flomo/core/testing` subpath rather than reaching
 * across package boundaries into this directory.
 *
 * @module @flomo/core/test/memory-store
 */

export { MemoryStore } from '../src/testing.ts'
