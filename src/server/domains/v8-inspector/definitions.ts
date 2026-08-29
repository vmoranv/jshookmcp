import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const v8InspectorTools: Tool[] = [
  tool('v8_heap_snapshot_capture', (t) =>
    t
      .desc(
        'Capture a V8 heap snapshot for offline analysis. The snapshot is persisted to ' +
          'artifacts/heap-snapshots/ (data + sidecar meta) so it survives a server restart; ' +
          'set persist=false to keep it in-memory only.',
      )
      .boolean('persist', 'Persist to artifacts/heap-snapshots/ (default: true)', {
        default: true,
      })
      .query(),
  ),
  tool('v8_heap_snapshot_analyze', (t) =>
    t
      .desc(
        'Analyze a heap snapshot: class histogram (object count/sizes by constructor), ' +
          'statistics (total objects, detached DOM nodes), optional dominator tree, and leak detection.',
      )
      .string('snapshotId', 'Snapshot ID')
      .number('topN', 'Number of top classes to return in histogram (default: 50)')
      .boolean('includeDominatorTree', 'Include dominator tree in analysis (default: false)')
      .number('depth', 'Dominator tree depth limit (default: 3)')
      .boolean('includeLeakDetection', 'Include memory leak detection (default: false)')
      .number('minLeakSize', 'Minimum leak size in bytes (default: 1MB)')
      .required('snapshotId')
      .query(),
  ),
  tool('v8_heap_diff', (t) =>
    t
      .desc('Compare two heap snapshots to find allocation changes.')
      .string('beforeSnapshotId', 'Baseline snapshot ID')
      .string('afterSnapshotId', 'Updated snapshot ID')
      .number('topN', 'Number of top added/removed nodes to return (default: 50)')
      .required('beforeSnapshotId', 'afterSnapshotId')
      .query(),
  ),
  tool('v8_object_inspect', (t) =>
    t
      .desc('Inspect a live JS object by objectId with property enumeration.')
      .string('address', 'Runtime objectId or compatible heap object id')
      .required('address')
      .query(),
  ),
  tool('v8_heap_stats', (t) => t.desc('Report V8 heap statistics: used, total, external.').query()),
  tool('v8_bytecode_extract', (t) =>
    t
      .desc('Extract V8 bytecode for a script by scriptId, with source fallback.')
      .string('scriptId', 'CDP scriptId')
      .number('functionOffset', 'Optional function byte offset')
      .boolean('includeSourceFallback', 'Include source-derived fallback output')
      .required('scriptId')
      .query(),
  ),
  tool('v8_version_detect', (t) =>
    t.desc('Detect V8 engine version, flags, and runtime capabilities.').query(),
  ),
  tool('v8_heap_find_leaks', (t) =>
    t
      .desc(
        'Find suspected memory leaks in a heap snapshot. Returns leak candidates sorted by confidence, ' +
          'including detached DOM nodes, large arrays, closure leaks, and unexpectedly large retained objects.',
      )
      .string('snapshotId', 'Snapshot ID to analyze')
      .number('minRetainedSize', 'Minimum retained size in bytes to consider (default: 1MB)')
      .number('maxResults', 'Maximum number of leak candidates to return (default: 20)')
      .required('snapshotId')
      .query(),
  ),
  tool('v8_heap_retainers', (t) =>
    t
      .desc(
        'Trace retainer chains from suspect leak objects back to GC roots. ' +
          'For each nodeId, walks the immediate-dominator chain to produce a ' +
          '"what keeps it alive" path: leaf → ... → GC root. Each step includes ' +
          'nodeId, name, className, shallowSize, retainedSize, and distance from the leaf. ' +
          'Use after v8_heap_find_leaks or v8_heap_snapshot_analyze to understand ' +
          'why a specific object is not being collected.',
      )
      .string('snapshotId', 'Snapshot ID taken with v8_heap_snapshot_capture')
      .array(
        'nodeIds',
        { type: 'number' },
        'One or more nodeIds to trace (from leak candidates or class histogram)',
      )
      .number('maxSteps', 'Maximum steps per chain (default: 50)')
      .required('snapshotId', 'nodeIds')
      .query(),
  ),
  tool('v8_deopt_trace', (t) =>
    t
      .desc(
        'Trace V8 deoptimization events during a capture window. ' +
          'Primary path uses CDP Tracing (v8 category, V8.DeoptimizeFrame ' +
          'events — no natives syntax needed, structured reason/type/line ' +
          'data, timestamps aligned with profiler_cpu). Falls back to ' +
          '%TraceDeoptimizations console parsing when Tracing is unavailable ' +
          '(requires V8 natives syntax).',
      )
      .number('durationMs', 'Trace window duration in ms (default: 5000)', {
        default: 5000,
        minimum: 100,
        maximum: 60000,
      })
      .number('maxEvents', 'Maximum deopt events to capture (default: 50)', { default: 50 })
      .boolean('enable', 'Enable deopt tracing (default: true)', { default: true })
      .query(),
  ),
  tool('v8_turbofan_inspect', (t) =>
    t
      .desc(
        'Inspect JIT/TurboFan compilation state for functions in a script. ' +
          'Reports optimization tier (interpreted/maglev/turbofan) with V8 ' +
          'optimization status codes. Supports actions: inspect (default), ' +
          'optimize (%OptimizeFunctionOnNextCall), deoptimize (%DeoptimizeFunction). ' +
          'Requires V8 natives syntax; falls back to heuristic JIT inspection ' +
          'when natives is unavailable.',
      )
      .string('scriptId', 'CDP scriptId to inspect')
      .string('functionName', 'Optional function name filter (substring match)')
      .string(
        'action',
        'Action: inspect (query status), optimize (force optimize), deoptimize (force deopt)',
      )
      .number('topN', 'Maximum functions to inspect (default: 10)', { default: 10 })
      .required('scriptId')
      .query(),
  ),
  tool('v8_turbofan_graph', (t) =>
    t
      .desc(
        'Collect and visualize V8 TurboFan IR (sea-of-nodes / Turboshaft graph). ' +
          'Two modes: (1) Provide JS source code — spawns an isolated V8 child ' +
          'with --trace-turbo to generate IR JSON, then parses nodes, edges, ' +
          'phases, and opcode histogram. (2) Provide a traceDir path to read ' +
          'already-generated turbo-*.json files (e.g. from a browser launched ' +
          'with --trace-turbo). Returns per-function graph summaries with ' +
          'phase-level node/edge counts, sample nodes, and opcode distribution.',
      )
      .string('source', 'JS source code to compile and trace (source mode)')
      .string('traceDir', 'Path to directory containing turbo-*.json files (directory mode)')
      .string(
        'functionName',
        'Optional function name for --trace-turbo-filter (default: anonymous)',
      )
      .string('phaseFilter', 'Optional: only include phases whose name contains this substring')
      .number('maxNodesPerPhase', 'Max sample nodes per phase in output (default: 20)', {
        default: 20,
      })
      .boolean('includePhases', 'Include per-phase breakdown with sample nodes (default: false)', {
        default: false,
      })
      .number('timeoutMs', 'Timeout for isolated V8 process in ms (default: 30000)', {
        default: 30000,
      })
      .boolean('keepTraceDir', 'Keep temp trace directory after parsing (default: false)', {
        default: false,
      })
      .query(),
  ),
  tool('v8_function_retained', (t) =>
    t
      .desc(
        'Find all heap objects retained by functions matching a name pattern. ' +
          'Walks the dominator tree to find objects whose constructor/class name ' +
          'matches the given pattern, then returns each with its retainer chain. ' +
          'Useful for understanding which objects a specific function/class is holding alive.',
      )
      .string('snapshotId', 'Snapshot ID taken with v8_heap_snapshot_capture')
      .string('pattern', 'Substring to match against heap object names (case-insensitive)')
      .number('maxResults', 'Maximum results to return (default: 50)', { default: 50 })
      .number('minRetainedSize', 'Minimum retained size filter in bytes (default: 0)', {
        default: 0,
      })
      .required('snapshotId', 'pattern')
      .query(),
  ),
  tool('v8_object_compare', (t) =>
    t
      .desc(
        'Compare heap objects by shallow/retained size, class name, and property count. ' +
          'Same-snapshot mode (objectIds only) does all-pairs comparison (n-choose-2). ' +
          'Cross-snapshot mode (anotherSnapshotId + anotherObjectIds) does pairwise A[i]↔B[i] comparison. ' +
          'Use to track object growth over time, find memory regression candidates, ' +
          'or compare leaked vs healthy objects of the same class.',
      )
      .string('snapshotId', 'Primary snapshot ID')
      .array('objectIds', { type: 'number' }, 'One or more nodeIds to compare (max 50)')
      .string(
        'anotherSnapshotId',
        'Optional: second snapshot ID for cross-snapshot comparison (requires anotherObjectIds)',
      )
      .array(
        'anotherObjectIds',
        { type: 'number' },
        'Optional: matching nodeIds from the second snapshot (must match objectIds length)',
      )
      .number('minDeltaBytes', 'Minimum delta in bytes to flag as interesting (default: 1024)', {
        default: 1024,
      })
      .required('snapshotId', 'objectIds')
      .query(),
  ),
  tool('v8_wasm_inspect', (t) =>
    t
      .desc(
        'Inspect WebAssembly modules and garbage-collected WASM objects in the page. ' +
          'Discovers .wasm script resources via performance.getEntriesByType, detects WASM GC ' +
          '(struct/array/ref-types) availability, and enumerates feature flags ' +
          '(gc/threads/simd). Supports optional scriptId filter to inspect a specific ' +
          'WASM module. Requires browser/page CDP context. ' +
          'Note: structural type enumeration (includeStructs) requires Chrome ≥ M119 ' +
          'with --enable-features=WebAssemblyGC; absent that, returns gcAvailable flag ' +
          'and script-level summary only.',
      )
      .string(
        'scriptId',
        'Optional: CDP scriptId of a specific WASM module to inspect. Omit for discovery mode.',
      )
      .boolean('includeStructs', 'Include struct type enumeration (default: true)', {
        default: true,
      })
      .query(),
  ),
  tool('v8_heap_sampling', (t) =>
    t
      .desc(
        'Collect a V8 allocation sampling profile via CDP HeapProfiler. ' +
          'Starts sampling for a capture window (default 5s), then returns the aggregated ' +
          'allocation call tree: per-function self/total bytes + sample count, sorted by ' +
          'total bytes allocated. Useful for finding hot allocation sites without a full ' +
          'heap snapshot. Requires browser/page CDP context.',
      )
      .number('durationMs', 'Sampling capture window in ms (default: 5000, max: 60000)', {
        default: 5000,
      })
      .number('topN', 'Number of top allocation sites to return (default: 50)', { default: 50 })
      .number('samplingInterval', 'Allocation sampling interval in bytes (default: 32768)', {
        default: 32768,
        minimum: 256,
        maximum: 1048576,
      })
      .query(),
  ),
  tool('v8_allocation_track', (t) =>
    t
      .desc(
        'Track live V8 allocations via CDP HeapProfiler object tracking. ' +
          'Enables the HeapProfiler, calls startTrackingHeapObjects({ trackAllocations: true }) ' +
          'to collect lastSeenObjectId events for a capture window (default 3s), then ' +
          'stopTrackingHeapObjects (with an explicit takeHeapSnapshot fallback) to return ' +
          'currently-live objects seen during the window with their allocation stack ' +
          '(top frame + size). Useful for finding objects that survive GC during a specific ' +
          'interaction. Requires browser/page CDP context and V8 natives for full stack resolution.',
      )
      .number('durationMs', 'Tracking capture window in ms (default: 3000, max: 30000)', {
        default: 3000,
      })
      .number('topN', 'Number of top live objects to return (default: 50)', { default: 50 })
      .query(),
  ),
  tool('v8_weakrefs_inspect', (t) =>
    t
      .desc(
        'Enumerate WeakRef and FinalizationRegistry instances in the page via Runtime.evaluate. ' +
          'Inspects registered finalization callbacks and live WeakRef targets, reporting ' +
          'how many WeakRefs are dereferenced vs cleared and which FinalizationRegistry ' +
          'callbacks have pending entries. Useful for diagnosing cleanup logic in long-lived ' +
          'pages. Requires browser/page CDP context.',
      )
      .number('scanDepth', 'Prototype chain scan depth for WeakRef discovery (default: 5)', {
        default: 5,
      })
      .query(),
  ),
  tool('v8_heap_snapshot_list', (t) =>
    t
      .desc(
        'List V8 heap snapshots — both in-memory (current session) and persisted to ' +
          'artifacts/heap-snapshots/ (survive a server restart). Reports id, capture time, ' +
          'size, source (in-memory/persisted), simulated flag, and expiry status, plus ' +
          'aggregate stats. Snapshot payloads are NOT returned (only metadata).',
      )
      .boolean('includeExpired', 'Include ttl-expired persisted snapshots (default: false)')
      .number(
        'ttlMinutes',
        'Mark persisted snapshots older than N minutes as expired (default: 0 = no ttl flagging)',
      )
      .query(),
  ),
  tool('v8_heap_snapshot_delete', (t) =>
    t
      .desc(
        'Delete persisted V8 heap snapshot artifact files (.heapsnapshot data + .meta.json ' +
          'sidecar) and drop the matching in-memory cache entry. Use deleteAll=true to remove ' +
          'every persisted snapshot. Does not affect the live V8 heap.',
      )
      .string('snapshotId', 'Snapshot ID to delete')
      .boolean('deleteAll', 'Delete ALL persisted snapshots (snapshotId is ignored when true)')
      .destructive(),
  ),
  tool('v8_heap_snapshot_export', (t) =>
    t
      .desc(
        'Export a heap snapshot as a complete .heapsnapshot JSON file under ' +
          'artifacts/heap-snapshots/, loadable by the Chrome DevTools Memory panel. The file ' +
          'path is returned; the snapshot content is written to disk, not injected into the ' +
          'response (it can be very large).',
      )
      .string('snapshotId', 'Snapshot ID to export (must be in-memory or persisted)')
      .required('snapshotId')
      .query(),
  ),
];
