import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cdpLimitMock, smartHandleMock, loggerMocks } = vi.hoisted(() => ({
  cdpLimitMock: vi.fn(),
  smartHandleMock: vi.fn(),
  loggerMocks: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function noopChunkListener(_params: any): void {}

vi.mock('@src/utils/concurrency', () => ({
  cdpLimit: (...args: any[]) => (cdpLimitMock as any)(...args),
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (...args: any[]) => (smartHandleMock as any)(...args),
    }),
  },
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerMocks,
}));

import { JSHeapSearchHandlers } from '@server/domains/browser/handlers/js-heap';

describe('JSHeapSearchHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cdpLimitMock.mockImplementation(async (fn: () => Promise<any>) => fn());
    smartHandleMock.mockImplementation((value: any) => value);
  });

  it('returns a validation error when pattern is missing', async () => {
    const getActivePage = vi.fn();
    const handlers = new JSHeapSearchHandlers({
      getActivePage,
      getActiveDriver: () => 'chrome',
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleJSHeapSearch({}));

    expect(body.success).toBe(false);
    expect(body.error).toContain('pattern is required');
    expect(cdpLimitMock).not.toHaveBeenCalled();
    expect(getActivePage).not.toHaveBeenCalled();
  });

  it('takes a heap snapshot with default options and returns matched strings', async () => {
    let chunkListener = noopChunkListener;
    const snapshot = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id'],
          node_types: [['hidden', 'array', 'string', 'object']],
        },
      },
      strings: ['unused', 'secret token', 'other value'],
      nodes: [2, 1, 101, 2, 2, 102],
    });

    const cdpSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          const midpoint = Math.floor(snapshot.length / 2);
          chunkListener({ chunk: snapshot.slice(0, midpoint) });
          chunkListener({ chunk: snapshot.slice(midpoint) });
        }
      }),
      on: vi.fn((event: string, listener: (params: any) => void) => {
        if (event === 'HeapProfiler.addHeapSnapshotChunk') {
          chunkListener = listener;
        }
      }),
      detach: vi.fn(async () => {}),
    };

    const page = {
      createCDPSession: vi.fn(async () => cdpSession),
    };

    const handlers = new JSHeapSearchHandlers({
      getActivePage: vi.fn(async () => page),
      getActiveDriver: () => 'chrome',
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleJSHeapSearch({ pattern: 'secret' }),
    );

    expect(cdpLimitMock).toHaveBeenCalledOnce();
    expect(page.createCDPSession).toHaveBeenCalledOnce();
    expect(cdpSession.on).toHaveBeenCalledWith(
      'HeapProfiler.addHeapSnapshotChunk',
      expect.any(Function),
    );
    expect(cdpSession.send).toHaveBeenNthCalledWith(1, 'HeapProfiler.enable');
    expect(cdpSession.send).toHaveBeenNthCalledWith(2, 'HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
      captureNumericValue: false,
    });
    expect(cdpSession.send).toHaveBeenNthCalledWith(3, 'HeapProfiler.disable');
    expect(smartHandleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        pattern: 'secret',
        caseSensitive: false,
        matchCount: 1,
        truncated: false,
      }),
      51200,
    );
    expect(body.success).toBe(true);
    expect(body.matchCount).toBe(1);
    expect(body.matches[0]).toMatchObject({
      nodeId: 101,
      nodeType: 'string',
      objectPath: '[HeapNode #101]',
      value: 'secret token',
    });
    expect(body.tip).toContain('page_evaluate');
    expect(cdpSession.detach).toHaveBeenCalledOnce();
  });

  it('accepts legacy query as an alias for pattern', async () => {
    let chunkListener = noopChunkListener;
    const snapshot = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id'],
          node_types: [['hidden', 'array', 'string', 'object']],
        },
      },
      strings: ['unused', 'legacy secret', 'other value'],
      nodes: [2, 1, 201, 2, 2, 202],
    });

    const cdpSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          chunkListener({ chunk: snapshot });
        }
      }),
      on: vi.fn((event: string, listener: (params: any) => void) => {
        if (event === 'HeapProfiler.addHeapSnapshotChunk') {
          chunkListener = listener;
        }
      }),
      detach: vi.fn(async () => {}),
    };

    const page = {
      createCDPSession: vi.fn(async () => cdpSession),
    };

    const handlers = new JSHeapSearchHandlers({
      getActivePage: vi.fn(async () => page),
      getActiveDriver: () => 'chrome',
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleJSHeapSearch({ query: 'legacy secret' }),
    );

    expect(body.success).toBe(true);
    expect(body.pattern).toBe('legacy secret');
    expect(body.matchCount).toBe(1);
    expect(body.matches[0]).toMatchObject({
      nodeId: 201,
      value: 'legacy secret',
    });
    expect(cdpSession.detach).toHaveBeenCalledOnce();
  });

  it('returns an error payload and detaches the CDP session when snapshot capture fails', async () => {
    const cdpSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          throw new Error('snapshot failed');
        }
      }),
      on: vi.fn(),
      detach: vi.fn(async () => {}),
    };

    const page = {
      createCDPSession: vi.fn(async () => cdpSession),
    };

    const handlers = new JSHeapSearchHandlers({
      getActivePage: vi.fn(async () => page),
      getActiveDriver: () => 'chrome',
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleJSHeapSearch({
        pattern: 'secret',
        maxResults: 3,
        caseSensitive: true,
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('snapshot failed');
    expect(cdpSession.detach).toHaveBeenCalledOnce();
  });
});
