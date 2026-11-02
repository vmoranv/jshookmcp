/**
 * syscall_pattern_detect — behavioral pattern detection on syscall sequences.
 *
 * Scans captured syscall events for reverse-engineering-relevant behavioral
 * signatures: anti-debug probes, system fingerprinting, filesystem enumeration,
 * network beaconing, and process spawning. Each detected pattern includes the
 * evidence (triggering events) and a confidence derived from how tightly the
 * events cluster in time.
 */

import type { SyscallEvent } from '@modules/syscall-hook';
import { argNumber } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

type SyscallPatternKind =
  | 'anti_debug'
  | 'fingerprint'
  | 'file_enum'
  | 'network_beacon'
  | 'process_spawn'
  | 'registry_probe';

interface DetectedPattern {
  kind: SyscallPatternKind;
  name: string;
  description: string;
  confidence: number;
  eventCount: number;
  /** Timestamps of the events that triggered the detection (ms since capture start). */
  eventTimestamps: number[];
  /** Distinct syscall names observed in the pattern. */
  syscalls: string[];
}

interface PatternDetectResult {
  success: boolean;
  error?: string;
  eventsAnalyzed: number;
  patterns: DetectedPattern[];
}

// ── Pattern definitions ────────────────────────────────────────────────────────

interface PatternSpec {
  kind: SyscallPatternKind;
  name: string;
  description: string;
  syscalls: ReadonlySet<string>;
  /** Minimum distinct syscalls from this set required to fire (0 = any single hit). */
  minDistinct: number;
  /** Minimum total event count required to fire. */
  minEvents: number;
}

const ANTI_DEBUG_SYSCALLS = new Set([
  'ptrace',
  'IsDebuggerPresent',
  'CheckRemoteDebuggerPresent',
  'NtQueryInformationProcess',
  'NtSetInformationThread',
]);

const FINGERPRINT_SYSCALLS = new Set([
  'uname',
  'getuid',
  'geteuid',
  'getgid',
  'getegid',
  'sysinfo',
  'gethostname',
  'getdomainname',
]);

const FILE_ENUM_SYSCALLS = new Set([
  'openat',
  'open',
  'getdents',
  'getdents64',
  'readdir',
  'stat',
  'lstat',
  'newfstatat',
  'access',
  'faccessat',
]);

const NETWORK_SYSCALLS = new Set([
  'connect',
  'sendto',
  'recvfrom',
  'sendmsg',
  'recvmsg',
  'getpeername',
  'getsockname',
]);

const PROCESS_SPAWN_SYSCALLS = new Set([
  'clone',
  'clone3',
  'fork',
  'vfork',
  'execve',
  'execveat',
  'CreateProcess',
  'CreateProcessAsUser',
  'CreateRemoteThread',
]);

const REGISTRY_PROBE_SYSCALLS = new Set([
  'RegOpenKey',
  'RegOpenKeyEx',
  'RegQueryValue',
  'RegQueryValueEx',
  'RegEnumKey',
  'RegEnumValue',
  'NtOpenKey',
  'NtQueryKey',
  'NtEnumerateKey',
]);

const PATTERN_SPECS: ReadonlyArray<PatternSpec> = [
  {
    kind: 'anti_debug',
    name: 'Anti-debug probe',
    description:
      'Debugger detection via ptrace / IsDebuggerPresent / NtQueryInformationProcess. ' +
      'Common in packed and anti-analysis binaries.',
    syscalls: ANTI_DEBUG_SYSCALLS,
    minDistinct: 0,
    minEvents: 1,
  },
  {
    kind: 'fingerprint',
    name: 'System fingerprinting',
    description:
      'Rapid sequence of identity queries (uname / getuid / sysinfo / hostname). ' +
      'Typical of environment fingerprinting before beaconing or payload selection.',
    syscalls: FINGERPRINT_SYSCALLS,
    minDistinct: 2,
    minEvents: 3,
  },
  {
    kind: 'file_enum',
    name: 'Filesystem enumeration',
    description:
      'Repeated directory enumeration (openat + getdents/readdir + stat). ' +
      'Indicates file discovery, often followed by exfiltration or targeted reads.',
    syscalls: FILE_ENUM_SYSCALLS,
    minDistinct: 2,
    minEvents: 5,
  },
  {
    kind: 'network_beacon',
    name: 'Network beaconing',
    description:
      'Outbound socket activity (connect / sendto / recvfrom). Periodic clustering ' +
      'suggests C2 beaconing or telemetry polling.',
    syscalls: NETWORK_SYSCALLS,
    minDistinct: 1,
    minEvents: 3,
  },
  {
    kind: 'process_spawn',
    name: 'Process spawning',
    description:
      'Child-process creation (clone / fork / execve / CreateProcess). May indicate ' +
      'process hollowing, lateral movement, or legitimate helper launch.',
    syscalls: PROCESS_SPAWN_SYSCALLS,
    minDistinct: 1,
    minEvents: 1,
  },
  {
    kind: 'registry_probe',
    name: 'Windows registry probing',
    description:
      'Registry key enumeration (RegOpenKey / RegQueryValue / NtEnumerateKey). ' +
      'Common in persistence installation and software inventory fingerprinting.',
    syscalls: REGISTRY_PROBE_SYSCALLS,
    minDistinct: 2,
    minEvents: 3,
  },
];

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleSyscallPatternDetect(
  args: Record<string, unknown>,
  capturedEvents: SyscallEvent[],
): Promise<PatternDetectResult> {
  const maxEvents = argNumber(args, 'maxEvents', 200);

  const events = capturedEvents.slice(-maxEvents);

  const patterns: DetectedPattern[] = [];

  for (const spec of PATTERN_SPECS) {
    const matched = events.filter((event) => spec.syscalls.has(event.syscall));
    if (matched.length < spec.minEvents) continue;

    const distinctSyscalls = new Set(matched.map((event) => event.syscall));
    if (distinctSyscalls.size < spec.minDistinct) continue;

    const confidence = scoreConfidence(matched.length, distinctSyscalls.size, spec);

    patterns.push({
      kind: spec.kind,
      name: spec.name,
      description: spec.description,
      confidence: Number(confidence.toFixed(3)),
      eventCount: matched.length,
      eventTimestamps: matched.map((event) => event.timestamp).slice(0, 50),
      syscalls: Array.from(distinctSyscalls).toSorted(),
    });
  }

  const sortedPatterns = patterns.toSorted((a, b) => b.confidence - a.confidence);

  return {
    success: true,
    eventsAnalyzed: events.length,
    patterns: sortedPatterns,
  };
}

/**
 * Confidence heuristic: more events + more distinct syscalls in the family →
 * higher confidence, capped at 1. A single-hit family (minEvents=1) earns a
 * base of 0.5 + 0.1 per extra distinct syscall.
 */
function scoreConfidence(eventCount: number, distinctCount: number, spec: PatternSpec): number {
  const eventFactor = Math.min(eventCount / Math.max(spec.minEvents * 2, 4), 1);
  const distinctFactor =
    spec.minDistinct > 0 ? Math.min(distinctCount / (spec.minDistinct + 1), 1) : 0.5;
  const base = spec.minEvents <= 1 ? 0.5 : 0.4;
  const score = base + 0.3 * eventFactor + 0.2 * distinctFactor;
  return Math.max(0, Math.min(1, score));
}
