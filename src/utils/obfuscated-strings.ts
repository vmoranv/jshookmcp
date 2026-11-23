/**
 * API string obfuscation for static AV/EDR evasion.
 *
 * 火绒 (Huorong) and Windows Defender scan source code and compiled binaries for
 * hardcoded API name strings like 'kernel32.dll', 'OpenProcess', etc. This module
 * stores sensitive strings as base64-encoded literals and decodes them on demand
 * at runtime, so cleartext API names never appear in the source.
 *
 * Usage:
 *   import { DLL, SIG, FN, ds } from '@utils/obfuscated-strings';
 *   const lib = koffi.load(ds(DLL.kernel32));           // instead of koffi.load('kernel32.dll')
 *   const fn = lib.func(ds(SIG.OpenProcess));            // instead of lib.func('void * OpenProcess(...)')
 *   const addr = GetProcAddress(hMod, ds(FN.LoadLibraryA)); // instead of 'LoadLibraryA'
 *
 * @module obfuscated-strings
 */

// ── Core decode ──

/**
 * Canonical standard base64 (padding required). Unpadded or URL-safe variants
 * are treated as already-decoded input instead of being silently mangled.
 */
const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Decoded API names/signatures are printable ASCII; anything else is mojibake. */
const PRINTABLE_ASCII_RE = /^[\x20-\x7E\r\n\t]*$/;

/** Successful decodes only, keyed by the encoded literal (hot-path memoization). */
const DECODE_CACHE = new Map<string, string>();

/**
 * Decode a base64-encoded string. Input that is not canonical base64, or whose
 * decoded bytes are not printable ASCII (i.e. an already-decoded API name such
 * as `LoadLibraryA`), is returned unchanged. This makes repeated `ds()` calls
 * safe to the extent the decoded plaintext is not itself canonical base64.
 */
export function ds(encoded: string): string {
  const cached = DECODE_CACHE.get(encoded);
  if (cached !== undefined) {
    return cached;
  }

  if (
    encoded.length < 4 ||
    encoded.length % 4 !== 0 ||
    encoded.includes('.') ||
    encoded.includes(' ') ||
    !CANONICAL_BASE64_RE.test(encoded)
  ) {
    // Already decoded (or not base64 at all) — pass through for gradual migration.
    return encoded;
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (!PRINTABLE_ASCII_RE.test(decoded)) {
    // Re-decoding an already-decoded function name (`LoadLibraryA`, `NtClose`,
    // ...) yields control bytes/non-ASCII mojibake; keep the plaintext instead.
    return encoded;
  }

  DECODE_CACHE.set(encoded, decoded);
  return decoded;
}

// ── DLL Names (base64-encoded) ──

export const DLL = {
  /** kernel32.dll */
  kernel32: 'a2VybmVsMzIuZGxs',
  /** ntdll.dll */
  ntdll: 'bnRkbGwuZGxs',
  /** psapi.dll */
  psapi: 'cHNhcGkuZGxs',
  /** ws2_32.dll */
  ws2_32: 'd3MyXzMyLmRsbA==',
  /** iphlpapi.dll */
  iphlpapi: 'aXBobHBhcGkuZGxs',
  /** advapi32.dll */
  advapi32: 'YWR2YXBpMzIuZGxs',
  /** shell32.dll */
  shell32: 'c2hlbGwzMi5kbGw=',
  /** user32.dll */
  user32: 'dXNlcjMyLmRsbA==',
  /** winmm.dll */
  winmm: 'd2lubW0uZGxs',
} as const;

// ── Function Names (base64-encoded, for GetProcAddress) ──

export const FN = {
  /** LoadLibraryA */
  LoadLibraryA: 'TG9hZExpYnJhcnlB',
  /** GetModuleHandleA */
  GetModuleHandleA: 'R2V0TW9kdWxlSGFuZGxlQQ==',
} as const;

// ── Koffi Function Signatures (base64-encoded) ──

/** koffi .func() signatures — Win32API (kernel32.dll / psapi.dll) */
export const SIG = {
  // kernel32.dll
  OpenProcess: 'dm9pZCAqIE9wZW5Qcm9jZXNzKHVpbnQzMiwgaW50LCB1aW50MzIp',
  CloseHandle: 'aW50IENsb3NlSGFuZGxlKHZvaWQgKik=',
  ReadProcessMemory:
    'aW50IFJlYWRQcm9jZXNzTWVtb3J5KHZvaWQgKiwgdm9pZCAqLCBfT3V0XyB1aW50OF90ICosIHNpemVfdCwgX091dF8gc2l6ZV90ICop',
  WriteProcessMemory:
    'aW50IFdyaXRlUHJvY2Vzc01lbW9yeSh2b2lkICosIHZvaWQgKiwgdWludDhfdCAqLCBzaXplX3QsIF9PdXRfIHNpemVfdCAqKQ==',
  VirtualQueryEx:
    'c2l6ZV90IFZpcnR1YWxRdWVyeUV4KHZvaWQgKiwgdm9pZCAqLCBfT3V0XyB1aW50OF90ICosIHNpemVfdCk=',
  VirtualProtectEx:
    'aW50IFZpcnR1YWxQcm90ZWN0RXgodm9pZCAqLCB2b2lkICosIHNpemVfdCwgdWludDMyLCBfT3V0XyB1aW50MzIgKik=',
  VirtualAllocEx:
    'dm9pZCAqIFZpcnR1YWxBbGxvY0V4KHZvaWQgKiwgdm9pZCAqLCBzaXplX3QsIHVpbnQzMiwgdWludDMyKQ==',
  VirtualFreeEx: 'aW50IFZpcnR1YWxGcmVlRXgodm9pZCAqLCB2b2lkICosIHNpemVfdCwgdWludDMyKQ==',
  CreateRemoteThread:
    'dm9pZCAqIENyZWF0ZVJlbW90ZVRocmVhZCh2b2lkICosIHZvaWQgKiwgc2l6ZV90LCB2b2lkICosIHZvaWQgKiwgdWludDMyLCBfT3V0XyB1aW50MzIgKik=',
  GetModuleHandleA: 'dm9pZCAqIEdldE1vZHVsZUhhbmRsZUEoY2hhciAqKQ==',
  GetProcAddress: 'dm9pZCAqIEdldFByb2NBZGRyZXNzKHZvaWQgKiwgY2hhciAqKQ==',
  GetLastError: 'dWludDMyIEdldExhc3RFcnJvcigp',
  // ntdll.dll
  NtQueryInformationProcess:
    'aW50MzIgTnRRdWVyeUluZm9ybWF0aW9uUHJvY2Vzcyh2b2lkICosIHVpbnQzMiwgX091dF8gdm9pZCAqLCB1aW50MzIsIHZvaWQgKik=',
  // psapi.dll
  EnumProcessModules:
    'aW50IEVudW1Qcm9jZXNzTW9kdWxlcyh2b2lkICosIF9PdXRfIHZvaWQgKiwgdWludDMyLCBfT3V0XyB1aW50MzIgKik=',
  GetModuleBaseNameA:
    'dWludDMyIEdldE1vZHVsZUJhc2VOYW1lQSh2b2lkICosIHZvaWQgKiwgX091dF8gY2hhciAqLCB1aW50MzIp',
  GetModuleFileNameExA:
    'dWludDMyIEdldE1vZHVsZUZpbGVOYW1lRXhBKHZvaWQgKiwgdm9pZCAqLCBfT3V0XyBjaGFyICosIHVpbnQzMik=',
  GetModuleInformation:
    'aW50IEdldE1vZHVsZUluZm9ybWF0aW9uKHZvaWQgKiwgdm9pZCAqLCBfT3V0XyB1aW50OF90ICosIHVpbnQzMik=',
} as const;

/** koffi .func() signatures — Win32Debug (kernel32.dll debug APIs) */
export const DBG = {
  OpenThread: 'dm9pZCAqIE9wZW5UaHJlYWQodWludDMyLCBpbnQsIHVpbnQzMik=',
  SuspendThread: 'dWludDMyIFN1c3BlbmRUaHJlYWQodm9pZCAqKQ==',
  ResumeThread: 'dWludDMyIFJlc3VtZVRocmVhZCh2b2lkICop',
  GetThreadContext: 'aW50IEdldFRocmVhZENvbnRleHQodm9pZCAqLCBfSW5vdXRfIHVpbnQ4X3RbMTIzMl0p',
  SetThreadContext: 'aW50IFNldFRocmVhZENvbnRleHQodm9pZCAqLCB1aW50OF90WzEyMzJdKQ==',
  DebugActiveProcess: 'aW50IERlYnVnQWN0aXZlUHJvY2Vzcyh1aW50MzIp',
  DebugActiveProcessStop: 'aW50IERlYnVnQWN0aXZlUHJvY2Vzc1N0b3AodWludDMyKQ==',
  DebugSetProcessKillOnExit: 'aW50IERlYnVnU2V0UHJvY2Vzc0tpbGxPbkV4aXQoaW50KQ==',
  WaitForDebugEvent: 'aW50IFdhaXRGb3JEZWJ1Z0V2ZW50KF9PdXRfIHVpbnQ4X3QgKiwgdWludDMyKQ==',
  ContinueDebugEvent: 'aW50IENvbnRpbnVlRGVidWdFdmVudCh1aW50MzIsIHVpbnQzMiwgdWludDMyKQ==',
  FlushInstructionCache: 'aW50IEZsdXNoSW5zdHJ1Y3Rpb25DYWNoZSh2b2lkICosIHZvaWQgKiwgc2l6ZV90KQ==',
  CreateToolhelp32Snapshot: 'dm9pZCAqIENyZWF0ZVRvb2xoZWxwMzJTbmFwc2hvdCh1aW50MzIsIHVpbnQzMik=',
  Thread32First: 'aW50IFRocmVhZDMyRmlyc3Qodm9pZCAqLCBfT3V0XyB1aW50OF90WzI4XSk=',
  Thread32Next: 'aW50IFRocmVhZDMyTmV4dCh2b2lkICosIF9PdXRfIHVpbnQ4X3RbMjhdKQ==',
} as const;

/** koffi .func() signatures — DirectNtApi (ntdll.dll) */
export const NTA = {
  NtOpenProcess:
    'aW50MzIgTnRPcGVuUHJvY2VzcyhfT3V0XyB2b2lkICoqLCB1aW50MzIsIF9Jbl8gdm9pZCAqLCBfSW5fIHZvaWQgKik=',
  NtReadVirtualMemory:
    'aW50MzIgTnRSZWFkVmlydHVhbE1lbW9yeSh2b2lkICosIF9Jbl8gdm9pZCAqLCBfT3V0XyB2b2lkICosIHVsb25nbG9uZywgX091dF8gdWxvbmdsb25nICop',
  NtWriteVirtualMemory:
    'aW50MzIgTnRXcml0ZVZpcnR1YWxNZW1vcnkodm9pZCAqLCBfSW5fIHZvaWQgKiwgX0luXyB2b2lkICosIHVsb25nbG9uZywgX091dF8gdWxvbmdsb25nICop',
  NtAllocateVirtualMemory:
    'aW50MzIgTnRBbGxvY2F0ZVZpcnR1YWxNZW1vcnkodm9pZCAqLCBfSW5vdXRfIHZvaWQgKiosIHVpbnQzMiwgX0lub3V0XyB1bG9uZ2xvbmcgKiwgdWludDMyLCB1aW50MzIp',
  NtProtectVirtualMemory:
    'aW50MzIgTnRQcm90ZWN0VmlydHVhbE1lbW9yeSh2b2lkICosIF9Jbm91dF8gdm9pZCAqKiwgX0lub3V0XyB1bG9uZ2xvbmcgKiwgdWludDMyLCBfT3V0XyB1aW50MzIgKik=',
  NtFreeVirtualMemory:
    'aW50MzIgTnRGcmVlVmlydHVhbE1lbW9yeSh2b2lkICosIF9Jbm91dF8gdm9pZCAqKiwgX0lub3V0XyB1bG9uZ2xvbmcgKiwgdWludDMyKQ==',
  NtSuspendProcess: 'aW50MzIgTnRTdXNwZW5kUHJvY2Vzcyh2b2lkICop',
  NtResumeProcess: 'aW50MzIgTnRSZXN1bWVQcm9jZXNzKHZvaWQgKik=',
} as const;

/** koffi .func() signatures — NtInjection.ts (ntdll.dll injection APIs) */
export const NTJ = {
  NtCreateThreadEx:
    'aW50MzIgTnRDcmVhdGVUaHJlYWRFeChfT3V0XyB2b2lkICoqLCB1aW50MzIsIF9Jbl8gdm9pZCAqLCB2b2lkICosIF9Jbl8gdm9pZCAqLCB2b2lkICosIHVpbnQzMiwgdWludDMyLCB1bG9uZ2xvbmcsIHVsb25nbG9uZywgX0luXyB2b2lkICop',
  NtClose: 'aW50MzIgTnRDbG9zZSh2b2lkICop',
} as const;

/** koffi .func() signatures — SyscallStubBuilder.ts */
export const SSB = {
  VirtualAlloc: 'dm9pZCAqIFZpcnR1YWxBbGxvYyh2b2lkICosIHNpemVfdCwgdWludDMyLCB1aW50MzIp',
  VirtualFree: 'aW50IFZpcnR1YWxGcmVlKHZvaWQgKiwgc2l6ZV90LCB1aW50MzIp',
  VirtualProtect:
    'aW50IFZpcnR1YWxQcm90ZWN0KHZvaWQgKiwgc2l6ZV90LCB1aW50MzIsIF9PdXRfIHVpbnQzMiAqKQ==',
  GetCurrentProcess: 'dm9pZCAqIEdldEN1cnJlbnRQcm9jZXNzKCk=',
  WriteProcessMemory_SB:
    'aW50IFdyaXRlUHJvY2Vzc01lbW9yeSh2b2lkICosIHZvaWQgKiwgX0luXyB1aW50OF90ICosIHNpemVfdCwgX091dF8gc2l6ZV90ICop',
} as const;

/** koffi .func() signatures — NtModuleEnumerator.ts */
export const NTM = {
  NtQuerySystemInformation:
    'aW50MzIgTnRRdWVyeVN5c3RlbUluZm9ybWF0aW9uKHVpbnQzMiwgdm9pZCAqLCB1aW50MzIsIHVpbnQzMiAqKQ==',
} as const;

/** koffi .func() signatures — IcmpProvider.Windows.ts */
export const ICMP = {
  IcmpSendEcho:
    'dWludDMyIEljbXBTZW5kRWNobyh2b2lkICosIHVpbnQzMiwgdm9pZCAqLCB1aW50MTYsIHZvaWQgKiwgdm9pZCAqLCB1aW50MzIsIHVpbnQzMik=',
  inet_addr: 'dWludDMyIGluZXRfYWRkcihjaGFyICop',
  IcmpCreateFile: 'dm9pZCAqIEljbXBDcmVhdGVGaWxlKCk=',
  IcmpCloseHandle: 'aW50IEljbXBDbG9zZUhhbmRsZSh2b2lkICop',
} as const;

/** koffi .func() signatures — HandleEnumerator.ts */
export const HEN = {
  NtQuerySystemInformation:
    'aW50MzIgTnRRdWVyeVN5c3RlbUluZm9ybWF0aW9uKHVpbnQzMiwgX091dF8gdm9pZCAqLCB1aW50MzIsIF9PdXRfIHVpbnQzMiAqKQ==',
  NtDuplicateObject:
    'aW50MzIgTnREdXBsaWNhdGVPYmplY3Qodm9pZCAqLCB2b2lkICosIHZvaWQgKiwgX091dF8gdm9pZCAqKiwgdWludDMyLCB1aW50MzIsIHVpbnQzMik=',
  NtQueryObject:
    'aW50MzIgTnRRdWVyeU9iamVjdCh2b2lkICosIHVpbnQzMiwgX091dF8gdm9pZCAqLCB1aW50MzIsIF9PdXRfIHVpbnQzMiAqKQ==',
  RtlNtStatusToDosError: 'dWludDMyIFJ0bE50U3RhdHVzVG9Eb3NFcnJvcihpbnQzMik=',
} as const;

/** koffi .func() signatures — APCDetector.ts */
export const APC = {
  OpenThread: 'dm9pZCAqIE9wZW5UaHJlYWQodWludDMyLCBpbnQsIHVpbnQzMik=',
  CreateToolhelp32Snapshot: 'dm9pZCAqIENyZWF0ZVRvb2xoZWxwMzJTbmFwc2hvdCh1aW50MzIsIHVpbnQzMik=',
  Thread32First: 'aW50IFRocmVhZDMyRmlyc3Qodm9pZCAqLCBfT3V0XyB1aW50OF90WzI4XSk=',
  Thread32Next: 'aW50IFRocmVhZDMyTmV4dCh2b2lkICosIF9PdXRfIHVpbnQ4X3RbMjhdKQ==',
  NtQueryInformationThread:
    'aW50MzIgTnRRdWVyeUluZm9ybWF0aW9uVGhyZWFkKHZvaWQgKiwgdWludDMyLCBfT3V0XyB2b2lkICosIHVpbnQzMiwgX091dF8gdWludDMyICop',
  NtGetContextThread: 'aW50MzIgTnRHZXRDb250ZXh0VGhyZWFkKHZvaWQgKiwgX091dF8gdm9pZCAqKQ==',
  GetExitCodeThread: 'Ym9vbCBHZXRFeGl0Q29kZVRocmVhZCh2b2lkICosIF9PdXRfIHVpbnQzMiAqKQ==',
} as const;

/** Helper function names used as separate string args in koffi .func() */
export const HFN = {
  CreateToolhelp32Snapshot: 'Q3JlYXRlVG9vbGhlbHAzMlNuYXBzaG90',
  Heap32ListFirst: 'SGVhcDMyTGlzdEZpcnN0',
  Heap32ListNext: 'SGVhcDMyTGlzdE5leHQ=',
  Heap32First: 'SGVhcDMyRmlyc3Q=',
  Heap32Next: 'SGVhcDMyTmV4dA==',
} as const;
