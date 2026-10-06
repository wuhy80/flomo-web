/**
 * Ambient declarations for the DeepSeek Harness services this plugin consumes.
 *
 * The plugin is bundled with esbuild and loaded by the DSH host, which supplies
 * these modules at runtime; they are deliberately not dependencies here. These
 * declarations mirror the contracts of the installed DSH build so that
 * `tsc --noEmit` over the monorepo stays meaningful without pulling the whole
 * Harness in as a build dependency.
 *
 * @module dsh-flomo/dsh
 */

declare module '@deepseek-ai/dsh-tools' {
  /** A JSON value a tool may return. */
  export type ToolJson =
    | null
    | boolean
    | number
    | string
    | ToolJson[]
    | { [key: string]: ToolJson }

  /** One declared parameter of a tool. */
  export interface ToolParameter {
    type: 'string' | 'boolean' | 'integer' | 'number' | 'array' | 'object'
    description: string
    required?: boolean
    enum?: readonly string[]
    items?: ToolParameter
    properties?: Record<string, ToolParameter>
  }

  /** The model-facing rendering of a tool result. */
  export interface ToolContentBlock {
    type: 'text'
    text: string
  }

  /** A tool as the registry stores it. */
  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, ToolParameter>
    output: {
      schema: { type: 'json' }
      render: (args: unknown, value: unknown) => ToolContentBlock[]
    }
    isConcurrencySafe?: () => boolean
    execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>
  }

  /**
   * Declare a tool. The real implementation adds validation and defaulting
   * around the definition.
   * @param definition - the tool definition.
   * @returns the definition the registry accepts.
   */
  export function defineTool(definition: ToolDefinition): ToolDefinition
}

declare module '@deepseek-ai/dsh-host-webserver' {
  import type { IncomingMessage, ServerResponse } from 'node:http'

  /** One route registered on the DSH web server. */
  export interface WebRoute {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }
}
