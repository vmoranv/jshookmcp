/**
 * AntiDetectionCheck — read-only pre-flight security audit.
 *
 * Checks:
 * 1. ETW/AMSI patch status (InProcessPatcher)
 * 2. Debugger attached to self (IsDebuggerPresent)
 * 3. HVCI/VBS status (registry read)
 * 4. Known anti-cheat processes running
 *
 * ALL operations are read-only. No patches, no memory writes, no policy changes.
 * Returns a pass/fail verdict with actionable recommendations.
 *
 * @module AntiDetectionCheck
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool } from '@server/domains/shared/parse-args';
import { readEnvBoolean } from '@src/config/environment';

// Known anti-cheat / EDR process name patterns.
const KNOWN_AC_PROCESSES: ReadonlyArray<{
  name: string;
  category: 'anti-cheat' | 'edr' | 'av' | 'debugger';
  severity: 'critical' | 'high' | 'medium';
}> = [
  // Anti-cheat
  { name: 'EasyAntiCheat.exe', category: 'anti-cheat', severity: 'critical' },
  { name: 'EasyAntiCheat_EOS.exe', category: 'anti-cheat', severity: 'critical' },
  { name: 'BEService.exe', category: 'anti-cheat', severity: 'critical' },
  { name: 'BEService_x64.exe', category: 'anti-cheat', severity: 'critical' },
  { name: 'vgk.sys', category: 'anti-cheat', severity: 'critical' }, // Vanguard kernel module
  { name: 'vgtray.exe', category: 'anti-cheat', severity: 'critical' },
  { name: 'Fake.dll', category: 'anti-cheat', severity: 'high' }, // FaceIt client
  { name: 'FaceitClient.exe', category: 'anti-cheat', severity: 'high' },
  { name: 'ACE-Base.sys', category: 'anti-cheat', severity: 'high' }, // Tencent
  { name: 'ACE-CORE.sys', category: 'anti-cheat', severity: 'critical' },
  { name: 'EQU8.exe', category: 'anti-cheat', severity: 'medium' },
  { name: 'Equ8Helper.exe', category: 'anti-cheat', severity: 'medium' },
  { name: 'mhyprot2.Sys', category: 'anti-cheat', severity: 'critical' }, // miHoYo
  { name: 'mhyprot3.Sys', category: 'anti-cheat', severity: 'critical' },
  { name: 'HoYoKProtect.sys', category: 'anti-cheat', severity: 'critical' },
  { name: 'xdd.sys', category: 'anti-cheat', severity: 'critical' }, // Roblox Hyperion
  // EDR
  { name: 'MsMpEng.exe', category: 'edr', severity: 'high' }, // Windows Defender
  { name: 'NisSrv.exe', category: 'edr', severity: 'high' },
  { name: 'MsSense.exe', category: 'edr', severity: 'critical' }, // Defender ATP
  { name: 'SenseNdr.exe', category: 'edr', severity: 'high' },
  { name: 'SentinelAgent.exe', category: 'edr', severity: 'critical' },
  { name: 'SentinelMonitor.sys', category: 'edr', severity: 'critical' },
  { name: 'CylanceSvc.exe', category: 'edr', severity: 'critical' },
  { name: 'csfalconservice.exe', category: 'edr', severity: 'critical' }, // CrowdStrike
  { name: 'CSFalconService.exe', category: 'edr', severity: 'critical' },
  { name: 'CarbonBlack.exe', category: 'edr', severity: 'critical' },
  { name: 'CbDefense.exe', category: 'edr', severity: 'critical' },
  { name: 'sophosav.exe', category: 'edr', severity: 'high' },
  { name: 'SophosFileScanner.exe', category: 'edr', severity: 'high' },
  { name: 'SntpService.exe', category: 'edr', severity: 'high' },
  { name: 'Cortex XDR', category: 'edr', severity: 'critical' }, // Palo Alto
  { name: 'Traps.exe', category: 'edr', severity: 'critical' },
  { name: 'elastic-endpoint.exe', category: 'edr', severity: 'critical' },
  { name: 'elastic-agent.exe', category: 'edr', severity: 'critical' },
  { name: 'FortiEDRCollector.exe', category: 'edr', severity: 'critical' },
  { name: 'TreilixAgent.exe', category: 'edr', severity: 'critical' }, // Trellix/FireEye
  { name: 'xagt.exe', category: 'edr', severity: 'critical' }, // FireEye HX
  // AV
  { name: 'AvastSvc.exe', category: 'av', severity: 'medium' },
  { name: 'AvastUI.exe', category: 'av', severity: 'medium' },
  { name: 'avgnt.exe', category: 'av', severity: 'medium' }, // Avira
  { name: 'avguard.exe', category: 'av', severity: 'medium' },
  { name: 'avp.exe', category: 'av', severity: 'high' }, // Kaspersky
  { name: 'kavfs.exe', category: 'av', severity: 'high' },
  { name: 'McAfee.TrueKey.Service.exe', category: 'av', severity: 'medium' },
  { name: 'mcshield.exe', category: 'av', severity: 'high' },
  { name: 'NortonSecurity.exe', category: 'av', severity: 'medium' },
  { name: 'NS.exe', category: 'av', severity: 'medium' },
  { name: 'bdagent.exe', category: 'av', severity: 'high' }, // Bitdefender
  { name: 'vsserv.exe', category: 'av', severity: 'high' },
  { name: 'ESET Service', category: 'av', severity: 'high' },
  { name: 'ekrn.exe', category: 'av', severity: 'high' }, // ESET kernel
  { name: 'egui.exe', category: 'av', severity: 'medium' },
  // Debuggers
  { name: 'x64dbg.exe', category: 'debugger', severity: 'high' },
  { name: 'x32dbg.exe', category: 'debugger', severity: 'high' },
  { name: 'ida.exe', category: 'debugger', severity: 'high' },
  { name: 'ida64.exe', category: 'debugger', severity: 'high' },
  { name: 'windbg.exe', category: 'debugger', severity: 'high' },
  { name: 'dbgview.exe', category: 'debugger', severity: 'medium' },
  { name: 'dnSpy.exe', category: 'debugger', severity: 'medium' },
  { name: 'Cheat Engine.exe', category: 'debugger', severity: 'medium' },
  { name: 'cheatengine-x86_64.exe', category: 'debugger', severity: 'medium' },
  { name: 'ReClass.exe', category: 'debugger', severity: 'medium' },
  { name: 'ProcessHacker.exe', category: 'debugger', severity: 'medium' },
  { name: 'SystemInformer.exe', category: 'debugger', severity: 'medium' },
  { name: 'Procmon.exe', category: 'debugger', severity: 'medium' },
  { name: 'Procmon64.exe', category: 'debugger', severity: 'medium' },
] as const;

export interface AntidetectionCheckResult {
  success: boolean;
  verdict: 'pass' | 'warn' | 'fail';
  checks: {
    etwAmsiPatched: boolean;
    debuggerAttached: boolean;
    hvciEnabled: boolean;
    vbsEnabled: boolean;
    acProcesses: string[];
    envGates: boolean;
  };
  score: number; // 0-100, higher = safer
  recommendations: string[];
  details?: Record<string, unknown>;
}

export class AntiDetectionCheckHandlers {
  handleCheck(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      const includeDetails = argBool(args, 'includeDetails', false);
      return this.runCheck(includeDetails);
    });
  }

  private async runCheck(includeDetails: boolean): Promise<AntidetectionCheckResult> {
    const recommendations: string[] = [];
    let score = 100;
    const penaltyPerFail = 15;
    const penaltyPerWarn = 7;

    const etw = await checkEtwAmsi(includeDetails, recommendations);
    score -= etw.penalty;
    const debuggerAttached = checkDebuggerAttached(recommendations, penaltyPerWarn);
    score -= debuggerAttached.penalty;
    const hvci = checkHvciVbs(recommendations, penaltyPerWarn);
    score -= hvci.penalty;
    const acProcesses = checkAcProcesses(recommendations, penaltyPerFail, penaltyPerWarn);
    score -= acProcesses.penalty;
    score = Math.max(0, score);
    checkEnvGates(recommendations, penaltyPerWarn);

    // ── Verdict ────────────────────────────────────────────────────────────
    let verdict: 'pass' | 'warn' | 'fail';
    if (score >= 70) {
      verdict = 'pass';
    } else if (score >= 30) {
      verdict = 'warn';
    } else {
      verdict = 'fail';
    }

    const result: AntidetectionCheckResult = {
      success: true,
      verdict,
      checks: {
        etwAmsiPatched: etw.etwAmsiPatched,
        debuggerAttached: debuggerAttached.debuggerAttached,
        hvciEnabled: hvci.hvciEnabled,
        vbsEnabled: hvci.vbsEnabled,
        acProcesses: acProcesses.processes,
        envGates: true,
      },
      score,
      recommendations,
    };

    if (includeDetails) {
      result.details = {
        patchDetails: etw.patchDetails,
        etwMonitoring: etw.etwMonitoring,
        platform: process.platform,
        pid: process.pid,
        title: process.title,
      };
    }

    return result;
  }
}

/** ETW/AMSI patch status is a Windows-only concept. On other platforms the
 * patcher is a no-op stub and `isPatched()` returns false, which would
 * otherwise incorrectly penalise the score. Skip both the lookup and the
 * penalty on non-Windows; expose the unavailable status in `checks`. */
async function checkEtwAmsi(
  includeDetails: boolean,
  recommendations: string[],
): Promise<{
  etwAmsiPatched: boolean;
  patchDetails: Record<string, boolean>;
  etwMonitoring: Record<string, unknown>;
  penalty: number;
}> {
  let etwAmsiPatched = false;
  let patchDetails: Record<string, boolean> = {};
  let etwMonitoring: Record<string, unknown> = {};
  let penalty = 0;

  if (process.platform !== 'win32') {
    return { etwAmsiPatched, patchDetails, etwMonitoring, penalty };
  }
  try {
    const { isPatched, getPatchDetails, getEtwMonitoringSummary } =
      await import('@src/native/syscall/InProcessPatcher');
    etwAmsiPatched = isPatched();
    if (includeDetails) {
      patchDetails = getPatchDetails();
    }
    etwMonitoring = getEtwMonitoringSummary() as unknown as Record<string, unknown>;

    if (!etwAmsiPatched) {
      penalty = 15;
      recommendations.push(
        'ETW/AMSI not patched — call memory_antidetection action=harden to apply',
      );
    }
  } catch {
    penalty = 7;
    recommendations.push('Could not check ETW/AMSI patch status');
  }
  return { etwAmsiPatched, patchDetails, etwMonitoring, penalty };
}

/** IsDebuggerPresent with a PEB.BeingDebugged (ProcessDebugPort) fallback. */
function checkDebuggerAttached(
  recommendations: string[],
  penaltyPerWarn: number,
): { debuggerAttached: boolean; penalty: number } {
  if (process.platform !== 'win32') return { debuggerAttached: false, penalty: 0 };
  let debuggerAttached = false;
  try {
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');
    const IsDebuggerPresent = k32.func('int IsDebuggerPresent()');
    debuggerAttached = IsDebuggerPresent() !== 0;
    try {
      k32.unload();
    } catch {
      /* ignore */
    }
  } catch {
    // Fallback: check PEB.BeingDebugged via NtQueryInformationProcess
    try {
      const koffi = require('koffi');
      const ntdll = koffi.load('ntdll.dll');
      const NtQueryInformationProcess = ntdll.func(
        'int32 NtQueryInformationProcess(void *, uint32, _Out_ void *, uint32, _Out_ uint32 *)',
      );
      // ProcessDebugPort = 7
      const buf = Buffer.alloc(8);
      const retLen = Buffer.alloc(4);
      const status = NtQueryInformationProcess(
        BigInt('0xFFFFFFFFFFFFFFFF'),
        7,
        koffi.address(buf),
        8,
        koffi.address(retLen),
      ) as number;
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      debuggerAttached = status >= 0 && buf.readBigUInt64LE(0) !== 0n;
    } catch {
      // Cannot determine — don't penalize
    }
  }

  if (debuggerAttached) {
    recommendations.push(
      'Debugger attached to self — this is expected during development but raises suspicion',
    );
    return { debuggerAttached, penalty: penaltyPerWarn };
  }
  return { debuggerAttached, penalty: 0 };
}

/** HVCI/VBS registry probe (Windows only; keys may be absent). */
function checkHvciVbs(
  recommendations: string[],
  penaltyPerWarn: number,
): { hvciEnabled: boolean; vbsEnabled: boolean; penalty: number } {
  let hvciEnabled = false;
  let vbsEnabled = false;
  let penalty = 0;
  if (process.platform !== 'win32') return { hvciEnabled, vbsEnabled, penalty };
  try {
    // Check HVCI via registry: HKLM\System\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity
    const { execSync } = require('node:child_process');
    const hvciOutput = execSync(
      'reg query "HKLM\\System\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" /v Enabled 2>nul',
      { timeout: 5000, encoding: 'utf8', windowsHide: true },
    ) as string;
    hvciEnabled = hvciOutput.includes('0x1');

    // Check VBS via registry
    const vbsOutput = execSync(
      'reg query "HKLM\\System\\CurrentControlSet\\Control\\DeviceGuard" /v EnableVirtualizationBasedSecurity 2>nul',
      { timeout: 5000, encoding: 'utf8', windowsHide: true },
    ) as string;
    vbsEnabled = vbsOutput.includes('0x1');
  } catch {
    // Registry keys may not exist — HVCI/VBS not configured
  }

  if (hvciEnabled) {
    penalty += penaltyPerWarn;
    recommendations.push(
      'HVCI (Hypervisor-protected Code Integrity) is ENABLED — ' +
        'this blocks unsigned driver loading and some memory operations',
    );
  }
  if (vbsEnabled) {
    penalty += penaltyPerWarn;
    recommendations.push(
      'Virtualization-Based Security (VBS) is ENABLED — ' +
        'this enables HVCI, Credential Guard, and restricts kernel access',
    );
  }
  return { hvciEnabled, vbsEnabled, penalty };
}

/** tasklist scan for known anti-cheat / EDR / debugging processes. */
function checkAcProcesses(
  recommendations: string[],
  penaltyPerFail: number,
  penaltyPerWarn: number,
): { processes: string[]; penalty: number } {
  if (process.platform !== 'win32') return { processes: [], penalty: 0 };
  let processes: string[] = [];
  try {
    const { execSync } = require('node:child_process');
    const tasklistOutput = execSync('tasklist /FO CSV /NH', {
      timeout: 5000,
      encoding: 'utf8',
      windowsHide: true,
    }) as string;

    const lowerOutput = tasklistOutput.toLowerCase();
    const detected: string[] = [];

    for (const proc of KNOWN_AC_PROCESSES) {
      if (lowerOutput.includes(proc.name.toLowerCase())) {
        detected.push(proc.name);
      }
    }

    processes = detected;
  } catch {
    // tasklist unavailable — skip
  }

  if (processes.length === 0) return { processes, penalty: 0 };

  // Count critical/high severity
  const criticalCount = processes.filter((name) =>
    KNOWN_AC_PROCESSES.some(
      (proc) => proc.name === name && (proc.severity === 'critical' || proc.severity === 'high'),
    ),
  ).length;

  if (criticalCount > 0) {
    recommendations.push(
      `${criticalCount} high/critical security process(es) detected: ${processes.join(', ')}`,
    );
    return { processes, penalty: penaltyPerFail * criticalCount };
  }
  recommendations.push(`Known security/debugging processes detected: ${processes.join(', ')}`);
  return { processes, penalty: penaltyPerWarn };
}

/** Environment gate visibility (penalises active self-defense only). */
function checkEnvGates(recommendations: string[], penaltyPerWarn: number): void {
  void penaltyPerWarn;
  const gateVars = ['JSHOOK_INJECTION_ENABLE', 'JSHOOK_BYOVD_ENABLE', 'JSHOOK_SELFDEFENSE'];
  for (const v of gateVars) {
    if (readEnvBoolean(v, false)) {
      if (v === 'JSHOOK_SELFDEFENSE') {
        recommendations.push(
          `${v}=1: Self-defense is active (safe operations only — no BreakOnTermination)`,
        );
      }
    }
  }
}
