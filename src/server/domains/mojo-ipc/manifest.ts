import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { mojoIpcTools } from './definitions';
import { MojoIPCHandlers } from './index';

const DOMAIN = 'mojo-ipc' as const;
const DEP_KEY = 'mojoIpcHandlers' as const;

const toolByName = toolLookup(mojoIpcTools);
const bind = (
  invoke: (handlers: MojoIPCHandlers, args: Record<string, unknown>) => Promise<unknown>,
) => bindByDepKey<MojoIPCHandlers>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): MojoIPCHandlers {
  const existingHandlers = ctx.getDomainInstance<MojoIPCHandlers>(DEP_KEY);
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
  registrations: [
    {
      tool: toolByName('mojo_monitor_start'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleMojoMonitorStart(args)),
    },
    {
      tool: toolByName('mojo_monitor_stop'),
      domain: DOMAIN,
      bind: bind((handlers) => handlers.handleMojoMonitorStop()),
    },
    {
      tool: toolByName('mojo_decode_message'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleMojoDecodeMessage(args)),
    },
    {
      tool: toolByName('mojo_list_interfaces'),
      domain: DOMAIN,
      bind: bind((handlers) => handlers.handleMojoListInterfaces()),
    },
    {
      tool: toolByName('mojo_messages_get'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleMojoMessagesGet(args)),
    },
  ],
  ensure,
  workflowRule: {
    patterns: [
      /\b(mojo|ipc|chromium\s?(ipc|message)|interface\s?(broker|registry))\b/i,
      /(mojo|ipc|chromium).*(monitor|capture|hook|trace)/i,
    ],
    priority: 75,
    tools: ['mojo_monitor_start', 'mojo_decode_message', 'mojo_list_interfaces'],
    hint: 'Mojo IPC: start monitor → capture messages → decode payloads → correlate with CDP',
  },
  prerequisites: {
    mojo_monitor_start: [
      {
        condition: 'Frida must be available for real process attachment',
        fix: 'Install Frida and ensure the Chromium target process is launched first',
      },
    ],
    mojo_decode_message: [
      {
        condition: 'Captured message payload hex is required',
        fix: 'Start a monitoring session via mojo_monitor_start and capture traffic first',
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
