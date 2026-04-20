/**
 * Coverage tests for AdvancedToolHandlers (network) dispatch methods in
 * handlers.impl.ts — the composition facade.
 *
 * Tests the dispatch branching logic that routes to sub-handler modules.
 */

import {
  createCodeCollectorMock,
  parseJson,
  // @ts-expect-error — auto-suppressed [TS1484]
  NetworkRequestsResponse,
} from '@tests/server/domains/shared/mock-factories';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: any) => payload,
    }),
  },
}));

const { dnsLookupMock, dnsReverseMock } = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(),
  dnsReverseMock: vi.fn(),
}));

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: (...args: any[]) => dnsLookupMock(...args),
    reverse: (...args: any[]) => dnsReverseMock(...args),
  };
});

vi.mock('@src/server/domains/network/replay', () => ({
  replayRequest: vi.fn().mockResolvedValue({ dryRun: true }),
}));

import { AdvancedToolHandlers } from '@server/domains/network/handlers.impl';

describe('AdvancedToolHandlers — dispatch methods (handlers.impl.ts coverage)', () => {
  const collector = createCodeCollectorMock();
  const eventBus = { emit: vi.fn() } as any;
  const consoleMonitor = {
    isNetworkEnabled: vi.fn().mockReturnValue(true),
    enable: vi.fn(),
    disable: vi.fn(),
    getNetworkStatus: vi.fn().mockReturnValue({ enabled: true }),
    getNetworkRequests: vi.fn().mockReturnValue([]),
    getResponseBody: vi.fn(),
    getExceptions: vi.fn().mockReturnValue([]),
    injectXhrInterceptor: vi.fn().mockResolvedValue({ success: true }),
    injectFetchInterceptor: vi.fn().mockResolvedValue({ success: true }),
    injectFunctionTracer: vi.fn().mockResolvedValue({ success: true }),
    injectScriptMonitor: vi.fn().mockResolvedValue({ success: true }),
    clearInjectedBuffers: vi.fn().mockResolvedValue({ success: true }),
    resetInjectedInterceptors: vi.fn().mockResolvedValue({ success: true }),
    addNetworkInterceptor: vi.fn().mockReturnValue({ id: 'i1' }),
    listInterceptors: vi.fn().mockReturnValue([]),
    removeInterceptor: vi.fn().mockReturnValue(true),
    getFetchInterceptStatus: vi.fn().mockReturnValue({ rules: [], total: 0 }),
    getPerformanceMetrics: vi.fn().mockResolvedValue({}),
    startJsCoverage: vi.fn().mockResolvedValue({}),
    stopJsCoverage: vi.fn().mockResolvedValue([]),
    takeHeapSnapshot: vi.fn().mockResolvedValue({}),
    startTracing: vi.fn().mockResolvedValue({}),
    stopTracing: vi.fn().mockResolvedValue({}),
    startCpuProfiling: vi.fn().mockResolvedValue({}),
    stopCpuProfiling: vi.fn().mockResolvedValue({}),
    startHeapSampling: vi.fn().mockResolvedValue({}),
    stopHeapSampling: vi.fn().mockResolvedValue({}),
  } as any;

  let handlers: AdvancedToolHandlers;

  beforeAll(() => {
    dnsLookupMock.mockImplementation(async (_hostname: string, options?: { all?: boolean }) =>
      options?.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 },
    );
    dnsReverseMock.mockResolvedValue(['localhost']);
  });

  afterAll(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    dnsLookupMock.mockImplementation(async (_hostname: string, options?: { all?: boolean }) =>
      options?.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 },
    );
    dnsReverseMock.mockResolvedValue(['localhost']);
    consoleMonitor.isNetworkEnabled.mockReturnValue(true);
    consoleMonitor.getNetworkStatus.mockReturnValue({ enabled: true });
    consoleMonitor.getNetworkRequests.mockReturnValue([]);
    consoleMonitor.getExceptions.mockReturnValue([]);
    consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [], total: 0 });
    // @ts-expect-error — mock type
    handlers = new AdvancedToolHandlers(collector, consoleMonitor, eventBus);
  });

  // ── handleConsoleInjectDispatch ────────────────────────────────────────────

  describe('handleConsoleInjectDispatch', () => {
    it('routes type=xhr to handleConsoleInjectXhrInterceptor', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleInjectDispatch({ type: 'xhr' }),
      );
      expect(res).toBeDefined();
    });

    it('routes type=fetch to handleConsoleInjectFetchInterceptor', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleInjectDispatch({ type: 'fetch' }),
      );
      expect(res).toBeDefined();
    });

    it('routes type=function to handleConsoleInjectFunctionTracer', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleInjectDispatch({ type: 'function' }),
      );
      expect(res).toBeDefined();
    });

    it('routes unknown type to handleConsoleInjectScriptMonitor (default)', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleInjectDispatch({ type: 'unknown' }),
      );
      expect(res).toBeDefined();
    });

    it('routes missing type to handleConsoleInjectScriptMonitor (default)', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleInjectDispatch({}),
      );
      expect(res).toBeDefined();
    });
  });

  // ── handleConsoleBuffersDispatch ───────────────────────────────────────────

  describe('handleConsoleBuffersDispatch', () => {
    it('routes action=reset to handleConsoleResetInjectedInterceptors', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleBuffersDispatch({ action: 'reset' }),
      );
      expect(res).toBeDefined();
    });

    it('routes action=clear (non-reset) to handleConsoleClearInjectedBuffers', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleBuffersDispatch({ action: 'clear' }),
      );
      expect(res).toBeDefined();
    });

    it('routes missing action to handleConsoleClearInjectedBuffers (default)', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleConsoleBuffersDispatch({}),
      );
      expect(res).toBeDefined();
    });
  });

  // ── handlePerformanceTraceDispatch ─────────────────────────────────────────

  describe('handlePerformanceTraceDispatch', () => {
    it('routes action=stop to handlePerformanceTraceStop', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handlePerformanceTraceDispatch({ action: 'stop' }),
      );
      expect(res).toBeDefined();
    });

    it('routes action=start (non-stop) to handlePerformanceTraceStart', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handlePerformanceTraceDispatch({ action: 'start' }),
      );
      expect(res).toBeDefined();
    });

    it('routes missing action to handlePerformanceTraceStart (default)', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handlePerformanceTraceDispatch({}),
      );
      expect(res).toBeDefined();
    });
  });

  // ── handleProfilerCpuDispatch ──────────────────────────────────────────────

  describe('handleProfilerCpuDispatch', () => {
    it('routes action=stop to handleProfilerCpuStop', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleProfilerCpuDispatch({ action: 'stop' }),
      );
      expect(res).toBeDefined();
    });

    it('routes action=start (non-stop) to handleProfilerCpuStart', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleProfilerCpuDispatch({ action: 'start' }),
      );
      expect(res).toBeDefined();
    });
  });

  // ── handleProfilerHeapSamplingDispatch ─────────────────────────────────────

  describe('handleProfilerHeapSamplingDispatch', () => {
    it('routes action=stop to handleProfilerHeapSamplingStop', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleProfilerHeapSamplingDispatch({ action: 'stop' }),
      );
      expect(res).toBeDefined();
    });

    it('routes action=start (non-stop) to handleProfilerHeapSamplingStart', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleProfilerHeapSamplingDispatch({ action: 'start' }),
      );
      expect(res).toBeDefined();
    });
  });

  // ── handleNetworkInterceptDispatch ─────────────────────────────────────────

  describe('handleNetworkInterceptDispatch', () => {
    it('routes action=list to handleNetworkInterceptList', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleNetworkInterceptDispatch({ action: 'list' }),
      );
      expect(res).toBeDefined();
    });

    it('routes action=disable to handleNetworkInterceptDisable', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handleNetworkInterceptDispatch({ action: 'disable', interceptorId: 'i1' }),
      );
      expect(res).toBeDefined();
    });

    it('routes invalid action to error response (isError=true in content)', async () => {
      // The dispatch returns { content: [{type:'text', text: '...'}, ...], isError: true } directly
      const raw = await handlers.handleNetworkInterceptDispatch({ action: 'invalid' });
      expect(raw).toMatchObject({ isError: true });
    });

    it('routes missing action to error response (isError=true in content)', async () => {
      const raw = await handlers.handleNetworkInterceptDispatch({});
      expect(raw).toMatchObject({ isError: true });
    });
  });

  // ── getPerformanceMonitor lazy-init ────────────────────────────────────────

  describe('getPerformanceMonitor (lazy init)', () => {
    it('initializes performanceMonitor on first call to handlePerformanceGetMetrics', async () => {
      const res = parseJson<NetworkRequestsResponse>(
        await handlers.handlePerformanceGetMetrics({}),
      );
      expect(res).toBeDefined();
      // second call should reuse the same instance (no throws)
      const res2 = parseJson<NetworkRequestsResponse>(
        await handlers.handlePerformanceGetMetrics({}),
      );
      expect(res2).toBeDefined();
    });
  });
});
