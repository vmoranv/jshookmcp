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

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

import { CallGraphHandlers } from '@server/domains/graphql/handlers/callgraph';
import { ScriptReplaceHandlers } from '@server/domains/graphql/handlers/script-replace';
import { IntrospectionHandlers } from '@server/domains/graphql/handlers/introspection';
import {
  ExtractHandlers,
  type GraphQLExtractDependencies,
} from '@server/domains/graphql/handlers/extract';
import { ReplayHandlers } from '@server/domains/graphql/handlers/replay';
import { SubscribeHandlers } from '@server/domains/graphql/handlers/subscribe';
import { SchemaEnumHandlers } from '@server/domains/graphql/handlers/schema-enum';

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
  private subscribe: SubscribeHandlers;
  private schemaEnum: SchemaEnumHandlers;

  constructor(deps: CodeCollector | GraphQLToolHandlerDependencies) {
    const normalized = normalizeDependencies(deps);
    this.callGraph = new CallGraphHandlers(normalized.collector);
    this.scriptReplace = new ScriptReplaceHandlers(normalized.collector);
    this.introspection = new IntrospectionHandlers(normalized.collector);
    this.extract = new ExtractHandlers(normalized);
    this.replay = new ReplayHandlers(normalized.collector);
    this.subscribe = new SubscribeHandlers(normalized.collector);
    this.schemaEnum = new SchemaEnumHandlers();
  }

  dropSessionState(sessionId: string): void {
    this.scriptReplace.dropSessionState(sessionId);
  }

  // ── Call Graph ──
  async handleCallGraphAnalyzeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCallGraphAnalyze(args));
  }

  async handleCallGraphAnalyze(args: Record<string, unknown>) {
    return this.callGraph.handleCallGraphAnalyze(args);
  }

  // ── Script Replace ──
  async handleScriptReplacePersistTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleScriptReplacePersist(args));
  }

  async handleScriptReplacePersist(args: Record<string, unknown>) {
    return this.scriptReplace.handleScriptReplacePersist(args);
  }

  // ── Introspection ──
  async handleGraphqlIntrospectTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGraphqlIntrospect(args));
  }

  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    return this.introspection.handleGraphqlIntrospect(args);
  }

  // ── Extract ──
  async handleGraphqlExtractQueriesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGraphqlExtractQueries(args));
  }

  async handleGraphqlExtractQueries(args: Record<string, unknown>) {
    return this.extract.handleGraphqlExtractQueries(args);
  }

  // ── Replay ──
  async handleGraphqlReplayTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGraphqlReplay(args));
  }

  async handleGraphqlReplay(args: Record<string, unknown>) {
    return this.replay.handleGraphqlReplay(args);
  }

  // ── Subscribe ──
  async handleGraphqlSubscribeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGraphqlSubscribe(args));
  }

  async handleGraphqlSubscribe(args: Record<string, unknown>) {
    return this.subscribe.handleGraphqlSubscribe(args);
  }

  async handleGraphqlEnumSchemaTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGraphqlEnumSchema(args));
  }

  async handleGraphqlEnumSchema(args: Record<string, unknown>) {
    return this.schemaEnum.handleGraphqlEnumSchema(args);
  }
}

// Re-export sub-handlers for direct access
