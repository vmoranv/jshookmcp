import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { processToolDefinitions } from './definitions.js';

const t = toolLookup(processToolDefinitions);

export const processRegistrations: readonly ToolRegistration[] = [
  { tool: t('electron_attach'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleElectronAttach(a) },
  { tool: t('process_find'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessFind(a) },
  { tool: t('process_list'), domain: 'process', bind: (d) => (_a) => d.processHandlers.handleProcessFind({ pattern: '' }) },
  { tool: t('process_get'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessGet(a) },
  { tool: t('process_windows'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessWindows(a) },
  { tool: t('process_find_chromium'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessFindChromium(a) },
  { tool: t('process_check_debug_port'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessCheckDebugPort(a) },
  { tool: t('process_launch_debug'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessLaunchDebug(a) },
  { tool: t('process_kill'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleProcessKill(a) },
  { tool: t('memory_read'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryRead(a) },
  { tool: t('memory_write'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryWrite(a) },
  { tool: t('memory_scan'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryScan(a) },
  { tool: t('memory_check_protection'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryCheckProtection(a) },
  { tool: t('memory_protect'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryCheckProtection(a) },
  { tool: t('memory_scan_filtered'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryScanFiltered(a) },
  { tool: t('memory_batch_write'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryBatchWrite(a) },
  { tool: t('memory_dump_region'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryDumpRegion(a) },
  { tool: t('memory_list_regions'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleMemoryListRegions(a) },
  { tool: t('inject_dll'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleInjectDll(a) },
  { tool: t('module_inject_dll'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleInjectDll(a) },
  { tool: t('inject_shellcode'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleInjectShellcode(a) },
  { tool: t('module_inject_shellcode'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleInjectShellcode(a) },
  { tool: t('check_debug_port'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleCheckDebugPort(a) },
  { tool: t('enumerate_modules'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleEnumerateModules(a) },
  { tool: t('module_list'), domain: 'process', bind: (d) => (a) => d.processHandlers.handleEnumerateModules(a) },
];
