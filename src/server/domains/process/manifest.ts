import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { processToolDefinitions } from '@server/domains/process/definitions';
import type { ProcessToolHandlers } from '@server/domains/process/index';

const DOMAIN = 'process' as const;
const DEP_KEY = 'processHandlers' as const;
type H = ProcessToolHandlers;
const t = toolLookup(processToolDefinitions);
const EFFECTIVE_PLATFORM =
  process.env.JSHOOK_REGISTRY_PLATFORM === 'win32' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'linux' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'darwin'
    ? process.env.JSHOOK_REGISTRY_PLATFORM
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

const registrations = IS_WIN32
  ? allRegistrations
  : allRegistrations.filter((r) => !WIN32_ONLY_TOOLS.has(r.tool.name));

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,
};

export default manifest;
