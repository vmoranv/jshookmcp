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

  const handlers = new SyscallHookHandlers(undefined, undefined, ctx.eventBus);
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
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
  workflowRule: {
    patterns: [
      /\b(syscall|etw|strace|dtrace|kernel|system\s?call)\b/i,
      /(syscall|kernel).*(trace|monitor|capture|filter)/i,
    ],
    priority: 78,
    tools: ['syscall_start_monitor', 'syscall_capture_events', 'syscall_correlate_js'],
    hint: 'Syscall tracing: start monitor (ETW/strace/dtrace) → capture events → correlate with JS stacks.',
  },
  prerequisites: {
    syscall_start_monitor: [
      {
        condition:
          'Administrator/root privileges required for ETW and dtrace; Linux strace needs ptrace_scope=0',
        fix: 'Run the MCP server with elevated privileges, or relax kernel restrictions on Linux',
      },
    ],
    syscall_correlate_js: [
      {
        condition: 'A debugger or v8-inspector session must expose JS stacks',
        fix: 'Attach the debugger or v8-inspector domain before correlating',
      },
    ],
  },
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
