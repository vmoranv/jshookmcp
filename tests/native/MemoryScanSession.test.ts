import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryScanSessionManager } from '../../src/native/MemoryScanSession';

describe('MemoryScanSessionManager', () => {
  let manager: MemoryScanSessionManager;

  beforeEach(() => {
    manager = new MemoryScanSessionManager(4, 5000); // max 4 sessions, 5s TTL
  });

  it('creates and retrieves a session', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const session = manager.getSession(id);
    expect(session.pid).toBe(1234);
    expect(session.valueType).toBe('int32');
    expect(session.alignment).toBe(4); // natural alignment for int32
    expect(session.scanCount).toBe(0);
    expect(session.addresses).toEqual([]);
  });

  it('updates session with new scan results', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    const addresses = [0x100n, 0x200n, 0x300n];
    const values = new Map<bigint, Buffer>();
    values.set(0x100n, Buffer.from([1, 0, 0, 0]));
    values.set(0x200n, Buffer.from([2, 0, 0, 0]));

    manager.updateSession(id, addresses, values);

    const session = manager.getSession(id);
    expect(session.addresses).toEqual(addresses);
    expect(session.scanCount).toBe(1);
    expect(session.previousValues.size).toBe(2);
  });

  it('lists all active sessions', () => {
    manager.createSession(1234, { valueType: 'int32' });
    manager.createSession(5678, { valueType: 'float' });

    const sessions = manager.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0]!.pid).toBe(1234);
    expect(sessions[1]!.pid).toBe(5678);
    expect(sessions[0]!.valueType).toBe('int32');
    expect(sessions[1]!.valueType).toBe('float');
  });

  it('deletes a session', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    expect(manager.deleteSession(id)).toBe(true);
    expect(manager.deleteSession(id)).toBe(false);
    expect(() => manager.getSession(id)).toThrow('Scan session not found');
  });

  it('throws on non-existent session', () => {
    expect(() => manager.getSession('nonexistent')).toThrow('Scan session not found');
  });

  it('expires sessions after TTL', async () => {
    vi.useFakeTimers();
    const id = manager.createSession(1234, { valueType: 'int32' });

    // Access within TTL should work
    expect(() => manager.getSession(id)).not.toThrow();

    // Advance past TTL
    vi.advanceTimersByTime(6000);

    expect(() => manager.getSession(id)).toThrow('Scan session expired');
    vi.useRealTimers();
  });

  it('enforces max session limit with LRU eviction', () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(manager.createSession(i, { valueType: 'int32' }));
    }

    // First session should have been evicted
    expect(() => manager.getSession(ids[0]!)).toThrow('Scan session not found');
    // Latest sessions should still exist
    expect(() => manager.getSession(ids[4]!)).not.toThrow();
  });

  it('cleanup removes expired sessions', () => {
    vi.useFakeTimers();
    manager.createSession(1234, { valueType: 'int32' });
    manager.createSession(5678, { valueType: 'float' });

    vi.advanceTimersByTime(6000);
    const cleaned = manager.cleanup();
    expect(cleaned).toBe(2);
    expect(manager.listSessions().length).toBe(0);
    vi.useRealTimers();
  });

  it('export/import roundtrip preserves data', () => {
    const id = manager.createSession(1234, { valueType: 'int32' });
    const addresses = [0xabcn, 0xdefn];
    const values = new Map<bigint, Buffer>();
    values.set(0xabcn, Buffer.from([10, 0, 0, 0]));
    manager.updateSession(id, addresses, values);

    const exported = manager.exportSession(id);
    expect(typeof exported).toBe('string');

    const newId = manager.importSession(exported);
    expect(newId).not.toBe(id); // new ID

    const imported = manager.getSession(newId);
    expect(imported.pid).toBe(1234);
    expect(imported.valueType).toBe('int32');
    // After export/import roundtrip, addresses are re-parsed from hex strings
    expect(imported.addresses).toEqual(addresses);
    expect(imported.previousValues.get(0xabcn)).toEqual(Buffer.from([10, 0, 0, 0]));
  });

  it('respects custom alignment in options', () => {
    const id = manager.createSession(1234, { valueType: 'int32', alignment: 16 });
    const session = manager.getSession(id);
    expect(session.alignment).toBe(16);
  });
});
