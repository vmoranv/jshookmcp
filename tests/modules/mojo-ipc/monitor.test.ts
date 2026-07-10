import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { MojoMonitor, parseFridaMessage } from '@modules/mojo-ipc/MojoMonitor';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code?: number) => void) => {
      if (event === 'close') cb(1);
    }),
  })),
  execFile: vi.fn(() => ({
    stdin: { end: vi.fn() },
  })),
}));

const mockSpawn = vi.mocked(spawn);

describe('MojoMonitor', () => {
  let monitor: MojoMonitor;

  beforeEach(() => {
    monitor = new MojoMonitor();
    vi.clearAllMocks();
  });

  it('starts as unavailable when frida cannot be probed', async () => {
    await monitor.start('chrome');
    expect(monitor.isAvailable()).toBe(false);
    expect(monitor.isActive()).toBe(false);
  });

  it('returns default interfaces', async () => {
    const interfaces = await monitor.listInterfaces();
    expect(interfaces.length).toBeGreaterThan(0);
  });

  it('returns empty message payload when inactive', async () => {
    const result = await monitor.getMessages();
    expect(result).toMatchObject({ messages: [], totalAvailable: 0, filtered: false });
  });

  it('records messages only when active', async () => {
    (monitor as any).active = true;
    monitor.recordMessage({
      timestamp: Date.now(),
      sourcePid: 1,
      targetPid: 2,
      interfaceName: 'network.mojom.NetworkService',
      messageType: 'CreateLoaderAndStart',
      payload: '0001',
      size: 4,
    });
    const result = await monitor.getMessages();
    expect(result.messages).toHaveLength(1);
  });

  it('filters messages by type, timestamp, and payload hex substring', async () => {
    (monitor as any).active = true;
    monitor.recordMessage({
      timestamp: 1000,
      sourcePid: 1,
      targetPid: 2,
      interfaceName: 'network.mojom.NetworkService',
      messageType: '7',
      payload: '0001',
      size: 2,
    });
    monitor.recordMessage({
      timestamp: 2000,
      sourcePid: 1,
      targetPid: 2,
      interfaceName: 'network.mojom.NetworkService',
      messageType: '7',
      payload: 'aabbccdd',
      size: 4,
    });
    monitor.recordMessage({
      timestamp: 3000,
      sourcePid: 1,
      targetPid: 2,
      interfaceName: 'blink.mojom.WidgetHost',
      messageType: '8',
      payload: 'aabbccdd',
      size: 4,
    });

    const result = await monitor.getMessages({
      messageType: 7,
      sinceTimestamp: 1500,
      hexSearch: 'BB CC',
    });

    expect(result.filtered).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      timestamp: 2000,
      messageType: '7',
      payload: 'aabbccdd',
    });
  });

  it('stops and clears buffered messages', async () => {
    (monitor as any).active = true;
    monitor.recordMessage({
      timestamp: Date.now(),
      sourcePid: 1,
      targetPid: 2,
      interfaceName: 'network.mojom.NetworkService',
      messageType: 'CreateLoaderAndStart',
      payload: '0001',
      size: 4,
    });
    await monitor.stop();
    expect(monitor.isActive()).toBe(false);
    const result = await monitor.getMessages();
    expect(result.messages).toEqual([]);
  });

  it('uses the frida cli probe and stays simulated when capture posts no messages', async () => {
    // 1st spawn = frida --version probe (succeeds); 2nd spawn = capture script (no messages)
    mockSpawn
      .mockImplementationOnce(
        () =>
          ({
            stdout: {
              on: vi.fn((event: string, cb: (data: Buffer) => void) => {
                if (event === 'data') cb(Buffer.from('16.0.0'));
              }),
            },
            on: vi.fn((event: string, cb: (code?: number) => void) => {
              if (event === 'close') cb(0);
            }),
          }) as any,
      )
      .mockImplementationOnce(
        () =>
          ({
            stdout: { setEncoding: vi.fn(), on: vi.fn() },
            stdin: { end: vi.fn() },
            on: vi.fn((event: string, cb: (code?: number) => void) => {
              if (event === 'close') cb(0);
            }),
            kill: vi.fn(),
          }) as any,
      );
    await monitor.start('chrome');
    expect(mockSpawn).toHaveBeenCalled();
    // No mojo-message arrived → still simulated, not live.
    expect(monitor.isSimulationMode()).toBe(true);
    expect(monitor.isLiveCapture()).toBe(false);
  });

  it('flips to live capture when the Frida script posts a real mojo message', async () => {
    (monitor as any).active = true;
    mockSpawn.mockImplementationOnce(() => {
      const handlers: Record<string, ((arg: unknown) => void) | undefined> = {};
      queueMicrotask(() => {
        handlers['data']?.(
          Buffer.from(
            JSON.stringify({
              type: 'send',
              payload: { type: 'mojo-message', hex: 'deadbeef', size: 4 },
            }) + '\n',
          ),
        );
        handlers['close']?.(0);
      });
      return {
        stdout: {
          setEncoding: vi.fn(),
          on: vi.fn((event: string, cb: (arg: unknown) => void) => {
            handlers[event] = cb;
          }),
        },
        stdin: { end: vi.fn() },
        on: vi.fn((event: string, cb: (arg: unknown) => void) => {
          handlers[event] = cb;
        }),
        kill: vi.fn(),
      } as any;
    });
    await (monitor as any).captureWithFrida('chrome');
    expect(monitor.isSimulationMode()).toBe(false);
    expect(monitor.isLiveCapture()).toBe(true);
    const result = await monitor.getMessages();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ payload: 'deadbeef' });
  });

  it('marks probe succeeded on mojo-hook-attached but stays simulated until a message', async () => {
    (monitor as any).active = true;
    mockSpawn.mockImplementationOnce(() => {
      const handlers: Record<string, ((arg: unknown) => void) | undefined> = {};
      queueMicrotask(() => {
        handlers['data']?.(
          Buffer.from(
            JSON.stringify({
              type: 'send',
              payload: {
                type: 'mojo-hook-attached',
                module: 'chrome.dll',
                symbol: 'MojoWriteMessage',
              },
            }) + '\n',
          ),
        );
        handlers['close']?.(0);
      });
      return {
        stdout: {
          setEncoding: vi.fn(),
          on: vi.fn((event: string, cb: (arg: unknown) => void) => {
            handlers[event] = cb;
          }),
        },
        stdin: { end: vi.fn() },
        on: vi.fn((event: string, cb: (arg: unknown) => void) => {
          handlers[event] = cb;
        }),
        kill: vi.fn(),
      } as any;
    });
    await (monitor as any).captureWithFrida('chrome');
    expect(monitor.didFridaProbeSucceed()).toBe(true);
    // Hook attached but no message yet → still simulated, not live.
    expect(monitor.isSimulationMode()).toBe(true);
    expect(monitor.isLiveCapture()).toBe(false);
  });
});

describe('parseFridaMessage', () => {
  it('parses CLI-wrapped send payloads', () => {
    const line = JSON.stringify({
      type: 'send',
      payload: { type: 'mojo-message', hex: 'ab', size: 1 },
    });
    expect(parseFridaMessage(line)).toMatchObject({ type: 'mojo-message', hex: 'ab', size: 1 });
  });

  it('parses bare mojo-* payload objects', () => {
    const line = JSON.stringify({
      type: 'mojo-hook-attached',
      module: 'chrome.dll',
      symbol: 'MojoWriteMessage',
    });
    expect(parseFridaMessage(line)).toMatchObject({
      type: 'mojo-hook-attached',
      symbol: 'MojoWriteMessage',
    });
  });

  it('returns null for non-JSON diagnostic lines', () => {
    expect(parseFridaMessage('Spawned, resuming main thread!')).toBeNull();
  });

  it('returns null for unrelated JSON', () => {
    expect(parseFridaMessage(JSON.stringify({ type: 'other' }))).toBeNull();
  });
});
