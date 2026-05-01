import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { crossDomainToolDefinitions } from './definitions';
import type { CrossDomainHandlers, CrossDomainWorkflowClassifier } from './handlers';
import type { CrossDomainEvidenceBridge } from './handlers/evidence-graph-bridge';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';

const DOMAIN = 'cross-domain' as const;
const DEP_KEY = 'crossDomainHandlers' as const;
type Handlers = CrossDomainHandlers;

const lookupTool = toolLookup(crossDomainToolDefinitions);
const registrations = defineMethodRegistrations<
  Handlers,
  (typeof crossDomainToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: lookupTool,
  entries: [
    { tool: 'cross_domain_capabilities', method: 'handleCapabilities' },
    { tool: 'cross_domain_suggest_workflow', method: 'handleSuggestWorkflow' },
    { tool: 'cross_domain_health', method: 'handleHealth' },
    { tool: 'cross_domain_correlate_all', method: 'handleCorrelateAll' },
    { tool: 'cross_domain_evidence_export', method: 'handleEvidenceExport' },
    { tool: 'cross_domain_evidence_stats', method: 'handleEvidenceStats' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<CrossDomainHandlers> {
  const { ReverseEvidenceGraph } = await import('@server/evidence/ReverseEvidenceGraph');
  const { CrossDomainEvidenceBridge } = await import('./handlers/evidence-graph-bridge');
  const { CrossDomainWorkflowClassifier, CrossDomainHandlers } = await import('./handlers');
  const existing = ctx.getDomainInstance<CrossDomainHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  // Dynamic imports — load only when domain is first accessed

  // Use the shared evidence graph (created by evidence domain, or create + bind eventBus here)
  let graph = ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
  if (!graph) {
    graph = new ReverseEvidenceGraph();
    graph.setEventBus(ctx.eventBus);
    ctx.setDomainInstance('evidenceGraph', graph);
  }

  let bridge = ctx.getDomainInstance<CrossDomainEvidenceBridge>('crossDomainEvidenceBridge');
  if (!bridge) {
    bridge = new CrossDomainEvidenceBridge(graph);
    ctx.setDomainInstance('crossDomainEvidenceBridge', bridge);
  }

  let workflowClassifier = ctx.getDomainInstance<CrossDomainWorkflowClassifier>(
    'crossDomainWorkflowClassifier',
  );
  if (!workflowClassifier) {
    workflowClassifier = new CrossDomainWorkflowClassifier(ctx, true);
    ctx.setDomainInstance('crossDomainWorkflowClassifier', workflowClassifier);
  }

  const handlers = new CrossDomainHandlers(bridge, workflowClassifier);
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  workflowRule: {
    patterns: [
      /(cross[- ]domain|multi[- ]domain|evidence graph|correlate).*(v8|network|canvas|syscall|mojo|binary)/i,
      /(跨域|多域|证据图|关联).*(v8|网络|canvas|syscall|mojo|binary)/i,
    ],
    priority: 98,
    tools: [
      'cross_domain_capabilities',
      'cross_domain_suggest_workflow',
      'cross_domain_correlate_all',
      'cross_domain_evidence_stats',
    ],
    hint: 'Cross-domain reverse workflow: inspect capabilities → suggest mission workflow → correlate evidence from all v5.0 domains → export evidence graph',
  },
  toolDependencies: [
    { from: 'cross_domain_suggest_workflow', to: 'deobfuscate', relation: 'suggests', weight: 0.6 },
    {
      from: 'cross_domain_suggest_workflow',
      to: 'js_heap_search',
      relation: 'suggests',
      weight: 0.6,
    },
    {
      from: 'cross_domain_suggest_workflow',
      to: 'network_enable',
      relation: 'suggests',
      weight: 0.5,
    },
    {
      from: 'cross_domain_suggest_workflow',
      to: 'canvas_scene_dump',
      relation: 'suggests',
      weight: 0.5,
    },
    {
      from: 'cross_domain_suggest_workflow',
      to: 'skia_correlate_objects',
      relation: 'suggests',
      weight: 0.5,
    },
    {
      from: 'cross_domain_suggest_workflow',
      to: 'syscall_correlate_js',
      relation: 'suggests',
      weight: 0.5,
    },
    {
      from: 'cross_domain_suggest_workflow',
      to: 'ghidra_analyze',
      relation: 'suggests',
      weight: 0.5,
    },
    {
      from: 'cross_domain_correlate_all',
      to: 'evidence_export',
      relation: 'precedes',
      weight: 0.7,
    },
  ],
  registrations,
} satisfies DomainManifest<typeof DEP_KEY, Handlers, typeof DOMAIN>;

export default manifest;
