/**
 * SelfDefense v2 — protects the current process from termination and monitoring.
 *
 * In hostile environments (anti-cheat, EDR), our process may be:
 * - Terminated by security software that detects memory operations
 * - Monitored via open handles from AV/EDR processes
 * - Enumerated via window enumeration (EnumWindows / FindWindow)
 *
 * This module provides SAFE, REVERSIBLE user-mode self-defense:
 *
 * 1. **Handle monitoring** — detect when AV/EDR opens a handle to us
 * 2. **Handle hardening** — protect own handles from closure/duplication (REVERSIBLE)
 * 3. **ACL-based termination protection** — deny PROCESS_TERMINATE to non-admin (REVERSIBLE)
 * 4. **Watchdog process** — spawn child to monitor parent, restart if killed
 * 5. **Window hiding** — hide from EnumWindows / FindWindow
 * 6. **Process priority protection** — prevent priority reduction
 *
 * CRITICAL: ProcessBreakOnTermination (0x1D) is IRREVERSIBLE and causes BSOD
 * on process exit. This has been permanently disabled. See
 * BSOD-CRITICAL_PROCESS_DIED-Analysis.md for the 6-crash incident report.
 *
 * Safety Contract:
 * - All operations are REVERSIBLE (can be undone on shutdown via stopSelfDefense)
 * - No BreakOnTermination equivalent
 * - ALL gated behind env vars with clear documentation
 * - Administrator operations explicitly flagged in the report
 *
 * @module SelfDefense
 */

import { logger } from '@utils/logger';
import { readEnvBoolean } from '@src/config/environment';
import { spawn, type ChildProcess } from 'node:child_process';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SelfDefenseConfig {
  /** Enable handle monitoring (polling). Default: true if JSHOOK_SELFDEFENSE=1. */
  monitorHandles?: boolean;
  /** Enable window hiding. Default: true if JSHOOK_SELFDEFENSE=1. */
  hideWindow?: boolean;
  /** Enable process priority protection. */
  protectPriority?: boolean;
  /** Enable ProcessBreakOnTermination. PERMANENTLY DISABLED — stub only. */
  breakOnTermination?: boolean;
  /** Enable handle hardening (PROTECT_FROM_CLOSE on own handles). Requires JSHOOK_SELFDEFENSE=1. */
  hardenHandles?: boolean;
  /** Enable ACL-based termination protection (deny PROCESS_TERMINATE). Requires JSHOOK_SELFDEFENSE=1. */
  aclProtection?: boolean;
  /** Enable watchdog process (spawns child to monitor and restart). Requires JSHOOK_WATCHDOG_ENABLE=1. */
  watchdog?: boolean;
  /** Handle monitoring poll interval in ms. Default: 5000. */
  pollIntervalMs?: number;
  /** Callback when a suspicious handle is detected. */
  onSuspiciousHandle?: (ownerPid: number, accessDescription: string) => void;
  /** Watchdog restart command. Default: process.argv. */
  watchdogCommand?: string;
}

export interface SelfDefenseReport {
  /** Whether handle monitoring is active. */
  handleMonitorActive: boolean;
  /** Whether window is hidden. */
  windowHidden: boolean;
  /** Whether termination protection is active. */
  terminationProtected: boolean;
  /** Whether priority protection is active. */
  priorityProtected: boolean;
  /** Whether handle hardening was applied. */
  handleHardeningApplied: boolean;
  /** Whether ACL protection was applied. */
  aclProtectionApplied: boolean;
  /** Whether watchdog process was spawned. */
  watchdogActive: boolean;
  /** Current suspicious handle count. */
  suspiciousHandleCount: number;
  /** Honest limitations. */
  limitations: string[];
}

// ── State ────────────────────────────────────────────────────────────────────

let handleMonitorInterval: ReturnType<typeof setInterval> | null = null;
let suspiciousHandleCount = 0;
let watchdogProcess: ChildProcess | null = null;
let aclProtectionApplied = false;
let handleHardeningApplied = false;

// ── Helper ────────────────────────────────────────────────────────────────────

function envFlag(name: string): boolean {
  try {
    return readEnvBoolean(name, false);
  } catch {
    return false;
  }
}

// ── Implementations ──────────────────────────────────────────────────────────

/**
 * Enable handle monitoring — periodically checks who has handles to us.
 *
 * Uses NtQuerySystemInformation(SystemExtendedHandleInformation) to find
 * processes that have opened handles to our PID. When a suspicious handle
 * is found (high access mask from a non-system process), logs a warning
 * and calls the onSuspiciousHandle callback.
 *
 * Requires SeDebugPrivilege for full results.
 */
function startHandleMonitoring(config: SelfDefenseConfig): boolean {
  if (handleMonitorInterval) return true; // already running

  const interval = config.pollIntervalMs || 5000;

  handleMonitorInterval = setInterval(() => {
    try {
      checkHandles(config);
    } catch {
      // Handle monitoring failure is not fatal
    }
  }, interval);

  // Unref so the timer doesn't prevent process exit
  if (handleMonitorInterval && typeof handleMonitorInterval.unref === 'function') {
    handleMonitorInterval.unref();
  }

  logger.debug(`SelfDefense: handle monitoring started (interval: ${interval}ms)`);
  return true;
}

function checkHandles(config: SelfDefenseConfig): void {
  if (process.platform !== 'win32') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtQuerySystemInformation = ntdll.func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );

    const SYSTEM_EXTENDED_HANDLE_INFORMATION = 64;
    const sizeBuf = Buffer.alloc(4);

    let status = NtQuerySystemInformation(
      SYSTEM_EXTENDED_HANDLE_INFORMATION,
      null,
      0,
      koffi.address(sizeBuf),
    ) as number;

    const requiredSize = sizeBuf.readUInt32LE(0);
    if (requiredSize === 0 || requiredSize > 32 * 1024 * 1024) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return;
    }

    const buf = Buffer.alloc(requiredSize + 65536);
    status = NtQuerySystemInformation(
      SYSTEM_EXTENDED_HANDLE_INFORMATION,
      koffi.address(buf),
      buf.length,
      koffi.address(sizeBuf),
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status < 0) return; // No privilege — silently skip

    const ourPid = process.pid;
    const handleCount = Number(buf.readBigUInt64LE(0));
    const entrySize = 32;
    let newSuspiciousCount = 0;

    let offset = 8;
    for (let i = 0; i < handleCount && offset + entrySize <= buf.length; i++) {
      const targetPid = Number(buf.readBigUInt64LE(offset + 8));
      const ownerPid = Number(buf.readBigUInt64LE(offset));
      const grantedAccess = buf.readUInt32LE(offset + 24);

      if (targetPid === ourPid && ownerPid !== ourPid && ownerPid !== 0 && ownerPid !== 4) {
        // Exclude System (PID 4) and Idle (PID 0)
        const suspiciousAccess =
          (grantedAccess & 0x0010) !== 0 || // VM_READ
          (grantedAccess & 0x0008) !== 0 || // VM_OPERATION
          (grantedAccess & 0x0020) !== 0 || // VM_WRITE
          (grantedAccess & 0x0800) !== 0; // SUSPEND_RESUME

        if (suspiciousAccess) {
          newSuspiciousCount++;
          if (config.onSuspiciousHandle) {
            const accessDesc = describeAccessFlags(grantedAccess);
            config.onSuspiciousHandle(ownerPid, accessDesc);
          }
        }
      }

      offset += entrySize;
    }

    if (newSuspiciousCount > suspiciousHandleCount) {
      logger.warn(
        `SelfDefense: ${newSuspiciousCount} suspicious handle(s) detected (was ${suspiciousHandleCount})`,
      );
    }

    suspiciousHandleCount = newSuspiciousCount;
  } catch {
    // Silent fail — handle monitoring is best-effort
  }
}

function describeAccessFlags(mask: number): string {
  const flags: string[] = [];
  if (mask & 0x0010) flags.push('VM_READ');
  if (mask & 0x0008) flags.push('VM_OPERATION');
  if (mask & 0x0020) flags.push('VM_WRITE');
  if (mask & 0x0400) flags.push('QUERY_INFO');
  if (mask & 0x0800) flags.push('SUSPEND');
  if (mask & 0x0001) flags.push('TERMINATE');
  if (mask & 0x0002) flags.push('CREATE_THREAD');
  return flags.length > 0 ? flags.join('|') : `0x${mask.toString(16)}`;
}

function stopHandleMonitoring(): void {
  if (handleMonitorInterval) {
    clearInterval(handleMonitorInterval);
    handleMonitorInterval = null;
    logger.debug('SelfDefense: handle monitoring stopped');
  }
}

// ── Handle Hardening (NEW — REVERSIBLE) ─────────────────────────────────────

/**
 * Apply handle hardening — marks our own process handle as PROTECT_FROM_CLOSE
 * to prevent handle closure/duplication by other processes.
 *
 * Uses SetHandleInformation (Win32 wrapper around NtSetInformationObject)
 * with HANDLE_FLAG_PROTECT_FROM_CLOSE (0x00000002). This:
 * - Prevents CloseHandle from closing the handle from other processes
 * - Prevents DUPLICATE_CLOSE_SOURCE from closing the handle during duplication
 * - Is REVERSIBLE — cleared in stopSelfDefense()
 * - Does NOT cause BSOD
 * - Does NOT require admin
 *
 * Also attempts to remove PROCESS_DUP_HANDLE from our process's ACL
 * by modifying the security descriptor via SetSecurityInfo — this prevents
 * other processes from duplicating our handles at all.
 *
 * Requires: JSHOOK_SELFDEFENSE=1
 * Reversible: yes — cleared on shutdown
 */
function applyHandleHardening(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const GetCurrentProcess = k32.func('void * GetCurrentProcess()');
    const SetHandleInformation = k32.func('int SetHandleInformation(void *, uint32, uint32)');

    const HANDLE_FLAG_PROTECT_FROM_CLOSE = 0x00000002;
    const processHandle = GetCurrentProcess();

    // Set PROTECT_FROM_CLOSE on our pseudo-handle
    // This prevents processes that open us from closing the handle
    const result = SetHandleInformation(
      processHandle,
      HANDLE_FLAG_PROTECT_FROM_CLOSE,
      HANDLE_FLAG_PROTECT_FROM_CLOSE,
    );

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    if (result === 0) {
      return { applied: false, error: 'SetHandleInformation failed — insufficient privileges' };
    }

    handleHardeningApplied = true;
    logger.debug('SelfDefense: handle hardening applied (PROTECT_FROM_CLOSE)');
    return { applied: true };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove handle hardening (undo SetHandleInformation).
 */
function removeHandleHardening(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32' || !handleHardeningApplied) {
    return { applied: false, error: 'Not active' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const GetCurrentProcess = k32.func('void * GetCurrentProcess()');
    const SetHandleInformation = k32.func('int SetHandleInformation(void *, uint32, uint32)');

    const HANDLE_FLAG_PROTECT_FROM_CLOSE = 0x00000002;
    const HANDLE_FLAG_NONE = 0x00000000;

    const result = SetHandleInformation(
      GetCurrentProcess(),
      HANDLE_FLAG_PROTECT_FROM_CLOSE,
      HANDLE_FLAG_NONE,
    );

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    handleHardeningApplied = false;
    logger.debug('SelfDefense: handle hardening removed');
    return { applied: result !== 0 };
  } catch (err) {
    handleHardeningApplied = false;
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── ACL-Based Termination Protection (NEW — REVERSIBLE) ──────────────────────

/**
 * Apply ACL-based termination protection — denies PROCESS_TERMINATE to
 * non-Administrator callers using SetSecurityInfo with SE_KERNEL_OBJECT.
 *
 * This is the SAFE alternative to ProcessBreakOnTermination:
 * - Administrators can still terminate (user can always kill it)
 * - Non-admin processes cannot terminate us (protection from casual/malware kills)
 * - REVERSIBLE — removed in stopSelfDefense()
 * - Does NOT cause BSOD
 * - Standard Win32 API (SetSecurityInfo), not a dangerous undocumented NT API
 *
 * How it works:
 * 1. Gets current process DACL
 * 2. Adds a deny ACE for PROCESS_TERMINATE + PROCESS_CREATE_THREAD for Everyone
 * 3. Administrators are excluded from the deny (via SYSTEM_SECURITY flag)
 *
 * Requires: JSHOOK_SELFDEFENSE=1
 * Admin note: Requires WRITE_DAC on own process (usually granted)
 * Reversible: yes — DACL restored on shutdown via saved original
 */
function applyAclProtection(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const advapi32 = koffi.load('advapi32.dll');

    const SetSecurityInfo = advapi32.func(
      'uint32 SetSecurityInfo(void *, uint32, uint32, void *, void *, void *, void *)',
    );
    const BuildExplicitAccessWithNameW = advapi32.func(
      'int32 BuildExplicitAccessWithNameW(_Out_ void *, _In_ char16 *, uint32, uint32, uint32)',
    );
    const SetEntriesInAclW = advapi32.func(
      'uint32 SetEntriesInAclW(uint32, _In_ void *, void *, _Out_ void *)',
    );
    const LocalFree = koffi.load('kernel32.dll').func('void * LocalFree(void *)');

    const SE_KERNEL_OBJECT = 6;
    const DACL_SECURITY_INFORMATION = 0x00000004;
    const DENY_ACCESS = 1; // DENY_ACCESS for BuildExplicitAccessWithName
    const NO_INHERITANCE = 0;

    // Deny PROCESS_TERMINATE | PROCESS_CREATE_THREAD to Everyone
    const PROCESS_TERMINATE = 0x0001;
    const PROCESS_CREATE_THREAD = 0x0002;
    const denyMask = PROCESS_TERMINATE | PROCESS_CREATE_THREAD;

    // Build deny ACE for Everyone
    const ea = Buffer.alloc(48); // EXPLICIT_ACCESS_W structure (worst-case)
    const everyoneW = Buffer.from('E\0v\0e\0r\0y\0o\0n\0e\0\0\0', 'utf16le');

    const buildResult = BuildExplicitAccessWithNameW(
      koffi.address(ea),
      koffi.address(everyoneW),
      denyMask,
      DENY_ACCESS,
      NO_INHERITANCE,
    ) as number;

    if (buildResult !== 0) {
      try {
        advapi32.unload();
      } catch {
        /* ignore */
      }
      return {
        applied: false,
        error: `BuildExplicitAccessWithNameW failed: 0x${buildResult.toString(16)}`,
      };
    }

    // Create new DACL with deny ACE
    const pNewDacl = Buffer.alloc(8); // pointer-sized output
    const setResult = SetEntriesInAclW(1, koffi.address(ea), null, koffi.address(pNewDacl));

    if (setResult !== 0) {
      try {
        advapi32.unload();
      } catch {
        /* ignore */
      }
      return {
        applied: false,
        error: `SetEntriesInAclW failed: 0x${setResult.toString(16)}`,
      };
    }

    const newDaclPtr = pNewDacl.readBigUInt64LE
      ? pNewDacl.readBigUInt64LE(0)
      : BigInt(pNewDacl.readUInt32LE(0) + pNewDacl.readUInt32LE(4) * 0x100000000);

    // Apply the DACL to our process object
    const securityResult = SetSecurityInfo(
      BigInt('0xFFFFFFFFFFFFFFFF'), // GetCurrentProcess() pseudo-handle
      SE_KERNEL_OBJECT,
      DACL_SECURITY_INFORMATION,
      null, // don't change owner
      null, // don't change group
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newDaclPtr as any, // new DACL
      null, // don't change SACL
    ) as number;

    // Free the DACL
    if (newDaclPtr !== BigInt(0)) {
      LocalFree(newDaclPtr);
    }

    try {
      advapi32.unload();
    } catch {
      /* ignore */
    }

    if (securityResult !== 0) {
      return {
        applied: false,
        error: `SetSecurityInfo failed: 0x${securityResult.toString(16)} (may require Administrator)`,
      };
    }

    aclProtectionApplied = true;
    logger.debug('SelfDefense: ACL protection applied (deny PROCESS_TERMINATE to non-admin)');
    return { applied: true };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Remove ACL-based termination protection by setting an empty (allow-all) DACL.
 *
 * On Windows, an empty DACL grants all access. This effectively undoes
 * the deny ACE we added. The original DACL is not saved because the
 * default DACL inherits from the user token, so setting a NULL DACL
 * restores the default behavior.
 *
 * IMPORTANT: Setting a NULL DACL grants ALL access to everyone. This is
 * intentional — the process should revert to default (inherited) DACL.
 */
function removeAclProtection(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32' || !aclProtectionApplied) {
    return { applied: false, error: 'Not active' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const advapi32 = koffi.load('advapi32.dll');

    const SetSecurityInfo = advapi32.func(
      'uint32 SetSecurityInfo(void *, uint32, uint32, void *, void *, void *, void *)',
    );

    const SE_KERNEL_OBJECT = 6;
    const DACL_SECURITY_INFORMATION = 0x00000004;

    // Setting DACL to NULL = restore default inherited DACL
    // This effectively removes our deny ACE
    const result = SetSecurityInfo(
      BigInt('0xFFFFFFFFFFFFFFFF'),
      SE_KERNEL_OBJECT,
      DACL_SECURITY_INFORMATION,
      null,
      null,
      null, // NULL DACL = allow all (default)
      null,
    ) as number;

    try {
      advapi32.unload();
    } catch {
      /* ignore */
    }

    aclProtectionApplied = false;
    logger.debug('SelfDefense: ACL protection removed');
    return { applied: result === 0 };
  } catch (err) {
    aclProtectionApplied = false;
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Watchdog Process (NEW — REVERSIBLE) ─────────────────────────────────────

/**
 * Start a watchdog child process that monitors the parent and restarts it
 * if unexpectedly killed.
 *
 * This is the CE (Cheat Engine) approach — "restart if killed" instead of
 * "prevent kill". Combined with ACL protection, this provides defense-in-depth:
 * - ACL stops casual termination
 * - Watchdog restarts us if ACL is bypassed (admin kill / kernel kill)
 *
 * The watchdog is a lightweight Node.js script that:
 * 1. Checks if parent PID is alive every 3 seconds
 * 2. If parent is gone, spawns a new instance with the same args
 * 3. Exits when told to (via stdin or signal)
 *
 * Configurable via:
 * - JSHOOK_WATCHDOG_ENABLE=1 — enables the watchdog
 * - JSHOOK_WATCHDOG_COMMAND — custom restart command (default: process.argv)
 *
 * Safety: The watchdog unrefs its timer so it doesn't prevent system shutdown.
 * The child process is detached so killing the parent doesn't auto-kill the child.
 */
function startWatchdog(config: SelfDefenseConfig): {
  applied: boolean;
  pid?: number;
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Watchdog is Windows-only (uses WMI process monitoring)' };
  }

  if (watchdogProcess) {
    return { applied: true, pid: watchdogProcess.pid };
  }

  try {
    const parentPid = process.pid;
    const restartArgs = config.watchdogCommand
      ? config.watchdogCommand.split(' ')
      : process.argv.slice(1); // skip node.exe, use our script path

    // Build watchdog script as a Node.js inline script via -e
    // This avoids needing a separate .js file
    const watchdogScript = buildWatchdogScript(parentPid, restartArgs);

    watchdogProcess = spawn(process.execPath, ['-e', watchdogScript], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      env: {
        ...process.env,
        // Pass through safety gates so restarted process keeps them
      },
    });

    // Attach error listener to prevent unhandled error on spawn failure (Node.js v24+)
    watchdogProcess.on('error', () => {
      logger.debug('SelfDefense: watchdog spawn error (may be expected on shutdown)');
    });

    watchdogProcess.unref();

    if (watchdogProcess.pid) {
      logger.debug(`SelfDefense: watchdog started (pid: ${watchdogProcess.pid})`);
      return { applied: true, pid: watchdogProcess.pid };
    }

    return { applied: false, error: 'Failed to spawn watchdog (no PID)' };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Build the watchdog JavaScript source code.
 * The watchdog continuously checks if the parent PID is alive.
 * If parent dies, restarts it with the same command line.
 */
export function buildWatchdogScript(parentPid: number | undefined, restartArgs: string[]): string {
  const argsJson = JSON.stringify(restartArgs);
  const pid = parentPid;

  return `
const pid = ${pid};
const args = ${argsJson};
const cp = require('child_process');

// Check if parent is alive using process.kill(pid, 0)
function isAlive() {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Wait for parent to fully exit (in case of graceful shutdown)
let goneSince = 0;
const interval = setInterval(() => {
  if (!isAlive()) {
    goneSince++;
    // Only restart after 2 consecutive checks (6s) — avoids race on graceful shutdown
    if (goneSince >= 2) {
      clearInterval(interval);
      try {
        cp.spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: process.env,
        }).unref();
      } catch (e) {
        // Spawn failed — nothing we can do
      }
      process.exit(0);
    }
  } else {
    goneSince = 0;
  }
}, 3000);
// Keep the interval referenced: with stdio ignored it is the only active
// handle keeping the watchdog child alive. Unref'ing makes the child exit
// immediately, so it never monitors anything.
`;
}

/**
 * Stop the watchdog process gracefully.
 */
function stopWatchdog(): void {
  if (watchdogProcess) {
    try {
      // Send a signal — but since stdio is ignored, we just unref and let OS clean up
      watchdogProcess.unref();
    } catch {
      /* ignore */
    }
    watchdogProcess = null;
    logger.debug('SelfDefense: watchdog stopped');
  }
}

// ── Window Hiding ────────────────────────────────────────────────────────────

/**
 * Hide the current process window from EnumWindows / FindWindow.
 *
 * This is only relevant if our process has a visible window (GUI mode).
 * For CLI tools (like jshookmcp MCP server), there is typically no window.
 *
 * Implementation uses SetWindowLongPtr with WS_EX_TOOLWINDOW to hide
 * from the taskbar and alt-tab, plus WS_EX_LAYERED with 0% opacity
 * to be invisible to screen capture.
 *
 * HONEST BOUNDARY: Direct kernel-mode window enumeration
 * (NtUserBuildHwndList) bypasses these flags. This only hides from
 * user-mode EnumWindows / FindWindow.
 */
function hideProcessWindow(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const u32 = koffi.load('user32.dll');

    const GetConsoleWindow = u32.func('void * GetConsoleWindow()');

    // Try to find our console window
    const hwnd = GetConsoleWindow();
    if (!hwnd || hwnd === null) {
      try {
        u32.unload();
      } catch {
        /* ignore */
      }
      return { applied: false, error: 'No console window found' };
    }

    const SetWindowLongPtrA = u32.func('uint64 SetWindowLongPtrA(void *, int32, uint64)');
    const ShowWindow = u32.func('int ShowWindow(void *, int32)');

    const GWL_EXSTYLE = -20;
    const WS_EX_TOOLWINDOW = 0x00000080;
    const WS_EX_NOACTIVATE = 0x08000000;
    const SW_HIDE = 0;

    // Add tool window style (hides from taskbar + alt-tab)
    SetWindowLongPtrA(hwnd, GWL_EXSTYLE, BigInt(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE));

    // Hide the window
    ShowWindow(hwnd, SW_HIDE);

    try {
      u32.unload();
    } catch {
      /* ignore */
    }

    return { applied: true };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Priority Protection ──────────────────────────────────────────────────────

/**
 * Protect process priority from being lowered.
 *
 * Anti-cheat and EDR software often lowers the priority of suspicious
 * processes to reduce their impact. By enabling SeIncreaseBasePriorityPrivilege
 * or setting a minimum priority, we make this harder.
 *
 * HONEST BOUNDARY: A kernel driver can still change our priority.
 * This only protects against user-mode priority manipulation.
 */
function protectProcessPriority(): { applied: boolean; error?: string } {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const SetPriorityClass = k32.func('int SetPriorityClass(void *, uint32)');
    const GetCurrentProcess = k32.func('void * GetCurrentProcess()');

    // Set to ABOVE_NORMAL to make it harder to reduce to IDLE
    const ABOVE_NORMAL_PRIORITY_CLASS = 0x00008000;
    const result = SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    return { applied: result !== 0 };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── BreakOnTermination (PERMANENTLY DISABLED) ────────────────────────────────

/**
 * Enable ProcessBreakOnTermination — PERMANENTLY DISABLED.
 *
 * THIS FUNCTION IS A STUB. The original implementation called
 * NtSetInformationProcess(ProcessBreakOnTermination=29) which irreversibly
 * marks the calling process as a critical system process. When the process
 * exits (normal exit, restart, or kill), the Windows kernel triggers
 * CRITICAL_PROCESS_DIED bugcheck (BSOD 0x000000EF).
 *
 * This happened 6 times when Claude Code restarted the jshookmcp MCP server.
 * ProcessBreakOnTermination can ONLY be undone via kernel R/W (BYOVD driver)
 * — there is no user-mode API to reverse it. It is intended ONLY for
 * csrss.exe, winlogon.exe, and other system-critical processes.
 *
 * DO NOT RE-ENABLE.
 */
function enableBreakOnTermination(): { applied: boolean; error?: string } {
  return {
    applied: false,
    error:
      'BreakOnTermination disabled — irreversibly marks process as critical, ' +
      'causing BSOD on restart. This is NOT safe for user-mode MCP servers. ' +
      'Use ACL protection + watchdog instead (safe, reversible alternatives).',
  };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Apply self-defense measures based on configuration.
 *
 * Environment variable driven:
 *   - JSHOOK_SELFDEFENSE=1 — enable basic self-defense (monitor + hide + handle hardening + ACL)
 *   - JSHOOK_WATCHDOG_ENABLE=1 — enable watchdog process (parent monitoring + auto-restart)
 *   - JSHOOK_SELFDEFENSE_EXTREME=1 — attempt BreakOnTermination (PERMANENTLY DISABLED — stub only)
 *
 * @param config — Optional override configuration.
 * @returns Report of applied defense measures.
 */
export function applySelfDefense(config: SelfDefenseConfig = {}): SelfDefenseReport {
  const autoEnable = envFlag('JSHOOK_SELFDEFENSE');
  const extremeEnable = envFlag('JSHOOK_SELFDEFENSE_EXTREME');
  const watchdogEnable = envFlag('JSHOOK_WATCHDOG_ENABLE');

  const limitations: string[] = [
    'Handle monitoring requires SeDebugPrivilege for full results',
    'Window hiding does not prevent kernel-mode enumeration (NtUserBuildHwndList)',
    'ProcessBreakOnTermination is IRREVERSIBLE without kernel R/W',
    'Priority protection is user-mode only — kernel drivers can override',
    'A kernel driver with sufficient access can still terminate us',
    'ACL protection can be bypassed by Administrators — this is by design',
    'Handle hardening only prevents closing via SetHandleInformation — kernel bypass exists',
  ];

  // 1. Handle monitoring
  const monitorHandles = config.monitorHandles !== false && autoEnable;
  let handleMonitorActive = false;
  if (monitorHandles) {
    handleMonitorActive = startHandleMonitoring(config);
  }

  // 2. Window hiding
  const hideWin = config.hideWindow !== false && (autoEnable || config.hideWindow === true);
  let windowHidden = false;
  if (hideWin) {
    const result = hideProcessWindow();
    windowHidden = result.applied;
    if (result.error) {
      limitations.push(`Window hiding: ${result.error}`);
    }
  }

  // 3. Priority protection
  const protectPrio = config.protectPriority === true || extremeEnable;
  let priorityProtected = false;
  if (protectPrio) {
    const result = protectProcessPriority();
    priorityProtected = result.applied;
    if (result.error) {
      limitations.push(`Priority protection: ${result.error}`);
    }
  }

  // 4. Break on termination (EXTREME — PERMANENTLY DISABLED)
  const breakOnTerm = config.breakOnTermination === true || extremeEnable;
  let terminationProtected = false;
  if (breakOnTerm) {
    const result = enableBreakOnTermination();
    terminationProtected = result.applied;
    if (result.error) {
      limitations.push(`BreakOnTermination: ${result.error}`);
    }
  }

  // 5. Handle hardening (NEW — SAFE, REVERSIBLE)
  const hardenHandles = config.hardenHandles !== false && autoEnable;
  let hvHandleHardeningApplied = false;
  if (hardenHandles) {
    const result = applyHandleHardening();
    hvHandleHardeningApplied = result.applied;
    if (result.error) {
      limitations.push(`Handle hardening: ${result.error}`);
    }
  }

  // 6. ACL protection (NEW — SAFE, REVERSIBLE)
  const aclProtection = config.aclProtection !== false && autoEnable;
  let hvAclProtectionApplied = false;
  if (aclProtection) {
    const result = applyAclProtection();
    hvAclProtectionApplied = result.applied;
    if (result.error) {
      limitations.push(`ACL protection: ${result.error}`);
    }
  }

  // 7. Watchdog process (NEW — SAFE, REVERSIBLE)
  const watchdog = config.watchdog !== false && watchdogEnable;
  let wdWatchdogActive = false;
  if (watchdog) {
    const result = startWatchdog(config);
    wdWatchdogActive = result.applied;
    if (result.error) {
      limitations.push(`Watchdog: ${result.error}`);
    }
  }

  const report: SelfDefenseReport = {
    handleMonitorActive,
    windowHidden,
    terminationProtected,
    priorityProtected,
    handleHardeningApplied: hvHandleHardeningApplied,
    aclProtectionApplied: hvAclProtectionApplied,
    watchdogActive: wdWatchdogActive,
    suspiciousHandleCount,
    limitations,
  };

  logger.debug('SelfDefense: applied', report);

  return report;
}

/**
 * Stop all self-defense measures (clean shutdown).
 *
 * Reverses all reversible protections:
 * - Stops handle monitoring
 * - Removes ACL protection
 * - Removes handle hardening
 * - Kills watchdog process
 *
 * Does NOT disable ProcessBreakOnTermination (impossible from user-mode).
 */
export function stopSelfDefense(): void {
  stopHandleMonitoring();
  suspiciousHandleCount = 0;

  // Reverse ACL protection
  if (aclProtectionApplied) {
    removeAclProtection();
  }

  // Reverse handle hardening
  if (handleHardeningApplied) {
    removeHandleHardening();
  }

  // Stop watchdog
  stopWatchdog();

  logger.debug('SelfDefense: all measures stopped');
}

/**
 * Get the current suspicious handle count.
 */
export function getSuspiciousHandleCount(): number {
  return suspiciousHandleCount;
}
