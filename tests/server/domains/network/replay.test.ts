import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: any[]) => lookupMock(...args),
}));

import { replayRequest } from '@server/domains/network/replay';
import { TEST_HOSTS, TEST_HTTP_URLS, TEST_URLS, withPath } from '@tests/shared/test-urls';

function buildReservedDocIpv4(): string {
  return [203, 0, 113, 10].map(String).join('.');
}

describe('replayRequest', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps https requests on the original hostname to preserve TLS validation', async () => {
    lookupMock.mockResolvedValue({ address: buildReservedDocIpv4(), family: 4 });
    fetchMock.mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await replayRequest(
      {
        url: withPath(TEST_URLS.root, 'assets/main.js'),
        method: 'GET',
        headers: {},
      },
      {
        requestId: 'req-https',
        dryRun: false,
      },
    );

    expect(result.dryRun).toBe(false);
    expect((result as any).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      withPath(TEST_URLS.root, 'assets/main.js'),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: {},
      }),
    );
  });

  it('blocks remote http requests unless they are loopback', async () => {
    const resolvedAddress = buildReservedDocIpv4();
    lookupMock.mockResolvedValue({ address: resolvedAddress, family: 4 });
    await expect(
      replayRequest(
        {
          url: withPath(TEST_HTTP_URLS.root, 'assets/main.js'),
          method: 'GET',
          headers: {},
        },
        {
          requestId: 'req-http',
          dryRun: false,
        },
      ),
    ).rejects.toThrow(
      'insecure HTTP is only allowed for loopback or explicitly authorized targets',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows authorized non-loopback HTTP requests for exact hosts', async () => {
    const resolvedAddress = buildReservedDocIpv4();
    lookupMock.mockResolvedValue({ address: resolvedAddress, family: 4 });
    fetchMock.mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await replayRequest(
      {
        url: withPath(TEST_HTTP_URLS.lab, 'assets/main.js'),
        method: 'GET',
        headers: {},
      },
      {
        requestId: 'req-http-authorized',
        dryRun: false,
        authorization: {
          allowedHosts: [TEST_HOSTS.lab],
          allowInsecureHttp: true,
        },
      },
    );

    expect(result.dryRun).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://203.0.113.10/assets/main.js',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({
          Host: TEST_HOSTS.lab,
        }),
      }),
    );
  });

  it('allows authorized private CIDR targets over HTTPS', async () => {
    fetchMock.mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await replayRequest(
      {
        url: 'https://10.0.0.8/assets/main.js',
        method: 'GET',
        headers: {},
      },
      {
        requestId: 'req-private-authorized',
        dryRun: false,
        authorization: {
          allowedCidrs: ['10.0.0.0/24'],
          allowPrivateNetwork: true,
        },
      },
    );

    expect(result.dryRun).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://10.0.0.8/assets/main.js',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      }),
    );
  });

  it('rejects expired replay authorization before sending the request', async () => {
    await expect(
      replayRequest(
        {
          url: 'https://10.0.0.8/assets/main.js',
          method: 'GET',
          headers: {},
        },
        {
          requestId: 'req-expired',
          dryRun: false,
          authorization: {
            allowedCidrs: ['10.0.0.0/24'],
            allowPrivateNetwork: true,
            expiresAt: '2000-01-01T00:00:00.000Z',
          },
        },
      ),
    ).rejects.toThrow('authorization expired');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
