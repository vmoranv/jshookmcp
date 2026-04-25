import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const v8InspectorTools: Tool[] = [
  tool('v8_heap_snapshot_capture', (t) => t.desc('Capture a V8 heap snapshot').query()),
  tool('v8_heap_snapshot_analyze', (t) =>
    t
      .desc('Analyze a captured V8 heap snapshot')
      .string('snapshotId', 'Snapshot ID')
      .required('snapshotId')
      .query(),
  ),
  tool('v8_heap_diff', (t) =>
    t
      .desc('Diff two V8 heap snapshots')
      .string('beforeSnapshotId', 'Baseline snapshot ID')
      .string('afterSnapshotId', 'Updated snapshot ID')
      .required('beforeSnapshotId', 'afterSnapshotId')
      .query(),
  ),
  tool('v8_object_inspect', (t) =>
    t
      .desc('Inspect a V8 heap object')
      .string('address', 'Heap object address')
      .required('address')
      .query(),
  ),
  tool('v8_heap_stats', (t) => t.desc('Read V8 heap usage').query()),
  tool('v8_bytecode_extract', (t) =>
    t
      .desc('Derive pseudo bytecode from a V8 script')
      .string('scriptId', 'CDP scriptId')
      .number('functionOffset', 'Optional function byte offset')
      .required('scriptId')
      .query(),
  ),
  tool('v8_version_detect', (t) => t.desc('Detect V8 version and capabilities').query()),
  tool('v8_jit_inspect', (t) =>
    t
      .desc('Inspect JIT status for a V8 script')
      .string('scriptId', 'CDP scriptId')
      .required('scriptId')
      .query(),
  ),
];
