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

  const handlers = new MojoIPCHandlers();
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest: DomainManifest<typeof DEP_KEY, MojoIPCHandlers, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
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
