import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { protocolAnalysisTools } from './definitions';
import { ProtocolAnalysisHandlers } from './handlers';

const DOMAIN = 'protocol-analysis';
const DEP_KEY = 'protocolAnalysisHandlers';
type H = ProtocolAnalysisHandlers;
const t = toolLookup(protocolAnalysisTools);
const b = (invoke: (handlers: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  const existing = ctx.getDomainInstance<H>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new ProtocolAnalysisHandlers();
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    {
      tool: t('proto_define_pattern'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleDefinePattern(args)),
    },
    {
      tool: t('proto_auto_detect'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleAutoDetect(args)),
    },
    {
      tool: t('proto_infer_fields'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleInferFields(args)),
    },
    {
      tool: t('proto_infer_state_machine'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleInferStateMachine(args)),
    },
    {
      tool: t('proto_export_schema'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleExportSchema(args)),
    },
    {
      tool: t('proto_visualize_state'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleVisualizeState(args)),
    },
  ],
  toolDependencies: [
    {
      from: 'network',
      to: 'protocol-analysis',
      relation: 'uses',
      weight: 0.7,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
