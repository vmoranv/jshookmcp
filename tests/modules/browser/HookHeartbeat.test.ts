import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookHeartbeat, type HeartbeatScript } from '@modules/browser/HookHeartbeat';

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function createMockPage() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const mainFrame = { url: () => 'https://example.com', parentFrame: () => null };
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    evaluate: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    mainFrame: vi.fn().mockReturnValue(mainFrame),
    _emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    _handlers: handlers,
  };
}

describe('HookHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts and stops monitoring', () => {
    const page = createMockPage();
    const heartbeat = new HookHeartbeat(page as any);

    expect(heartbeat.isRunning).toBe(false);
    heartbeat.start();
    expect(heartbeat.isRunning).toBe(true);
    expect(page.on).toHaveBeenCalledWith('framenavigated', expect.any(Function));

    heartbeat.stop();
    expect(heartbeat.isRunning).toBe(false);
    expect(page.off).toHaveBeenCalledWith('framenavigated', expect.any(Function));
  });

  it('re-injects scripts after main frame navigation', async () => {
    const page = createMockPage();
    const script: HeartbeatScript = { id: 'intercept', source: 'console.log("hi")' };
    const heartbeat = new HookHeartbeat(page as any, { debounceMs: 0 });
    heartbeat.addScript(script);
    heartbeat.start();

    const mainFrame = { url: () => 'https://example.com/new-page', parentFrame: () => null };
    page._emit('framenavigated', mainFrame);

    // Run debounce timer
    await vi.advanceTimersByTimeAsync(10);

    expect(page.evaluate).toHaveBeenCalledWith('console.log("hi")');
  });

  it('skips sub-frame navigations when mainFrameOnly is true', async () => {
    const page = createMockPage();
    const heartbeat = new HookHeartbeat(page as any, { debounceMs: 0 });
    heartbeat.addScript({ id: 'test', source: 'test()' });
    heartbeat.start();

    const subFrame = { url: () => 'https://ads.example.com', parentFrame: () => ({}) };
    page._emit('framenavigated', subFrame);

    await vi.advanceTimersByTimeAsync(10);

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('debounces rapid navigations', async () => {
    const page = createMockPage();
    const heartbeat = new HookHeartbeat(page as any, { debounceMs: 100 });
    heartbeat.addScript({ id: 'test', source: 'test()' });
    heartbeat.start();

    const frame = { url: () => 'https://example.com/a', parentFrame: () => null };
    page._emit('framenavigated', frame);
    page._emit('framenavigated', frame);
    page._emit('framenavigated', frame);

    await vi.advanceTimersByTimeAsync(50);
    expect(page.evaluate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('manages scripts correctly', () => {
    const page = createMockPage();
    const heartbeat = new HookHeartbeat(page as any);

    heartbeat.addScript({ id: 'a', source: 'a()' });
    heartbeat.addScript({ id: 'b', source: 'b()' });
    expect(heartbeat.scriptCount).toBe(2);

    heartbeat.removeScript('a');
    expect(heartbeat.scriptCount).toBe(1);
  });

  it('does not re-inject when page is closed', async () => {
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    const heartbeat = new HookHeartbeat(page as any, { debounceMs: 0 });
    heartbeat.addScript({ id: 'test', source: 'test()' });
    heartbeat.start();

    const frame = { url: () => 'about:blank', parentFrame: () => null };
    page._emit('framenavigated', frame);
    await vi.advanceTimersByTimeAsync(10);

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('continues injecting remaining scripts if one fails', async () => {
    const page = createMockPage();
    page.evaluate
      .mockRejectedValueOnce(new Error('script A failed'))
      .mockResolvedValueOnce(undefined);

    const heartbeat = new HookHeartbeat(page as any, { debounceMs: 0 });
    heartbeat.addScript({ id: 'a', source: 'a()' });
    heartbeat.addScript({ id: 'b', source: 'b()' });
    heartbeat.start();

    const frame = { url: () => 'https://example.com', parentFrame: () => null };
    page._emit('framenavigated', frame);
    await vi.advanceTimersByTimeAsync(10);

    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('is idempotent on start/stop', () => {
    const page = createMockPage();
    const heartbeat = new HookHeartbeat(page as any);

    heartbeat.start();
    heartbeat.start(); // should not double-register
    expect(page.on).toHaveBeenCalledTimes(1);

    heartbeat.stop();
    heartbeat.stop(); // should not throw
    expect(page.off).toHaveBeenCalledTimes(1);
  });
});
