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
];
