/**
 * Runtime integration test for PointerChainEngine — exercises the REAL Win32
 * ReadProcessMemory pointer-chase path against the test runner's OWN process
 * (node.exe).
 *
 * Scope note: this file verifies the parts of the engine whose correctness is
 * observable from JS — chain walking (deref + offset arithmetic), the broken-
 * chain contract, and validation against a target address. It deliberately
 * does NOT try to build a synthetic multi-hop graph: a pointer-sized value can
 * appear in many heap slots (typed-array backing stores, handles, copies), so
 * "scan for the pointer value, treat every hit as a slot" produces ambiguous
 * roots and cannot be made deterministic from JS alone. That gap is stated
 * here rather than papered over with a flaky test.
 *
 * What IS covered, and why it would catch a real bug:
 *  - resolveChain with a chain rooted at a genuine in-process address holding
 *    a known 64-bit value: verifies readMemory addressing and offset addition.
 *  - resolveChain on an unmapped base: verifies the brokenAt contract.
 *  - validateChain agreeing with resolveChain on the same chain.
 *
 * Gate: Win32 + JSHOOK_NATIVE_RUNTIME=1. CI (Linux/macOS) and the default
 * `pnpm test` skip this file.
 */
import { describe, it, expect } from 'vitest';
import { PointerChainEngine } from '@native/PointerChainEngine';
import { MemoryScanner } from '@native/MemoryScanner';
import { nativeMemoryManager } from '@native/NativeMemoryManager';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

/** Distinctive 64-bit markers written into this process's own heap. */
const TARGET_MARKER = 0x5555666677778888n;

/** Module-scope holder keeps the marker alive and unoptimisable. */
const targetHolder = new BigUint64Array(2);

/** aobScan reports hits as `matches` (not the ScanResult `addresses` shape). */
type AobResult = { matches: string[]; totalMatches: number };

/** Space-separated AOB pattern for a 64-bit little-endian value. */
function aobOf(value: bigint): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Locate an address in this process currently holding `value`. */
async function locate(scanner: MemoryScanner, value: bigint): Promise<string> {
  const found = (await scanner.aobScan(process.pid, aobOf(value), {
    maxResults: 8,
  })) as unknown as AobResult;
  expect(found.matches.length).toBeGreaterThan(0);
  return found.matches[0]!;
}

describe.skipIf(!WIN32_RUNTIME)(
  'PointerChainEngine — real self-process pointer chase (runtime, host=Windows)',
  () => {
    it('dereferences a real in-process slot and applies link offsets', async () => {
      const scanner = new MemoryScanner(nativeMemoryManager);
      const engine = new PointerChainEngine();

      targetHolder[0] = TARGET_MARKER;
      const slotAddr = await locate(scanner, TARGET_MARKER);

      // The slot holds TARGET_MARKER; a zero-offset link resolves to exactly
      // that value, and a +0x10 link must shift it by 16.
      const baseChain = {
        id: 'zero',
        links: [{ address: slotAddr, offset: 0 }],
        targetAddress: slotAddr,
        baseAddress: slotAddr,
        isStatic: false,
        depth: 1,
        lastValidated: 0,
        isValid: true,
      };

      const resolvedBase = await engine.resolveChain(process.pid, baseChain);
      expect(resolvedBase).not.toBeNull();
      expect(String(resolvedBase).toLowerCase()).toBe(`0x${TARGET_MARKER.toString(16)}`);

      const shiftedChain = {
        ...baseChain,
        id: 'shifted',
        links: [{ address: slotAddr, offset: 0x10 }],
      };
      const resolvedShifted = await engine.resolveChain(process.pid, shiftedChain);
      expect(String(resolvedShifted).toLowerCase()).toBe(
        `0x${(TARGET_MARKER + 0x10n).toString(16)}`,
      );
    });

    it('reports a broken chain instead of throwing when the base is unmapped', async () => {
      const engine = new PointerChainEngine();

      const bogusChain = {
        id: 'bogus',
        links: [{ address: '0x1', offset: 0x10 }],
        targetAddress: '0x2',
        baseAddress: '0x1',
        isStatic: false,
        depth: 1,
        lastValidated: 0,
        isValid: true,
      };

      const result = await engine.validateChain(process.pid, bogusChain);

      expect(result.isValid).toBe(false);
      expect(result.resolvedAddress).toBeNull();
      expect(result.brokenAt).toBeDefined();

      // resolveChain must agree: a broken chain resolves to null, not a throw.
      const resolved = await engine.resolveChain(process.pid, bogusChain);
      expect(resolved).toBeNull();
    });

    it('marks a resolvable chain valid when targetAddress matches', async () => {
      const scanner = new MemoryScanner(nativeMemoryManager);
      const engine = new PointerChainEngine();

      targetHolder[1] = TARGET_MARKER;
      const slotAddr = await locate(scanner, TARGET_MARKER);

      // validateChain compares the RESOLVED address (the slot's content) with
      // targetAddress, so the expectation is the marker value, not the slot.
      const chain = {
        id: 'valid',
        links: [{ address: slotAddr, offset: 0 }],
        targetAddress: `0x${TARGET_MARKER.toString(16)}`,
        baseAddress: slotAddr,
        isStatic: false,
        depth: 1,
        lastValidated: 0,
        isValid: true,
      };

      const result = await engine.validateChain(process.pid, chain);
      expect(result.isValid).toBe(true);
      expect(result.brokenAt).toBeUndefined();
    });
  },
);
