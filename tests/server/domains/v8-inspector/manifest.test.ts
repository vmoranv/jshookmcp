import { describe, it, expect, vi, beforeEach } from 'vitest';
import manifest from '../../../../src/server/domains/v8-inspector/manifest';
import {
  getSnapshotCache,
  clearSnapshotCache,
} from '../../../../src/server/domains/v8-inspector/handlers/heap-snapshot';

describe('v8-inspector manifest', () => {
  it('should have correct domain configuration', async () => {
    expect(manifest.domain).toBe('v8-inspector');
    expect(manifest.depKey).toBe('v8InspectorHandlers');
    expect(manifest.version).toBe(1);
    expect(manifest.kind).toBe('domain-manifest');
  });

  it('should have workflow and full profiles', async () => {
    expect(manifest.profiles).toContain('workflow');
    expect(manifest.profiles).toContain('full');
  });

  it('should have all tool registrations', async () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name);

    expect(toolNames).toContain('v8_heap_snapshot_capture');
    expect(toolNames).toContain('v8_heap_snapshot_analyze');
    expect(toolNames).toContain('v8_heap_diff');
    expect(toolNames).toContain('v8_object_inspect');
    expect(toolNames).toContain('v8_heap_stats');
  });

  it('should have prerequisites configured', async () => {
    expect(manifest.prerequisites).toBeDefined();
    expect(manifest.prerequisites?.v8_heap_snapshot_capture).toBeDefined();
    expect(manifest.prerequisites?.v8_heap_snapshot_analyze).toBeDefined();
    expect(manifest.prerequisites?.v8_heap_diff).toBeDefined();
  });

  it('should have tool dependencies', async () => {
    expect(manifest.toolDependencies).toBeDefined();
    expect(manifest.toolDependencies?.length).toBeGreaterThan(0);
  });

  it('should have a workflow rule', async () => {
    expect(manifest.workflowRule).toBeDefined();
    expect(manifest.workflowRule?.patterns.length).toBeGreaterThan(0);
    expect(manifest.workflowRule?.tools).toContain('v8_heap_snapshot_capture');
  });

  it('should have ensure function that returns handler instance', async () => {
    const mockCtx = {
      pageController: {
        getPage: vi.fn().mockResolvedValue({ createCDPSession: vi.fn() }),
      },
      workerPool: null,
    } as unknown as import('@server/MCPServer.context').MCPServerContext;

    const handler = await manifest.ensure(mockCtx);

    expect(handler).toBeDefined();
    expect(typeof handler.v8_heap_snapshot_capture).toBe('function');
    expect(typeof handler.v8_heap_snapshot_analyze).toBe('function');
    expect(typeof handler.v8_heap_diff).toBe('function');
    expect(typeof handler.v8_object_inspect).toBe('function');
    expect(typeof handler.v8_heap_stats).toBe('function');
    expect(typeof handler.handle).toBe('function');

    // Clean up
    expect(mockCtx.v8InspectorHandlers).toBe(handler);
  });

  it('should wire heap capture through pageController.getPage()', async () => {
    const chunk = '{"snapshot":true}';
    let chunkListener: ((payload: { chunk: string }) => void) | undefined;
    const session = {
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.enable') return {};
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          chunkListener?.({ chunk });
          return {};
        }
        return {};
      }),
      on: vi.fn((event: string, listener: (payload: { chunk: string }) => void) => {
        if (event === 'HeapProfiler.addHeapSnapshotChunk') {
          chunkListener = listener;
        }
      }),
      off: vi.fn(),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      createCDPSession: vi.fn().mockResolvedValue(session),
    };
    const pageController = {
      getPage: vi.fn().mockResolvedValue(page),
    };
    const mockCtx = {
      pageController,
      eventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as import('@server/MCPServer.context').MCPServerContext;

    const handler = await manifest.ensure(mockCtx);
    const result = await handler.v8_heap_snapshot_capture({});

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(page.createCDPSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      simulated: false,
      sizeBytes: Buffer.byteLength(chunk, 'utf8'),
    });
  });

  it('should throw if pageController is missing', async () => {
    const mockCtx = {} as import('@server/MCPServer.context').MCPServerContext;

    await expect(manifest.ensure(mockCtx)).rejects.toThrow(
      'v8-inspector: PageController not available',
    );
  });
});

describe('v8-inspector snapshot cache', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  it('should return empty cache initially', async () => {
    const cache = getSnapshotCache();
    expect(cache.size).toBe(0);
  });

  it('should allow clearing', async () => {
    const cache = getSnapshotCache();
    cache.set('test', {
      id: 'test',
      chunks: [],
      capturedAt: new Date().toISOString(),
      sizeBytes: 0,
    });
    expect(cache.size).toBe(1);
    clearSnapshotCache();
    expect(cache.size).toBe(0);
  });
});
