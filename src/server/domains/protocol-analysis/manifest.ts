import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { protocolAnalysisTools } from '@server/domains/protocol-analysis/definitions';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/index';

const DOMAIN = 'protocol-analysis' as const;
const DEP_KEY = 'protocolAnalysisHandlers' as const;
type H = ProtocolAnalysisHandlers;
const t = toolLookup(protocolAnalysisTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!(ctx as unknown as Record<string, unknown>)[DEP_KEY]) {
    (ctx as unknown as Record<string, unknown>)[DEP_KEY] = new ProtocolAnalysisHandlers();
  }
  return (ctx as unknown as Record<string, unknown>)[DEP_KEY] as H;
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
      tool: t('protocol_define_pattern'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDefinePattern(a)),
    },
    {
      tool: t('protocol_auto_detect'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAutoDetect(a)),
    },
    {
      tool: t('protocol_export_schema'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExportSchema(a)),
    },
    {
      tool: t('protocol_infer_state_machine'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleInferStateMachine(a)),
    },
    {
      tool: t('protocol_visualize_state'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleVisualizeState(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
