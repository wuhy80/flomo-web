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

  /**
   * A tool as it is *written*: parameters as a name-to-declaration map.
   *
   * This is the input shape. `defineTool` normalizes it, and that normalization is
   * not optional — see {@link ToolDefinition.parameters}.
   */
  export interface ToolDeclaration {
    name: string
    description: string
    parameters: Record<string, ToolParameter>
    output: {
      /**
       * A JSON Schema for the tool's return value.
       *
       * Typed loosely on purpose. `defineTool` also accepts a `{ type: 'json' }`
       * shorthand and expands it; a plugin that supplies its own helper must expand
       * it too, because the registry validates what it is finally given.
       */
      schema: Record<string, unknown>
      render: (args: unknown, value: unknown) => ToolContentBlock[]
    }
    isConcurrencySafe?: () => boolean
    execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>
  }

  /** A tool as the registry stores it. */
  export interface ToolDefinition extends Omit<ToolDeclaration, 'parameters'> {
    /**
     * A JSON Schema of `type: "object"` describing the arguments.
     *
     * Not the declaration map it was written as, and the difference matters more
     * than it looks. The registry accepts either — it only validates
     * `output.schema` — so a declaration map passes registration and then fails
     * much later, when the model is handed the tool list:
     *
     *   Invalid schema for function 'flomo_add':
     *   schema must be a JSON Schema of 'type: "object"', got 'type: null'.
     */
    parameters: Record<string, unknown>
  }

  /**
   * Declare a tool. The real implementation adds validation, defaulting and the
   * parameter normalization described on {@link ToolDefinition}.
   * @param declaration - the tool as written.
   * @returns the definition the registry accepts.
   */
  export function defineTool(declaration: ToolDeclaration): ToolDefinition
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
