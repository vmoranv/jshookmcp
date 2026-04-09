import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const v8InspectorTools: Tool[] = [
  tool('v8_heap_snapshot_capture', (t) =>
    t.desc('Capture a V8 heap snapshot from the active browser target').query(),
  ),
  tool('v8_heap_snapshot_analyze', (t) =>
    t
      .desc('Analyze a previously captured V8 heap snapshot')
      .string('snapshotId', 'Heap snapshot identifier')
      .required('snapshotId')
      .query(),
  ),
  tool('v8_heap_diff', (t) =>
    t
      .desc('Diff two captured V8 heap snapshots')
      .string('beforeSnapshotId', 'Baseline snapshot identifier')
      .string('afterSnapshotId', 'Updated snapshot identifier')
      .required('beforeSnapshotId', 'afterSnapshotId')
      .query(),
  ),
  tool('v8_object_inspect', (t) =>
    t
      .desc('Inspect a V8 heap object by address')
      .string('address', 'Heap object address')
      .required('address')
      .query(),
  ),
  tool('v8_heap_stats', (t) => t.desc('Return V8 heap snapshot statistics').query()),
  tool('v8_bytecode_extract', (t) =>
    t
      .desc('Extract V8 Ignition bytecode for a function')
      .string('functionId', 'CDP RemoteObjectId of the function')
      .required('functionId')
      .query(),
  ),
  tool('v8_version_detect', (t) => t.desc('Detect V8 engine version and feature support').query()),
  tool('v8_jit_inspect', (t) =>
    t
      .desc('Inspect JIT-compiled code for a function')
      .string('functionId', 'CDP RemoteObjectId of the function')
      .required('functionId')
      .query(),
  ),
];
