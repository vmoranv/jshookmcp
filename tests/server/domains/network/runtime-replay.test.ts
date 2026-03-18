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
  replayRequest: (...args: any[]) => replayRequestMock(...args),
}));

vi.mock('@src/server/domains/network/auth-extractor', () => ({
  extractAuthFromRequests: (...args: any[]) => extractAuthMock(...args),
}));

vi.mock('@src/server/domains/network/har', () => ({
  buildHar: (...args: any[]) => buildHarMock(...args),
}));

vi.mock('node:fs', () => ({
  promises: {
    writeFile: (...args: any[]) => fsWriteFileMock(...args),
    lstat: (...args: any[]) => fsLstatMock(...args),
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  realpath: (...args: any[]) => fsRealpathMock(...args),
}));

vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AdvancedToolHandlersRuntime } from '@server/domains/network/handlers.impl.core.runtime.replay';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('AdvancedToolHandlersRuntime', () => {
  const collector = {} as any;
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
  } as any;

  let handler: AdvancedToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new AdvancedToolHandlersRuntime(collector, consoleMonitor);
    // Inject a mock performance monitor to avoid real instantiation
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
      consoleMonitor.getNetworkRequests.mockReturnValue([]);

      const body = parseJson(await handler.handleNetworkExtractAuth({}));
      expect(body.success).toBe(false);
      expect(body.message).toContain('No captured requests');
    });

    it('returns auth findings filtered by default minConfidence', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://api.example.com', method: 'GET' },
      ]);
      extractAuthMock.mockReturnValue([
        { type: 'bearer', confidence: 0.9, value: 'tok***' },
        { type: 'cookie', confidence: 0.3, value: 'ses***' },
      ]);

      const body = parseJson(await handler.handleNetworkExtractAuth({}));
      expect(body.success).toBe(true);
      expect(body.scannedRequests).toBe(1);
      expect(body.found).toBe(1); // Only the 0.9 finding passes default 0.4 threshold
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0].confidence).toBe(0.9);
    });

    it('respects custom minConfidence parameter', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://api.example.com', method: 'GET' },
      ]);
      extractAuthMock.mockReturnValue([
        { type: 'bearer', confidence: 0.9, value: 'tok***' },
        { type: 'cookie', confidence: 0.5, value: 'ses***' },
        { type: 'apiKey', confidence: 0.2, value: 'key***' },
      ]);

      const body = parseJson(await handler.handleNetworkExtractAuth({ minConfidence: 0.5 }));
      expect(body.found).toBe(2);
    });

    it('returns zero findings when nothing passes the threshold', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      extractAuthMock.mockReturnValue([{ type: 'weak', confidence: 0.1 }]);

      const body = parseJson(await handler.handleNetworkExtractAuth({}));
      expect(body.success).toBe(true);
      expect(body.found).toBe(0);
    });
  });

  // ---------- handleNetworkExportHar ----------

  describe('handleNetworkExportHar', () => {
    it('returns failure when no requests are captured', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([]);

      const body = parseJson(await handler.handleNetworkExportHar({}));
      expect(body.success).toBe(false);
      expect(body.message).toContain('No captured requests');
    });

    it('returns HAR inline when no outputPath is given', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockResolvedValue({
        log: {
          entries: [{ request: {}, response: {} }],
        },
      });

      const body = parseJson(await handler.handleNetworkExportHar({}));
      expect(body.success).toBe(true);
      expect(body.entryCount).toBe(1);
      expect(body.har).toBeDefined();
    });

    it('catches buildHar errors and returns failure', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockRejectedValue(new Error('HAR build failed'));

      const body = parseJson(await handler.handleNetworkExportHar({}));
      expect(body.success).toBe(false);
      expect(body.error).toBe('HAR build failed');
    });

    it('passes includeBodies option to buildHar', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET' },
      ]);
      buildHarMock.mockResolvedValue({ log: { entries: [] } });

      await handler.handleNetworkExportHar({ includeBodies: true });
      expect(buildHarMock).toHaveBeenCalledWith(expect.objectContaining({ includeBodies: true }));
    });

    it('defaults includeBodies to false', async () => {
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
      const body = parseJson(await handler.handleNetworkReplayRequest({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('requestId is required');
    });

    it('returns error when requestId is not found in captured requests', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'other', url: 'https://example.com', method: 'GET' },
      ]);

      const body = parseJson(
        await handler.handleNetworkReplayRequest({ requestId: 'nonexistent' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
      expect(body.hint).toContain('network_get_requests');
    });

    it('replays a captured request with dryRun=true by default', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com/data', method: 'POST' },
      ]);
      replayRequestMock.mockResolvedValue({
        dryRun: true,
        requestId: 'req-1',
        url: 'https://api.example.com/data',
      });

      const body = parseJson(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      expect(body.success).toBe(true);
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
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue(new Error('Network timeout'));

      const body = parseJson(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('Network timeout');
    });

    it('handles non-Error throws from replayRequest', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue('string error');

      const body = parseJson(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('string error');
    });

    it('skips invalid request payloads when finding the target request', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        null,
        42,
        { broken: true },
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: true });

      const body = parseJson(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      expect(body.success).toBe(true);
    });

    it('does not find request missing required fields', async () => {
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://example.com' }, // missing method
        { requestId: 'req-2', method: 'GET' }, // missing url
      ]);

      const body = parseJson(await handler.handleNetworkReplayRequest({ requestId: 'req-1' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });
  });
});
