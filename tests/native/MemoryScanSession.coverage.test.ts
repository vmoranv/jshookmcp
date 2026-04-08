/**
 * MemoryScanSession coverage tests — exercise uncovered branches.
 *
 * Gaps in the main test suite:
 *  - listSessions(): age formatting with minutes > 0 vs seconds only
 *  - importSession(): previousValues with non-string entries (skipped)
 *  - importSession(): addresses with non-string entries (skipped)
 *  - importSession(): uses default alignment when parsed.alignment is undefined
 *  - importSession(): scanCount defaults to 0 when absent
 *  - exportSession(): throws when session not found
 *  - exportSession(): throws when session expired
 *  - importSession(): handles empty previousValues array
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryScanSessionManager } from '../../src/native/MemoryScanSession';

describe('MemoryScanSessionManager coverage: listSessions() — age formatting', () => {
  let manager: MemoryScanSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    // Use a very long TTL so sessions don't expire during the test
    manager = new MemoryScanSessionManager(4, 999999999); // effectively no TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats age with seconds only when age < 1 minute', () => {
    manager.createSession(1234, { valueType: 'int32' });
    // Advance time by 30 seconds
    vi.advanceTimersByTime(30_000);

    const sessions = manager.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.age).toMatch(/^\d+s$/);
    expect(sessions[0]!.age).not.toContain('m');
  });

  it('formats age with minutes when age >= 1 minute', () => {
    manager.createSession(1234, { valueType: 'int32' });
    // Advance time by 90 seconds
    vi.advanceTimersByTime(90_000);

    const sessions = manager.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.age).toMatch(/^\d+m\d+s$/);
  });

  it('reports addressCount in session summary', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    manager.updateSession(
      id,
      [0x100n, 0x200n, 0x300n],
      new Map([
        [0x100n, Buffer.from([1, 0, 0, 0])],
        [0x200n, Buffer.from([2, 0, 0, 0])],
        [0x300n, Buffer.from([3, 0, 0, 0])],
      ]),
    );

    const sessions = manager.listSessions();
    expect(sessions[0]!.addressCount).toBe(3);
    expect(sessions[0]!.scanCount).toBe(1);
  });
});

describe('MemoryScanSessionManager coverage: importSession() — edge cases', () => {
  let manager: MemoryScanSessionManager;

  beforeEach(() => {
    manager = new MemoryScanSessionManager(4, 60000);
  });

  it('uses default alignment when parsed.alignment is undefined', () => {
    const data = JSON.stringify({
      pid: 9999,
      valueType: 'int32',
      addresses: [],
      previousValues: [],
    });
    const id = manager.importSession(data);
    const session = manager.getSession(id);
    expect(session.alignment).toBe(4); // default
  });

  it('defaults scanCount to 0 when absent', () => {
    const data = JSON.stringify({
      pid: 9999,
      valueType: 'float',
      addresses: [],
      previousValues: [],
    });
    const id = manager.importSession(data);
    const session = manager.getSession(id);
    expect(session.scanCount).toBe(0);
  });

  it('skips previousValues entries with non-string address', () => {
    const data = JSON.stringify({
      pid: 9999,
      valueType: 'int32',
      addresses: [],
      previousValues: [
        [123, 'deadbeef'], // number instead of string — should be skipped
        ['0x1000', 'ff'],
      ],
    });
    const id = manager.importSession(data);
    const session = manager.getSession(id);
    expect(session.previousValues.size).toBe(1); // only the valid entry
    expect(session.previousValues.has(0x1000n)).toBe(true);
  });

  it('skips previousValues entries with non-string hex', () => {
    const data = JSON.stringify({
      pid: 9999,
      valueType: 'int32',
      addresses: [],
      previousValues: [
        ['0x1000', 999], // number instead of string — should be skipped
      ],
    });
    const id = manager.importSession(data);
    const session = manager.getSession(id);
    expect(session.previousValues.size).toBe(0);
  });

  it('skips addresses with non-string entries', () => {
    const data = JSON.stringify({
      pid: 9999,
      valueType: 'int32',
      addresses: [123, '0x2000', null],
      previousValues: [],
    });
    const id = manager.importSession(data);
    const session = manager.getSession(id);
    expect(session.addresses).toHaveLength(1);
    expect(session.addresses[0]).toBe(0x2000n);
  });

  it('handles empty previousValues array', () => {
    const data = JSON.stringify({
      pid: 8888,
      valueType: 'byte',
      addresses: ['0x1000'],
      previousValues: [],
    });
    const id = manager.importSession(data);
    const session = manager.getSession(id);
    expect(session.previousValues.size).toBe(0);
    expect(session.addresses).toEqual([0x1000n]);
  });

  it('uses createdAt = lastScanAt = now on import (not from serialized data)', () => {
    const data = JSON.stringify({
      pid: 7777,
      valueType: 'int64',
      addresses: [],
      previousValues: [],
    });
    const before = Date.now();
    const id = manager.importSession(data);
    const after = Date.now();
    const session = manager.getSession(id);
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
  });
});

describe('MemoryScanSessionManager coverage: exportSession() — error branches', () => {
  let manager: MemoryScanSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new MemoryScanSessionManager(4, 5000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when exporting non-existent session', () => {
    expect(() => manager.exportSession('nonexistent')).toThrow('Scan session not found');
  });

  it('throws when exporting expired session', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    vi.advanceTimersByTime(6000);
    expect(() => manager.exportSession(id)).toThrow('Scan session expired');
  });
});

describe('MemoryScanSessionManager coverage: getSession() — expired path', () => {
  let manager: MemoryScanSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new MemoryScanSessionManager(4, 5000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getSession deletes expired session before throwing', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    vi.advanceTimersByTime(6000);

    expect(() => manager.getSession(id)).toThrow('Scan session expired');
    // Session should be deleted from map
    expect(manager.deleteSession(id)).toBe(false);
  });
});
