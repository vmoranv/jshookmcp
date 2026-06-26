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

// Win32-only tool names — use CreateRemoteThread / NtQueryInformationProcess / CreateToolhelp32Snapshot
const WIN32_ONLY_TOOLS = new Set([
  'check_debug_port',
  'process_enum_threads',
  'process_detect_hollowing',
  'process_enum_handles',
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
    { tool: 'process_find', method: 'handleProcessFind' },
    { tool: 'process_list', method: 'handleProcessFind' },
    { tool: 'process_get', method: 'handleProcessGet' },
    { tool: 'process_kill', method: 'handleProcessKill' },
    { tool: 'process_windows', method: 'handleProcessWindows' },
    { tool: 'process_check_debug_port', method: 'handleProcessCheckDebugPort' },
    { tool: 'process_launch_debug', method: 'handleProcessLaunchDebug' },
    { tool: 'electron_attach', method: 'handleElectronAttach' },
    // Memory operations
    { tool: 'memory_read', method: 'handleMemoryRead' },
    { tool: 'memory_write', method: 'handleMemoryWrite' },
    { tool: 'memory_scan', method: 'handleMemoryScan' },
    { tool: 'memory_check_protection', method: 'handleMemoryCheckProtection' },
    { tool: 'memory_scan_filtered', method: 'handleMemoryScanFiltered' },
    { tool: 'memory_batch_write', method: 'handleMemoryBatchWrite' },
    { tool: 'memory_dump_region', method: 'handleMemoryDumpRegion' },
    { tool: 'memory_list_regions', method: 'handleMemoryListRegions' },
    { tool: 'memory_audit_export', method: 'handleMemoryAuditExport' },
    // Injection (Win32-only)
    { tool: 'inject_dll', method: 'handleInjectDll' },
    { tool: 'inject_shellcode', method: 'handleInjectShellcode' },
    { tool: 'check_debug_port', method: 'handleCheckDebugPort' },
    { tool: 'enumerate_modules', method: 'handleEnumerateModules' },
    { tool: 'process_enum_threads', method: 'handleProcessEnumThreads' },
    { tool: 'process_detect_hollowing', method: 'handleDetectHollowing' },
    { tool: 'process_enum_handles', method: 'handleProcessEnumHandles' },
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
