import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { syscallHookToolDefinitions } from '@server/domains/syscall-hook/definitions';
import type { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers';

const DOMAIN = 'syscall-hook' as const;
const DEP_KEY = 'syscallHookHandlers' as const;

type Handlers = SyscallHookHandlers;

const EFFECTIVE_PLATFORM =
  process.env.JSHOOK_REGISTRY_PLATFORM === 'win32' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'linux' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'darwin'
    ? process.env.JSHOOK_REGISTRY_PLATFORM
    : process.platform;

const IS_WIN32 = EFFECTIVE_PLATFORM === 'win32';

const lookupTool = toolLookup(syscallHookToolDefinitions);
const registrations = defineMethodRegistrations<
  Handlers,
  (typeof syscallHookToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: lookupTool,
  entries: [
    { tool: 'syscall_start_monitor', method: 'handleSyscallStartMonitor' },
    { tool: 'syscall_stop_monitor', method: 'handleSyscallStopMonitor' },
    { tool: 'syscall_capture_events', method: 'handleSyscallCaptureEvents' },
    { tool: 'syscall_correlate_js', method: 'handleSyscallCorrelateJs' },
    { tool: 'syscall_filter', method: 'handleSyscallFilter' },
    { tool: 'syscall_get_stats', method: 'handleSyscallGetStats' },
    { tool: 'syscall_ebpf_trace', method: 'handleSyscallEbpfTrace' },
    { tool: 'syscall_resolve_ssn', method: 'handleSyscallResolveSsn' },
    { tool: 'syscall_direct_invoke', method: 'handleSyscallDirectInvoke' },
    { tool: 'syscall_stack_capture', method: 'handleSyscallStackCapture' },
    { tool: 'syscall_trace_compare', method: 'handleSyscallTraceCompare' },
    { tool: 'syscall_trace_export', method: 'handleSyscallTraceExport' },
    { tool: 'syscall_ebpf_attach', method: 'handleSyscallEbpfAttach' },
  ],
});

// Win32-only: direct NT API tools require koffi/ntdll.
const WIN32_ONLY_SYSCALL_TOOLS = new Set(['syscall_resolve_ssn', 'syscall_direct_invoke']);

const activeRegistrations = IS_WIN32
  ? registrations
  : registrations.filter((r) => !WIN32_ONLY_SYSCALL_TOOLS.has(r.tool.name));

async function ensure(ctx: MCPServerContext): Promise<SyscallHookHandlers> {
  const { SyscallHookHandlers } = await import('@server/domains/syscall-hook/handlers');
  const existing = ctx.getDomainInstance<SyscallHookHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new SyscallHookHandlers(undefined, undefined, ctx.eventBus, undefined, ctx);
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
  registrations: activeRegistrations,
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
