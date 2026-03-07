import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: any[]) => lookupMock(...args),
}));

import { replayRequest } from '@server/domains/network/replay';

describe('replayRequest', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps https requests on the original hostname to preserve TLS validation', async () => {
    lookupMock.mockResolvedValue({ address: '203.0.113.10', family: 4 });
    fetchMock.mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await replayRequest(
      {
        url: 'https://assets.example.com/main.js',
        method: 'GET',
        headers: {},
      },
      {
        requestId: 'req-https',
        dryRun: false,
      }
    );

    expect(result.dryRun).toBe(false);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://assets.example.com/main.js',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: {},
      })
    );
  });

  it('pins http requests to the resolved ip and preserves Host', async () => {
    lookupMock.mockResolvedValue({ address: '203.0.113.10', family: 4 });
    fetchMock.mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await replayRequest(
      {
        url: 'http://assets.example.com/main.js',
        method: 'GET',
        headers: {},
      },
      {
        requestId: 'req-http',
        dryRun: false,
      }
    );

    expect(result.dryRun).toBe(false);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://203.0.113.10/main.js',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: { Host: 'assets.example.com' },
      })
    );
  });
});
