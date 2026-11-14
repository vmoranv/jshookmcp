import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { processToolDefinitions } from '@server/domains/process/definitions';
import type { ProcessToolHandlers } from '@server/domains/process/index';
import { readEnvString } from '@src/config/environment';

const DOMAIN = 'process' as const;
const DEP_KEY = 'processHandlers' as const;
type H = ProcessToolHandlers;
const t = toolLookup(processToolDefinitions);
const configuredPlatform = readEnvString('JSHOOK_REGISTRY_PLATFORM', '', { trim: true });
const EFFECTIVE_PLATFORM =
  configuredPlatform === 'win32' ||
  configuredPlatform === 'linux' ||
  configuredPlatform === 'darwin'
    ? configuredPlatform
    : process.platform;

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { ProcessToolHandlers } = await import('@server/domains/process/index');

  if (!ctx.processHandlers) ctx.processHandlers = new ProcessToolHandlers(ctx);
  return ctx.processHandlers;
}

const IS_WIN32 = EFFECTIVE_PLATFORM === 'win32';

// Win32-only tool names — use CreateRemoteThread / NtQueryInformationProcess / CreateToolhelp32Snapshot.
// `process_enum_threads` is cross-platform (Win32 Toolhelp32Snapshot fast path; Linux /proc/{pid}/task;
// macOS `ps -M`) via ThreadEnumerator — see injection-handlers.ts::handleProcessEnumThreads.
// `process_detect_hollowing` is cross-platform (Win32 PE compareMemoryWithDisk; Linux/macOS
// IntegrityScanner ELF/Mach-O section hash fallback) — see hollowing-detection.ts.
const WIN32_ONLY_TOOLS = new Set([
  'check_debug_port',
  'process_enum_handles',
  'process_detect_apc',
]);

// NOTE: `process_runtime_info` reads procfs, which only exists on Linux. It is
// deliberately NOT filtered by platform: the tool catalog must be identical on
// every host (metadata / openapi are generated from a single sample), and the
// handler already answers with a clear "use process_get" message elsewhere.
const LINUX_ONLY_TOOLS = new Set<string>();

const allRegistrations = defineMethodRegistrations<
  H,
  (typeof processToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    // Core process management
    { tool: 'process_find', method: 'handleProcessFindTool' },
    { tool: 'process_list', method: 'handleProcessFindTool' },
    { tool: 'process_get', method: 'handleProcessGetTool' },
    { tool: 'process_runtime_info', method: 'handleProcessRuntimeInfoTool' },
    { tool: 'process_kill', method: 'handleProcessKillTool' },
    { tool: 'process_windows', method: 'handleProcessWindowsTool' },
    { tool: 'process_check_debug_port', method: 'handleProcessCheckDebugPortTool' },
    { tool: 'process_launch_debug', method: 'handleProcessLaunchDebugTool' },
    { tool: 'electron_attach', method: 'handleElectronAttachTool' },
    // Memory operations
    { tool: 'memory_read', method: 'handleMemoryReadTool' },
    { tool: 'memory_write', method: 'handleMemoryWriteTool' },
    { tool: 'memory_scan', method: 'handleMemoryScanTool' },
    { tool: 'memory_check_protection', method: 'handleMemoryCheckProtectionTool' },
    { tool: 'memory_scan_filtered', method: 'handleMemoryScanFilteredTool' },
    { tool: 'memory_batch_write', method: 'handleMemoryBatchWriteTool' },
    { tool: 'memory_dump_region', method: 'handleMemoryDumpRegionTool' },
    { tool: 'memory_list_regions', method: 'handleMemoryListRegionsTool' },
    { tool: 'memory_audit_export', method: 'handleMemoryAuditExportTool' },
    // Injection (Win32-only)
    { tool: 'inject_dll', method: 'handleInjectDllTool' },
    { tool: 'inject_shellcode', method: 'handleInjectShellcodeTool' },
    { tool: 'check_debug_port', method: 'handleCheckDebugPortTool' },
    { tool: 'enumerate_modules', method: 'handleEnumerateModulesTool' },
    { tool: 'process_enum_threads', method: 'handleProcessEnumThreadsTool' },
    { tool: 'process_detect_hollowing', method: 'handleDetectHollowingTool' },
    { tool: 'process_hollowing_scan', method: 'handleHollowingScanTool' },
    { tool: 'process_enum_handles', method: 'handleProcessEnumHandlesTool' },
    { tool: 'process_detect_apc', method: 'handleProcessDetectApcTool' },
    // Cross-platform process suspend/resume (Win32 NtSuspendProcess / Linux SIGSTOP / macOS task_suspend)
    { tool: 'process_suspend', method: 'handleProcessSuspendTool' },
    { tool: 'process_resume', method: 'handleProcessResumeTool' },
  ],
});

const IS_LINUX = EFFECTIVE_PLATFORM === 'linux';

const registrations = allRegistrations.filter((r) => {
  if (IS_WIN32) return !LINUX_ONLY_TOOLS.has(r.tool.name);
  if (IS_LINUX) return !WIN32_ONLY_TOOLS.has(r.tool.name);
  // macOS: no Win32 APIs, no procfs.
  return !WIN32_ONLY_TOOLS.has(r.tool.name) && !LINUX_ONLY_TOOLS.has(r.tool.name);
});

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  check_debug_port: [
    'is a debugger attached to pid',
    'check the debug port of process',
    'check the debug port of the process',
  ],
  electron_attach: [
    'hook into the electron app',
    'attach debugging to electron',
    'take over the electron app',
  ],
  enumerate_modules: [
    'list loaded dlls of a process',
    'enumerate module list',
    'enumerate the loaded modules',
  ],
  inject_dll: [
    'load my dll into the target',
    'dll injection into process',
    'inject a dll into the process',
  ],
  inject_shellcode: [
    'run shellcode in the target',
    'code injection into process',
    'inject shellcode into the process',
  ],
  memory_audit_export: ['export the write audit trail', 'dump audit log', 'export the audit trail'],
  memory_batch_write: [
    'write many values at once',
    'batch memory writes',
    'write many memory values at once',
  ],
  memory_check_protection: [
    'page protection of this address',
    'memory guard bits',
    'check the memory protection of an address',
  ],
  memory_dump_region: ['dump a memory range', 'save region bytes', 'dump a memory region'],
  memory_list_regions: [
    'list address ranges of process',
    'enumerate memory regions',
    'list the memory regions',
  ],
  memory_read: ['read bytes from process memory', 'read memory at address', 'read process memory'],
  memory_scan: [
    'search memory for a value',
    'scan process for pattern',
    'hunt for a number in memory',
    'locate a value inside the target',
    'find a value inside the target',
    'search the process memory for a pattern',
  ],
  memory_scan_filtered: [
    'narrow the previous scan',
    'filter scan results',
    'filter the memory scan results',
  ],
  memory_write: [
    'write bytes into process memory',
    'patch memory value',
    'overwrite the value at an address',
    'set a new value at that address',
    'overwrite the value at that address',
    'write into the process memory',
  ],
  process_check_debug_port: [
    'debug port of another process',
    'is process being debugged',
    'check the debug port of a process',
  ],
  process_detect_apc: [
    'detect apc injection tricks',
    'apc queue abuse scan',
    'detect apc injection',
  ],
  process_detect_hollowing: [
    'is the process hollowed',
    'detect process hollowing',
    'detect process hollowing',
  ],
  process_enum_handles: [
    'list open handles of process',
    'enumerate handle table',
    'enumerate the open handles',
  ],
  process_enum_threads: [
    'list threads of a process',
    'enumerate thread ids',
    'enumerate the threads',
  ],
  process_find: ['find the pid of a program', 'look up process by name', 'find the process'],
  process_get: ['details of one process', 'process info by pid', 'process details'],
  process_hollowing_scan: [
    'scan for hollowed processes',
    'system wide hollowing check',
    'system wide hollowing scan',
  ],
  process_kill: ['kill this process', 'terminate the pid', 'kill the process'],
  process_launch_debug: [
    'start a program under debugging',
    'launch with debug port',
    'launch the process under the debugger',
  ],
  process_list: [
    'show all running processes',
    'enumerate the process table',
    'list the running processes',
  ],
  process_resume: ['resume the suspended process', 'unfreeze process', 'resume the process'],
  process_runtime_info: [
    'runtime facts about the process',
    'process internals readout',
    'runtime information about the process',
  ],
  process_suspend: ['freeze this process', 'suspend the pid', 'suspend the process'],
  process_windows: [
    'list the windows of a process',
    'enumerate window titles',
    'enumerate the windows',
  ],
};

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
};

export default manifest;
