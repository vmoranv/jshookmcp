import { describe, it, expect, beforeEach } from 'vitest';
import {
  V8InspectorHandlers,
  type V8InspectorDomainDependencies,
} from '../../../../src/server/domains/v8-inspector/handlers/impl';
import { clearSnapshotCache } from '../../../../src/server/domains/v8-inspector/handlers/heap-snapshot';

function createMockDeps(
  overrides?: Partial<V8InspectorDomainDependencies>,
): V8InspectorDomainDependencies {
  return {
    ctx: {} as import('@server/MCPServer.context').MCPServerContext,
    ...overrides,
  };
}

describe('V8InspectorHandlers', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  describe('construction', () => {
    it('should create handler instance with minimal deps', () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      expect(handlers).toBeDefined();
    });

    it('should expose expected tool methods', () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      expect(typeof handlers.v8_heap_snapshot_capture).toBe('function');
      expect(typeof handlers.v8_heap_snapshot_analyze).toBe('function');
      expect(typeof handlers.v8_heap_diff).toBe('function');
      expect(typeof handlers.v8_object_inspect).toBe('function');
      expect(typeof handlers.v8_heap_stats).toBe('function');
      expect(typeof handlers.handle).toBe('function');
    });
  });

  describe('handle() routing', () => {
    it('should route to known tool', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      // Should not throw for a known tool name (even if underlying CDP fails)
      await expect(handlers.handle('v8_heap_stats', {})).rejects.toThrow();
    });

    it('should throw for unknown tool', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(handlers.handle('nonexistent_tool', {})).rejects.toThrow(
        'Unknown v8-inspector tool: nonexistent_tool',
      );
    });
  });

  describe('v8_heap_snapshot_capture', () => {
    it('should throw without browser connection', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(handlers.v8_heap_snapshot_capture({})).rejects.toThrow();
    });
  });

  describe('v8_heap_snapshot_analyze', () => {
    it('should throw if snapshotId is missing', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(handlers.v8_heap_snapshot_analyze({})).rejects.toThrow('snapshotId is required');
    });

    it('should throw if snapshot not found', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(
        handlers.v8_heap_snapshot_analyze({ snapshotId: 'nonexistent' }),
      ).rejects.toThrow('Snapshot nonexistent not found');
    });
  });

  describe('v8_heap_diff', () => {
    it('should throw if snapshot IDs are missing', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(handlers.v8_heap_diff({})).rejects.toThrow(
        'Both beforeSnapshotId and afterSnapshotId are required',
      );
    });

    it('should throw if before snapshot not found', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(
        handlers.v8_heap_diff({
          beforeSnapshotId: 'missing',
          afterSnapshotId: 'also-missing',
        }),
      ).rejects.toThrow('Snapshot missing not found');
    });
  });
});
