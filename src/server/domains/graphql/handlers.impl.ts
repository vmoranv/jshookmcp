/**
 * GraphQL tool handlers — composition facade.
 *
 * This file serves as the main entry point for GraphQL tool handlers.
 * Handlers are organized into atomic modules by functional domain:
 * - callgraph: Runtime function call graph analysis
 * - script-replace: Persistent script response replacement via CDP interception
 * - introspection: GraphQL schema introspection
 * - extract: Query extraction from captured network traces
 * - replay: GraphQL operation replay via in-page fetch
 */

import type { CodeCollector } from '@server/domains/shared/modules';

import { CallGraphHandlers } from '@server/domains/graphql/handlers/callgraph';
import { ScriptReplaceHandlers } from '@server/domains/graphql/handlers/script-replace';
import { IntrospectionHandlers } from '@server/domains/graphql/handlers/introspection';
import {
  ExtractHandlers,
  type GraphQLExtractDependencies,
} from '@server/domains/graphql/handlers/extract';
import { ReplayHandlers } from '@server/domains/graphql/handlers/replay';

export type GraphQLToolHandlerDependencies = GraphQLExtractDependencies;

function normalizeDependencies(
  deps: CodeCollector | GraphQLToolHandlerDependencies,
): GraphQLToolHandlerDependencies {
  return 'collector' in deps ? deps : { collector: deps };
}

export class GraphQLToolHandlers {
  private callGraph: CallGraphHandlers;
  private scriptReplace: ScriptReplaceHandlers;
  private introspection: IntrospectionHandlers;
  private extract: ExtractHandlers;
  private replay: ReplayHandlers;

  constructor(deps: CodeCollector | GraphQLToolHandlerDependencies) {
    const normalized = normalizeDependencies(deps);
    this.callGraph = new CallGraphHandlers(normalized.collector);
    this.scriptReplace = new ScriptReplaceHandlers(normalized.collector);
    this.introspection = new IntrospectionHandlers(normalized.collector);
    this.extract = new ExtractHandlers(normalized);
    this.replay = new ReplayHandlers(normalized.collector);
  }

  // ── Call Graph ──
  async handleCallGraphAnalyze(args: Record<string, unknown>) {
    return this.callGraph.handleCallGraphAnalyze(args);
  }

  // ── Script Replace ──
  async handleScriptReplacePersist(args: Record<string, unknown>) {
    return this.scriptReplace.handleScriptReplacePersist(args);
  }

  // ── Introspection ──
  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    return this.introspection.handleGraphqlIntrospect(args);
  }

  // ── Extract ──
  async handleGraphqlExtractQueries(args: Record<string, unknown>) {
    return this.extract.handleGraphqlExtractQueries(args);
  }

  // ── Replay ──
  async handleGraphqlReplay(args: Record<string, unknown>) {
    return this.replay.handleGraphqlReplay(args);
  }
}

// Re-export sub-handlers for direct access
export {
  CallGraphHandlers,
  ScriptReplaceHandlers,
  IntrospectionHandlers,
  ExtractHandlers,
  ReplayHandlers,
};
