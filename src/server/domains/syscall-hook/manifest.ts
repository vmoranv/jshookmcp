import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { syscallHookToolDefinitions } from '@server/domains/syscall-hook/definitions';
import type { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers';
import { readEnvString } from '@src/config/environment';

const DOMAIN = 'syscall-hook' as const;
const DEP_KEY = 'syscallHookHandlers' as const;

type Handlers = SyscallHookHandlers;

const configuredPlatform = readEnvString('JSHOOK_REGISTRY_PLATFORM', '', { trim: true });
const EFFECTIVE_PLATFORM =
  configuredPlatform === 'win32' ||
  configuredPlatform === 'linux' ||
  configuredPlatform === 'darwin'
    ? configuredPlatform
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
    { tool: 'syscall_start_monitor', method: 'handleSyscallStartMonitorTool' },
    { tool: 'syscall_stop_monitor', method: 'handleSyscallStopMonitorTool' },
    { tool: 'syscall_capture_events', method: 'handleSyscallCaptureEventsTool' },
    { tool: 'syscall_correlate_js', method: 'handleSyscallCorrelateJsTool' },
    { tool: 'syscall_filter', method: 'handleSyscallFilterTool' },
    { tool: 'syscall_get_stats', method: 'handleSyscallGetStatsTool' },
    { tool: 'syscall_ebpf_trace', method: 'handleSyscallEbpfTraceTool' },
    { tool: 'syscall_resolve_ssn', method: 'handleSyscallResolveSsnTool' },
    { tool: 'syscall_direct_invoke', method: 'handleSyscallDirectInvokeTool' },
    { tool: 'syscall_stack_capture', method: 'handleSyscallStackCaptureTool' },
    { tool: 'syscall_trace_compare', method: 'handleSyscallTraceCompareTool' },
    { tool: 'syscall_trace_export', method: 'handleSyscallTraceExportTool' },
    { tool: 'syscall_ebpf_attach', method: 'handleSyscallEbpfAttachTool' },
    { tool: 'syscall_origin_map', method: 'handleSyscallOriginMapTool' },
    { tool: 'syscall_pattern_detect', method: 'handleSyscallPatternDetectTool' },
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

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  syscall_capture_events: [
    'collect syscall events',
    'fetch captured syscalls',
    'capture the system calls',
  ],
  syscall_correlate_js: [
    'link syscalls to js callsites',
    'correlate kernel calls with script',
    'correlate with the javascript call sites',
  ],
  syscall_direct_invoke: ['invoke a syscall directly', 'raw syscall call', 'direct syscall'],
  syscall_ebpf_attach: ['attach an ebpf program', 'load bpf tracer', 'attach the ebpf probe'],
  syscall_ebpf_trace: ['read the ebpf trace', 'collect bpf events', 'read the ebpf trace'],
  syscall_filter: ['filter syscall stream', 'narrow captured syscalls', 'filter the system calls'],
  syscall_get_stats: [
    'syscall counter summary',
    'how many syscalls captured',
    'syscall statistics',
  ],
  syscall_origin_map: [
    'map syscalls to their origin',
    'where did the syscall come from',
    'syscall origin',
  ],
  syscall_pattern_detect: [
    'spot syscall patterns',
    'detect suspicious syscall sequences',
    'syscall pattern',
  ],
  syscall_resolve_ssn: [
    'resolve syscall numbers',
    'find the ssn table entries',
    'decode the syscall numbers',
  ],
  syscall_stack_capture: [
    'capture stack at syscall',
    'stack trace per syscall',
    'capture the syscall stack',
  ],
  syscall_start_monitor: [
    'start tracing syscalls',
    'begin syscall monitoring',
    'start monitoring the system calls',
  ],
  syscall_stop_monitor: [
    'stop the syscall tracer',
    'end syscall capture',
    'stop monitoring the system calls',
  ],
  syscall_trace_compare: [
    'compare two syscall traces',
    'trace session delta',
    'compare the syscall traces',
  ],
  syscall_trace_export: [
    'save syscall trace',
    'export captured syscalls',
    'export the syscall trace',
  ],
};

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

  // Document-expansion keywords (search sceneKeywords).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, Handlers, typeof DOMAIN>;

export default manifest;
