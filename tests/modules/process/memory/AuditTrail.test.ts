import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';

describe('MemoryAuditTrail', () => {
  let originalEnv: { USERNAME?: string; USER?: string };

  beforeEach(() => {
    originalEnv = {
      USERNAME: process.env.USERNAME,
      USER: process.env.USER,
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.USERNAME = originalEnv.USERNAME;
    process.env.USER = originalEnv.USER;
    vi.useRealTimers();
  });

  it('records entries and reports correct size', () => {
    const trail = new MemoryAuditTrail();

    trail.record({
      operation: 'memory_read',
      pid: 1234,
      address: '0x1000',
      size: 4,
      result: 'success',
      durationMs: 10,
    });

    expect(trail.size()).toBe(1);
  });

  it('exports entries as JSON', () => {
    const trail = new MemoryAuditTrail();

    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    process.env.USERNAME = 'testuser';

    trail.record({
      operation: 'memory_write',
      pid: 5678,
      address: '0x2000',
      size: 8,
      result: 'success',
      durationMs: 5,
    });

    const exported = JSON.parse(trail.exportJson());
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      operation: 'memory_write',
      pid: 5678,
      address: '0x2000',
      size: 8,
      result: 'success',
      durationMs: 5,
      timestamp: '2025-01-01T00:00:00.000Z',
      user: 'testuser',
    });
  });

  it('records optional fields like pattern and dllPath', () => {
    const trail = new MemoryAuditTrail();

    trail.record({
      operation: 'memory_scan',
      pid: 100,
      address: null,
      size: null,
      result: 'success',
      durationMs: 50,
      pattern: 'AA BB CC',
      resultsCount: 3,
    });

    trail.record({
      operation: 'inject_dll',
      pid: 200,
      address: null,
      size: null,
      result: 'failure',
      durationMs: 100,
      dllPath: 'C:\\temp\\test.dll',
      error: 'access denied',
    });

    const exported = JSON.parse(trail.exportJson());
    expect(exported).toHaveLength(2);
    expect(exported[0].pattern).toBe('AA BB CC');
    expect(exported[0].resultsCount).toBe(3);
    expect(exported[1].dllPath).toBe('C:\\temp\\test.dll');
    expect(exported[1].error).toBe('access denied');
  });

  it('clears all entries', () => {
    const trail = new MemoryAuditTrail();

    trail.record({
      operation: 'read',
      pid: 1,
      address: null,
      size: null,
      result: 'success',
      durationMs: 1,
    });
    trail.record({
      operation: 'write',
      pid: 2,
      address: null,
      size: null,
      result: 'success',
      durationMs: 2,
    });

    expect(trail.size()).toBe(2);

    trail.clear();

    expect(trail.size()).toBe(0);
    expect(JSON.parse(trail.exportJson())).toEqual([]);
  });

  it('wraps around when capacity is reached (ring buffer)', () => {
    const trail = new MemoryAuditTrail(3);

    for (let i = 1; i <= 5; i++) {
      trail.record({
        operation: `op_${i}`,
        pid: i,
        address: null,
        size: null,
        result: 'success',
        durationMs: i,
      });
    }

    expect(trail.size()).toBe(3);

    const exported = JSON.parse(trail.exportJson());
    expect(exported).toHaveLength(3);
    // The oldest entries (op_1, op_2) should be evicted; op_3, op_4, op_5 remain
    expect(exported.map((e: { operation: string }) => e.operation)).toEqual([
      'op_3',
      'op_4',
      'op_5',
    ]);
  });

  it('defaults invalid capacity to 5000', () => {
    const trail1 = new MemoryAuditTrail(0);
    const trail2 = new MemoryAuditTrail(-5);
    const trail3 = new MemoryAuditTrail(3.7);

    // All should fall back to 5000 capacity, so recording 1 entry always works
    for (const t of [trail1, trail2, trail3]) {
      t.record({
        operation: 'test',
        pid: 1,
        address: null,
        size: null,
        result: 'success',
        durationMs: 1,
      });
      expect(t.size()).toBe(1);
    }
  });

  it('uses USER env var when USERNAME is not set', () => {
    delete process.env.USERNAME;
    process.env.USER = 'linuxuser';

    const trail = new MemoryAuditTrail();
    trail.record({
      operation: 'test',
      pid: 1,
      address: null,
      size: null,
      result: 'success',
      durationMs: 1,
    });

    const exported = JSON.parse(trail.exportJson());
    expect(exported[0].user).toBe('linuxuser');
  });

  it('uses "unknown" when no user env vars are set', () => {
    delete process.env.USERNAME;
    delete process.env.USER;

    const trail = new MemoryAuditTrail();
    trail.record({
      operation: 'test',
      pid: 1,
      address: null,
      size: null,
      result: 'success',
      durationMs: 1,
    });

    const exported = JSON.parse(trail.exportJson());
    expect(exported[0].user).toBe('unknown');
  });

  it('exports empty JSON array when no entries exist', () => {
    const trail = new MemoryAuditTrail();
    expect(trail.exportJson()).toBe('[]');
  });
});
