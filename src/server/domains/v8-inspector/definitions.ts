import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const v8InspectorTools: Tool[] = [
  tool('v8_heap_snapshot_capture', (t) =>
    t.desc('Capture a V8 heap snapshot for offline analysis.').query(),
  ),
  tool('v8_heap_snapshot_analyze', (t) =>
    t
      .desc('Analyze a heap snapshot: retained size, constructor distribution, dominators.')
      .string('snapshotId', 'Snapshot ID')
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
];
