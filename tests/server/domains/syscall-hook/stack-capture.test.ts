import { describe, expect, it } from 'vitest';
import { handleSyscallStackCapture } from '@server/domains/syscall-hook/handlers/stack-capture';
import type { SyscallEvent } from '@modules/syscall-hook';

function makeEvent(syscall: string, args: string[] = [], timestamp = 0): SyscallEvent {
  return { timestamp, pid: 1234, syscall, args };
}

describe('handleSyscallStackCapture', () => {
  it('falls back to heuristics when no debugger is attached', async () => {
    const events: SyscallEvent[] = [
      makeEvent('openat', ['path=/x.js']),
      makeEvent('read', ['fd=3']),
    ];

    const result = await handleSyscallStackCapture({}, events);

    expect(result.success).toBe(true);
    expect(result.eventCount).toBe(2);
    expect(result.mode).toBe('heuristic');
    expect(result.withStacks).toBe(0);
    // Both events map heuristically (openat→fs.open, read→fs.readFile).
    expect(result.withHeuristicsOnly).toBe(2);
    expect(result.events.every((c) => c.mapped !== undefined)).toBe(true);
  });

  it('respects maxEvents to analyze only the tail', async () => {
    const events: SyscallEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent('openat', [`path=/f${i}.js`], i));
    }

    const result = await handleSyscallStackCapture({ maxEvents: 3 }, events);

    expect(result.eventCount).toBe(3);
  });

  it('handles an empty event list cleanly', async () => {
    const result = await handleSyscallStackCapture({}, []);
    expect(result.success).toBe(true);
    expect(result.eventCount).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.mode).toBe('heuristic');
  });

  it('attributes events to the live debugger frame when one is paused', async () => {
    // Synthesize a MCPServerContext with a paused debugger whose top frame is
    // `app.handleRequest`. tryGetJsStack reads getPausedState() synchronously,
    // so every event should be attributed to that frame and mode should be
    // 'debugger' (heuristic mapper still runs as complement, but withStacks>0
    // and any event that has a stack is not counted in withHeuristicsOnly).
    const events: SyscallEvent[] = [makeEvent('read', ['fd=3']), makeEvent('write', ['fd=4'])];
    const callFrames = [
      {
        callFrameId: 'cf-0',
        functionName: 'app.handleRequest',
        url: 'app.js',
        location: { scriptId: 's1', lineNumber: 10, columnNumber: 0 },
        scopeChain: [],
        this: undefined,
      },
    ];
    const fakeDebuggerManager = {
      getPausedState: () => ({ callFrames, reason: 'other' }),
    };
    const ctx = { debuggerManager: fakeDebuggerManager } as unknown as Parameters<
      typeof handleSyscallStackCapture
    >[2];

    const result = await handleSyscallStackCapture({ useDebugger: true }, events, ctx);

    expect(result.success).toBe(true);
    expect(result.withStacks).toBe(2);
    expect(result.events.every((c) => c.stack !== undefined)).toBe(true);
    const topFrame = result.events[0]?.stack?.[0];
    expect(topFrame?.functionName).toBe('app.handleRequest');
    expect(topFrame?.scriptUrl).toBe('app.js');
    expect(topFrame?.lineNumber).toBe(10);
  });

  it('returns no stack when debugger is not paused', async () => {
    const events: SyscallEvent[] = [makeEvent('read', ['fd=3'])];
    const fakeDebuggerManager = { getPausedState: () => null };
    const ctx = { debuggerManager: fakeDebuggerManager } as unknown as Parameters<
      typeof handleSyscallStackCapture
    >[2];

    const result = await handleSyscallStackCapture({ useDebugger: true }, events, ctx);

    expect(result.withStacks).toBe(0);
    expect(result.events.every((c) => c.stack === undefined)).toBe(true);
  });
});
