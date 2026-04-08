import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const v8InspectorTools: Tool[] = [
  tool('v8_heap_snapshot_capture')
    .desc('Capture a V8 heap snapshot from the active browser target')
    .readOnly()
    .idempotent()
    .build(),
  tool('v8_heap_snapshot_analyze')
    .desc('Analyze a previously captured V8 heap snapshot')
    .string('snapshotId', 'Heap snapshot identifier')
    .required('snapshotId')
    .readOnly()
    .idempotent()
    .build(),
  tool('v8_heap_diff')
    .desc('Diff two captured V8 heap snapshots')
    .string('beforeSnapshotId', 'Baseline snapshot identifier')
    .string('afterSnapshotId', 'Updated snapshot identifier')
    .required('beforeSnapshotId', 'afterSnapshotId')
    .readOnly()
    .idempotent()
    .build(),
  tool('v8_object_inspect')
    .desc('Inspect a V8 heap object by address')
    .string('address', 'Heap object address')
    .required('address')
    .readOnly()
    .idempotent()
    .build(),
  tool('v8_heap_stats').desc('Return V8 heap snapshot statistics').readOnly().idempotent().build(),
  tool('v8_bytecode_extract')
    .desc('Extract V8 Ignition bytecode for a function')
    .string('functionId', 'CDP RemoteObjectId of the function')
    .required('functionId')
    .readOnly()
    .idempotent()
    .build(),
  tool('v8_version_detect')
    .desc('Detect V8 engine version and feature support')
    .readOnly()
    .idempotent()
    .build(),
  tool('v8_jit_inspect')
    .desc('Inspect JIT-compiled code for a function')
    .string('functionId', 'CDP RemoteObjectId of the function')
    .required('functionId')
    .readOnly()
    .idempotent()
    .build(),
];
