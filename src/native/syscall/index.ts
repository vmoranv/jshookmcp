export {
  ntOpenProcess,
  ntReadVirtualMemory,
  ntWriteVirtualMemory,
  ntAllocateVirtualMemory,
  ntProtectVirtualMemory,
  ntFreeVirtualMemory,
  ntSuspendProcess,
  ntResumeProcess,
  ntSuccess,
} from './DirectNtApi';
export { resolveNtdll, resetNtdllCache } from './SyscallResolver';
export type { SyscallEntry, ResolvedNtdll } from './SyscallResolver';
export { createScanWalker, DEFAULT_OBFUSCATION_CONFIG } from './ScanObfuscator';
export type { ScanObfuscationConfig, ScanWalker } from './ScanObfuscator';
export { buildSyscallStub, freeAllStubs } from './SyscallStubBuilder';
export type { SyscallStub } from './SyscallStubBuilder';
export {
  ntCreateThreadEx,
  ntAllocateVirtualMemory as ntAllocVM,
  ntProtectVirtualMemory as ntProtectVM,
  ntClose,
  ntCreateThreadExSafe,
} from './NtInjection';
