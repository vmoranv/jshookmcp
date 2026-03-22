import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns/promises', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  lookup: (...args: any[]) => lookupMock(...args),
}));

import { replayRequest } from '@server/domains/network/replay';

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
      })
    );

    const result = await replayRequest(
      {
        url: 'https://vmoranv.github.io/jshookmcp/assets/main.js',
        method: 'GET',
        headers: {},
      },
      {
        requestId: 'req-https',
        dryRun: false,
      }
    );

    expect(result.dryRun).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((result as any).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vmoranv.github.io/jshookmcp/assets/main.js',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: {},
      })
    );
  });

  it('blocks remote http requests unless they are loopback', async () => {
    const resolvedAddress = buildReservedDocIpv4();
    lookupMock.mockResolvedValue({ address: resolvedAddress, family: 4 });
    await expect(
      replayRequest(
        {
          url: 'http://vmoranv.github.io/jshookmcp/assets/main.js',
          method: 'GET',
          headers: {},
        },
        {
          requestId: 'req-http',
          dryRun: false,
        }
      )
    ).rejects.toThrow('insecure HTTP is only allowed for loopback targets');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
