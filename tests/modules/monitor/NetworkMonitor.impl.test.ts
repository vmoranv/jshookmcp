import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { NetworkMonitor } from '@modules/monitor/NetworkMonitor.impl';

function createMockSession() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const send = vi.fn(async (..._args: unknown[]) => ({}));
  const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
    const group = listeners.get(event) ?? new Set<(payload: unknown) => void>();
    group.add(handler);
    listeners.set(event, group);
  });
  const off = vi.fn((event: string, handler: (payload: unknown) => void) => {
    listeners.get(event)?.delete(handler);
  });
  const emit = (event: string, payload?: unknown) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    session: { send, on, off } as any,
    send,
    emit,
  };
}

describe('NetworkMonitor impl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures request and response activity through the internal implementation path', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
      timestamp: 1,
      type: 'XHR',
      initiator: {},
    });
    emit('Network.responseReceived', {
      requestId: 'req-1',
      response: {
        url: 'https://example.com/api',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    expect(monitor.isEnabled()).toBe(true);
    expect(monitor.getRequests()).toHaveLength(1);
    expect(monitor.getResponses()).toHaveLength(1);
    expect(monitor.getActivity('req-1').response?.status).toBe(200);
  });
});
