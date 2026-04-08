import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { syscallHookToolDefinitions } from '@server/domains/syscall-hook/definitions';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers';

const DOMAIN = 'syscall-hook' as const;
const DEP_KEY = 'syscallHookHandlers' as const;

type Handlers = SyscallHookHandlers;

const lookupTool = toolLookup(syscallHookToolDefinitions);
const bindTool = (
  invoke: (handlers: Handlers, args: Record<string, unknown>) => Promise<unknown>,
) => bindByDepKey<Handlers>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): SyscallHookHandlers {
  const existing = ctx.getDomainInstance<SyscallHookHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new SyscallHookHandlers();
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
      tool: lookupTool('syscall_start_monitor'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleSyscallStartMonitor(args)),
    },
    {
      tool: lookupTool('syscall_stop_monitor'),
      domain: DOMAIN,
      bind: bindTool((handlers) => handlers.handleSyscallStopMonitor()),
    },
    {
      tool: lookupTool('syscall_capture_events'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleSyscallCaptureEvents(args)),
    },
    {
      tool: lookupTool('syscall_correlate_js'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleSyscallCorrelateJs(args)),
    },
    {
      tool: lookupTool('syscall_filter'),
      domain: DOMAIN,
      bind: bindTool((handlers, args) => handlers.handleSyscallFilter(args)),
    },
    {
      tool: lookupTool('syscall_get_stats'),
      domain: DOMAIN,
      bind: bindTool((handlers) => handlers.handleSyscallGetStats()),
    },
  ],
  toolDependencies: [
    {
      from: 'memory',
      to: 'syscall-hook',
      relation: 'uses',
      weight: 0.5,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, Handlers, typeof DOMAIN>;

export default manifest;
