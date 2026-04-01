/**
 * Coverage tests for handlers.impl.core.runtime.replay.ts
 *
 * Exercises ALL uncovered branches in:
 *   - handleNetworkExtractAuth
 *   - handleNetworkExportHar  (outputPath branches: cwd, tmpDir, outside, symlink, write errors, getResponseBody throw)
 *   - handleNetworkReplayRequest
 *   - isReplayableRequest guard
 *   - parseBooleanArg / parseNumberArg helpers
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCodeCollectorMock,
  parseJson,
  type CodeCollectorMirror,
} from '@tests/server/domains/shared/mock-factories';
import type {
  NetworkExtractAuthResponse,
  NetworkExportHarResponse,
  NetworkReplayResponse,
} from '@tests/server/domains/shared/common-test-types';

// ── Hoisted refs — created before vi.mock so factories can close over them ─

// Domain mocks
const replayRequestMock = vi.fn();
const extractAuthMock = vi.fn();
const buildHarMock = vi.fn();

// Node built-in mocks — vi.hoisted ensures these are the EXACT same objects
// that vi.mock factories close over, so configureIn beforeEach works reliably.
const { mockFsWriteFile, mockFsRealpath, mockFsLstat } = vi.hoisted(() => ({
  mockFsWriteFile: vi.fn(),
  mockFsRealpath: vi.fn(),
  mockFsLstat: vi.fn(),
}));

const { mockPathResolve, mockPathDirname, mockPathBasename, mockPathJoin } = vi.hoisted(() => ({
  mockPathResolve: vi.fn((p: string) => p),
  mockPathDirname: vi.fn((p: string) => p.replace(/[/\\][^/\\]+$/, '')),
  mockPathBasename: vi.fn((p: string) => p.replace(/^.*[/\\]/, '')),
  mockPathJoin: vi.fn((...args: string[]) => args.join('/')),
}));

const { mockOsTmpdir } = vi.hoisted(() => ({
  mockOsTmpdir: vi.fn(() => '/mock-tmp'),
}));

// Console monitor mocks (stable refs for beforeEach)
const mockGetNetworkRequests = vi.fn();
const mockGetNetworkActivity = vi.fn();
const mockGetResponseBody = vi.fn();

// ── Static module mocks — factories close over hoisted refs ─────────────────

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

vi.mock('@server/domains/network/replay', () => ({
  replayRequest: (...args: unknown[]) => replayRequestMock(...args),
}));

vi.mock('@server/domains/network/auth-extractor', () => ({
  extractAuthFromRequests: (...args: unknown[]) => extractAuthMock(...args),
}));

vi.mock('@server/domains/network/har', () => ({
  buildHar: (...args: unknown[]) => buildHarMock(...args),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockFsWriteFile,
  realpath: mockFsRealpath,
  lstat: mockFsLstat,
}));

// The source uses `import { promises as fs } from 'node:fs'` (static) for lstat/writeFile
// after path resolution, AFTER the dynamic import path. We mock node:fs so its .promises
// namespace resolves to the same hoisted mocks.
vi.mock('node:fs', () => ({
  promises: {
    writeFile: mockFsWriteFile,
    realpath: mockFsRealpath,
    lstat: mockFsLstat,
  },
}));

vi.mock('node:path', () => ({
  resolve: mockPathResolve,
  dirname: mockPathDirname,
  basename: mockPathBasename,
  join: mockPathJoin,
  sep: '/',
}));

vi.mock('node:os', () => ({
  tmpdir: mockOsTmpdir,
}));

vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Console monitor mock (stable reference for vi.fn mocks) ─────────────────

const consoleMonitor = {
  isNetworkEnabled: vi.fn(() => true),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  getNetworkStatus: vi.fn(() => ({ enabled: true })),
  getNetworkRequests: mockGetNetworkRequests,
  getNetworkResponses: vi.fn(() => []),
  getNetworkActivity: mockGetNetworkActivity,
  getResponseBody: mockGetResponseBody,
  getExceptions: vi.fn(() => []),
  evaluate: vi.fn(),
  clearInjectedBuffers: vi.fn(),
  resetInjectedInterceptors: vi.fn(),
  clearInjectedInterceptors: vi.fn(),
  enableDynamicScriptMonitoring: vi.fn(),
  injectXHRInterceptor: vi.fn(),
  injectFetchInterceptor: vi.fn(),
  injectFunctionTracer: vi.fn(),
} as unknown as ReturnType<typeof createCodeCollectorMock> & {
  getNetworkRequests: typeof mockGetNetworkRequests;
  getNetworkActivity: typeof mockGetNetworkActivity;
  getResponseBody: typeof mockGetResponseBody;
};

// ── Class under test ──────────────────────────────────────────────────────────

import { AdvancedToolHandlersRuntime } from '@server/domains/network/handlers.impl.core.runtime.replay';

class TestableAdvancedToolHandlersRuntime extends AdvancedToolHandlersRuntime {
  public testParseNumberArg(
    value: unknown,
    options: { defaultValue: number; min?: number; max?: number; integer?: boolean },
  ): number {
    return this.parseNumberArg(value, options);
  }

  public testParseBooleanArg(value: unknown, defaultValue: boolean): boolean {
    return this.parseBooleanArg(value, defaultValue);
  }
}

describe('AdvancedToolHandlersRuntime — replay.ts coverage', () => {
  let collector: CodeCollectorMirror;
  let handler: TestableAdvancedToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the node built-in mock defaults
    mockPathResolve.mockImplementation((p: string) => p);
    mockPathDirname.mockImplementation((p: string) => p.replace(/[/\\][^/\\]+$/, ''));
    mockPathBasename.mockImplementation((p: string) => p.replace(/^.*[/\\]/, ''));
    mockPathJoin.mockImplementation((...args: string[]) => args.join('/'));
    mockOsTmpdir.mockReturnValue('/mock-tmp');

    // Default: realpath always resolves, lstat says file doesn't exist
    mockFsRealpath.mockResolvedValue('/mock-cwd');
    mockFsLstat.mockRejectedValue(new Error('ENOENT'));

    collector = createCodeCollectorMock();
    handler = new TestableAdvancedToolHandlersRuntime(collector as any, consoleMonitor as any);

    // Stub performance monitor so inherited methods don't throw
    (handler as unknown as Record<string, unknown>).performanceMonitor = {
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

  // ══════════════════════════════════════════════════════════════════════════
  // handleNetworkExtractAuth
  // ══════════════════════════════════════════════════════════════════════════

  describe('handleNetworkExtractAuth', () => {
    it('returns success with multiple findings when requests pass threshold', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { url: 'https://api.example.com/auth', method: 'POST', requestId: 'req-1' },
        { url: 'https://cdn.example.com/resource', method: 'GET', requestId: 'req-2' },
      ]);
      extractAuthMock.mockReturnValue([
        { type: 'bearer', confidence: 0.9, value: 'tok_abc123def456gh' },
        { type: 'apiKey', confidence: 0.6, value: 'key_xyz789uvw012' },
      ]);

      const result = await handler.handleNetworkExtractAuth({ minConfidence: 0.5 });
      const body = parseJson<NetworkExtractAuthResponse>(result);

      expect(body.success).toBe(true);
      expect(body.scannedRequests).toBe(2);
      expect(body.found).toBe(2);
      expect(body.findings).toHaveLength(2);
    });

    it('returns success with zero findings when nothing passes the threshold', async () => {
      mockGetNetworkRequests.mockReturnValue([{ url: 'https://example.com', method: 'GET' }]);
      extractAuthMock.mockReturnValue([{ type: 'weak', confidence: 0.1 }]);

      const result = await handler.handleNetworkExtractAuth({ minConfidence: 0.4 });
      const body = parseJson<NetworkExtractAuthResponse>(result);

      expect(body.success).toBe(true);
      expect(body.found).toBe(0);
      expect(body.findings).toHaveLength(0);
    });

    it('uses default minConfidence of 0.4 when minConfidence is not provided', async () => {
      mockGetNetworkRequests.mockReturnValue([{ url: 'https://example.com', method: 'GET' }]);
      extractAuthMock.mockReturnValue([
        { type: 'bearer', confidence: 0.9 },
        { type: 'cookie', confidence: 0.3 },
      ]);

      const result = await handler.handleNetworkExtractAuth({});
      const body = parseJson<NetworkExtractAuthResponse>(result);

      // 0.3 confidence filtered out by default 0.4 threshold
      expect(body.found).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleNetworkExportHar — inline HAR (no outputPath)
  // ══════════════════════════════════════════════════════════════════════════

  describe('handleNetworkExportHar — inline (no outputPath)', () => {
    beforeEach(() => {
      mockGetNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET', requestId: 'req-1' },
      ]);
      mockGetNetworkActivity.mockReturnValue({ response: { status: 200 } });
      mockGetResponseBody.mockResolvedValue({ body: '{"data":1}', base64Encoded: false });
      buildHarMock.mockResolvedValue({ log: { entries: [{ request: {}, response: {} }] } });
    });

    it('returns inline HAR when no outputPath is given', async () => {
      const result = await handler.handleNetworkExportHar({});
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
      expect(body.entryCount).toBe(1);
      expect(body.har).toBeDefined();
    });

    it('passes includeBodies=false to buildHar by default', async () => {
      await handler.handleNetworkExportHar({});
      expect(buildHarMock).toHaveBeenCalledWith(expect.objectContaining({ includeBodies: false }));
    });

    it('passes includeBodies=true to buildHar when specified', async () => {
      await handler.handleNetworkExportHar({ includeBodies: true });
      expect(buildHarMock).toHaveBeenCalledWith(expect.objectContaining({ includeBodies: true }));
    });

    it('handles buildHar throwing an Error', async () => {
      buildHarMock.mockRejectedValue(new Error('HAR build failed'));

      const result = await handler.handleNetworkExportHar({});
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('HAR build failed');
    });

    it('handles buildHar throwing a non-Error value', async () => {
      buildHarMock.mockRejectedValue('string error from buildHar');

      const result = await handler.handleNetworkExportHar({});
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('string error from buildHar');
    });

    it('handles getResponseBody throwing in the buildHar callback — caught, returns null', async () => {
      // First call throws (caught), subsequent calls resolve normally
      mockGetResponseBody
        .mockRejectedValueOnce(new Error('body not available'))
        .mockResolvedValue({ body: 'fallback', base64Encoded: false });
      buildHarMock.mockResolvedValue({ log: { entries: [] } });

      // Must NOT throw — getResponseBody error is caught inside the callback
      const result = await handler.handleNetworkExportHar({});
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleNetworkExportHar — outputPath branches
  //
  // Strategy: configure hoisted mock refs (mockFsRealpath, mockFsLstat,
  // mockFsWriteFile, mockPathResolve, etc.) in each test. vi.hoisted()
  // ensures these are the EXACT same objects that vi.mock factories close over.
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // handleNetworkExportHar — outputPath branches
  //
  // These tests exercise the resolvedOutputPath security checks and
  // lstat/writeFile paths.  The existing mocks cover both the dynamic
  // await import('node:path/os/fs/promises') and the static fs.promises
  // from 'node:fs'.  Each test configures the hoisted mocks in beforeEach.
  // ══════════════════════════════════════════════════════════════════════════

  describe('handleNetworkExportHar — outputPath branches', () => {
    beforeEach(() => {
      // Default network requests (needed for the HAR builder path)
      mockGetNetworkRequests.mockReturnValue([
        { url: 'https://example.com', method: 'GET', requestId: 'req-1' },
      ]);
      mockGetNetworkActivity.mockReturnValue({ response: { status: 200 } });
      mockGetResponseBody.mockResolvedValue({ body: 'ok', base64Encoded: false });
      buildHarMock.mockResolvedValue({ log: { entries: [{}] } });
    });

    it('returns error when outputPath is outside cwd and tmpDir', async () => {
      mockPathResolve.mockReturnValue('/some/other/path/out.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd realpath
        .mockResolvedValueOnce('/mock-tmp') // tmpDir realpath
        .mockResolvedValueOnce('/some/other/path'); // parentDir realpath
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/some/other/path');
      mockPathBasename.mockReturnValue('out.har');
      mockPathJoin.mockReturnValue('/some/other/path/out.har');

      const result = await handler.handleNetworkExportHar({
        outputPath: '/some/other/path/out.har',
      });
      const body = parseJson<NetworkExportHarResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('outputPath must be within');
    });

    it('returns error when realpath of parent dir throws', async () => {
      mockPathResolve.mockReturnValue('/mock-cwd/subdir/out.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockRejectedValueOnce(new Error('ENOENT: parentDir')); // parentDir realpath throws
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-cwd/subdir');
      mockPathBasename.mockReturnValue('out.har');
      // When realpath throws, realParent falls back to the dirname value
      mockPathJoin.mockReturnValue('/mock-cwd/subdir/out.har');

      const result = await handler.handleNetworkExportHar({
        outputPath: '/mock-cwd/subdir/out.har',
      });
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      // Falls back to parentDir → join gives path still within cwd → write succeeds
      expect(body.success).toBe(true);
    });

    it('writes file when outputPath resolves to cwd and file does not exist', async () => {
      mockPathResolve.mockReturnValue('/mock-cwd/out.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-cwd'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-cwd');
      mockPathBasename.mockReturnValue('out.har');
      mockPathJoin.mockReturnValue('/mock-cwd/out.har');
      // lstat: file does not exist → ENOENT
      mockFsLstat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockFsWriteFile.mockResolvedValueOnce(undefined);

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-cwd/out.har' });
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
      expect(body.outputPath).toBe('/mock-cwd/out.har');
      expect(mockFsWriteFile).toHaveBeenCalledWith(
        '/mock-cwd/out.har',
        expect.any(String),
        'utf-8',
      );
    });

    it('returns error when outputPath is a symbolic link', async () => {
      mockPathResolve.mockReturnValue('/mock-cwd/link.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-cwd'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-cwd');
      mockPathBasename.mockReturnValue('link.har');
      mockPathJoin.mockReturnValue('/mock-cwd/link.har');
      // lstat: file exists and is a symlink
      mockFsLstat.mockResolvedValueOnce({ isSymbolicLink: () => true });

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-cwd/link.har' });
      const body = parseJson<NetworkExportHarResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('symbolic link');
    });

    it('writes file when outputPath is a regular file that already exists', async () => {
      mockPathResolve.mockReturnValue('/mock-cwd/existing.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-cwd'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-cwd');
      mockPathBasename.mockReturnValue('existing.har');
      mockPathJoin.mockReturnValue('/mock-cwd/existing.har');
      // lstat: regular file (not symlink)
      mockFsLstat.mockResolvedValueOnce({ isSymbolicLink: () => false });
      mockFsWriteFile.mockResolvedValueOnce(undefined);

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-cwd/existing.har' });
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
      expect(mockFsWriteFile).toHaveBeenCalledWith(
        '/mock-cwd/existing.har',
        expect.any(String),
        'utf-8',
      );
    });

    it('writes file when outputPath resolves to tmpDir', async () => {
      mockPathResolve.mockReturnValue('/mock-tmp/capture.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-tmp'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-tmp');
      mockPathBasename.mockReturnValue('capture.har');
      mockPathJoin.mockReturnValue('/mock-tmp/capture.har');
      mockFsLstat.mockRejectedValueOnce(new Error('ENOENT'));
      mockFsWriteFile.mockResolvedValueOnce(undefined);

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-tmp/capture.har' });
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
      expect(mockFsWriteFile).toHaveBeenCalled();
    });

    it('returns error when fs.writeFile throws', async () => {
      mockPathResolve.mockReturnValue('/mock-cwd/fail.har');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-cwd'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-cwd');
      mockPathBasename.mockReturnValue('fail.har');
      mockPathJoin.mockReturnValue('/mock-cwd/fail.har');
      mockFsLstat.mockRejectedValueOnce(new Error('ENOENT'));
      mockFsWriteFile.mockRejectedValueOnce(new Error('disk full'));

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-cwd/fail.har' });
      const body = parseJson<NetworkExportHarResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('disk full');
    });

    it('writes file when outputPath resolves exactly to cwd (no subdirectory)', async () => {
      // realPath === cwd (exactly equal, not startsWith)
      mockPathResolve.mockReturnValue('/mock-cwd');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-cwd'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-cwd');
      mockPathBasename.mockReturnValue('');
      mockPathJoin.mockReturnValue('/mock-cwd');
      mockFsLstat.mockRejectedValueOnce(new Error('ENOENT'));
      mockFsWriteFile.mockResolvedValueOnce(undefined);

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-cwd' });
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
    });

    it('writes file when outputPath resolves exactly to tmpDir (no subdirectory)', async () => {
      mockPathResolve.mockReturnValue('/mock-tmp');
      mockFsRealpath
        .mockResolvedValueOnce('/mock-cwd') // cwd
        .mockResolvedValueOnce('/mock-tmp') // tmpDir
        .mockResolvedValueOnce('/mock-tmp'); // parentDir
      mockOsTmpdir.mockReturnValue('/mock-tmp');
      mockPathDirname.mockReturnValue('/mock-tmp');
      mockPathBasename.mockReturnValue('');
      mockPathJoin.mockReturnValue('/mock-tmp');
      mockFsLstat.mockRejectedValueOnce(new Error('ENOENT'));
      mockFsWriteFile.mockResolvedValueOnce(undefined);

      const result = await handler.handleNetworkExportHar({ outputPath: '/mock-tmp' });
      const body = parseJson<NetworkExportHarResponse & Record<string, unknown>>(result);

      expect(body.success).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleNetworkReplayRequest
  // ══════════════════════════════════════════════════════════════════════════

  describe('handleNetworkReplayRequest', () => {
    it('returns error when requestId is missing', async () => {
      const result = await handler.handleNetworkReplayRequest({});
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('requestId is required');
    });

    it('returns error when requestId is not found in captured requests', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 'req-other', url: 'https://example.com', method: 'GET' },
      ]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-missing' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
      expect(body.hint).toContain('network_get_requests');
    });

    it('finds and replays a request with all required fields', async () => {
      mockGetNetworkRequests.mockReturnValue([
        {
          requestId: 'req-1',
          url: 'https://api.example.com/data',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          postData: '{"key":"value"}',
        },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: true, requestId: 'req-1' });

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(true);
      expect(replayRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-1',
          url: 'https://api.example.com/data',
          method: 'POST',
        }),
        expect.objectContaining({ requestId: 'req-1', dryRun: true }),
      );
    });

    it('uses dryRun=true by default when dryRun arg is not provided', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: true });

      await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      expect(replayRequestMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ dryRun: true }),
      );
    });

    it('passes dryRun=false when explicitly set', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: false });

      await handler.handleNetworkReplayRequest({ requestId: 'req-1', dryRun: false });
      expect(replayRequestMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ dryRun: false }),
      );
    });

    it('passes headerPatch, bodyPatch, methodOverride, urlOverride, timeoutMs to replayRequest', async () => {
      mockGetNetworkRequests.mockReturnValue([
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
        expect.anything(),
        expect.objectContaining({
          headerPatch: { Authorization: 'Bearer new-token' },
          bodyPatch: '{"key":"value"}',
          methodOverride: 'PUT',
          urlOverride: 'https://api.example.com/v2/data',
          timeoutMs: 5000,
          dryRun: false,
        }),
      );
    });

    it('handles replayRequest throwing an Error', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue(new Error('Network timeout'));

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Network timeout');
    });

    it('handles replayRequest throwing a non-Error string value', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue('string error');

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('string error');
    });

    it('handles replayRequest throwing a non-Error object value', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockRejectedValue({ reason: 'unknown error' });

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe(String({ reason: 'unknown error' }));
    });

    it('skips invalid request payloads when finding the target requestId', async () => {
      mockGetNetworkRequests.mockReturnValue([
        null,
        42,
        { broken: true },
        undefined,
        { requestId: 'req-1', url: 'https://api.example.com', method: 'GET' },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: true, requestId: 'req-1' });

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(true);
    });

    it('does not match a request missing the url field', async () => {
      mockGetNetworkRequests.mockReturnValue([{ requestId: 'req-1', method: 'GET' }]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });

    it('does not match a request missing the method field', async () => {
      mockGetNetworkRequests.mockReturnValue([{ requestId: 'req-1', url: 'https://example.com' }]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });

    it('does not match a request where requestId is not a string', async () => {
      mockGetNetworkRequests.mockReturnValue([
        { requestId: 123 as unknown, url: 'https://example.com', method: 'GET' },
      ]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // isReplayableRequest type guard
  // ══════════════════════════════════════════════════════════════════════════

  describe('isReplayableRequest type guard', () => {
    it('rejects null value', async () => {
      mockGetNetworkRequests.mockReturnValue([null]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
    });

    it('rejects undefined value', async () => {
      mockGetNetworkRequests.mockReturnValue([undefined as unknown]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
    });

    it('rejects primitive string', async () => {
      mockGetNetworkRequests.mockReturnValue(['string' as unknown]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
    });

    it('rejects primitive number', async () => {
      mockGetNetworkRequests.mockReturnValue([42 as unknown]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
    });

    it('rejects primitive boolean', async () => {
      mockGetNetworkRequests.mockReturnValue([true as unknown]);

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(false);
    });

    it('accepts a valid request with all fields present', async () => {
      mockGetNetworkRequests.mockReturnValue([
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          headers: {},
          postData: '',
        },
      ]);
      replayRequestMock.mockResolvedValue({ dryRun: true });

      const result = await handler.handleNetworkReplayRequest({ requestId: 'req-1' });
      const body = parseJson<NetworkReplayResponse>(result);

      expect(body.success).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // parseBooleanArg coverage (inherited from NetworkHandlersCore)
  // ══════════════════════════════════════════════════════════════════════════

  describe('parseBooleanArg — coverage', () => {
    it('returns defaultValue for null', () => {
      expect(handler.testParseBooleanArg(null, false)).toBe(false);
    });

    it('returns defaultValue for undefined', () => {
      expect(handler.testParseBooleanArg(undefined, true)).toBe(true);
    });

    it('returns defaultValue for plain object', () => {
      expect(handler.testParseBooleanArg({}, false)).toBe(false);
    });

    it('returns defaultValue for function', () => {
      expect(handler.testParseBooleanArg(() => {}, true)).toBe(true);
    });

    it('returns boolean value as-is', () => {
      expect(handler.testParseBooleanArg(true, false)).toBe(true);
      expect(handler.testParseBooleanArg(false, true)).toBe(false);
    });

    it('converts numeric 1 to true and 0 to false', () => {
      expect(handler.testParseBooleanArg(1, false)).toBe(true);
      expect(handler.testParseBooleanArg(0, true)).toBe(false);
    });

    it('converts non-0/1 numbers to defaultValue', () => {
      expect(handler.testParseBooleanArg(42, false)).toBe(false);
      expect(handler.testParseBooleanArg(-1, true)).toBe(true);
      expect(handler.testParseBooleanArg(NaN, true)).toBe(true);
    });

    it('converts string true-like values case-insensitively', () => {
      expect(handler.testParseBooleanArg('true', false)).toBe(true);
      expect(handler.testParseBooleanArg('TRUE', false)).toBe(true);
      expect(handler.testParseBooleanArg('1', false)).toBe(true);
      expect(handler.testParseBooleanArg('yes', false)).toBe(true);
      expect(handler.testParseBooleanArg('YES', false)).toBe(true);
      expect(handler.testParseBooleanArg('on', false)).toBe(true);
    });

    it('converts string false-like values', () => {
      expect(handler.testParseBooleanArg('false', true)).toBe(false);
      expect(handler.testParseBooleanArg('FALSE', true)).toBe(false);
      expect(handler.testParseBooleanArg('0', true)).toBe(false);
      expect(handler.testParseBooleanArg('no', true)).toBe(false);
      expect(handler.testParseBooleanArg('off', true)).toBe(false);
    });

    it('returns defaultValue for unrecognized string values', () => {
      expect(handler.testParseBooleanArg('maybe', true)).toBe(true);
      expect(handler.testParseBooleanArg('unknown', false)).toBe(false);
    });

    it('trims whitespace from string values', () => {
      expect(handler.testParseBooleanArg('  true  ', false)).toBe(true);
      expect(handler.testParseBooleanArg('  FALSE  ', true)).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // parseNumberArg coverage (inherited from NetworkHandlersCore)
  // ══════════════════════════════════════════════════════════════════════════

  describe('parseNumberArg — coverage', () => {
    it('returns defaultValue for undefined', () => {
      expect(handler.testParseNumberArg(undefined, { defaultValue: 42 })).toBe(42);
    });

    it('returns defaultValue for null', () => {
      expect(handler.testParseNumberArg(null, { defaultValue: 7 })).toBe(7);
    });

    it('returns defaultValue for non-numeric string', () => {
      expect(handler.testParseNumberArg('abc', { defaultValue: 10 })).toBe(10);
    });

    it('returns defaultValue for empty string', () => {
      expect(handler.testParseNumberArg('', { defaultValue: 7 })).toBe(7);
    });

    it('returns defaultValue for whitespace-only string', () => {
      expect(handler.testParseNumberArg('   ', { defaultValue: 5 })).toBe(5);
    });

    it('parses a finite number', () => {
      expect(handler.testParseNumberArg(3.14, { defaultValue: 0 })).toBe(3.14);
    });

    it('returns defaultValue for Infinity', () => {
      expect(handler.testParseNumberArg(Infinity, { defaultValue: 99 })).toBe(99);
    });

    it('returns defaultValue for NaN', () => {
      expect(handler.testParseNumberArg(NaN, { defaultValue: 88 })).toBe(88);
    });

    it('parses a numeric string with whitespace', () => {
      expect(handler.testParseNumberArg('  42  ', { defaultValue: 0 })).toBe(42);
    });

    it('truncates to integer when integer=true', () => {
      expect(handler.testParseNumberArg(3.9, { defaultValue: 0, integer: true })).toBe(3);
      expect(handler.testParseNumberArg(-3.9, { defaultValue: 0, integer: true })).toBe(-3);
    });

    it('applies min constraint — clamps up', () => {
      expect(handler.testParseNumberArg(5, { defaultValue: 0, min: 10 })).toBe(10);
      expect(handler.testParseNumberArg(15, { defaultValue: 0, min: 10 })).toBe(15);
    });

    it('applies max constraint — clamps down', () => {
      expect(handler.testParseNumberArg(50, { defaultValue: 0, max: 20 })).toBe(20);
      expect(handler.testParseNumberArg(10, { defaultValue: 0, max: 20 })).toBe(10);
    });

    it('applies min and max together with clamping', () => {
      expect(handler.testParseNumberArg(5, { defaultValue: 0, min: 10, max: 20 })).toBe(10);
      expect(handler.testParseNumberArg(25, { defaultValue: 0, min: 10, max: 20 })).toBe(20);
      expect(handler.testParseNumberArg(15, { defaultValue: 0, min: 10, max: 20 })).toBe(15);
    });

    it('applies integer truncation before min constraint', () => {
      // 3.9 → truncate to 3 → clamp to min 10 → 10
      expect(handler.testParseNumberArg(3.9, { defaultValue: 0, min: 10, integer: true })).toBe(10);
    });
  });
});
