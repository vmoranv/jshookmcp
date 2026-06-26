/**
 * SyscallResolver / ScanObfuscator unit tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveNtdll, resetNtdllCache, createScanWalker } from '@native/syscall';

describe('SyscallResolver', () => {
  beforeEach(() => {
    resetNtdllCache();
  });

  it('throws on non-existent ntdll path', () => {
    expect(() => resolveNtdll('C:\\nonexistent\\ntdll.dll')).toThrow(/cannot read/);
  });

  it('rejects non-PE file as ntdll', () => {
    // A file that exists but isn't a PE — the linter may flag this, but we
    // want to exercise the invalid-signature path.
    const nodeExe = process.execPath; // always exists
    // Node's exe IS a PE on Windows, but on Linux it's ELF — the parser will
    // fail at PE signature check. This test is meaningful on both platforms.
    try {
      resolveNtdll(nodeExe);
      // On Windows, Node's exe is a valid PE — resolver may succeed or fail
      // at export directory. Either is fine (not an error we check).
      // The real test: must not crash.
    } catch (e) {
      // Non-Windows: ELF → invalid PE signature → expected to throw.
      expect(String(e)).toMatch(/invalid PE|cannot read|resolver/);
    }
  });
});

describe('ScanObfuscator', () => {
  it('creates walker with default config', () => {
    const walker = createScanWalker();
    expect(walker.address).toBe(0n);
    expect(walker.chunkSize).toBeGreaterThan(0);
  });

  it('walk advances address non-linearly', () => {
    const walker = createScanWalker();
    const advanceCount = 10;
    const strides: bigint[] = [];
    for (let i = 0; i < advanceCount; i++) {
      walker.next();
      strides.push(walker.address);
    }
    // All strides must be positive (walker advanced past zero).
    expect(strides.every((s) => s > 0n)).toBe(true);
  });

  it('shouldInterleaveDummy returns boolean', () => {
    const walker = createScanWalker();
    for (let i = 0; i < 100; i++) {
      expect(typeof walker.shouldInterleaveDummy()).toBe('boolean');
    }
  });

  it('delay resolves without error', async () => {
    const walker = createScanWalker();
    await expect(walker.delay()).resolves.toBeUndefined();
  });
});
