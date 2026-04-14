import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

class FakeManagedSession {
  private readonly emitter = new EventEmitter();
  send = vi.fn(async () => ({}));
  detach = vi.fn(async () => {});

  on(event: string, listener: (payload: unknown) => void) {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener: (payload: unknown) => void) {
    this.emitter.off(event, listener);
    return this;
  }
}

describe('ConsoleMonitor with managed target session', () => {
  it('binds to the attached target session instead of creating a page CDP session', async () => {
    const session = new FakeManagedSession();
    const collector = {
      getAttachedTargetSession: vi.fn(() => session),
      getActivePage: vi.fn(),
    };
    const monitor = new ConsoleMonitor(collector as never);

    await monitor.enable({ enableNetwork: true });
    await monitor.disable();

    expect(collector.getAttachedTargetSession).toHaveBeenCalled();
    expect(collector.getActivePage).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledWith('Runtime.enable', {});
    expect(session.send).toHaveBeenCalledWith('Console.enable', {});
    expect(session.send).toHaveBeenCalledWith(
      'Network.enable',
      expect.objectContaining({
        maxPostDataSize: 65536,
      }),
    );
    expect(session.detach).not.toHaveBeenCalled();
  });
});
