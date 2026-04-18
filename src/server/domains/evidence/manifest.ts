import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { evidenceTools } from '@server/domains/evidence/definitions';
import { EvidenceHandlers } from '@server/domains/evidence/handlers';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { EvidenceGraphBridge } from '@server/instrumentation/EvidenceGraphBridge';

const DOMAIN = 'evidence' as const;
const DEP_KEY = 'evidenceHandlers' as const;
type H = EvidenceHandlers;
const t = toolLookup(evidenceTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  let graph = ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
  if (!graph) {
    graph = new ReverseEvidenceGraph();
    graph.setEventBus(ctx.eventBus);
    ctx.setDomainInstance('evidenceGraph', graph);
  }

  let bridge = ctx.getDomainInstance<EvidenceGraphBridge>('evidenceGraphBridge');
  if (!bridge) {
    bridge = new EvidenceGraphBridge(graph);
    ctx.setDomainInstance('evidenceGraphBridge', bridge);
  }

  const sessionManager = ctx.getDomainInstance<InstrumentationSessionManager>(
    'instrumentationSessionManager',
  );
  sessionManager?.setEvidenceBridge(bridge);

  if (!ctx.evidenceHandlers) {
    ctx.evidenceHandlers = new EvidenceHandlers(graph);
  }
  return ctx.evidenceHandlers;
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
      /(evidence|provenance|chain).*(graph|query|export|report)/i,
      /(证据|溯源|链).*(图|查询|导出|报告)/i,
    ],
    priority: 90,
    tools: ['evidence_query_url', 'evidence_export_markdown'],
    hint: 'Evidence graph: query by URL/function/scriptId → get provenance chain → export as JSON or Markdown report',
  },

  registrations: [
    {
      tool: t('evidence_query_url'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleQueryUrl(a)),
    },
    {
      tool: t('evidence_query_function'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleQueryFunction(a)),
    },
    {
      tool: t('evidence_query_script'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleQueryScript(a)),
    },
    {
      tool: t('evidence_export_json'),
      domain: DOMAIN,
      bind: b(async (h) => h.handleExportJson()),
    },
    {
      tool: t('evidence_export_markdown'),
      domain: DOMAIN,
      bind: b(async (h) => h.handleExportMarkdown()),
    },
    {
      tool: t('evidence_chain'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleChain(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
