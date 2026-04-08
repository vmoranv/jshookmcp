import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { SyscallMonitor } from '@modules/syscall-hook/SyscallMonitor';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn(),
  })),
}));

const mockSpawn = vi.mocked(spawn);

describe('SyscallMonitor', () => {
  let monitor: SyscallMonitor;

  beforeEach(() => {
    monitor = new SyscallMonitor();
    vi.clearAllMocks();
  });

  it('reports supported backends for the current platform', () => {
    expect(Array.isArray(monitor.getSupportedBackends())).toBe(true);
  });

  it('starts in simulation mode when requested', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats()).toHaveProperty('backend');
  });

  it('captures synthetic events after start', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    const events = await monitor.captureEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it('filters captured events by syscall name', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    const events = await monitor.captureEvents({ name: ['connect'] });
    expect(events.every((event) => event.syscall === 'connect')).toBe(true);
  });

  it('stops monitoring cleanly', async () => {
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: true,
    });
    await monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('falls back to simulation when subprocess capture fails', async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await monitor.start({
      backend:
        process.platform === 'win32' ? 'etw' : process.platform === 'linux' ? 'strace' : 'dtrace',
      pid: 1234,
      simulate: false,
    });
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.getStats()).toHaveProperty('subprocessError');
  });
});
