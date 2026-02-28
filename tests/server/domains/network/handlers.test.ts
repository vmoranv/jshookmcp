import { beforeEach, describe, expect, it, vi } from 'vitest';

const replayRequestMock = vi.fn();

vi.mock('../../../../src/server/domains/network/replay.js', () => ({
  replayRequest: (...args: any[]) => replayRequestMock(...args),
}));

vi.mock('../../../../src/utils/DetailedDataManager.js', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
    }),
  },
}));

import { AdvancedToolHandlers } from '../../../../src/server/domains/network/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('AdvancedToolHandlers (network)', () => {
  const collector = {} as any;
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
    handlers = new AdvancedToolHandlers(collector, consoleMonitor);
  });

  it('enables network with parsed boolean args', async () => {
    consoleMonitor.getNetworkStatus.mockReturnValue({
      enabled: true,
      cdpSessionActive: true,
      listenerCount: 1,
    });

    const body = parseJson(await handlers.handleNetworkEnable({ enableExceptions: '0' }));
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

    const body = parseJson(await handlers.handleNetworkGetStatus({}));
    expect(body.success).toBe(false);
    expect(body.enabled).toBe(false);
  });

  it('returns guidance when get_requests called with monitoring disabled', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValue(false);
    const body = parseJson(await handlers.handleNetworkGetRequests({ autoEnable: false }));
    expect(body.success).toBe(false);
    expect(body.message).toContain('not enabled');
  });

  it('auto-enables and reports empty capture set', async () => {
    consoleMonitor.isNetworkEnabled
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    consoleMonitor.getNetworkRequests.mockReturnValue([]);

    const body = parseJson(await handlers.handleNetworkGetRequests({ autoEnable: true }));
    expect(consoleMonitor.enable).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
    expect(body.message).toContain('No network requests captured');
  });

  it('filters and paginates captured requests', async () => {
    consoleMonitor.isNetworkEnabled.mockReturnValue(true);
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: '1', url: 'https://api.example.com/a', method: 'GET' },
      { requestId: '2', url: 'https://api.example.com/b', method: 'POST' },
      { requestId: '3', url: 'https://cdn.example.com/c', method: 'GET' },
    ]);

    const body = parseJson(
      await handlers.handleNetworkGetRequests({ url: 'api.example.com', method: 'ALL', limit: 1, offset: 1 })
    );
    expect(body.success).toBe(true);
    expect(body.page.returned).toBe(1);
    expect(body.page.totalAfterFilter).toBe(2);
    expect(body.requests[0].requestId).toBe('2');
  });

  it('validates network_replay_request requires requestId', async () => {
    const body = parseJson(await handlers.handleNetworkReplayRequest({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('requestId is required');
  });

  it('replays captured request with dryRun default true', async () => {
    consoleMonitor.getNetworkRequests.mockReturnValue([
      { requestId: 'abc', url: 'https://api', method: 'POST' },
    ]);
    replayRequestMock.mockResolvedValue({ dryRun: true, requestId: 'abc' });

    const body = parseJson(await handlers.handleNetworkReplayRequest({ requestId: 'abc' }));
    expect(replayRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abc' }),
      expect.objectContaining({ requestId: 'abc', dryRun: true })
    );
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(true);
  });
});

