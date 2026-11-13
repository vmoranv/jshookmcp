import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { mojoIpcTools } from './definitions';
import type { MojoIPCHandlers } from './handlers.impl';

const DOMAIN = 'mojo-ipc' as const;
const DEP_KEY = 'mojoIpcHandlers' as const;
type H = MojoIPCHandlers;

const toolByName = toolLookup(mojoIpcTools);
const registrations = defineMethodRegistrations<H, (typeof mojoIpcTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: toolByName,
  entries: [
    { tool: 'mojo_ipc_capabilities', method: 'handleMojoIpcCapabilitiesTool' },
    { tool: 'mojo_monitor', method: 'handleMojoMonitorDispatchTool' },
    { tool: 'mojo_decode_message', method: 'handleMojoDecodeMessageTool' },
    { tool: 'mojo_encode_message', method: 'handleMojoEncodeMessageTool' },
    { tool: 'mojo_list_interfaces', method: 'handleMojoListInterfacesTool' },
    { tool: 'mojo_messages_get', method: 'handleMojoMessagesGetTool' },
    { tool: 'mojo_messages_summarize', method: 'handleMojoMessagesSummarizeTool' },
    { tool: 'mojo_verify_live', method: 'handleMojoVerifyLiveTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { MojoIPCHandlers } = await import('./handlers.impl');
  const existingHandlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (existingHandlers) {
    return existingHandlers;
  }

  const handlers = new MojoIPCHandlers(undefined, undefined, ctx.eventBus);
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  mojo_decode_message: ['decode a mojo message', 'parse chrome ipc payload', '解码 mojo 消息'],
  mojo_encode_message: ['build a mojo message', 'encode chrome ipc payload', '编码 mojo 消息'],
  mojo_ipc_capabilities: ['mojo tooling availability', 'what mojo features exist', 'mojo 能力'],
  mojo_list_interfaces: ['list mojo interfaces', 'enumerate ipc interfaces', '列出 mojo 接口'],
  mojo_messages_get: ['captured mojo messages', 'fetch recorded ipc messages', '取 mojo 消息'],
  mojo_messages_summarize: ['mojo traffic summary', 'ipc message overview', 'mojo 消息摘要'],
  mojo_monitor: ['watch chrome internal ipc', 'follow mojo messages live', '监控 mojo'],
  mojo_verify_live: ['is mojo capture working', 'verify live ipc stream', '验证 mojo 活性'],
};

const manifest: DomainManifest<typeof DEP_KEY, MojoIPCHandlers, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  registrations,

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,

  ensure,
  workflowRule: {
    patterns: [
      /\b(mojo|ipc|chromium\s?(ipc|message)|interface\s?(broker|registry))\b/i,
      /(mojo|ipc|chromium).*(monitor|capture|hook|trace)/i,
    ],
    priority: 75,
    tools: ['mojo_monitor', 'mojo_decode_message', 'mojo_encode_message', 'mojo_list_interfaces'],
    hint: 'Mojo IPC: start monitor → capture messages → decode payloads → correlate with CDP',
  },
  prerequisites: {
    mojo_monitor: [
      {
        condition: 'Frida must be available for real process attachment',
        fix: 'Install Frida and ensure the Chromium target process is launched first',
      },
    ],
    mojo_decode_message: [
      {
        condition: 'Captured message payload hex is required',
        fix: 'Start a monitoring session via mojo_monitor and capture traffic first',
      },
    ],
  },
  toolDependencies: [
    {
      from: 'browser',
      to: 'mojo-ipc',
      relation: 'uses',
      weight: 0.8,
    },
  ],
};

export default manifest;
