/**
 * V8 Inspector domain benchmark — offline pure-TS golden vectors for V8 HeapSnapshot parsing and analysis.
 *
 * Ground truth:
 *  - storeSnapshot & getSnapshot: in-memory cache lifecycle for captured/loaded snapshots
 *  - v8_heap_snapshot_analyze: class histogram, totalObjects, and shallow/retained size calculations
 *  - v8_heap_diff: structural diff between two snapshots (added vs removed nodes and sizeDelta)
 *  - v8_heap_find_leaks: identifies high-retained or detached DOM objects in heap graphs
 *  - v8_heap_retainers: traces retainer chains from specified node IDs back to roots
 *  - v8_object_compare: compares property and size deltas between heap objects
 *  - v8_function_retained: filters objects retained by specific function name pattern
 */
import { V8InspectorHandlers } from '@server/domains/v8-inspector/handlers';
import {
  storeSnapshot,
  clearSnapshotCache,
} from '@server/domains/v8-inspector/handlers/heap-snapshot';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BenchSuite } from '../harness';
import { body, expectSuccess } from '../harness';

const mockDeps = {
  ctx: {
    eventBus: { emit: () => {} },
  } as never,
  client: {} as never,
};

const handlers = new V8InspectorHandlers(mockDeps);

/** Minimal synthetic V8 heap snapshot with root, Array, and Object */
const SNAPSHOT_BASE = JSON.stringify({
  snapshot: {
    meta: {
      node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
      node_types: [
        [
          'hidden',
          'array',
          'string',
          'object',
          'code',
          'closure',
          'regexp',
          'number',
          'native',
          'synthetic',
        ],
        'hidden',
      ],
      edge_fields: ['type', 'name_or_index', 'to_node'],
      edge_types: [['context', 'element', 'property', 'internal', 'hidden'], 'context'],
    },
    node_count: 4,
    edge_count: 3,
  },
  nodes: [
    // 0: (root) - synthetic
    9, 0, 1, 0, 2, 0,
    // 1: Array - self_size 1024
    1, 1, 2, 1024, 1, 0,
    // 2: Object - self_size 512
    3, 2, 3, 512, 0, 0,
    // 3: LeakClass - self_size 2048
    3, 3, 4, 2048, 0, 0,
  ],
  edges: [2, 1, 6, 2, 2, 18, 2, 3, 24],
  strings: ['(root)', 'Array', 'MyObject', 'LeakClass'],
});

/** Second snapshot with LeakClass modified/removed and NewClass added */
const SNAPSHOT_UPDATED = JSON.stringify({
  snapshot: {
    meta: {
      node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id'],
      node_types: [
        [
          'hidden',
          'array',
          'string',
          'object',
          'code',
          'closure',
          'regexp',
          'number',
          'native',
          'synthetic',
        ],
        'hidden',
      ],
      edge_fields: ['type', 'name_or_index', 'to_node'],
      edge_types: [['context', 'element', 'property', 'internal', 'hidden'], 'context'],
    },
    node_count: 4,
    edge_count: 3,
  },
  nodes: [
    // 0: (root)
    9, 0, 1, 0, 2, 0,
    // 1: Array - self_size 1024
    1, 1, 2, 1024, 1, 0,
    // 2: Object - self_size 512
    3, 2, 3, 512, 0, 0,
    // 3: NewClass - id=5, self_size 4096
    3, 4, 5, 4096, 0, 0,
  ],
  edges: [2, 1, 6, 2, 2, 18, 2, 4, 24],
  strings: ['(root)', 'Array', 'MyObject', 'LeakClass', 'NewClass'],
});

export const v8InspectorSuite: BenchSuite = {
  name: 'v8-inspector-heap',
  domain: 'v8-inspector',
  description:
    'Golden vectors for V8 heap snapshot analysis, diff, leak candidate detection, retainer tracing, and object comparison',
  cases: [
    {
      name: 'v8_heap_snapshot_analyze/histogram-and-objects',
      tool: 'v8_heap_snapshot_analyze',
      origin: 'homemade',
      reference:
        'parses synthetic V8 snapshot chunks and calculates class histogram count/shallowSize',
      run: async () => {
        clearSnapshotCache();
        storeSnapshot({
          id: 'bench-snap-1',
          chunks: [SNAPSHOT_BASE],
          capturedAt: new Date().toISOString(),
          sizeBytes: Buffer.byteLength(SNAPSHOT_BASE),
        });
        return handlers.handle('v8_heap_snapshot_analyze', { snapshotId: 'bench-snap-1' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const histogram = b.classHistogram as
          | Array<{ className: string; count: number; shallowSize: number }>
          | undefined;
        if (!Array.isArray(histogram) || histogram.length < 2) {
          return `expected at least 2 histogram entries, got: ${JSON.stringify(histogram)}`;
        }
        const arrEntry = histogram.find((e) => e.className === 'Array');
        if (!arrEntry || arrEntry.shallowSize !== 1024) {
          return `expected Array entry with shallowSize=1024, got: ${JSON.stringify(arrEntry)}`;
        }
        return true;
      },
    },
    {
      name: 'v8_heap_diff/structural-node-comparison',
      tool: 'v8_heap_diff',
      origin: 'homemade',
      reference:
        'compares two snapshot revisions, reporting added node (NewClass) and removed node (LeakClass)',
      run: async () => {
        storeSnapshot({
          id: 'bench-snap-2',
          chunks: [SNAPSHOT_UPDATED],
          capturedAt: new Date().toISOString(),
          sizeBytes: Buffer.byteLength(SNAPSHOT_UPDATED),
        });
        return handlers.handle('v8_heap_diff', {
          beforeSnapshotId: 'bench-snap-1',
          afterSnapshotId: 'bench-snap-2',
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.addedCount !== 'number' || typeof b.removedCount !== 'number') {
          return `expected addedCount and removedCount, got: ${JSON.stringify(b)}`;
        }
        const text = JSON.stringify(b);
        if (!text.includes('NewClass')) return 'added node NewClass missing from diff';
        return true;
      },
    },
    {
      name: 'v8_heap_retainers/trace-retainer-chains',
      tool: 'v8_heap_retainers',
      origin: 'homemade',
      reference: 'traces retainer chains from nodeId back to GC root',
      run: async () => {
        return handlers.handle('v8_heap_retainers', {
          snapshotId: 'bench-snap-1',
          nodeIds: [2], // Array node
          maxSteps: 10,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const chains = b.chains as Record<string, unknown> | undefined;
        if (!chains || typeof chains !== 'object') {
          return `expected chains object, got: ${JSON.stringify(b)}`;
        }
        return true;
      },
    },
    {
      name: 'v8_object_compare/object-delta-comparison',
      tool: 'v8_object_compare',
      origin: 'homemade',
      reference: 'evaluates size and property delta between object nodes in the heap graph',
      run: async () => {
        return handlers.handle('v8_object_compare', {
          snapshotId: 'bench-snap-1',
          objectIds: [2, 3], // Array vs MyObject
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.success === false) return `object compare failed: ${b.error}`;
        const pairs = b.pairs as Array<unknown> | undefined;
        if (!Array.isArray(pairs)) return `expected pairs array, got: ${typeof pairs}`;
        return true;
      },
    },
    {
      name: 'v8_heap_snapshot_list/in-memory-listing',
      tool: 'v8_heap_snapshot_list',
      origin: 'homemade',
      reference: 'lists stored in-memory snapshots and calculates totalBytes',
      run: async () => {
        return handlers.handle('v8_heap_snapshot_list', {});
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.count !== 'number' || b.count < 1) {
          return `expected at least 1 cached snapshot in list, got: ${b.count}`;
        }
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline heap inspection & export tools ──
    {
      name: 'v8_heap_find_leaks/candidate-detection',
      tool: 'v8_heap_find_leaks',
      origin: 'homemade',
      reference: 'finds memory leak candidates in snapshot with minRetainedSize filter',
      run: () =>
        handlers.handle('v8_heap_find_leaks', {
          snapshotId: 'bench-snap-1',
          minRetainedSize: 0,
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success === false) return `find leaks failed: ${b.error}`;
        if (!Array.isArray(b.leakCandidates))
          return `expected leakCandidates array, got ${JSON.stringify(b).slice(0, 150)}`;
        return true;
      },
    },
    {
      name: 'v8_function_retained/function-dominator-filter',
      tool: 'v8_function_retained',
      origin: 'homemade',
      reference: 'filters objects retained by function name pattern across dominator tree',
      run: () =>
        handlers.handle('v8_function_retained', {
          snapshotId: 'bench-snap-1',
          pattern: 'Array',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (typeof b.objectCount !== 'number')
          return `expected objectCount number, got ${typeof b.objectCount}`;
        return true;
      },
    },
    {
      name: 'v8_heap_snapshot_export/export-artifact',
      tool: 'v8_heap_snapshot_export',
      origin: 'homemade',
      reference: 'exports in-memory heap snapshot chunks to a .heapsnapshot JSON artifact',
      run: () =>
        handlers.handle('v8_heap_snapshot_export', {
          snapshotId: 'bench-snap-1',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const path = (b.absolutePath ?? b.displayPath ?? b.exportedPath) as string | undefined;
        if (!path || typeof path !== 'string')
          return `expected absolutePath string, got ${JSON.stringify(b).slice(0, 150)}`;
        return true;
      },
    },
    {
      name: 'v8_heap_snapshot_delete/drop-from-cache',
      tool: 'v8_heap_snapshot_delete',
      origin: 'homemade',
      reference: 'removes target snapshot from in-memory cache and persisted store',
      run: () =>
        handlers.handle('v8_heap_snapshot_delete', {
          snapshotId: 'bench-snap-2',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.cacheDropped !== true) return `expected cacheDropped === true, got ${b.cacheDropped}`;
        return true;
      },
    },

    // ── Coverage batch 2 (2026-11-11 autoresearch): TurboFan IR traceDir mode ──
    {
      name: 'v8_turbofan_graph/trace-dir-parsing',
      tool: 'v8_turbofan_graph',
      origin: 'external-vector',
      reference:
        'parses real --trace-turbo JSON (sea-of-nodes graph: nodes/edges/phases) from a turboDir fixture',
      run: async () => {
        const traceDir = mkdtempSync(join(tmpdir(), 'jshook-bench-turbo-'));
        const turboJson = JSON.stringify({
          function: {
            sourceId: 0,
            functionName: 'hotLoop',
            sourceName: 'test.js',
            sourceText: 'function hotLoop(n){let s=0;for(let i=0;i<n;i++){s+=i}return s}',
            startPosition: 0,
            endPosition: 64,
          },
          phases: [
            {
              name: 'begin inlining',
              type: 'graph',
              data: {
                nodes: [
                  {
                    id: 1,
                    label: 'NumberConstant [0]',
                    title: 'NumberConstant(0)',
                    live: true,
                    properties: '0',
                    opcode: 'NumberConstant',
                    control: false,
                    opinfo: '0 v 0 eff 0 ctrl in',
                    type: 'TaggedNumber',
                  },
                  {
                    id: 2,
                    label: 'NumberConstant [1]',
                    title: 'NumberConstant(1)',
                    live: true,
                    properties: '1',
                    opcode: 'NumberConstant',
                    control: false,
                    opinfo: '1 v 0 eff 0 ctrl in',
                    type: 'TaggedNumber',
                  },
                  {
                    id: 10,
                    label: 'Loop',
                    title: 'Loop',
                    live: true,
                    properties: '',
                    opcode: 'Loop',
                    control: true,
                    opinfo: '0 v 0 eff 2 ctrl in',
                    type: 'Internal',
                  },
                  {
                    id: 25,
                    label: 'JSAdd',
                    title: 'JSAdd',
                    live: true,
                    properties: '',
                    opcode: 'JSAdd',
                    control: false,
                    opinfo: '2 v 1 eff 1 ctrl in',
                    type: 'TaggedNumber',
                  },
                ],
                edges: [
                  { source: 1, target: 25, index: 0, type: 'value' },
                  { source: 2, target: 25, index: 1, type: 'value' },
                  { source: 10, target: 25, index: 0, type: 'control' },
                ],
              },
            },
          ],
        });
        writeFileSync(join(traceDir, 'turbo-hotLoop-0.json'), turboJson);
        process.once('exit', () => {
          try {
            rmSync(traceDir, { recursive: true, force: true });
          } catch {}
        });
        return handlers.handle('v8_turbofan_graph', { traceDir, includePhases: false });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.mode !== 'directory') return `expected mode=directory, got ${b.mode}`;
        if (Number(b.functionCount) !== 1 || !Array.isArray(b.functions))
          return `expected 1 parsed function, got ${JSON.stringify(b).slice(0, 200)}`;
        const fn = b.functions[0] as { functionName?: string; totalNodeCount?: number } | undefined;
        if (fn?.functionName !== 'hotLoop' || Number(fn?.totalNodeCount ?? 0) !== 4)
          return `expected hotLoop with 4 nodes, got ${JSON.stringify(fn)}`;
        return true;
      },
    },

    // ── Coverage batch 3 (2026-11-12 autoresearch): honest unavailable contracts (no live browser) ──
    {
      name: 'v8_wasm_inspect/no-page-honest-empty',
      tool: 'v8_wasm_inspect',
      origin: 'homemade',
      reference:
        'without a browser the tool must report success=false with zero wasm modules and an explicit PageController reason — never fabricate module data',
      run: () => handlers.handle('v8_wasm_inspect', {}),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success !== false) return `expected success=false offline, got ${b.success}`;
        if (Number(b.totalModules) !== 0) return `expected totalModules=0, got ${b.totalModules}`;
        if (!Array.isArray(b.modules) || b.modules.length !== 0)
          return `expected empty modules array, got ${JSON.stringify(b.modules)}`;
        return /PageController not available/i.test(String(b.error))
          ? true
          : `expected explicit PageController reason, got ${String(b.error)}`;
      },
    },
    {
      name: 'v8_deopt_trace/no-cdp-session-unavailable',
      tool: 'v8_deopt_trace',
      origin: 'homemade',
      reference:
        'without a CDP session the deopt tracer must report mode=unavailable with zero events rather than pretend a trace ran',
      run: () => handlers.handle('v8_deopt_trace', {}),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success !== false) return `expected success=false offline, got ${b.success}`;
        if (b.mode !== 'unavailable') return `expected mode=unavailable, got ${String(b.mode)}`;
        if (b.traceEnabled !== false)
          return `traceEnabled must be false, got ${String(b.traceEnabled)}`;
        return b.eventCount === 0 && Array.isArray(b.events) && b.events.length === 0
          ? true
          : `expected zero captured events, got ${JSON.stringify(b).slice(0, 160)}`;
      },
    },
    {
      name: 'v8_object_inspect/missing-client-method-clean-error',
      tool: 'v8_object_inspect',
      origin: 'homemade',
      reference:
        'an inspector client without getObjectByObjectId must surface a clean, named capability error instead of throwing an unhandled TypeError',
      run: () => handlers.handle('v8_object_inspect', { address: '0x1234' }),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success !== false) return `expected success=false, got ${b.success}`;
        const err = String(b.error ?? '');
        return /getObjectByObjectId|Could not inspect/i.test(err)
          ? true
          : `expected named capability error, got ${err}`;
      },
    },

    // ── Honest-unavailable batch 2026-11-12 (autoresearch) ──────────────────
    // These 7 tools need a live CDP client, a captured heap profile, or a
    // resolved script. With the dependency-free fixture the only correct
    // answer is a named refusal — never a zeroed stats object, an empty
    // sampled profile, or a fabricated V8 version.
    {
      name: 'v8_allocation_track/refuses-without-page',
      tool: 'v8_allocation_track',
      origin: 'homemade',
      reference:
        'admission contract: allocation tracking needs a live CDP heap profiler; without it the tool names the missing PageController',
      run: () => handlers.handle('v8_allocation_track', {}),
      validate: (v) =>
        expectNamedRefusal(v, /PageController not available/i, ['samples', 'profile']),
    },
    {
      name: 'v8_heap_sampling/refuses-without-page',
      tool: 'v8_heap_sampling',
      origin: 'homemade',
      reference:
        'admission contract: heap sampling needs the live CDP sampler and must not return an empty sample set as success',
      run: () => handlers.handle('v8_heap_sampling', {}),
      validate: (v) =>
        expectNamedRefusal(v, /PageController not available/i, ['samples', 'profile']),
    },
    {
      name: 'v8_heap_snapshot_capture/refuses-without-page',
      tool: 'v8_heap_snapshot_capture',
      origin: 'homemade',
      reference:
        'admission contract: capturing a snapshot needs a live page; a snapshot id must not be issued without one',
      run: () => handlers.handle('v8_heap_snapshot_capture', {}),
      validate: (v) => expectNamedRefusal(v, /PageController not available/i, ['snapshotId']),
    },
    {
      name: 'v8_heap_stats/refuses-without-page',
      tool: 'v8_heap_stats',
      origin: 'homemade',
      reference:
        'admission contract: heap statistics require the live CDP heap profiler; the refusal must not be masked by zeroed counters',
      run: () => handlers.handle('v8_heap_stats', {}),
      validate: (v) =>
        expectNamedRefusal(v, /PageController not available/i, ['totalSize', 'usedSize', 'stats']),
    },
    {
      name: 'v8_bytecode_extract/requires-scriptId',
      tool: 'v8_bytecode_extract',
      origin: 'homemade',
      reference:
        'argument contract: bytecode extraction needs a resolved scriptId and names it when absent',
      run: () => handlers.handle('v8_bytecode_extract', {}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false)
          return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
        return /scriptId/i.test(String(b['error'] ?? b['message'] ?? ''))
          ? true
          : `expected a scriptId error: ${JSON.stringify(b).slice(0, 180)}`;
      },
    },
    {
      name: 'v8_turbofan_inspect/requires-scriptId',
      tool: 'v8_turbofan_inspect',
      origin: 'homemade',
      reference:
        'argument contract: TurboFan inspection needs the script whose graph should be inspected',
      run: () => handlers.handle('v8_turbofan_inspect', {}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false)
          return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
        return /scriptId/i.test(String(b['error'] ?? b['message'] ?? ''))
          ? true
          : `expected a scriptId error: ${JSON.stringify(b).slice(0, 180)}`;
      },
    },
    {
      name: 'v8_version_detect/refuses-without-page',
      tool: 'v8_version_detect',
      origin: 'homemade',
      reference:
        'admission contract: the V8 version is read from the live runtime, so without a page the tool must refuse instead of guessing a version string',
      run: () => handlers.handle('v8_version_detect', {}),
      validate: (v) => expectNamedRefusal(v, /PageController not available/i, ['version']),
    },
  ],
};

/**
 * Assert a named offline refusal: `success:false` with the expected reason, and
 * none of the listed payload keys present (no fabricated data alongside it).
 */
function expectNamedRefusal(v: unknown, expect: RegExp, forbiddenKeys: string[]): true | string {
  const b = body(v);
  if (b['success'] !== false)
    return `expected success=false, got ${JSON.stringify(b).slice(0, 180)}`;
  const message = String(b['error'] ?? b['message'] ?? '');
  if (!expect.test(message)) return `refusal does not match ${expect}: ${message.slice(0, 180)}`;
  for (const key of forbiddenKeys) {
    if (b[key] !== undefined) return `must not return "${key}" without live data`;
  }
  return true;
}
