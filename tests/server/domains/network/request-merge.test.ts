import { describe, expect, it } from 'vitest';
import { getMergedNetworkRequestsFromMonitor } from '@server/domains/network/request-merge';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

const REQUEST_URL = withPath(TEST_URLS.root, 'api/data');

describe('request-merge', () => {
  it('keeps OOPIF requests scoped by target and session', async () => {
    const monitor = {
      getNetworkRequests: () => [
        {
          requestId: 'cdp-1',
          targetId: 'frame-1',
          sessionId: 'session-1',
          url: REQUEST_URL,
          method: 'GET',
          type: 'XHR',
          timestamp: 1000,
        },
        {
          requestId: 'cdp-2',
          targetId: 'frame-2',
          sessionId: 'session-2',
          url: REQUEST_URL,
          method: 'GET',
          type: 'XHR',
          timestamp: 1001,
        },
      ],
      getXHRRequests: async () => [
        {
          targetId: 'frame-2',
          sessionId: 'session-2',
          url: REQUEST_URL,
          method: 'GET',
          type: 'XHR',
          timestamp: 1001,
        },
      ],
      getFetchRequests: async () => [],
    };

    const merged = await getMergedNetworkRequestsFromMonitor(monitor);

    expect(merged).toHaveLength(2);
    expect(merged.find((request) => request.targetId === 'frame-1')).toMatchObject({
      requestId: 'cdp-1',
    });
    expect(merged.find((request) => request.targetId === 'frame-2')).toMatchObject({
      requestId: 'cdp-2',
      injected: true,
      captureSource: 'inpage',
    });
  });
});
