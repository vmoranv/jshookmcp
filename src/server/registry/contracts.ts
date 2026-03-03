/**
 * Standardized domain manifest contract.
 *
 * Every domain under domains/STAR/manifest.ts exports a default DomainManifest.
 * The registry discovers and aggregates them at startup - no manual imports needed.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from '../types.js';
import type { MCPServerContext } from '../MCPServer.context.js';

/* ---------- Profile IDs ---------- */

export type ToolProfileId = 'search' | 'minimal' | 'workflow' | 'full' | 'reverse';

/* ---------- Dynamic dependency container ---------- */

// Runtime dependency map keyed by DomainManifest.depKey.
// Each value is a lazily-initialised domain handler instance (wrapped in a Proxy).
// Individual manifests recover concrete types via bindByDepKey<T>().
export interface ToolHandlerDeps {
  readonly [depKey: string]: unknown;
}

/* ---------- Tool registration ---------- */

export interface ToolRegistration {
  readonly tool: Tool;
  readonly domain: string;
  readonly bind: (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown>;
}

/* ---------- Domain manifest ---------- */

export interface DomainManifest<
  TDepKey extends string = string,
  THandler = unknown,
  TDomain extends string = string,
> {
  // Discriminator for runtime validation.
  readonly kind: 'domain-manifest';
  // Schema version - bump when the contract changes.
  readonly version: 1;

  // Unique domain identifier (e.g. 'browser', 'core', 'workflow').
  readonly domain: TDomain;
  // Key under which the handler instance is stored in ToolHandlerDeps.
  readonly depKey: TDepKey;

  // Which tool profiles include this domain.
  readonly profiles: readonly ToolProfileId[];

  // All tool registrations owned by this domain.
  readonly registrations: readonly ToolRegistration[];

  // Lazy factory - called once (via Proxy) to create the domain handler.
  // The returned object is cached by the domain proxy in MCPServer.
  readonly ensure: (ctx: MCPServerContext) => THandler;
}
