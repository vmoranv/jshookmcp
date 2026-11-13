import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { graphqlTools } from '@server/domains/graphql/definitions';
import type { GraphQLToolHandlers } from '@server/domains/graphql/index';

const DOMAIN = 'graphql' as const;
const DEP_KEY = 'graphqlHandlers' as const;
type H = GraphQLToolHandlers;
const t = toolLookup(graphqlTools);
const registrations = defineMethodRegistrations<H, (typeof graphqlTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'call_graph_analyze', method: 'handleCallGraphAnalyzeTool' },
    { tool: 'script_replace_persist', method: 'handleScriptReplacePersistTool' },
    { tool: 'graphql_introspect', method: 'handleGraphqlIntrospectTool' },
    { tool: 'graphql_extract_queries', method: 'handleGraphqlExtractQueriesTool' },
    { tool: 'graphql_replay', method: 'handleGraphqlReplayTool' },
    { tool: 'graphql_subscribe', method: 'handleGraphqlSubscribeTool' },
    { tool: 'graphql_enum_schema', method: 'handleGraphqlEnumSchemaTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { GraphQLToolHandlers } = await import('@server/domains/graphql/index');
  await ensureBrowserCore(ctx);
  if (!ctx.graphqlHandlers) {
    ctx.graphqlHandlers = new GraphQLToolHandlers({
      collector: ctx.collector!,
      consoleMonitor: ctx.consoleMonitor,
    });
  }
  return ctx.graphqlHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (search sceneKeywords).
  sceneKeywords: {
    graphql_introspect: ['pull the graphql schema', 'introspection query', '内省 schema'],
    graphql_enum_schema: ['list graphql enums', 'enum values from schema', '枚举 schema'],
    graphql_extract_queries: [
      'pull graphql from page code',
      'find queries in scripts',
      '提取 graphql',
    ],
    graphql_replay: ['resend a graphql operation', 'replay query with changes', '重放 graphql'],
    graphql_subscribe: ['open graphql subscription', 'follow subscription stream', '订阅 graphql'],
    call_graph_analyze: ['build call graph from code', 'function call relationships', '调用图分析'],
    script_replace_persist: [
      'swap script content for good',
      'persist script replacement',
      '持久替换脚本',
    ],
  },
};

export default manifest;
