import { createCodeCollectorMock, parseJson, NetworkRequestsResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replayRequestMock = vi.fn();
const extractAuthMock = vi.fn();
const buildHarMock = vi.fn();
const fsWriteFileMock = vi.fn();
const fsLstatMock = vi.fn();
const fsRealpathMock = vi.fn();

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
    }),
  },
}));

vi.mock('@src/server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
  ConsoleMonitor: vi.fn(),
  CodeCollector: vi.fn(),
}));

vi.mock('@src/server/domains/network/replay', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  replayRequest: (...args: any[]) => replayRequestMock(...args),
}));

vi.mock('@src/server/domains/network/auth-extractor', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  extractAuthFromRequests: (...args: any[]) => extractAuthMock(...args),
}));

vi.mock('@src/server/domains/network/har', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  buildHar: (...args: any[]) => buildHarMock(...args),
}));

vi.mock('node:fs', () => ({
  promises: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    writeFile: (...args: any[]) => fsWriteFileMock(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    lstat: (...args: any[]) => fsLstatMock(...args),
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  realpath: (...args: any[]) => fsRealpathMock(...args),
}));

vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AdvancedToolHandlersRuntime } from '@server/domains/network/handlers.impl.core.runtime.replay';



describe('AdvancedToolHandlersRuntime', () => {
  const collector = createCodeCollectorMock();
  const consoleMonitor = {
    isNetworkEnabled: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getNetworkStatus: vi.fn(),
    getNetworkRequests: vi.fn(),
    getNetworkResponses: vi.fn(),
    getResponseBody: vi.fn(),
    getExceptions: vi.fn(),
    getNetworkActivity: vi.fn(),
    evaluate: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handler: AdvancedToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new AdvancedToolHandlersRuntime(collector, consoleMonitor);
    // Inject a mock performance monitor to avoid real instantiation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handler as any).performanceMonitor = {
      getPerformanceMetrics: vi.fn(),
      getPerformanceTimeline: vi.fn(),
      startCoverage: vi.fn(),
      stopCoverage: vi.fn(),
      takeHeapSnapshot: vi.fn(),
      startTracing: vi.fn(),
      stopTracing: vi.fn(),
      startCPUProfiling: vi.fn(),
      stopCPUProfiling: vi.fn(),
      startHeapSampling: vi.fn(),
      stopHeapSampling: vi.fn(),
    };
  });

  // ---------- handleNetworkExtractAuth ----------

  describe('handleNetworkExtractAuth', () => {
    it('returns failure when no requests are captured', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExtractAuth({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('No captured requests');
    });

    it('returns auth findings filtered by default minConfidence', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://api.example.com', method: 'GET' },
      ]);
      extractAuthMock.mockReturnValue([
        { type: 'bearer', confidence: 0.9, value: 'tok***' },
        { type: 'cookie', confidence: 0.3, value: 'ses***' },
      ]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExtractAuth({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.scannedRequests).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(1); // Only the 0.9 finding passes default 0.4 threshold
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.findings).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.findings[0].confidence).toBe(0.9);
    });

    it('respects custom minConfidence parameter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://api.example.com', method: 'GET' },
      ]);
      extractAuthMock.mockReturnValue([
        { type: 'bearer', confidence: 0.9, value: 'tok***' },
        { type: 'cookie', confidence: 0.5, value: 'ses***' },
        { type: 'apiKey', confidence: 0.2, value: 'key***' },
      ]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExtractAuth({ minConfidence: 0.5 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(2);
    });

    it('returns zero findings when nothing passes the threshold', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      extractAuthMock.mockReturnValue([{ type: 'weak', confidence: 0.1 }]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExtractAuth({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(0);
    });
  });

  // ---------- handleNetworkExportHar ----------

  describe('handleNetworkExportHar', () => {
    it('returns failure when no requests are captured', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExportHar({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('No captured requests');
    });

    it('returns HAR inline when no outputPath is given', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockResolvedValue({
        log: {
          entries: [{ request: {}, response: {} }],
        },
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExportHar({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.entryCount).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.har).toBeDefined();
    });

    it('catches buildHar errors and returns failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockRejectedValue(new Error('HAR build failed'));

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkExportHar({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('HAR build failed');
    });

    it('passes includeBodies option to buildHar', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockResolvedValue({ log: { entries: [] } });

      await handler.handleNetworkExportHar({ includeBodies: true });
      expect(buildHarMock).toHaveBeenCalledWith(expect.objectContaining({ includeBodies: true }));
    });

    it('defaults includeBodies to false', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockResolvedValue({ log: { entries: [] } });

      await handler.handleNetworkExportHar({});
      expect(buildHarMock).toHaveBeenCalledWith(expect.objectContaining({ includeBodies: false }));
    });
  });

  // ---------- handleNetworkReplayRequest ----------

  describe('handleNetworkReplayRequest', () => {
    it('returns error when requestId is missing', async () => {
      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkReplayRequest({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('requestId is required');
    });

    it('returns error when requestId is not found in captured requests', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'other', url: 'https://example.com', method: 'GET' },
      ]);

      const body = parseJson<NetworkRequestsResponse>(
        await handler.handleNetworkReplayRequest({ requestId: 'nonexistent' })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('not found');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hint).toContain('network_get_requests');
    });

    it('replays a captured request with dryRun=true by default', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com/data', method: 'POST' },
      ]);
      replayRequestMock.mockResolvedValue({
        dryRun: true,
        requestId: 'req-1',
        url: 'https://api.example.com/data',
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.dryRun).toBe(true);
      expect(replayRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-1',
          url: 'https://api.example.com/data',
          method: 'POST',
        }),
        expect.objectContaining({
          requestId: 'req-1',
          dryRun: true,
        })
      );
    });

    it('passes override options to replayRequest', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com/data', method: 'POST' },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: false });

      await handler.handleNetworkReplayRequest({
        requestId: 'req-1',
        headerPatch: { Authorization: 'Bearer new-token' },
        bodyPatch: '{"key":"value"}',
        methodOverride: 'PUT',
        urlOverride: 'https://api.example.com/v2/data',
        timeoutMs: 5000,
        dryRun: false,
      });

      expect(replayRequestMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          requestId: 'req-1',
          headerPatch: { Authorization: 'Bearer new-token' },
          bodyPatch: '{"key":"value"}',
          methodOverride: 'PUT',
          urlOverride: 'https://api.example.com/v2/data',
          timeoutMs: 5000,
          dryRun: false,
        })
      );
    });

    it('handles replayRequest throwing an error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue(new Error('Network timeout'));

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Network timeout');
    });

    it('handles non-Error throws from replayRequest', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue('string error');

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('string error');
    });

    it('skips invalid request payloads when finding the target request', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        null,
        42,
        { broken: true },
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: true });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
    });

    it('does not find request missing required fields', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://example.com' }, // missing method
        { requestId: 'req-2', method: 'GET' }, // missing url
      ]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('not found');
    });
  });
});
