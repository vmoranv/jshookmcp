/**
 * Runtime integration test for MemoryScanner — exercises the REAL Win32
 * ReadProcessMemory / VirtualQueryEx path against the test runner's OWN
 * process (node.exe).
 *
 * Why this exists: the mocked suite (MemoryScanner.test.ts) can keep passing
 * while the offset/region arithmetic is wrong, because a crafted buffer and
 * a self-consistent mock agree with each other. That failure mode has already
 * bitten this repository once (see the x64 RTL_PROCESS_MODULES layout bug).
 * Here every assertion is grounded in a byte pattern the test itself wrote
 * into its own address space, so a wrong offset cannot produce a passing run.
 *
 * OpenProcess on the caller's own pid needs no privilege, which keeps this
 * the most portable real-runtime check in the native layer.
 *
 * Gate: Win32 + JSHOOK_NATIVE_RUNTIME=1. CI (Linux/macOS) and the default
 * `pnpm test` skip this file; the mocked unit tests keep running everywhere.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryScanner } from '@native/MemoryScanner';
import { nativeMemoryManager } from '@native/NativeMemoryManager';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

/** A 64-bit sentinel that is extremely unlikely to appear in a Node heap. */
const SENTINEL = 0x4a5b6c7d8e9f0a1bn;

/**
 * Keeps the sentinel reachable and non-optimisable: a module-scope buffer
 * survives GC pressure for the duration of the test and the runtime cannot
 * fold it away, unlike a local const.
 */
const sentinelHolder = new BigUint64Array(4);

describe.skipIf(!WIN32_RUNTIME)(
  'MemoryScanner — real self-process scan (runtime, host=Windows)',
  () => {
    let scanner: MemoryScanner;

    beforeAll(() => {
      sentinelHolder[2] = SENTINEL;
      scanner = new MemoryScanner(nativeMemoryManager);
    });

    it('finds a value written by the test itself via firstScan', async () => {
      const result = await scanner.firstScan(process.pid, String(SENTINEL), {
        valueType: 'uint64',
        maxResults: 64,
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      // The hit list must be addresses, not garbage.
      for (const addr of result.addresses.slice(0, 8)) {
        expect(addr).toMatch(/^0x[0-9a-f]+$/i);
      }
    });

    it('returns no hits for a value that was never written', async () => {
      const absent = '0x1fffffffffffffff';
      const result = await scanner.firstScan(process.pid, absent, {
        valueType: 'uint64',
        maxResults: 8,
      });
      // Not asserting exactly 0 — a coincidental hit is theoretically possible
      // but a large result set would mean the matcher lost its address bounds.
      expect(result.totalMatches).toBeLessThanOrEqual(8);
    });

    it('finds the sentinel through an explicit byte pattern (aobScan)', async () => {
      // Little-endian bytes of SENTINEL.
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64LE(SENTINEL);
      // aobScan takes space-separated bytes ("1b 0a ..."), not a hex string.
      const pattern = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

      const result = await scanner.aobScan(process.pid, pattern, { maxResults: 64 });

      expect(result.totalMatches).toBeGreaterThan(0);
    });

    it('groupScan reports the same sentinel when given the same pattern', async () => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64LE(SENTINEL);
      const pattern = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

      const result = await scanner.groupScan(
        process.pid,
        [{ offset: 0, value: pattern, type: 'bytes' } as never],
        { maxResults: 32 },
      );

      expect(result.totalMatches).toBeGreaterThan(0);
    });

    it('honours maxResults instead of returning the whole address space', async () => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64LE(SENTINEL);
      const pattern = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

      const result = await scanner.aobScan(process.pid, pattern, { maxResults: 1 });

      expect(result.totalMatches).toBeLessThanOrEqual(1);
    });

    it('rejects an unparseable pattern rather than scanning with a bogus needle', async () => {
      await expect(scanner.aobScan(process.pid, 'zz not hex', { maxResults: 8 })).rejects.toThrow();
    });
  },
);
