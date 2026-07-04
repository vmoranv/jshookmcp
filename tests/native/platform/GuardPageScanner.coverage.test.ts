/**
 * Coverage tests for GuardPageScanner.scanGuardPages — exercises the
 * platform-api region-walk: open failure, region iteration, guard-flag
 * detection, timeout/maxRegions truncation, and query failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanGuardPages } from '@native/platform/GuardPageScanner';
import { MemoryProtection } from '@native/platform/types';

function makeApi(over: Record<string, unknown> = {}) {
  return {
    openProcess: vi.fn(() => ({})),
    closeProcess: vi.fn(),
    queryRegion: vi.fn(() => null),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scanGuardPages', () => {
  it('returns empty when openProcess throws', async () => {
    const api = makeApi({
      openProcess: () => {
        throw new Error('EPERM');
      },
    });
    const r = await scanGuardPages(api, 999);
    expect(r.guardPages).toEqual([]);
    expect(r.stats.scannedRegions).toBe(0);
  });

  it('breaks cleanly when queryRegion returns null immediately', async () => {
    const api = makeApi({ queryRegion: vi.fn(() => null) });
    const r = await scanGuardPages(api, 1);
    expect(r.guardPages).toEqual([]);
    expect(api.closeProcess).toHaveBeenCalled();
  });

  it('collects regions whose protection has the Guard flag', async () => {
    let call = 0;
    const regions = [
      { baseAddress: 0x1000n, size: 4096, protection: MemoryProtection.Guard },
      { baseAddress: 0x2000n, size: 4096, protection: MemoryProtection.ReadWrite },
      {
        baseAddress: 0x3000n,
        size: 4096,
        protection: MemoryProtection.Guard | MemoryProtection.Read,
      },
    ];
    const api = makeApi({
      queryRegion: vi.fn(() => regions[call++] ?? null),
    });
    const r = await scanGuardPages(api, 1);
    expect(r.guardPages).toHaveLength(2); // 2 guard regions
    expect(r.guardPages[0]?.address).toBe('0x1000');
    expect(r.guardPages[1]?.address).toBe('0x3000');
    expect(r.stats.scannedRegions).toBe(3);
  });

  it('truncates when maxRegions is reached', async () => {
    let call = 0;
    const api = makeApi({
      queryRegion: vi.fn(() => {
        const base = BigInt(call) * 0x1000n;
        call++;
        return { baseAddress: base, size: 4096, protection: 0 };
      }),
    });
    const r = await scanGuardPages(api, 1, 3, 5000);
    expect(r.stats.truncated).toBe(true);
    expect(r.stats.scannedRegions).toBe(3);
  });

  it('reports queryFailures when queryRegion throws mid-scan', async () => {
    let call = 0;
    const api = makeApi({
      queryRegion: vi.fn(() => {
        call++;
        if (call === 2) throw new Error('query failed');
        return { baseAddress: BigInt(call) * 0x1000n, size: 4096, protection: 0 };
      }),
    });
    const r = await scanGuardPages(api, 1);
    expect(r.stats.queryFailures).toBeGreaterThanOrEqual(1);
    expect(api.closeProcess).toHaveBeenCalled();
  });
});
