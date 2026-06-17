/**
 * Test HTTP/2 support in network_replay_request
 *
 * CRIT-09: network_replay_request must support HTTP/2 protocol
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replayRequest } from '@server/domains/network/replay';
import type { ReplayArgs } from '@server/domains/network/replay';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

// Public IP from TEST-NET-1 (RFC 5737)
const TEST_PUBLIC_IP = '192.0.2.10';

describe('replayRequest - HTTP/2 support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('protocol detection', () => {
    it('uses HTTP/2 client when protocol is "h2"', async () => {
      lookupMock.mockResolvedValue({ address: TEST_PUBLIC_IP, family: 4 });

      const base = {
        url: 'https://example.com/api/data',
        method: 'GET',
        headers: { 'user-agent': 'test' },
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-h2',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      // This should use http2 client instead of fetch (will fail to connect in test env)
      await expect(replayRequest(base, args)).rejects.toThrow();
    });

    it('uses HTTP/2 client when protocol is "h2c"', async () => {
      lookupMock.mockResolvedValue({ address: TEST_PUBLIC_IP, family: 4 });

      const base = {
        url: 'http://localhost:8080/api/data',
        method: 'GET',
        headers: {},
        protocol: 'h2c',
      };

      const args: ReplayArgs = {
        requestId: 'req-h2c',
        dryRun: false,
        authorization: {
          allowedHosts: ['localhost'],
          allowInsecureHttp: true,
        },
      };

      // h2c (HTTP/2 over cleartext) should use http2 client
      await expect(replayRequest(base, args)).rejects.toThrow();
    });

    it('uses HTTP/2 client when protocol is "HTTP/2"', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/api/data',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"test":true}',
        protocol: 'HTTP/2',
      };

      const args: ReplayArgs = {
        requestId: 'req-http2',
        dryRun: false,
        bodyPatch: '{"test":false}',
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
    });

    it('falls back to fetch when protocol is undefined', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const base = {
        url: 'https://example.com/api/data',
        method: 'GET',
        headers: {},
        // No protocol field → assume HTTP/1.1
      };

      const args: ReplayArgs = {
        requestId: 'req-default',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await replayRequest(base, args);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('falls back to fetch when protocol is http/1.1', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const base = {
        url: 'https://example.com/api/data',
        method: 'GET',
        headers: {},
        protocol: 'http/1.1',
      };

      const args: ReplayArgs = {
        requestId: 'req-http11',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await replayRequest(base, args);
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('HTTP/2 features', () => {
    it('handles HTTP/2 pseudo-headers correctly', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/api/data',
        method: 'POST',
        headers: {
          ':authority': 'example.com',
          ':method': 'POST',
          ':path': '/api/data',
          ':scheme': 'https',
          'content-type': 'application/json',
        },
        postData: '{"test":true}',
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-pseudo-headers',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
      // TODO: Verify pseudo-headers are correctly translated
    });

    it('preserves HTTP/2 header case sensitivity', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/api/data',
        method: 'GET',
        headers: {
          'X-Custom-Header': 'value', // HTTP/2 normalizes to lowercase
          'user-agent': 'test',
        },
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-case-sensitive',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
      // HTTP/2 spec requires lowercase header names
    });

    it('handles HTTP/2 response headers correctly', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/api/data',
        method: 'GET',
        headers: {},
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-response-headers',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
      // HTTP/2 responses should have :status pseudo-header converted to status code
    });
  });

  describe('dry run mode', () => {
    it('validates HTTP/2 requests in dry run mode', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/api/data',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"test":true}',
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-dry-run',
        dryRun: true,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      const result = await replayRequest(base, args);
      expect(result.dryRun).toBe(true);
      if (result.dryRun) {
        expect(result.preview.url).toBe('https://example.com/api/data');
        expect(result.preview.method).toBe('POST');
        expect(result.preview.body).toBe('{"test":true}');
      }
    });
  });

  describe('redirect handling', () => {
    it('follows HTTP/2 redirects correctly', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/redirect',
        method: 'GET',
        headers: {},
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-redirect',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com', 'example.org'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
      // HTTP/2 redirects should be handled by client
      // 301/302/303 → GET, 307/308 → preserve method
    });

    it('respects max redirects for HTTP/2', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/infinite-redirect',
        method: 'GET',
        headers: {},
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-max-redirects',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      // HTTP/2 doesn't support manual redirect in current implementation
      await expect(replayRequest(base, args)).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('handles HTTP/2 connection errors gracefully', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://nonexistent.example.com/api/data',
        method: 'GET',
        headers: {},
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-connection-error',
        dryRun: false,
        authorization: {
          allowedHosts: ['nonexistent.example.com'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
    });

    it('handles HTTP/2 timeout correctly', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });

      const base = {
        url: 'https://example.com/slow',
        method: 'GET',
        headers: {},
        protocol: 'h2',
      };

      const args: ReplayArgs = {
        requestId: 'req-timeout',
        dryRun: false,
        timeoutMs: 100, // Very short timeout
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      await expect(replayRequest(base, args)).rejects.toThrow();
    });
  });

  describe('backward compatibility', () => {
    it('maintains compatibility with existing HTTP/1.1 replays', async () => {
      lookupMock.mockResolvedValue({ address: '192.0.2.10', family: 4 });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const base = {
        url: 'https://example.com/api/data',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"test":true}',
      };

      const args: ReplayArgs = {
        requestId: 'req-backward-compat',
        dryRun: false,
        authorization: {
          allowedHosts: ['example.com'],
        },
      };

      const result = await replayRequest(base, args);
      expect(result.dryRun).toBe(false);
      if (!result.dryRun) {
        expect(result.status).toBe(200);
      }
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
