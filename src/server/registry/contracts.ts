/**
 * Standardized domain manifest contract.
 *
 * Every domain under domains/STAR/manifest.ts exports a default DomainManifest.
 * The registry discovers and aggregates them at startup - no manual imports needed.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from '@server/types';
import type { MCPServerContext } from '@server/MCPServer.context';

// ── Profile IDs ──

export type ToolProfileId = 'search' | 'workflow' | 'full' | 'restricted';

// ── Dynamic dependency container ──

// Runtime dependency map keyed by DomainManifest.depKey.
// Each value is a lazily-initialised domain handler instance (wrapped in a Proxy).
// Individual manifests recover concrete types via bindByDepKey<T>().
export interface ToolHandlerDeps {
  readonly [depKey: string]: unknown;
}

// ── Tool registration ──

export interface ToolRegistration {
  readonly tool: Tool;
  readonly domain: string;
  readonly bind: (deps: ToolHandlerDeps) => (args: ToolArgs) => Promise<unknown>;
  /**
   * Optional per-registration profile override.
   * When set, this tool is only included in the listed profiles
   * even if the parent domain is available at a lower tier.
   */
  readonly profiles?: readonly ToolProfileId[];
}

// ── Domain manifest ──

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
  // Additional dep keys that ensure() initialises on the context.
  // Used when a single ensure() creates multiple handler objects.
  readonly secondaryDepKeys?: readonly string[];

  // Which tool profiles include this domain.
  readonly profiles: readonly ToolProfileId[];

  // All tool registrations owned by this domain.
  readonly registrations: readonly ToolRegistration[];

  // Lazy factory - called once (via Proxy) to create the domain handler.
  // The returned object is cached by the domain proxy in MCPServer.
  readonly ensure: (ctx: MCPServerContext) => THandler;
}
