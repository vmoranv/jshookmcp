import {
  createCodeCollectorMock,
  parseJson,
  // @ts-expect-error — auto-suppressed [TS1484]
  NetworkRequestsResponse,
} from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replayRequestMock = vi.fn();

vi.mock('@src/server/domains/network/replay', () => ({
  replayRequest: (...args: any[]) => replayRequestMock(...args),
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: any) => payload,
    }),
  },
}));

import { AdvancedToolHandlers } from '@server/domains/network/handlers';

describe('AdvancedToolHandlers (network)', () => {
  const collector = createCodeCollectorMock();
  const consoleMonitor = {
    isNetworkEnabled: vi.fn(),
    enable: vi.fn(),
    getNetworkStatus: vi.fn(),
    getNetworkRequests: vi.fn(),
    getResponseBody: vi.fn(),
    disable: vi.fn(),
  } as any;

  let handlers: AdvancedToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error — auto-suppressed [TS2345]
    handlers = new AdvancedToolHandlers(collector, consoleMonitor);
  });

  it('enables network with parsed boolean args', async () => {
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: true,
      cdpSessionActive: true,
      listenerCount: 1,
    });

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkEnable({ enableExceptions: '0' }),
    );
    expect(consoleMonitor.enable).toHaveBeenCalledWith({
      enableNetwork: true,
      enableExceptions: false,
    });
    expect(body.success).toBe(true);
  });

  it('returns disabled status payload when monitoring is off', async () => {
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: false,
    });

    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkGetStatus({}));
    expect(body.success).toBe(false);
    // @ts-expect-error — auto-suppressed [TS2339]
    expect(body.enabled).toBe(false);
  });

  it('returns guidance when get_requests called with monitoring disabled', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValue(false);
    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkGetRequests({ autoEnable: false }),
    );
    expect(body.success).toBe(false);
    expect(body.message).toContain('not enabled');
  });

  it('auto-enables and reports empty capture set', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
    consoleMonitor.getNetworkRequests.mockReturnValue([]);

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkGetRequests({ autoEnable: true }),
    );
    expect(consoleMonitor.enable).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
    expect(body.message).toContain('No network requests captured');
  });

  it('filters and paginates captured requests', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValue(true);
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: '1', url: 'https://vmoranv.github.io/jshookmcp/api/a', method: 'GET' },
      { requestId: '2', url: 'https://vmoranv.github.io/jshookmcp/api/b', method: 'POST' },
      { requestId: '3', url: 'https://vmoranv.github.io/jshookmcp/cdn/c', method: 'GET' },
    ]);

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkGetRequests({
        url: 'jshookmcp/api/',
        method: 'ALL',
        limit: 1,
        offset: 1,
      }),
    );
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS18048]
    expect(body.page.returned).toBe(1);
    // @ts-expect-error — auto-suppressed [TS18048]
    expect(body.page.totalAfterFilter).toBe(2);
    // @ts-expect-error — auto-suppressed [TS2532]
    expect(body.requests[0].requestId).toBe('2');
  });

  it('validates network_replay_request requires requestId', async () => {
    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkReplayRequest({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('requestId is required');
  });

  it('replays captured request with dryRun default true', async () => {
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    replayRequestMock.mockResolvedValue({ dryRun: true, requestId: 'abc' });

    const body = parseJson<NetworkRequestsResponse>(
      await handlers.handleNetworkReplayRequest({ requestId: 'abc' }),
    );
    expect(replayRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abc' }),
      expect.objectContaining({ requestId: 'abc', dryRun: true }),
    );
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS2339]
    expect(body.dryRun).toBe(true);
  });
});
