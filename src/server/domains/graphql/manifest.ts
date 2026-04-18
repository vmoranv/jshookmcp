import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { graphqlTools } from '@server/domains/graphql/definitions';
import { GraphQLToolHandlers } from '@server/domains/graphql/index';
import { CodeCollector } from '@server/domains/shared/modules';

const DOMAIN = 'graphql' as const;
const DEP_KEY = 'graphqlHandlers' as const;
type H = GraphQLToolHandlers;
const t = toolLookup(graphqlTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.graphqlHandlers) ctx.graphqlHandlers = new GraphQLToolHandlers(ctx.collector);
  return ctx.graphqlHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations: [
    {
      tool: t('call_graph_analyze'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCallGraphAnalyze(a)),
    },
    {
      tool: t('script_replace_persist'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleScriptReplacePersist(a)),
    },
    {
      tool: t('graphql_introspect'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGraphqlIntrospect(a)),
    },
    {
      tool: t('graphql_extract_queries'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGraphqlExtractQueries(a)),
    },
    { tool: t('graphql_replay'), domain: DOMAIN, bind: b((h, a) => h.handleGraphqlReplay(a)) },
  ],
};

export default manifest;
