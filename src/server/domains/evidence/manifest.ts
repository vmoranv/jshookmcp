import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { evidenceTools } from '@server/domains/evidence/definitions';
import { EvidenceHandlers } from '@server/domains/evidence/handlers';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { EvidenceGraphBridge } from '@server/instrumentation/EvidenceGraphBridge';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import { resolve } from 'node:path';

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

  const scheduler = ctx.getDomainInstance<RuntimeSnapshotScheduler>('snapshotScheduler');
  const stateDir = ctx.getDomainInstance<string>('snapshotStateDir');
  graph.setPersistNotifier(scheduler ? () => scheduler.notifyDirty() : undefined);
  if (scheduler && stateDir && !ctx.getDomainInstance<boolean>('evidenceGraphSnapshotRegistered')) {
    scheduler.register(resolve(stateDir, 'evidence-graph', 'current.json'), graph);
    ctx.setDomainInstance('evidenceGraphSnapshotRegistered', true);
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
    tools: ['evidence_query', 'evidence_export'],
    hint: 'Evidence graph: query by URL/function/scriptId → get provenance chain → export as JSON or Markdown report',
  },

  registrations: [
    {
      tool: t('evidence_query'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleQueryDispatch(a)),
    },
    {
      tool: t('evidence_export'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleExportDispatch(a)),
    },
    {
      tool: t('evidence_chain'),
      domain: DOMAIN,
      bind: b(async (h, a) => h.handleChain(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
