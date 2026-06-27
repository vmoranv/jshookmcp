import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const v8InspectorTools: Tool[] = [
  tool('v8_heap_snapshot_capture', (t) =>
    t.desc('Capture a V8 heap snapshot for offline analysis.').query(),
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
  tool('v8_jit_inspect', (t) =>
    t
      .desc('Report JIT compilation status and optimization tier for a script.')
      .string('scriptId', 'CDP scriptId')
      .required('scriptId')
      .query(),
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
          'Enables %TraceDeoptimizations via natives syntax and captures ' +
          'deopt events (function name, reason, bailout position). ' +
          'Requires V8 natives syntax. Falls back gracefully when unavailable.',
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
        'Inspect TurboFan compilation state for functions in a script. ' +
          'Reports optimization tier (interpreted/maglev/turbofan). ' +
          'Supports actions: inspect (default), optimize (%OptimizeFunctionOnNextCall), ' +
          'deoptimize (%DeoptimizeFunction). Requires V8 natives syntax.',
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
          'Discovers .wasm script resources, detects WASM GC (struct/array/ref-types) availability, ' +
          'and enumerates feature flags (gc/threads/simd). Supports optional scriptId filter ' +
          'to inspect a specific WASM module. Requires browser/page CDP context.',
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
];
