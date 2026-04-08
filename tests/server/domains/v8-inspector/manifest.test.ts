import { describe, it, expect, vi, beforeEach } from 'vitest';
import manifest from '../../../../src/server/domains/v8-inspector/manifest';
import {
  getSnapshotCache,
  clearSnapshotCache,
} from '../../../../src/server/domains/v8-inspector/handlers/heap-snapshot';

describe('v8-inspector manifest', () => {
  it('should have correct domain configuration', () => {
    expect(manifest.domain).toBe('v8-inspector');
    expect(manifest.depKey).toBe('v8InspectorHandlers');
    expect(manifest.version).toBe(1);
    expect(manifest.kind).toBe('domain-manifest');
  });

  it('should have workflow and full profiles', () => {
    expect(manifest.profiles).toContain('workflow');
    expect(manifest.profiles).toContain('full');
  });

  it('should have all tool registrations', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name);

    expect(toolNames).toContain('v8_heap_snapshot_capture');
    expect(toolNames).toContain('v8_heap_snapshot_analyze');
    expect(toolNames).toContain('v8_heap_diff');
    expect(toolNames).toContain('v8_object_inspect');
    expect(toolNames).toContain('v8_heap_stats');
  });

  it('should have prerequisites configured', () => {
    expect(manifest.prerequisites).toBeDefined();
    expect(manifest.prerequisites?.v8_heap_snapshot_capture).toBeDefined();
    expect(manifest.prerequisites?.v8_heap_snapshot_analyze).toBeDefined();
    expect(manifest.prerequisites?.v8_heap_diff).toBeDefined();
  });

  it('should have tool dependencies', () => {
    expect(manifest.toolDependencies).toBeDefined();
    expect(manifest.toolDependencies?.length).toBeGreaterThan(0);
  });

  it('should have a workflow rule', () => {
    expect(manifest.workflowRule).toBeDefined();
    expect(manifest.workflowRule?.patterns.length).toBeGreaterThan(0);
    expect(manifest.workflowRule?.tools).toContain('v8_heap_snapshot_capture');
  });

  it('should have ensure function that returns handler instance', async () => {
    const mockCtx = {
      pageController: {
        sendCDPCommand: vi.fn().mockResolvedValue({}),
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

  it('should return empty cache initially', () => {
    const cache = getSnapshotCache();
    expect(cache.size).toBe(0);
  });

  it('should allow clearing', () => {
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
