import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { mojoIpcTools } from './definitions';
import type { MojoIPCHandlers } from './index';

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
    { tool: 'mojo_list_interfaces', method: 'handleMojoListInterfacesTool' },
    { tool: 'mojo_messages_get', method: 'handleMojoMessagesGetTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { MojoIPCHandlers } = await import('./index');
  const existingHandlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (existingHandlers) {
    return existingHandlers;
  }

  const handlers = new MojoIPCHandlers(undefined, undefined, ctx.eventBus);
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest: DomainManifest<typeof DEP_KEY, MojoIPCHandlers, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  registrations,
  ensure,
  workflowRule: {
    patterns: [
      /\b(mojo|ipc|chromium\s?(ipc|message)|interface\s?(broker|registry))\b/i,
      /(mojo|ipc|chromium).*(monitor|capture|hook|trace)/i,
    ],
    priority: 75,
    tools: ['mojo_monitor', 'mojo_decode_message', 'mojo_list_interfaces'],
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
