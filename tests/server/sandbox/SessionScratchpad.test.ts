import { describe, it, expect } from 'vitest';
import { SessionScratchpad } from '@server/sandbox/SessionScratchpad';

describe('SessionScratchpad', () => {
  it('persists values across get/set calls', () => {
    const pad = new SessionScratchpad();
    pad.set('session1', 'counter', 42);
    expect(pad.get('session1', 'counter')).toBe(42);
  });

  it('isolates sessions — different sessionIds do not share state', () => {
    const pad = new SessionScratchpad();
    pad.set('session1', 'key', 'value1');
    pad.set('session2', 'key', 'value2');

    expect(pad.get('session1', 'key')).toBe('value1');
    expect(pad.get('session2', 'key')).toBe('value2');
  });

  it('returns undefined for non-existent keys', () => {
    const pad = new SessionScratchpad();
    expect(pad.get('session1', 'missing')).toBeUndefined();
  });

  it('returns undefined for non-existent sessions', () => {
    const pad = new SessionScratchpad();
    expect(pad.get('nosession', 'key')).toBeUndefined();
  });

  it('clear removes all state for a session', () => {
    const pad = new SessionScratchpad();
    pad.set('session1', 'a', 1);
    pad.set('session1', 'b', 2);
    pad.clear('session1');

    expect(pad.get('session1', 'a')).toBeUndefined();
    expect(pad.get('session1', 'b')).toBeUndefined();
  });

  it('clear does not affect other sessions', () => {
    const pad = new SessionScratchpad();
    pad.set('session1', 'key', 'v1');
    pad.set('session2', 'key', 'v2');
    pad.clear('session1');

    expect(pad.get('session2', 'key')).toBe('v2');
  });

  it('serializes/deserializes values via JSON', () => {
    const pad = new SessionScratchpad();
    const obj = { nested: { arr: [1, 2, 3] } };
    pad.set('s1', 'data', obj);

    const retrieved = pad.get('s1', 'data');
    expect(retrieved).toEqual(obj);
    // Ensure it's a new object (not reference equality)
    expect(retrieved).not.toBe(obj);
  });

  it('getAll returns all key/value pairs for a session', () => {
    const pad = new SessionScratchpad();
    pad.set('s1', 'a', 1);
    pad.set('s1', 'b', 'hello');
    pad.set('s2', 'c', 3);

    expect(pad.getAll('s1')).toEqual({ a: 1, b: 'hello' });
    expect(pad.getAll('s2')).toEqual({ c: 3 });
  });

  it('getAll returns empty object for non-existent session', () => {
    const pad = new SessionScratchpad();
    expect(pad.getAll('nosession')).toEqual({});
  });

  it('keys returns all keys for a session', () => {
    const pad = new SessionScratchpad();
    pad.set('s1', 'x', 1);
    pad.set('s1', 'y', 2);

    expect(pad.keys('s1').toSorted()).toEqual(['x', 'y']);
    expect(pad.keys('nosession')).toEqual([]);
  });

  it('clearAll wipes everything', () => {
    const pad = new SessionScratchpad();
    pad.set('s1', 'a', 1);
    pad.set('s2', 'b', 2);
    pad.clearAll();

    expect(pad.getAll('s1')).toEqual({});
    expect(pad.getAll('s2')).toEqual({});
  });
});
