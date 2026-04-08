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
  prerequisites: {
    proto_auto_detect: [
      {
        condition: 'At least one hex payload sample is required',
        fix: 'Capture traffic using network monitoring tools first',
      },
    ],
    proto_infer_state_machine: [
      {
        condition: 'Multiple message samples are required for state machine inference',
        fix: 'Capture message sequences with mojo-ipc or network tools',
      },
    ],
  },
  workflowRule: {
    patterns: [
      /protocol\s+(reverse|analysis|pattern|state\s*machine|schema)/i,
      /custom\s+protocol|binary\s+protocol|wire\s+format/i,
      /infer\s+(protocol|fields|state\s*machine)/i,
      /proto.*export|proto.*schema|proto.*diagram/i,
    ],
    priority: 0.6,
    tools: [
      'proto_auto_detect',
      'proto_infer_fields',
      'proto_define_pattern',
      'proto_infer_state_machine',
      'proto_export_schema',
      'proto_visualize_state',
    ],
    hint: 'Capture hex payloads -> auto-detect pattern -> infer fields/state machine -> export schema',
  },
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
