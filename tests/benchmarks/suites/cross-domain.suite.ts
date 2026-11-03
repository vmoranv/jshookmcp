/**
 * Cross-domain suite — evidence graph, cross-domain synonyms, workflow suggestion, and capabilities (offline).
 *
 * Ground truth:
 *  - cross_domain_synonym: natural language task queries resolve canonical synonym matches with recommended tools
 *  - cross_domain_evidence_export / stats: nodes added to the evidence bridge are accurately reflected in stats and graph exports
 *  - cross_domain_capabilities: workflow classifier detects registered domains and evaluates multi-domain workflows
 */
import {
  CrossDomainHandlers,
  CrossDomainWorkflowClassifier,
} from '@server/domains/cross-domain/handlers.impl';
import { CrossDomainEvidenceBridge } from '@server/domains/cross-domain/handlers/evidence-graph-bridge.impl';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { MCPServerContext } from '@server/MCPServer.context';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';
import { body, expectSuccess, type BenchSuite } from '../harness';

function createCrossDomainFixture() {
  const graph = new ReverseEvidenceGraph();
  const bridge = new CrossDomainEvidenceBridge(graph);
  const ctx = {
    enabledDomains: new Set(['network', 'browser', 'debugger', 'v8-inspector']),
    selectedTools: new Set(),
    resolveEnabledDomains: () => new Set(['network', 'browser']),
  } as unknown as MCPServerContext;

  const classifier = new CrossDomainWorkflowClassifier(ctx, true);
  const handlers = new CrossDomainHandlers(bridge, classifier, ctx);
  return { graph, bridge, handlers };
}

export const crossDomainSuite: BenchSuite = {
  name: 'cross-domain',
  domain: 'cross-domain',
  description:
    'Cross-domain synonym mapping, evidence graph node/edge tracking, and workflow suggestion capabilities',
  cases: [
    {
      name: 'cross_domain_synonym/query-resolves-intent',
      tool: 'cross_domain_synonym',
      origin: 'homemade',
      reference: 'natural language query matches concept and returns recommended tools list',
      run: async () => {
        const { handlers } = createCrossDomainFixture();
        return handlers.handleSynonymTool({ query: 'intercept network requests', maxResults: 5 });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.matchCount) <= 0) return `expected matchCount > 0, got ${b.matchCount}`;
        const matches = (b.matches as Array<Record<string, unknown>>) ?? [];
        if (!matches.length) return 'matches array empty';
        const hasNetworkTools = matches.some(
          (m) =>
            Array.isArray(m.recommendedTools) &&
            (m.recommendedTools as string[]).some((t) => t.startsWith('network_')),
        );
        return hasNetworkTools ? true : 'expected network_* tools in recommendedTools';
      },
    },
    {
      name: 'cross_domain_evidence/add-and-export',
      tool: 'cross_domain_evidence_export',
      origin: 'homemade',
      reference: 'adding nodes via evidence bridge reflects in exportGraph and evidence_stats',
      run: async () => {
        const { bridge, handlers } = createCrossDomainFixture();
        bridge.addNode('network-request', 'req-1', { url: withPath(TEST_URLS.api, 'login') });
        bridge.addNode('v8-heap-object', 'obj-1', { address: '0x1234' });
        const exported = body(await handlers.handleEvidenceExportTool());
        const stats = body(await handlers.handleEvidenceStatsTool());
        return { exported, stats };
      },
      validate: (v) => {
        const b = body(v);
        const exp = b.exported as Record<string, unknown>;
        const stats = b.stats as Record<string, unknown>;
        const nodes = (exp.nodes as Array<Record<string, unknown>>) ?? [];
        if (nodes.length !== 2) return `expected 2 nodes in export, got ${nodes.length}`;
        if (Number(stats.nodeCount) !== 2)
          return `expected stats.nodeCount === 2, got ${stats.nodeCount}`;
        return true;
      },
    },
    {
      name: 'cross_domain_capabilities/workflow-evaluation',
      tool: 'cross_domain_capabilities',
      origin: 'homemade',
      reference: 'capabilities report available domains and compute workflow coverage',
      run: async () => {
        const { handlers } = createCrossDomainFixture();
        return handlers.handleCapabilitiesTool({});
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const available = (b.availableDomains as string[]) ?? [];
        if (!available.includes('network') || !available.includes('browser')) {
          return `availableDomains missing expected domains: ${JSON.stringify(available)}`;
        }
        const workflows = (b.workflows as Array<Record<string, unknown>>) ?? [];
        if (workflows.length === 0) return 'expected at least one defined workflow in capabilities';
        return true;
      },
    },
  ],
};
