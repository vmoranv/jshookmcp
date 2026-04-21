import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must come before imports that reference the mocked modules.
// Mock factories MUST use `function` (not arrow) so `new` produces instances.
// ---------------------------------------------------------------------------

const mockExtractBytecode = vi.fn();
const mockDisassembleBytecode = vi.fn();
const mockFindHiddenClasses = vi.fn();
const mockInspectJIT = vi.fn();
const mockTakeHeapSnapshot = vi.fn();
const mockGetObjectByObjectId = vi.fn();
const mockGetHeapUsage = vi.fn();
const mockDetectV8Version = vi.fn();

vi.mock('@modules/v8-inspector', () => {
  return {
    BytecodeExtractor: vi.fn(function (this: any) {
      this.extractBytecode = mockExtractBytecode;
      this.disassembleBytecode = mockDisassembleBytecode;
      this.findHiddenClasses = mockFindHiddenClasses;
    }),
    JITInspector: vi.fn(function (this: any) {
      this.inspectJIT = mockInspectJIT;
    }),
  };
});

vi.mock('@modules/v8-inspector/V8InspectorClient', () => {
  return {
    V8InspectorClient: vi.fn(function (this: any) {
      this.takeHeapSnapshot = mockTakeHeapSnapshot;
      this.getObjectByObjectId = mockGetObjectByObjectId;
      this.getHeapUsage = mockGetHeapUsage;
      this.dispose = vi.fn();
    }),
  };
});

vi.mock('@modules/v8-inspector/VersionDetector', () => {
  return {
    VersionDetector: vi.fn(function (this: any) {
      this.detectV8Version = mockDetectV8Version;
      this.supportsNativesSyntax = vi.fn().mockResolvedValue(false);
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports — handler functions under test
// ---------------------------------------------------------------------------

import { handleBytecodeExtract } from '../../../../src/server/domains/v8-inspector/handlers/bytecode-extract';
import { handleJitInspect } from '../../../../src/server/domains/v8-inspector/handlers/jit-inspect';
import {
  handleHeapSnapshotCapture,
  handleHeapSearch,
  clearSnapshotCache,
  getSnapshotCache,
  storeSnapshot,
  getSnapshot,
} from '../../../../src/server/domains/v8-inspector/handlers/heap-snapshot';
import {
  V8InspectorHandlers,
  type V8InspectorDomainDependencies,
} from '../../../../src/server/domains/v8-inspector/handlers/impl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(
  overrides?: Partial<V8InspectorDomainDependencies>,
): V8InspectorDomainDependencies {
  const eventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
  };
  const ctx = {
    pageController: {},
    eventBus,
  } as unknown as import('@server/MCPServer.context').MCPServerContext;
  const client = {
    takeHeapSnapshot: mockTakeHeapSnapshot,
    getObjectByObjectId: mockGetObjectByObjectId,
    getHeapUsage: mockGetHeapUsage,
    dispose: vi.fn(),
  } as unknown as import('@modules/v8-inspector/V8InspectorClient').V8InspectorClient;
  return { ctx, client, ...overrides };
}

function createMockDepsWithoutPage(): V8InspectorDomainDependencies {
  const eventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
  };
  const ctx = {
    eventBus,
  } as unknown as import('@server/MCPServer.context').MCPServerContext;
  const client = {
    takeHeapSnapshot: mockTakeHeapSnapshot,
    getObjectByObjectId: mockGetObjectByObjectId,
    getHeapUsage: mockGetHeapUsage,
    dispose: vi.fn(),
  } as unknown as import('@modules/v8-inspector/V8InspectorClient').V8InspectorClient;
  return { ctx, client };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('v8-inspector handler coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSnapshotCache();
  });

  afterEach(() => {
    clearSnapshotCache();
  });

  // =========================================================================
  // bytecode-extract.ts
  // =========================================================================
  describe('handleBytecodeExtract', () => {
    it('should return error when scriptId is empty', async () => {
      const result = await handleBytecodeExtract({});
      expect(result).toEqual({
        success: false,
        error: 'scriptId is required',
      });
    });

    it('should return error when scriptId is whitespace-only', async () => {
      const result = await handleBytecodeExtract({ scriptId: '   ' });
      expect(result).toEqual({
        success: false,
        error: 'scriptId is required',
      });
    });

    it('should return error when extractBytecode returns null', async () => {
      mockExtractBytecode.mockResolvedValueOnce(null);
      const result = await handleBytecodeExtract({ scriptId: 'script-42' });
      expect(result).toEqual({
        success: false,
        error: 'Unable to extract bytecode for scriptId "script-42"',
      });
    });

    it('should return extraction result on success', async () => {
      const extraction = {
        functionName: 'myFunc',
        bytecode: '0 LdaConstant\n1 Return',
        sourcePosition: 10,
      };
      mockExtractBytecode.mockResolvedValueOnce(extraction);
      mockDisassembleBytecode.mockReturnValueOnce([
        { offset: 0, opcode: 'LdaConstant', operands: [] },
        { offset: 1, opcode: 'Return', operands: [] },
      ]);
      mockFindHiddenClasses.mockResolvedValueOnce([
        { address: 'hidden-class-0', properties: ['x', 'y'] },
      ]);

      const result = await handleBytecodeExtract(
        { scriptId: 'script-99' },
        { getPage: vi.fn().mockResolvedValue({}) },
      );

      expect(result).toMatchObject({
        success: true,
        scriptId: 'script-99',
        functionOffset: null,
        extraction,
        disassembly: [
          { offset: 0, opcode: 'LdaConstant', operands: [] },
          { offset: 1, opcode: 'Return', operands: [] },
        ],
        hiddenClasses: [{ address: 'hidden-class-0', properties: ['x', 'y'] }],
      });
    });

    it('should pass functionOffset when provided', async () => {
      const extraction = {
        functionName: 'inner',
        bytecode: '0 LoadLiteral a\n1 Return',
      };
      mockExtractBytecode.mockResolvedValueOnce(extraction);
      mockDisassembleBytecode.mockReturnValueOnce([]);
      mockFindHiddenClasses.mockResolvedValueOnce([]);

      const result = await handleBytecodeExtract(
        { scriptId: 'script-1', functionOffset: 42 },
        { getPage: vi.fn().mockResolvedValue({}) },
      );

      expect(mockExtractBytecode).toHaveBeenCalledWith('script-1', 42);
      expect(result).toMatchObject({
        success: true,
        scriptId: 'script-1',
        functionOffset: 42,
      });
    });

    it('should work without runtime (undefined getPage)', async () => {
      const extraction = {
        functionName: 'anon',
        bytecode: '0 Evaluate x',
      };
      mockExtractBytecode.mockResolvedValueOnce(extraction);
      mockDisassembleBytecode.mockReturnValueOnce([]);
      mockFindHiddenClasses.mockResolvedValueOnce([]);

      const result = await handleBytecodeExtract({ scriptId: 'script-x' });

      expect(result).toMatchObject({ success: true, scriptId: 'script-x' });
    });
  });

  // =========================================================================
  // jit-inspect.ts
  // =========================================================================
  describe('handleJitInspect', () => {
    it('should return error when scriptId is empty', async () => {
      const result = await handleJitInspect({});
      expect(result).toEqual({
        success: false,
        error: 'scriptId is required',
      });
    });

    it('should return error when scriptId is whitespace-only', async () => {
      const result = await handleJitInspect({ scriptId: '\t\n' });
      expect(result).toEqual({
        success: false,
        error: 'scriptId is required',
      });
    });

    it('should return functions on success', async () => {
      const functions = [
        { functionName: 'foo', optimized: true, tier: 'turbofan' },
        { functionName: 'bar', optimized: false, tier: 'interpreted' },
      ];
      mockInspectJIT.mockResolvedValueOnce(functions);

      const result = await handleJitInspect(
        { scriptId: 'script-7' },
        { getPage: vi.fn().mockResolvedValue({}) },
      );

      expect(result).toEqual({
        success: true,
        scriptId: 'script-7',
        functions,
      });
    });

    it('should work without runtime', async () => {
      mockInspectJIT.mockResolvedValueOnce([]);
      const result = await handleJitInspect({ scriptId: 'abc' });
      expect(result).toMatchObject({ success: true, scriptId: 'abc' });
    });
  });

  // =========================================================================
  // heap-snapshot.ts — cache operations
  // =========================================================================
  describe('heap-snapshot cache operations', () => {
    it('clearSnapshotCache should empty the cache', () => {
      storeSnapshot({ id: 'snap-1', chunks: ['{}'], capturedAt: 't', sizeBytes: 0 });
      expect(getSnapshotCache().size).toBe(1);
      clearSnapshotCache();
      expect(getSnapshotCache().size).toBe(0);
    });

    it('storeSnapshot should add and return the snapshot', () => {
      const snap = { id: 'snap-2', chunks: ['chunk-a'], capturedAt: '2026-01-01', sizeBytes: 100 };
      const result = storeSnapshot(snap);
      expect(result).toBe(snap);
      expect(getSnapshot('snap-2')).toBe(snap);
    });

    it('getSnapshot should return undefined for missing id', () => {
      expect(getSnapshot('nonexistent')).toBeUndefined();
    });

    it('getSnapshotCache should return the live map', () => {
      const cache = getSnapshotCache();
      expect(cache).toBeInstanceOf(Map);
    });
  });

  // =========================================================================
  // heap-snapshot.ts — handleHeapSnapshotCapture
  // =========================================================================
  describe('handleHeapSnapshotCapture', () => {
    function makeOptions(overrides?: Record<string, unknown>) {
      return {
        getPage: vi.fn().mockResolvedValue({}),
        getSnapshot: vi.fn().mockReturnValue(null),
        setSnapshot: vi.fn(),
        ...overrides,
      };
    }

    it('should capture via client when client succeeds', async () => {
      mockTakeHeapSnapshot.mockImplementationOnce(async (onChunk: (c: string) => void) => {
        onChunk('chunk1');
        onChunk('chunk2');
        return 200;
      });
      const opts = makeOptions({ client: { takeHeapSnapshot: mockTakeHeapSnapshot } });

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(false);
      expect(result.sizeBytes).toBe(200);
      expect(result.chunks).toEqual([]);
      expect(opts.setSnapshot).toHaveBeenCalled();
    });

    it('should fall through to CDP page fallback when client throws', async () => {
      mockTakeHeapSnapshot.mockRejectedValueOnce(new Error('CDP fail'));

      const mockSession = {
        send: vi
          .fn()
          .mockResolvedValueOnce(undefined) // HeapProfiler.enable
          .mockResolvedValueOnce({
            result: JSON.stringify({
              jsHeapSizeUsed: 512,
              jsHeapSizeTotal: 1024,
              jsHeapSizeLimit: 2048,
            }),
          }), // Runtime.evaluate
        detach: vi.fn().mockResolvedValue(undefined),
      };
      const mockPage = { createCDPSession: vi.fn().mockResolvedValue(mockSession) };
      const opts = makeOptions({
        client: { takeHeapSnapshot: mockTakeHeapSnapshot },
        getPage: vi.fn().mockResolvedValue(mockPage),
      });

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.sizeBytes).toBe(512);
    });

    it('should fall through to minimal fallback when CDP page fails', async () => {
      mockTakeHeapSnapshot.mockRejectedValueOnce(new Error('fail'));
      const opts = makeOptions({
        client: { takeHeapSnapshot: mockTakeHeapSnapshot },
        getPage: vi.fn().mockRejectedValue(new Error('no page')),
      });

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.sizeBytes).toBe(0);
    });

    it('should fall through to minimal fallback when no client provided and page is not CDP-like', async () => {
      const opts = makeOptions(); // no client, getPage returns {}

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.sizeBytes).toBe(0);
    });

    it('should use minimal fallback when no client and no page', async () => {
      const opts = makeOptions({ getPage: vi.fn().mockRejectedValue(new Error('no browser')) });

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.sizeBytes).toBe(0);
      expect(opts.setSnapshot).toHaveBeenCalled();
    });

    it('should handle CDP page fallback when Runtime.evaluate returns null memory', async () => {
      const mockSession = {
        send: vi
          .fn()
          .mockResolvedValueOnce(undefined) // HeapProfiler.enable
          .mockResolvedValueOnce({ result: 'null' }), // Runtime.evaluate returns null
        detach: vi.fn().mockResolvedValue(undefined),
      };
      const mockPage = { createCDPSession: vi.fn().mockResolvedValue(mockSession) };
      const opts = makeOptions({ getPage: vi.fn().mockResolvedValue(mockPage) });

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.sizeBytes).toBe(0);
    });

    it('should handle CDP page fallback when response has no result field', async () => {
      const mockSession = {
        send: vi
          .fn()
          .mockResolvedValueOnce(undefined) // HeapProfiler.enable
          .mockResolvedValueOnce({ notResult: 'something' }), // no 'result'
        detach: vi.fn().mockResolvedValue(undefined),
      };
      const mockPage = { createCDPSession: vi.fn().mockResolvedValue(mockSession) };
      const opts = makeOptions({ getPage: vi.fn().mockResolvedValue(mockPage) });

      const result = await handleHeapSnapshotCapture({}, opts);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.sizeBytes).toBe(0);
    });
  });

  // =========================================================================
  // heap-snapshot.ts — handleHeapSearch
  // =========================================================================
  describe('handleHeapSearch', () => {
    function makeSearchOptions(overrides?: Record<string, unknown>) {
      return {
        getPage: vi.fn().mockResolvedValue({}),
        getSnapshot: vi.fn().mockReturnValue(null),
        setSnapshot: vi.fn(),
        ...overrides,
      };
    }

    it('should throw when snapshotId is missing and no current snapshot', async () => {
      const opts = makeSearchOptions();
      await expect(handleHeapSearch({}, opts)).rejects.toThrow('snapshotId is required');
    });

    it('should throw when specified snapshotId is not found', async () => {
      const opts = makeSearchOptions();
      await expect(
        handleHeapSearch({ snapshotId: 'missing-snap', query: 'test' }, opts),
      ).rejects.toThrow('Snapshot missing-snap not found');
    });

    it('should return matching chunks for a valid snapshot', async () => {
      storeSnapshot({
        id: 'snap-search',
        chunks: ['{"name":"foo"}', '{"name":"bar"}', '{"name":"foobar"}'],
        capturedAt: '2026-01-01',
        sizeBytes: 300,
      });
      const opts = makeSearchOptions();

      const result = await handleHeapSearch({ snapshotId: 'snap-search', query: 'foo' }, opts);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe('snap-search');
      expect(result.query).toBe('foo');
      // Chunks that include "foo": the first and third
      expect(result.matches).toHaveLength(2);
    });

    it('should default query to ".*" when not provided', async () => {
      // handleHeapSearch uses chunk.includes(query) — literal string match
      // Chunks containing the literal substring ".*" will match
      storeSnapshot({
        id: 'snap-wildcard',
        chunks: ['has-.*-inside', 'no-wildcard'],
        capturedAt: '2026-01-01',
        sizeBytes: 100,
      });
      const opts = makeSearchOptions();

      const result = await handleHeapSearch({ snapshotId: 'snap-wildcard' }, opts);

      expect(result.query).toBe('.*');
      // Only the first chunk contains the literal substring ".*"
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toBe('has-.*-inside');
    });

    it('should use getSnapshot() as fallback for snapshotId', async () => {
      storeSnapshot({
        id: 'snap-fallback',
        chunks: ['data'],
        capturedAt: '2026-01-01',
        sizeBytes: 50,
      });
      const opts = makeSearchOptions({
        getSnapshot: vi.fn().mockReturnValue('snap-fallback'),
      });

      const result = await handleHeapSearch({ query: 'data' }, opts);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe('snap-fallback');
    });

    it('should return empty matches when no chunks match query', async () => {
      storeSnapshot({
        id: 'snap-nomatch',
        chunks: ['alpha', 'beta'],
        capturedAt: '2026-01-01',
        sizeBytes: 100,
      });
      const opts = makeSearchOptions();

      const result = await handleHeapSearch({ snapshotId: 'snap-nomatch', query: 'gamma' }, opts);

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
    });
  });

  // =========================================================================
  // impl.ts — V8InspectorHandlers
  // =========================================================================
  describe('V8InspectorHandlers', () => {
    describe('handle() dispatch', () => {
      it('should throw for unknown tool', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(handlers.handle('unknown_tool', {})).rejects.toThrow(
          'Unknown v8-inspector tool: unknown_tool',
        );
      });

      it('should dispatch to v8_heap_stats', async () => {
        mockGetHeapUsage.mockResolvedValueOnce({
          jsHeapSizeUsed: 100,
          jsHeapSizeTotal: 200,
          jsHeapSizeLimit: 300,
        });
        const handlers = new V8InspectorHandlers(createMockDeps());
        const result = await handlers.handle('v8_heap_stats', {});
        expect(result).toMatchObject({
          success: true,
          snapshotCount: 0,
          heapUsage: { jsHeapSizeUsed: 100, jsHeapSizeTotal: 200, jsHeapSizeLimit: 300 },
        });
      });
    });

    describe('v8_heap_snapshot_capture', () => {
      it('should throw without pageController', async () => {
        const deps = createMockDepsWithoutPage();
        const handlers = new V8InspectorHandlers(deps);
        await expect(handlers.v8_heap_snapshot_capture({})).rejects.toThrow();
      });

      it('should capture snapshot and emit event on success', async () => {
        mockTakeHeapSnapshot.mockImplementationOnce(async (onChunk: (c: string) => void) => {
          onChunk('chunk-data');
          return 1024;
        });
        const deps = createMockDeps();
        const handlers = new V8InspectorHandlers(deps);

        const result = await handlers.v8_heap_snapshot_capture({});

        expect(result.success).toBe(true);
        expect(result.simulated).toBe(false);
        expect(result.sizeBytes).toBe(1024);
        expect(deps.ctx.eventBus.emit).toHaveBeenCalledWith(
          'v8:heap_captured',
          expect.objectContaining({
            snapshotId: result.snapshotId,
            sizeBytes: 1024,
          }),
        );
      });
    });

    describe('v8_heap_snapshot_analyze', () => {
      it('should throw if snapshotId is missing', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(handlers.v8_heap_snapshot_analyze({})).rejects.toThrow(
          'snapshotId is required',
        );
      });

      it('should throw if snapshot not found in cache', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(
          handlers.v8_heap_snapshot_analyze({ snapshotId: 'no-such-snap' }),
        ).rejects.toThrow('Snapshot no-such-snap not found');
      });

      it('should return analysis for a stored snapshot', async () => {
        storeSnapshot({
          id: 'snap-analyze',
          chunks: ['c1', 'c2', 'c3'],
          capturedAt: '2026-01-01',
          sizeBytes: 4096,
        });
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_heap_snapshot_analyze({ snapshotId: 'snap-analyze' });

        expect(result).toEqual({
          success: true,
          snapshotId: 'snap-analyze',
          summary: { chunkCount: 3, sizeBytes: 4096 },
          objectAddress: '0x1000',
        });
      });
    });

    describe('v8_heap_diff', () => {
      it('should throw if beforeSnapshotId is missing', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(handlers.v8_heap_diff({ afterSnapshotId: 'snap-after' })).rejects.toThrow(
          'Both beforeSnapshotId and afterSnapshotId are required',
        );
      });

      it('should throw if afterSnapshotId is missing', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(handlers.v8_heap_diff({ beforeSnapshotId: 'snap-before' })).rejects.toThrow(
          'Both beforeSnapshotId and afterSnapshotId are required',
        );
      });

      it('should throw if both snapshot IDs are non-string', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(
          handlers.v8_heap_diff({ beforeSnapshotId: 123, afterSnapshotId: 456 }),
        ).rejects.toThrow('Both beforeSnapshotId and afterSnapshotId are required');
      });

      it('should throw if before snapshot not found', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(
          handlers.v8_heap_diff({ beforeSnapshotId: 'missing', afterSnapshotId: 'also-missing' }),
        ).rejects.toThrow('Snapshot missing not found');
      });

      it('should throw if after snapshot not found', async () => {
        storeSnapshot({ id: 'snap-before', chunks: ['a'], capturedAt: 't', sizeBytes: 100 });
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(
          handlers.v8_heap_diff({
            beforeSnapshotId: 'snap-before',
            afterSnapshotId: 'missing-after',
          }),
        ).rejects.toThrow('Snapshot missing-after not found');
      });

      it('should return size delta for two stored snapshots', async () => {
        storeSnapshot({ id: 'snap-diff-before', chunks: ['a'], capturedAt: 't1', sizeBytes: 500 });
        storeSnapshot({
          id: 'snap-diff-after',
          chunks: ['b', 'c'],
          capturedAt: 't2',
          sizeBytes: 800,
        });
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_heap_diff({
          beforeSnapshotId: 'snap-diff-before',
          afterSnapshotId: 'snap-diff-after',
        });

        expect(result).toEqual({
          success: true,
          beforeSnapshotId: 'snap-diff-before',
          afterSnapshotId: 'snap-diff-after',
          sizeDeltaBytes: 300,
        });
      });

      it('should return negative delta when after is smaller', async () => {
        storeSnapshot({ id: 'snap-big', chunks: ['x'], capturedAt: 't1', sizeBytes: 1000 });
        storeSnapshot({ id: 'snap-small', chunks: ['y'], capturedAt: 't2', sizeBytes: 400 });
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_heap_diff({
          beforeSnapshotId: 'snap-big',
          afterSnapshotId: 'snap-small',
        });

        expect(result.sizeDeltaBytes).toBe(-600);
      });
    });

    describe('v8_object_inspect', () => {
      it('should throw if address is missing', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        await expect(handlers.v8_object_inspect({})).rejects.toThrow('address is required');
      });

      it('should return object data when client succeeds', async () => {
        mockGetObjectByObjectId.mockResolvedValueOnce({ type: 'object', className: 'Object' });
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_object_inspect({ address: '1:42' });

        expect(result).toEqual({
          success: true,
          address: '1:42',
          objectData: { type: 'object', className: 'Object' },
        });
      });

      it('should return without objectData when client returns null', async () => {
        mockGetObjectByObjectId.mockResolvedValueOnce(null);
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_object_inspect({ address: '1:99' });

        expect(result).toEqual({ success: true, address: '1:99' });
      });

      it('should handle client error gracefully', async () => {
        mockGetObjectByObjectId.mockRejectedValueOnce(new Error('CDP error'));
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_object_inspect({ address: '1:0' });

        expect(result).toEqual({ success: true, address: '1:0' });
      });
    });

    describe('v8_heap_stats', () => {
      it('should throw without pageController', async () => {
        const deps = createMockDepsWithoutPage();
        const handlers = new V8InspectorHandlers(deps);
        await expect(handlers.v8_heap_stats({})).rejects.toThrow();
      });

      it('should return stats with heapUsage when client succeeds', async () => {
        mockGetHeapUsage.mockResolvedValueOnce({
          jsHeapSizeUsed: 512,
          jsHeapSizeTotal: 1024,
          jsHeapSizeLimit: 2048,
        });
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_heap_stats({});

        expect(result).toMatchObject({
          success: true,
          snapshotCount: 0,
          heapUsage: { jsHeapSizeUsed: 512, jsHeapSizeTotal: 1024, jsHeapSizeLimit: 2048 },
        });
      });

      it('should return stats without heapUsage when client throws', async () => {
        mockGetHeapUsage.mockRejectedValueOnce(new Error('no session'));
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_heap_stats({});

        expect(result).toEqual({
          success: true,
          snapshotCount: 0,
        });
      });

      it('should include cached snapshot count', async () => {
        storeSnapshot({ id: 's1', chunks: ['a'], capturedAt: 't', sizeBytes: 10 });
        storeSnapshot({ id: 's2', chunks: ['b'], capturedAt: 't', sizeBytes: 20 });
        mockGetHeapUsage.mockRejectedValueOnce(new Error('skip'));
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_heap_stats({});

        expect(result.snapshotCount).toBe(2);
      });
    });

    describe('v8_bytecode_extract', () => {
      it('should return error when scriptId is empty', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        const result = await handlers.v8_bytecode_extract({});
        expect(result).toEqual({ success: false, error: 'scriptId is required' });
      });

      it('should call handleBytecodeExtract with pageController', async () => {
        const extraction = { functionName: 'test', bytecode: '0 Return' };
        mockExtractBytecode.mockResolvedValueOnce(extraction);
        mockDisassembleBytecode.mockReturnValueOnce([]);
        mockFindHiddenClasses.mockResolvedValueOnce([]);

        const handlers = new V8InspectorHandlers(createMockDeps());
        const result = await handlers.v8_bytecode_extract({ scriptId: 's1' });

        expect(result).toMatchObject({ success: true, scriptId: 's1' });
      });

      it('should work without pageController', async () => {
        mockExtractBytecode.mockResolvedValueOnce(null);
        const deps = createMockDepsWithoutPage();
        const handlers = new V8InspectorHandlers(deps);

        const result = await handlers.v8_bytecode_extract({ scriptId: 's2' });

        expect(result).toMatchObject({ success: false, error: expect.stringContaining('s2') });
      });
    });

    describe('v8_version_detect', () => {
      it('should return error without pageController', async () => {
        const deps = createMockDepsWithoutPage();
        const handlers = new V8InspectorHandlers(deps);

        const result = await handlers.v8_version_detect({});

        expect(result).toEqual({ success: false, error: 'PageController not available' });
      });

      it('should detect version with pageController', async () => {
        mockDetectV8Version.mockResolvedValueOnce({
          major: 12,
          minor: 4,
          patch: 100,
          commit: 'abc',
        });
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_version_detect({});

        expect(result).toMatchObject({
          success: true,
          version: { major: 12, minor: 4, patch: 100, commit: 'abc' },
          features: {},
        });
      });
    });

    describe('v8_jit_inspect', () => {
      it('should return error when scriptId is empty', async () => {
        const handlers = new V8InspectorHandlers(createMockDeps());
        const result = await handlers.v8_jit_inspect({});
        expect(result).toEqual({ success: false, error: 'scriptId is required' });
      });

      it('should return functions on success', async () => {
        const functions = [{ functionName: 'fn1', optimized: true, tier: 'turbofan' }];
        mockInspectJIT.mockResolvedValueOnce(functions);
        const handlers = new V8InspectorHandlers(createMockDeps());

        const result = await handlers.v8_jit_inspect({ scriptId: 'jit-1' });

        expect(result).toEqual({
          success: true,
          scriptId: 'jit-1',
          functions,
        });
      });
    });
  });
});
