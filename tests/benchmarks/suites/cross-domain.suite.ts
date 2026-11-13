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

    // ── Coverage batch 2026-11-11 (autoresearch): complete remaining 4 cross-domain tools ──
    {
      name: 'cross_domain_suggest_workflow/goal-ranking',
      tool: 'cross_domain_suggest_workflow',
      origin: 'homemade',
      reference:
        'workflow classifier recommends a matching workflow with requiredDomains and coverage score',
      run: () => {
        const { handlers } = createCrossDomainFixture();
        return handlers.handleSuggestWorkflowTool({
          goal: 'intercept network requests and debug API calls',
          preferAvailableOnly: true,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.workflowKey !== 'string' || b.workflowKey.length === 0)
          return `missing workflowKey: ${JSON.stringify(b).slice(0, 200)}`;
        if (!Array.isArray(b.requiredDomains) || b.requiredDomains.length === 0)
          return `missing requiredDomains: ${JSON.stringify(b).slice(0, 200)}`;
        if (typeof b.coverage !== 'number' || b.coverage <= 0)
          return `expected positive coverage for available workflow, got ${b.coverage}`;
        return true;
      },
    },
    {
      name: 'cross_domain_evidence_stats/node-and-edge-counts',
      tool: 'cross_domain_evidence_stats',
      origin: 'homemade',
      reference: 'evidence_stats reports exact nodeCount, edgeCount, and quality summary',
      run: () => {
        const { bridge, handlers } = createCrossDomainFixture();
        const n1 = bridge.addNode('network-request', 'req-stat-1', {
          url: withPath(TEST_URLS.api, 'items'),
        });
        const n2 = bridge.addNode('v8-heap-object', 'obj-stat-1', { address: '0x2000' });
        bridge.getGraph().addEdge(n1.id, n2.id, 'v8-triggers-network', { confidence: 0.9 });
        return handlers.handleEvidenceStatsTool();
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.nodeCount) !== 2) return `expected nodeCount === 2, got ${b.nodeCount}`;
        if (Number(b.edgeCount) !== 1) return `expected edgeCount === 1, got ${b.edgeCount}`;
        return true;
      },
    },
    {
      name: 'cross_domain_evidence_query/network-url-filter',
      tool: 'cross_domain_evidence_query',
      origin: 'homemade',
      reference: 'evidence_query by network_url filters graph nodes to matching URL substring',
      run: () => {
        const { bridge, handlers } = createCrossDomainFixture();
        bridge.addNode('network-request', 'req-q-login', {
          url: withPath(TEST_URLS.api, 'login'),
        });
        bridge.addNode('network-request', 'req-q-other', {
          url: withPath(TEST_URLS.api, 'health'),
        });
        return handlers.handleEvidenceQueryTool({
          queryType: 'network_url',
          value: 'login',
          limit: 10,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.total) !== 1) return `expected total === 1, got ${b.total}`;
        const nodes = (b.nodes as Array<Record<string, unknown>>) ?? [];
        if (nodes.length !== 1 || String(nodes[0]?.label ?? '') !== 'req-q-login')
          return `expected matching node label req-q-login, got ${JSON.stringify(nodes)}`;
        return true;
      },
    },
    {
      name: 'cross_domain_correlate_all/offline-correlators',
      tool: 'cross_domain_correlate_all',
      origin: 'homemade',
      reference:
        'runs built-in mojo/syscall/skia/binary correlators with pullFromDomains=false and merges evidence graph',
      run: () => {
        const { handlers } = createCrossDomainFixture();
        return handlers.handleCorrelateAllTool({
          pullFromDomains: false,
          mojoMessages: [
            {
              interface: 'network.mojom.URLLoader',
              method: 'CreateLoaderAndStart',
              timestamp: 1005,
              messageId: 'mojo-1',
            },
          ],
          cdpEvents: [
            {
              eventType: 'Network.requestWillBeSent',
              timestamp: 1000,
              url: withPath(TEST_URLS.api, 'correlate'),
            },
          ],
          networkRequests: [
            {
              requestId: 'req-corr-1',
              url: withPath(TEST_URLS.api, 'correlate'),
              timestamp: 1000,
            },
          ],
          syscallEvents: [{ pid: 100, tid: 1, syscallName: 'connect', timestamp: 1002 }],
          jsStacks: [{ threadId: 1, timestamp: 1002, frames: [{ functionName: 'fetchData' }] }],
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const corr = b.correlationResults as { errors?: string[] } | undefined;
        if (!corr) return 'missing correlationResults';
        if (Array.isArray(corr.errors) && corr.errors.length > 0)
          return `unexpected correlator errors: ${JSON.stringify(corr.errors)}`;
        const graph = b.evidenceGraph as { nodes?: unknown[] } | undefined;
        if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0)
          return `expected populated evidenceGraph nodes, got ${JSON.stringify(graph).slice(0, 200)}`;
        return true;
      },
    },
  ],
};
