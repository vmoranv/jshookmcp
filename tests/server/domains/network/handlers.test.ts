import { createCodeCollectorMock, parseJson, NetworkRequestsResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replayRequestMock = vi.fn();

vi.mock('@src/server/domains/network/replay', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  replayRequest: (...args: any[]) => replayRequestMock(...args),
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: AdvancedToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new AdvancedToolHandlers(collector, consoleMonitor);
  });

  it('enables network with parsed boolean args', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: true,
      cdpSessionActive: true,
      listenerCount: 1,
    });

    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkEnable({ enableExceptions: '0' }));
    expect(consoleMonitor.enable).toHaveBeenCalledWith({
      enableNetwork: true,
      enableExceptions: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  it('returns disabled status payload when monitoring is off', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: false,
    });

    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkGetStatus({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.enabled).toBe(false);
  });

  it('returns guidance when get_requests called with monitoring disabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.isNetworkEnabled.mockReturnValue(false);
    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkGetRequests({ autoEnable: false }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('not enabled');
  });

  it('auto-enables and reports empty capture set', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.isNetworkEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.getNetworkRequests.mockReturnValue([]);

    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkGetRequests({ autoEnable: true }));
    expect(consoleMonitor.enable).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.total).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('No network requests captured');
  });

  it('filters and paginates captured requests', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.isNetworkEnabled.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.page.returned).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.page.totalAfterFilter).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.requests[0].requestId).toBe('2');
  });

  it('validates network_replay_request requires requestId', async () => {
    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkReplayRequest({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('requestId is required');
  });

  it('replays captured request with dryRun default true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    replayRequestMock.mockResolvedValue({ dryRun: true, requestId: 'abc' });

    const body = parseJson<NetworkRequestsResponse>(await handlers.handleNetworkReplayRequest({ requestId: 'abc' }));
    expect(replayRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abc' }),
      expect.objectContaining({ requestId: 'abc', dryRun: true })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.dryRun).toBe(true);
  });
});
