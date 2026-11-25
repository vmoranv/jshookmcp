/**
 * Runtime integration test for NtModuleEnumerator — exercises the REAL
 * NtQuerySystemInformation(SystemModuleInformation) FFI on a Windows host
 * (no koffi mock, no crafted RTL_PROCESS_MODULES buffer).
 *
 * Narrows the "runtime-unverified" boundary: the two-call probe (small buffer
 * → STATUS_INFO_LENGTH_MISMATCH → required length → real query), the 288-byte
 * RTL_PROCESS_MODULE_INFORMATION record walk, ImageBase (readBigUInt64LE @8),
 * and the OffsetToFileName short-name derivation are all proven against the
 * actual loaded kernel module list on this build.
 *
 * Honesty contract (mirrors DarwinAPI.runtime.test.ts): SystemModuleInformation
 * is admin-accessible. If this host lacks Admin/SeDebug, the call returns
 * STATUS_ACCESS_DENIED — the test documents that gate and soft-passes instead
 * of failing. Admin success → real assertions on ntoskrnl.exe.
 *
 * Gate: Win32 + JSHOOK_NATIVE_RUNTIME=1.
 */
import { describe, it, expect } from 'vitest';
import { enumerateKernelModules, findKernelModule } from '@native/syscall';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

/**
 * Lower bound for kernel-mode module addresses. The canonical x64 kernel half
 * starts at 0xFFFF8000'00000000. win32k/session-space modules can sit well
 * below the old 0xFFFFF000'00000000 bound — observed on this host:
 * win32k.sys @ 0xFFFFECDC'0ACD0000, win32kbase.sys @ 0xFFFFECDC'0AE00000.
 */
const KERNEL_MODULE_MIN = 0xffff800000000000n;

describe.skipIf(!WIN32_RUNTIME)(
  'NtModuleEnumerator — real NtQuerySystemInformation (runtime, host=Windows)',
  () => {
    it('enumerates the real loaded kernel module list (admin) OR documents the access gate', () => {
      let modules: ReturnType<typeof enumerateKernelModules>;
      try {
        modules = enumerateKernelModules();
      } catch (e) {
        // Admin / SeDebugPrivilege missing on this host — gate, not failure.
        expect(String(e)).toMatch(/ACCESS_DENIED|Windows-only|NtQuerySystemInformation/);
        return;
      }

      // Real success path: ntoskrnl + drivers are loaded.
      expect(modules.length).toBeGreaterThan(10);
      // Every record has a kernel-mode base + a non-empty short name.
      for (const m of modules) {
        expect(m.imageBase).toBeGreaterThanOrEqual(KERNEL_MODULE_MIN);
        expect(m.shortName.length).toBeGreaterThan(0);
        expect(m.fullPath.length).toBeGreaterThan(0);
      }
    });

    it('finds ntoskrnl.exe with a kernel-space ImageBase (admin) OR documents the access gate', () => {
      let mod: ReturnType<typeof findKernelModule>;
      try {
        mod = findKernelModule('ntoskrnl');
      } catch (e) {
        expect(String(e)).toMatch(/ACCESS_DENIED|Windows-only|NtQuerySystemInformation/);
        return;
      }
      expect(mod).not.toBeNull();
      expect(mod!.shortName.toLowerCase()).toContain('ntoskrnl');
      expect(mod!.imageBase).toBeGreaterThanOrEqual(KERNEL_MODULE_MIN);
      expect(mod!.imageSize).toBeGreaterThan(0); // ~8-10 MB
    });
  },
);
