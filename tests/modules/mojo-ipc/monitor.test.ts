import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { MojoMonitor } from '@modules/mojo-ipc/MojoMonitor';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code?: number) => void) => {
      if (event === 'close') cb(1);
    }),
  })),
  execFile: vi.fn(),
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

  it('uses the frida cli probe when available', async () => {
    mockSpawn.mockImplementationOnce(
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
    );
    await monitor.start('chrome');
    expect(mockSpawn).toHaveBeenCalled();
  });
});
