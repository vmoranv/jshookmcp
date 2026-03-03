import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { processToolDefinitions } from './definitions.js';
import { ProcessToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';

const DOMAIN = 'process' as const;
const DEP_KEY = 'processHandlers' as const;
type H = ProcessToolHandlers;
const t = toolLookup(processToolDefinitions);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.processHandlers) ctx.processHandlers = new ProcessToolHandlers();
  return ctx.processHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('electron_attach'), domain: DOMAIN, bind: b((h, a) => h.handleElectronAttach(a)) },
    { tool: t('process_find'), domain: DOMAIN, bind: b((h, a) => h.handleProcessFind(a)) },
    { tool: t('process_list'), domain: DOMAIN, bind: b((h, _a) => h.handleProcessFind({ pattern: '' })) },
    { tool: t('process_get'), domain: DOMAIN, bind: b((h, a) => h.handleProcessGet(a)) },
    { tool: t('process_windows'), domain: DOMAIN, bind: b((h, a) => h.handleProcessWindows(a)) },
    { tool: t('process_find_chromium'), domain: DOMAIN, bind: b((h, a) => h.handleProcessFindChromium(a)) },
    { tool: t('process_check_debug_port'), domain: DOMAIN, bind: b((h, a) => h.handleProcessCheckDebugPort(a)) },
    { tool: t('process_launch_debug'), domain: DOMAIN, bind: b((h, a) => h.handleProcessLaunchDebug(a)) },
    { tool: t('process_kill'), domain: DOMAIN, bind: b((h, a) => h.handleProcessKill(a)) },
    { tool: t('memory_read'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryRead(a)) },
    { tool: t('memory_write'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryWrite(a)) },
    { tool: t('memory_scan'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryScan(a)) },
    { tool: t('memory_check_protection'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryCheckProtection(a)) },
    { tool: t('memory_protect'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryCheckProtection(a)) },
    { tool: t('memory_scan_filtered'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryScanFiltered(a)) },
    { tool: t('memory_batch_write'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryBatchWrite(a)) },
    { tool: t('memory_dump_region'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryDumpRegion(a)) },
    { tool: t('memory_list_regions'), domain: DOMAIN, bind: b((h, a) => h.handleMemoryListRegions(a)) },
    { tool: t('inject_dll'), domain: DOMAIN, bind: b((h, a) => h.handleInjectDll(a)) },
    { tool: t('module_inject_dll'), domain: DOMAIN, bind: b((h, a) => h.handleInjectDll(a)) },
    { tool: t('inject_shellcode'), domain: DOMAIN, bind: b((h, a) => h.handleInjectShellcode(a)) },
    { tool: t('module_inject_shellcode'), domain: DOMAIN, bind: b((h, a) => h.handleInjectShellcode(a)) },
    { tool: t('check_debug_port'), domain: DOMAIN, bind: b((h, a) => h.handleCheckDebugPort(a)) },
    { tool: t('enumerate_modules'), domain: DOMAIN, bind: b((h, a) => h.handleEnumerateModules(a)) },
    { tool: t('module_list'), domain: DOMAIN, bind: b((h, a) => h.handleEnumerateModules(a)) },
  ],
};

export default manifest;
