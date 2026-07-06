import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { instrumentationTools } from '@server/domains/instrumentation/definitions';
import { aiHookTools, hookPresetTools } from '@server/domains/instrumentation/hooks/definitions';
import { evidenceTools } from '@server/domains/instrumentation/evidence/definitions';
import type { InstrumentationHandlers } from '@server/domains/instrumentation/handlers';
import type { AIHookToolHandlers } from '@server/domains/instrumentation/hooks/ai-handlers';
import type { HookPresetToolHandlers } from '@server/domains/instrumentation/hooks/preset-handlers';
import type { EvidenceHandlers } from '@server/domains/instrumentation/evidence/handlers';
import type { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import type { EvidenceGraphBridge } from '@server/instrumentation/EvidenceGraphBridge';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import type { ToolResponse } from '@server/types';
import { resolve } from 'node:path';

const DOMAIN = 'instrumentation' as const;
const DEP_KEY = 'instrumentationHandlers' as const;
type H = InstrumentationHandlers;
type AH = AIHookToolHandlers;
type HP = HookPresetToolHandlers;
type EH = EvidenceHandlers;

const allToolDefinitions = [
  ...instrumentationTools,
  ...aiHookTools,
  ...hookPresetTools,
  ...evidenceTools,
] as const;
const t = toolLookup(allToolDefinitions);

// Instrumentation registrations
const instrumentationRegistrations = defineMethodRegistrations<
  H,
  (typeof instrumentationTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'instrumentation_session', method: 'handleSessionDispatch' },
    { tool: 'instrumentation_session_export', method: 'handleSessionExport' },
    { tool: 'instrumentation_operation', method: 'handleOperationDispatch' },
    { tool: 'instrumentation_artifact', method: 'handleArtifactDispatch' },
    { tool: 'instrumentation_hook_preset', method: 'handleHookPreset' },
    { tool: 'instrumentation_network_replay', method: 'handleNetworkReplay' },
  ],
});

// Hooks registrations
const aiHookRegistrations = defineMethodRegistrations<AH, (typeof aiHookTools)[number]['name']>({
  domain: DOMAIN,
  depKey: 'aiHookHandlers',
  lookup: t,
  entries: [{ tool: 'ai_hook', method: 'handleAIHook' }],
});

const hookPresetRegistrations = defineMethodRegistrations<
  HP,
  (typeof hookPresetTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: 'hookPresetHandlers',
  lookup: t,
  entries: [{ tool: 'hook_preset', method: 'handleHookPreset' }],
});

// Evidence registrations
const evidenceRegistrations = defineMethodRegistrations<EH, (typeof evidenceTools)[number]['name']>(
  {
    domain: DOMAIN,
    depKey: 'evidenceHandlers',
    lookup: t,
    entries: [
      { tool: 'evidence_query', method: 'handleQueryDispatch' },
      { tool: 'evidence_export', method: 'handleExportDispatch' },
      { tool: 'evidence_chain', method: 'handleChain' },
    ],
  },
);

interface HookPresetHandlerLike {
  handleHookPreset(args: Record<string, unknown>): Promise<ToolResponse>;
}

interface NetworkReplayHandlerLike {
  handleNetworkReplayRequest(args: Record<string, unknown>): Promise<ToolResponse>;
}

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { ReverseEvidenceGraph } = await import('@server/evidence/ReverseEvidenceGraph');
  const { InstrumentationSessionManager } =
    await import('@server/instrumentation/InstrumentationSession');
  const { EvidenceGraphBridge } = await import('@server/instrumentation/EvidenceGraphBridge');
  const { InstrumentationHandlers } = await import('@server/domains/instrumentation/handlers');

  // Hooks — require browser core (pageController)
  await ensureBrowserCore(ctx);
  if (!ctx.aiHookHandlers) {
    const { AIHookToolHandlers } = await import('@server/domains/instrumentation/hooks/index');
    ctx.aiHookHandlers = new AIHookToolHandlers(ctx.pageController!);
  }
  if (!ctx.hookPresetHandlers) {
    const { HookPresetToolHandlers } = await import('@server/domains/instrumentation/hooks/index');
    ctx.hookPresetHandlers = new HookPresetToolHandlers(ctx.pageController!);
  }

  // Evidence — shared graph singleton
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

  // Evidence handlers
  if (!ctx.evidenceHandlers) {
    const { EvidenceHandlers } = await import('@server/domains/instrumentation/evidence/handlers');
    ctx.evidenceHandlers = new EvidenceHandlers(graph);
  }

  // Evidence snapshot scheduler
  const scheduler = ctx.getDomainInstance<RuntimeSnapshotScheduler>('snapshotScheduler');
  const stateDir = ctx.getDomainInstance<string>('snapshotStateDir');
  graph.setPersistNotifier(scheduler ? () => scheduler.notifyDirty() : undefined);
  if (scheduler && stateDir && !ctx.getDomainInstance<boolean>('evidenceGraphSnapshotRegistered')) {
    scheduler.register(resolve(stateDir, 'evidence-graph', 'current.json'), graph);
    ctx.setDomainInstance('evidenceGraphSnapshotRegistered', true);
  }

  // Instrumentation session manager
  let sessionManager = ctx.getDomainInstance<InstrumentationSessionManager>(
    'instrumentationSessionManager',
  );
  if (!sessionManager) {
    sessionManager = new InstrumentationSessionManager();
    ctx.setDomainInstance('instrumentationSessionManager', sessionManager);
  }
  sessionManager.setEvidenceBridge(bridge);

  // Instrumentation handlers
  const hookPresetHandlers = ctx.handlerDeps.hookPresetHandlers as unknown as
    | HookPresetHandlerLike
    | undefined;
  const advancedHandlers = ctx.handlerDeps.advancedHandlers as unknown as
    | NetworkReplayHandlerLike
    | undefined;

  if (!ctx.instrumentationHandlers) {
    ctx.instrumentationHandlers = new InstrumentationHandlers(sessionManager, {
      hookPresetHandlers: hookPresetHandlers!,
      advancedHandlers: advancedHandlers!,
    });
  }
  return ctx.instrumentationHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['aiHookHandlers', 'hookPresetHandlers', 'evidenceHandlers'] as const,
  profiles: ['full'],
  ensure,

  workflowRule: {
    patterns: [
      /(hook|intercept|trace|instrument).*(session|unified|manage|all)/i,
      /(session|统一|会话).*(hook|拦截|追踪|仪器化|instrument)/i,
      /(evidence|provenance|chain).*(graph|query|export|report)/i,
      /(证据|溯源|链).*(图|查询|导出|报告)/i,
    ],
    priority: 95,
    tools: [
      'instrumentation_session',
      'instrumentation_session_export',
      'instrumentation_operation',
      'instrumentation_artifact',
      'instrumentation_hook_preset',
      'instrumentation_network_replay',
      'ai_hook',
      'hook_preset',
      'evidence_query',
      'evidence_export',
      'evidence_chain',
    ],
    hint:
      'Instrumentation session: create session → attach hook presets / network replay → record artifacts → query ' +
      'artifacts → destroy when done. Also: AI hook injection, hook presets, evidence graph query/export/chain.',
  },
  registrations: [
    ...instrumentationRegistrations,
    ...aiHookRegistrations,
    ...hookPresetRegistrations,
    ...evidenceRegistrations,
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
