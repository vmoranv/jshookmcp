import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { instrumentationTools } from '@server/domains/instrumentation/definitions';
import { InstrumentationHandlers } from '@server/domains/instrumentation/handlers';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { EvidenceGraphBridge } from '@server/instrumentation/EvidenceGraphBridge';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { ToolResponse } from '@server/types';

const DOMAIN = 'instrumentation' as const;
const DEP_KEY = 'instrumentationHandlers' as const;
type H = InstrumentationHandlers;
const t = toolLookup(instrumentationTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

interface HookPresetHandlerLike {
  handleHookPreset(args: Record<string, unknown>): Promise<ToolResponse>;
}

interface NetworkReplayHandlerLike {
  handleNetworkReplayRequest(args: Record<string, unknown>): Promise<ToolResponse>;
}

function ensure(ctx: MCPServerContext): H {
  const hookPresetHandlers = ctx.handlerDeps.hookPresetHandlers as unknown as
    | HookPresetHandlerLike
    | undefined;
  const advancedHandlers = ctx.handlerDeps.advancedHandlers as unknown as
    | NetworkReplayHandlerLike
    | undefined;

  let graph = ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
  if (!graph) {
    graph = new ReverseEvidenceGraph();
    ctx.setDomainInstance('evidenceGraph', graph);
  }

  let sessionManager = ctx.getDomainInstance<InstrumentationSessionManager>(
    'instrumentationSessionManager',
  );
  if (!sessionManager) {
    sessionManager = new InstrumentationSessionManager();
    ctx.setDomainInstance('instrumentationSessionManager', sessionManager);
  }

  let bridge = ctx.getDomainInstance<EvidenceGraphBridge>('evidenceGraphBridge');
  if (!bridge) {
    bridge = new EvidenceGraphBridge(graph);
    ctx.setDomainInstance('evidenceGraphBridge', bridge);
  }

  sessionManager.setEvidenceBridge(bridge);

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
  profiles: ['full'],
  ensure,

  workflowRule: {
    patterns: [
      /(hook|intercept|trace|instrument).*(session|unified|manage|all)/i,
      /(session|统一|会话).*(hook|拦截|追踪|仪器化|instrument)/i,
    ],
    priority: 95,
    tools: [
      'instrumentation_session',
      'instrumentation_operation',
      'instrumentation_artifact',
      'instrumentation_hook_preset',
      'instrumentation_network_replay',
    ],
    hint: 'Instrumentation session: create session → attach hook presets / network replay → record artifacts → query artifacts → destroy when done',
  },

  registrations: [
    {
      tool: t('instrumentation_session'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSessionDispatch(a)),
    },
    {
      tool: t('instrumentation_operation'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleOperationDispatch(a)),
    },
    {
      tool: t('instrumentation_artifact'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleArtifactDispatch(a)),
    },
    {
      tool: t('instrumentation_hook_preset'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleHookPreset(a)),
    },
    {
      tool: t('instrumentation_network_replay'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkReplay(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
