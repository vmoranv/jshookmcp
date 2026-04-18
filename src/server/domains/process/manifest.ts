import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { processToolDefinitions } from '@server/domains/process/definitions';
import { ProcessToolHandlers } from '@server/domains/process/index';

const DOMAIN = 'process' as const;
const DEP_KEY = 'processHandlers' as const;
type H = ProcessToolHandlers;
const t = toolLookup(processToolDefinitions);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);
const EFFECTIVE_PLATFORM =
  process.env.JSHOOK_REGISTRY_PLATFORM === 'win32' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'linux' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'darwin'
    ? process.env.JSHOOK_REGISTRY_PLATFORM
    : process.platform;

function ensure(ctx: MCPServerContext): H {
  if (!ctx.processHandlers) ctx.processHandlers = new ProcessToolHandlers();
  return ctx.processHandlers;
}

const IS_WIN32 = EFFECTIVE_PLATFORM === 'win32';

// Win32-only tool names — use CreateRemoteThread / NtQueryInformationProcess
const WIN32_ONLY_TOOLS = new Set(['check_debug_port']);

const allRegistrations = [
  { tool: t('electron_attach'), domain: DOMAIN, bind: b((h, a) => h.handleElectronAttach(a)) },
  { tool: t('process_find'), domain: DOMAIN, bind: b((h, a) => h.handleProcessFind(a)) },
  { tool: t('process_get'), domain: DOMAIN, bind: b((h, a) => h.handleProcessGet(a)) },
  { tool: t('process_windows'), domain: DOMAIN, bind: b((h, a) => h.handleProcessWindows(a)) },
  {
    tool: t('process_find_chromium'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleProcessFindChromium(a)),
  },
  {
    tool: t('process_check_debug_port'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleProcessCheckDebugPort(a)),
  },
  {
    tool: t('process_launch_debug'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleProcessLaunchDebug(a)),
  },
  { tool: t('process_kill'), domain: DOMAIN, bind: b((h, a) => h.handleProcessKill(a)) },
  { tool: t('memory_read'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryRead(a)) },
  { tool: t('memory_write'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryWrite(a)) },
  { tool: t('memory_scan'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryScan(a)) },
  {
    tool: t('memory_check_protection'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleMemoryCheckProtection(a)),
  },
  {
    tool: t('memory_scan_filtered'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleMemoryScanFiltered(a)),
  },
  {
    tool: t('memory_batch_write'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleMemoryBatchWrite(a)),
  },
  {
    tool: t('memory_dump_region'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleMemoryDumpRegion(a)),
  },
  {
    tool: t('memory_list_regions'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleMemoryListRegions(a)),
  },
  {
    tool: t('memory_audit_export'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleMemoryAuditExport(a)),
  },
  // ── Win32-only: injection / debug ──
  { tool: t('inject_dll'), domain: DOMAIN, bind: b((h, a) => h.handleInjectDll(a)) },
  { tool: t('inject_shellcode'), domain: DOMAIN, bind: b((h, a) => h.handleInjectShellcode(a)) },
  { tool: t('check_debug_port'), domain: DOMAIN, bind: b((h, a) => h.handleCheckDebugPort(a)) },
  {
    tool: t('enumerate_modules'),
    domain: DOMAIN,
    bind: b((h, a) => h.handleEnumerateModules(a)),
  },
] as const;

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
