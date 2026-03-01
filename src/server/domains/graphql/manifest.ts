import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { graphqlTools } from './definitions.js';

const t = toolLookup(graphqlTools);

export const graphqlRegistrations: readonly ToolRegistration[] = [
  { tool: t('call_graph_analyze'), domain: 'graphql', bind: (d) => (a) => d.graphqlHandlers.handleCallGraphAnalyze(a) },
  { tool: t('script_replace_persist'), domain: 'graphql', bind: (d) => (a) => d.graphqlHandlers.handleScriptReplacePersist(a) },
  { tool: t('graphql_introspect'), domain: 'graphql', bind: (d) => (a) => d.graphqlHandlers.handleGraphqlIntrospect(a) },
  { tool: t('graphql_extract_queries'), domain: 'graphql', bind: (d) => (a) => d.graphqlHandlers.handleGraphqlExtractQueries(a) },
  { tool: t('graphql_replay'), domain: 'graphql', bind: (d) => (a) => d.graphqlHandlers.handleGraphqlReplay(a) },
];
