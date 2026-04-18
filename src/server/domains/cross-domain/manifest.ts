import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { crossDomainToolDefinitions } from './definitions';
import { CrossDomainHandlers, CrossDomainWorkflowClassifier } from './handlers';
import { CrossDomainEvidenceBridge } from './handlers/evidence-graph-bridge';

const DOMAIN = 'cross-domain' as const;
const DEP_KEY = 'crossDomainHandlers' as const;
type Handlers = CrossDomainHandlers;

const lookupTool = toolLookup(crossDomainToolDefinitions);
const bindTool = (
  invoke: (handlers: Handlers, args: Record<string, unknown>) => Promise<unknown>,
) => bindByDepKey<Handlers>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): CrossDomainHandlers {
  const existing = ctx.getDomainInstance<CrossDomainHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  let bridge = ctx.getDomainInstance<CrossDomainEvidenceBridge>('crossDomainEvidenceBridge');
  if (!bridge) {
    bridge = new CrossDomainEvidenceBridge();
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
      to: 'evidence_export_json',
      relation: 'precedes',
      weight: 0.7,
    },
  ],
  registrations: [
    {
      tool: lookupTool('cross_domain_capabilities'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleCapabilities(args)),
    },
    {
      tool: lookupTool('cross_domain_suggest_workflow'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleSuggestWorkflow(args)),
    },
    {
      tool: lookupTool('cross_domain_health'),
      domain: DOMAIN,
      bind: bindTool((handlers) => handlers.handleHealth()),
    },
    {
      tool: lookupTool('cross_domain_correlate_all'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleCorrelateAll(args)),
    },
    {
      tool: lookupTool('cross_domain_evidence_export'),
      domain: DOMAIN,
      bind: bindTool((handlers) => handlers.handleEvidenceExport()),
    },
    {
      tool: lookupTool('cross_domain_evidence_stats'),
      domain: DOMAIN,
      bind: bindTool((handlers) => handlers.handleEvidenceStats()),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, Handlers, typeof DOMAIN>;

export default manifest;
