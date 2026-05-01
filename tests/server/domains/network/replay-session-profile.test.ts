import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: any[]) => lookupMock(...args),
}));

import { replayRequest } from '@server/domains/network/replay';
import type { SessionProfile } from '@internal-types/SessionProfile';

const SESSION_PROFILE: SessionProfile = {
  cookies: [
    { name: 'cf_clearance', value: 'abc123', domain: '.example.com' },
    { name: 'session', value: 'xyz', path: '/' },
  ],
  userAgent: 'TestBot/1.0',
  acceptLanguage: 'en-US,en;q=0.9',
  referer: 'https://example.com/page',
  platform: 'Win32',
  origin: 'https://example.com',
  collectedAt: Date.now(),
  ttlSec: 1800,
};

describe('replayRequest sessionProfile', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('injects cookies as Cookie header from sessionProfile', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      { requestId: 'r1', dryRun: false, sessionProfile: SESSION_PROFILE },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers.Cookie).toBe('cf_clearance=abc123; session=xyz');
  });

  it('injects User-Agent from sessionProfile when not in base headers', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      { requestId: 'r2', dryRun: false, sessionProfile: SESSION_PROFILE },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('TestBot/1.0');
  });

  it('injects Accept-Language from sessionProfile when not in base headers', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      { requestId: 'r3', dryRun: false, sessionProfile: SESSION_PROFILE },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers['Accept-Language']).toBe('en-US,en;q=0.9');
  });

  it('does not override existing User-Agent from headerPatch', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      {
        requestId: 'r4',
        dryRun: false,
        sessionProfile: SESSION_PROFILE,
        headerPatch: { 'User-Agent': 'CustomAgent/2.0' },
      },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('CustomAgent/2.0');
  });

  it('does not inject Cookie header when profile has empty cookies', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const emptyProfile: SessionProfile = { ...SESSION_PROFILE, cookies: [] };
    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      { requestId: 'r5', dryRun: false, sessionProfile: emptyProfile },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers.Cookie).toBeUndefined();
  });

  it('works without sessionProfile (backward compatible)', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: { 'X-Test': '1' } },
      { requestId: 'r6', dryRun: false },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers.Cookie).toBeUndefined();
    expect(headers['X-Test']).toBe('1');
  });

  it('injects Referer from sessionProfile when not in base headers', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      { requestId: 'r7', dryRun: false, sessionProfile: SESSION_PROFILE },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers['Referer']).toBe('https://example.com/page');
  });

  it('does not override existing Referer from headerPatch', async () => {
    lookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await replayRequest(
      { url: 'https://example.com/api', method: 'GET', headers: {} },
      {
        requestId: 'r8',
        dryRun: false,
        sessionProfile: SESSION_PROFILE,
        headerPatch: { Referer: 'https://other.com' },
      },
    );

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = (callArgs[1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers['Referer']).toBe('https://other.com');
  });
});
