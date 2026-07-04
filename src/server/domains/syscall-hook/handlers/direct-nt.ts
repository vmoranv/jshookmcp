/**
 * Direct NT API Handler — syscall_direct_invoke + syscall_resolve_ssn
 *
 * Wires the native syscall layer (DirectNtApi, SyscallResolver, SyscallStubBuilder)
 * into the syscall-hook domain, exposing direct NT API calls and syscall-number
 * lookup as MCP tools.
 *
 * Win32 only — both tools are filtered at registration time on non-Win32 platforms.
 */

import { argString, argStringRequired } from '@server/domains/shared/parse-args';
import type { SyscallEntry } from '@native/syscall';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ResolveSsnResult {
  success: boolean;
  error?: string;
  platform?: string;
  path?: string;
  syscalls?: SyscallEntry[];
  tableSize?: number;
  lookup?: Record<string, SyscallEntry>;
  warnings?: string[];
}

interface DirectInvokeResult {
  success: boolean;
  error?: string;
  platform?: string;
  functionName?: string;
  ssn?: number;
  usage?: string;
  note?: string;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export class DirectNtApiHandlers {
  /**
   * Resolve syscall service numbers by parsing the on-disk ntdll.dll export
   * table. Returns a table of Zw* → SSN mappings and a syscall gadget RVA.
   * Win32 only.
   */
  async handleSyscallResolveSsn(args: Record<string, unknown>): Promise<ResolveSsnResult> {
    try {
      if (process.platform !== 'win32') {
        return {
          success: false,
          error: 'NT syscall resolution is Windows-only',
          platform: process.platform,
        };
      }

      // Dynamic import so non-Win32 platforms don't crash on koffi static requires.
      const { resolveNtdll } = await import('@native/syscall');
      const customPath = argString(args, 'ntdllPath', '').trim() || undefined;

      const resolved = resolveNtdll(customPath);

      return {
        success: true,
        platform: 'win32',
        path: resolved.path,
        syscalls: resolved.syscalls,
        tableSize: resolved.syscalls.length,
        lookup: resolved.byName,
        warnings: resolved.warnings.length > 0 ? resolved.warnings : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Invoke an NT system call directly, bypassing ntdll.
   *
   * This is a documentation / guidance tool rather than a live caller —
   * direct syscall invocation requires per-process stub allocation and
   * cannot be executed from a generic MCP context without targeting a
   * specific process.  The tool returns:
   *   - the resolved SSN for the given function
   *   - a stub template (asm bytes)
   *   - usage guidance for in-process invocations
   *
   * Win32 only.
   */
  async handleSyscallDirectInvoke(args: Record<string, unknown>): Promise<DirectInvokeResult> {
    try {
      if (process.platform !== 'win32') {
        return {
          success: false,
          error: 'Direct NT syscall invocation is Windows-only',
          platform: process.platform,
        };
      }

      const functionName = argStringRequired(args, 'functionName').trim();
      if (
        !/^Nt[A-Z][a-zA-Z0-9]*$/.test(functionName) &&
        !/^Zw[A-Za-z][a-zA-Z0-9]*$/.test(functionName)
      ) {
        return {
          success: false,
          error: `Invalid NT function name: "${functionName}". Expected format: Nt<Name> or Zw<Name>`,
        };
      }

      const { resolveNtdll } = await import('@native/syscall');
      const ntdll = resolveNtdll();

      // Try Nt and Zw prefix variants.
      let entry = ntdll.byName[functionName];
      if (!entry) {
        const alt = functionName.startsWith('Nt')
          ? functionName.replace(/^Nt/, 'Zw')
          : functionName.replace(/^Zw/, 'Nt');
        entry = ntdll.byName[alt] ?? ntdll.byName[functionName];
      }

      if (!entry) {
        return {
          success: false,
          functionName,
          error: `Function "${functionName}" not found in ntdll export table. Available: ${ntdll.syscalls
            .map((s) => s.name)
            .slice(0, 20)
            .join(
              ', ',
            )}${ntdll.syscalls.length > 20 ? ` (+${ntdll.syscalls.length - 20} more)` : ''}`,
        };
      }

      // Build a stub asm snippet for the resolved SSN.
      // mov r10, rcx   → 4C 8B D1
      // mov eax, SSN   → B8 [SSN le32]
      // jmp [rip+2]    → FF 25 02 00 00 00 EB 00
      // syscall-gadget → 8-byte address
      const ssnBytes = Buffer.alloc(4);
      ssnBytes.writeUInt32LE(entry.ssn, 0);

      const stubHex = [
        '4C',
        '8B',
        'D1', // mov r10, rcx
        'B8',
        ...Array.from(ssnBytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()), // mov eax, SSN
        'FF',
        '25',
        '02',
        '00',
        '00',
        '00',
        'EB',
        '00', // jmp [rip+2]; jmp +0 (nop sled)
        `<syscall_gadget at RVA 0x${ntdll.syscallGadgetRva.toString(16)}>`,
      ].join(' ');

      return {
        success: true,
        functionName,
        ssn: entry.ssn,
        usage:
          `To invoke ${functionName} directly:\n` +
          `1. Allocate an RWX page (VirtualAlloc)\n` +
          `2. Copy the stub + gadget address into the page\n` +
          `3. Call the stub as a function pointer\n` +
          `SSN: 0x${entry.ssn.toString(16).padStart(4, '0')} (${entry.ssn})\n` +
          `Stub: ${stubHex}\n` +
          `Gadget RVA: 0x${ntdll.syscallGadgetRva.toString(16)}`,
        note:
          'Direct syscall invocation bypasses user-mode hooks (EDR/EAV) placed on ntdll.dll. ' +
          'Syscall numbers are OS-build-specific and may change across Windows versions. ' +
          'Use resolveNtdll() once per boot and cache the result.',
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
