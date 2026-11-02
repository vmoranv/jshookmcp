/**
 * V8 Allocation Tracking Handler — v8_allocation_track
 *
 * Tracks live V8 allocations via CDP HeapProfiler object tracking. Unlike
 * sampling (which aggregates a call tree), tracking returns the set of
 * objects that are still alive at the end of the capture window — each with
 * its allocation stack and size. Useful for "what survived GC during this
 * interaction" analysis.
 *
 * Flow:
 *   1. HeapProfiler.enable
 *   2. HeapProfiler.startTrackingHeapObjects({ trackAllocations: true }) —
 *      V8 starts recording allocation stacks for new objects. Mid-flight the
 *      session emits `HeapProfiler.lastSeenObjectId` events, which we collect
 *      as a secondary count signal.
 *   3. Wait the capture window.
 *   4. HeapProfiler.stopTrackingHeapObjects({ reportProgress: false,
 *      treatGlobalObjectsAsRoots: true, captureNumericValue: true }) — in
 *      Chrome the stop call internally captures a heap snapshot and streams
 *      it via `HeapProfiler.addHeapSnapshotChunk` events. That snapshot
 *      carries the `allocation_stack` node field for objects allocated while
 *      tracking was on. The stop response itself is `{}` (no `entries`).
 *   5. Fallback: some CDP clients/versions answer the stop call without
 *      streaming a snapshot — then issue an explicit
 *      HeapProfiler.takeHeapSnapshot (same params) and collect its chunks.
 *   6. Parse the snapshot: nodes whose `allocation_stack` field is set were
 *      allocated during the window and survived GC; each is resolved to its
 *      top stack frame (function name / script / line) via the snapshot's
 *      `trace_function_infos` / `trace_tree` sections.
 *   7. HeapProfiler.disable (paired with the enable).
 *
 * Requires browser/page CDP context.
 */

import { argNumber } from '@server/domains/shared/parse-args';
import { normalizeSessionSource, resolveTargetSession } from './cdp-session';
import type { CDPSessionLike, SessionSource } from './cdp-session';
import { HEAP_PARSE_JOB_TIMEOUT_MS } from './heap-parse-worker';
import type { HeapParsePool } from './heap-parse-worker';

export interface LiveAllocation {
  objectId: number;
  sizeBytes: number;
  functionName: string;
  scriptId: string | number;
  url: string;
  lineNumber: number;
}

export interface AllocationTrackResult {
  success: boolean;
  error?: string;
  durationMs: number;
  trackedCount: number;
  returnedCount: number;
  totalLiveBytes: number;
  allocations: LiveAllocation[];
  summary: string;
}

interface LastSeenObjectIdEvent {
  lastSeenObjectId: number;
  timestamp: number;
}

/** Subset of CDPSessionLike's event surface used for chunk/object-id events. */
interface EventedSession {
  on?: (event: string, handler: (data: unknown) => void) => void;
  off?: (event: string, handler: (data: unknown) => void) => void;
}

/** Params DevTools passes when stopping tracking / taking the tracking snapshot. */
const SNAPSHOT_PARAMS = {
  reportProgress: false,
  treatGlobalObjectsAsRoots: true,
  captureNumericValue: true,
};

/**
 * Send a snapshot-producing HeapProfiler command and collect every
 * `HeapProfiler.addHeapSnapshotChunk` event it streams. Mirrors
 * V8InspectorClient.takeHeapSnapshot: the listener is registered before the
 * command so chunks emitted during generation are captured; the command's
 * response (`{}` for both stopTrackingHeapObjects and takeHeapSnapshot)
 * resolves after snapshot generation, at which point all chunk events have
 * been dispatched. A microtask flush after the response covers clients that
 * queue events behind the response message.
 */
async function collectSnapshotChunks(
  session: CDPSessionLike,
  evented: EventedSession,
  method: 'HeapProfiler.stopTrackingHeapObjects' | 'HeapProfiler.takeHeapSnapshot',
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const chunks: string[] = [];
    const chunkHandler = (data: unknown) => {
      const chunk = (data as { chunk?: unknown } | null)?.chunk;
      if (typeof chunk === 'string') {
        chunks.push(chunk);
      }
    };
    if (typeof evented.on === 'function') {
      evented.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
    }
    session
      .send(method, SNAPSHOT_PARAMS)
      .then(async () => {
        // Flush any chunk events queued behind the command response.
        await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
        if (typeof evented.off === 'function') {
          evented.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
        }
        resolve(chunks);
      })
      .catch((err: unknown) => {
        if (typeof evented.off === 'function') {
          evented.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
        }
        reject(err);
      });
  });
}

/** Snapshot trace data parsed out of the tracking snapshot. */
export interface ParsedAllocationSnapshot {
  ok: boolean;
  error?: string;
  allocations: LiveAllocation[];
  totalLiveBytes: number;
  /** Nodes whose allocation_stack field was set (allocated during the window). */
  trackedNodeCount: number;
}

interface TraceFunctionInfo {
  name?: unknown;
  script_name?: unknown;
  script_id?: unknown;
  line?: unknown;
  column?: unknown;
}

interface TraceTreeNode {
  id: number;
  functionInfoIndex: number;
  children: TraceTreeNode[];
}

/** Upper bound on trace-tree nodes walked when resolving a stack by id. */
const TRACE_TREE_LOOKUP_BUDGET = 10000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Resolve a value that is either a raw string or an index into the strings table. */
function resolveStringIndex(strings: unknown, index: unknown): string {
  if (typeof index === 'string') {
    return index;
  }
  if (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    Array.isArray(strings) &&
    index < strings.length
  ) {
    const value = strings[index];
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/**
 * Parse the snapshot's `trace_function_infos` section. Two serialization
 * shapes exist in the wild: an array of per-entry objects (name/script_name/
 * line/column, with string-table indices), or a flat array serialized per
 * `snapshot.meta.trace_function_info_fields` (["function_id","name",
 * "script_name","script_id","line","column"]).
 */
function parseTraceFunctionInfos(raw: Record<string, unknown>): TraceFunctionInfo[] {
  const infos = raw['trace_function_infos'];
  if (!Array.isArray(infos)) {
    return [];
  }
  if (infos.length > 0 && isRecord(infos[0])) {
    return infos as TraceFunctionInfo[];
  }
  const snapshot = isRecord(raw['snapshot']) ? raw['snapshot'] : null;
  const meta = snapshot && isRecord(snapshot['meta']) ? snapshot['meta'] : null;
  const fields = meta ? toStringArray(meta['trace_function_info_fields']) : [];
  if (fields.length === 0) {
    return [];
  }
  const stride = fields.length;
  const result: TraceFunctionInfo[] = [];
  for (let i = 0; i + stride <= infos.length; i += stride) {
    const entry: Record<string, unknown> = {};
    for (let j = 0; j < stride; j += 1) {
      const field = fields[j];
      if (field) {
        entry[field] = infos[i + j];
      }
    }
    result.push(entry as TraceFunctionInfo);
  }
  return result;
}

/**
 * Parse the snapshot's `trace_tree` section into a tree of {id,
 * functionInfoIndex}. Supports both the flat serialization (per
 * `snapshot.meta.trace_node_fields` = ["id","function_info_index","count",
 * "size","children"]) and an object shape (nested {id,
 * function_info_index, children} entries).
 */
function parseTraceTree(raw: Record<string, unknown>): TraceTreeNode | null {
  const tree = raw['trace_tree'];
  if (!Array.isArray(tree) || tree.length === 0) {
    return null;
  }
  const snapshot = isRecord(raw['snapshot']) ? raw['snapshot'] : null;
  const meta = snapshot && isRecord(snapshot['meta']) ? snapshot['meta'] : null;

  if (isRecord(tree[0])) {
    const parseObjectNode = (node: Record<string, unknown>): TraceTreeNode | null => {
      const id = node['id'];
      const functionInfoIndex = node['function_info_index'];
      if (typeof id !== 'number' || typeof functionInfoIndex !== 'number') {
        return null;
      }
      const children: TraceTreeNode[] = [];
      const kids = node['children'];
      if (Array.isArray(kids)) {
        for (const kid of kids) {
          if (isRecord(kid)) {
            const parsed = parseObjectNode(kid);
            if (parsed) {
              children.push(parsed);
            }
          }
        }
      }
      return { id, functionInfoIndex, children };
    };
    return parseObjectNode(tree[0]);
  }

  const fields = meta ? toStringArray(meta['trace_node_fields']) : [];
  const idIndex = fields.indexOf('id');
  const functionInfoIndexField = fields.indexOf('function_info_index');
  const childrenField = fields.indexOf('children');
  if (idIndex < 0 || functionInfoIndexField < 0 || childrenField < 0) {
    return null;
  }
  const stride = fields.length;
  const parseFlatNode = (arr: unknown[], offset: number): TraceTreeNode | null => {
    const id = arr[offset + idIndex];
    const functionInfoIndex = arr[offset + functionInfoIndexField];
    if (typeof id !== 'number' || typeof functionInfoIndex !== 'number') {
      return null;
    }
    const children: TraceTreeNode[] = [];
    const kids = arr[offset + childrenField];
    if (Array.isArray(kids)) {
      for (let c = 0; c + stride <= kids.length; c += stride) {
        const parsed = parseFlatNode(kids, c);
        if (parsed) {
          children.push(parsed);
        }
      }
    }
    return { id, functionInfoIndex, children };
  };
  return parseFlatNode(tree, 0);
}

/** Bounded search for a trace node by id (node allocation_stack is sometimes a trace node id). */
function findTraceNodeById(root: TraceTreeNode | null, id: number): TraceTreeNode | null {
  if (!root) {
    return null;
  }
  const stack: TraceTreeNode[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < TRACE_TREE_LOOKUP_BUDGET) {
    const node = stack.pop();
    visited += 1;
    if (node && node.id === id) {
      return node;
    }
    if (node) {
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }
  return null;
}

interface ResolvedStackFrame {
  functionName: string;
  scriptId: string | number;
  url: string;
  lineNumber: number;
}

/** Build a stack frame from a trace_function_infos entry; null when the entry has no name. */
function frameFromInfo(info: TraceFunctionInfo, strings: unknown): ResolvedStackFrame | null {
  const name = resolveStringIndex(strings, info['name']);
  if (!name) {
    return null;
  }
  const scriptId = info['script_id'];
  return {
    functionName: name,
    scriptId: typeof scriptId === 'number' || typeof scriptId === 'string' ? scriptId : '?',
    url: resolveStringIndex(strings, info['script_name']),
    lineNumber: typeof info['line'] === 'number' ? info['line'] : -1,
  };
}

/**
 * Resolve a node's allocation_stack value to its top frame. The value is an
 * index into trace_function_infos in some serializations and a trace-tree
 * node id in others — try both before falling back to the node's own class
 * name so the result is never empty.
 */
function resolveStackFrame(
  infos: TraceFunctionInfo[],
  tree: TraceTreeNode | null,
  stackValue: number,
  strings: unknown,
  nodeName: string,
): ResolvedStackFrame {
  const fallback: ResolvedStackFrame = {
    functionName: nodeName,
    scriptId: '?',
    url: '',
    lineNumber: -1,
  };
  if (stackValue < infos.length) {
    return frameFromInfo(infos[stackValue] ?? {}, strings) ?? fallback;
  }
  const treeNode = findTraceNodeById(tree, stackValue);
  if (treeNode && treeNode.functionInfoIndex >= 0 && treeNode.functionInfoIndex < infos.length) {
    return frameFromInfo(infos[treeNode.functionInfoIndex] ?? {}, strings) ?? fallback;
  }
  return fallback;
}

/**
 * Parse a tracking heap snapshot (joined `HeapProfiler.addHeapSnapshotChunk`
 * chunks) into live-allocation records. Nodes whose `allocation_stack` field
 * is a non-negative number were allocated while tracking was active; their
 * size contributes to the totals. Returns ok:false with a diagnostic when the
 * snapshot cannot be read or carries no allocation data.
 */
function parseAllocationSnapshot(chunks: string[]): ParsedAllocationSnapshot {
  const empty: ParsedAllocationSnapshot = {
    ok: false,
    allocations: [],
    totalLiveBytes: 0,
    trackedNodeCount: 0,
  };
  if (chunks.length === 0) {
    return { ...empty, error: 'no snapshot chunks received from the CDP session' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(chunks.join(''));
  } catch (err) {
    return {
      ...empty,
      error: `heap snapshot JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(raw)) {
    return { ...empty, error: 'heap snapshot is not a JSON object' };
  }
  const snapshot = isRecord(raw['snapshot']) ? raw['snapshot'] : null;
  const meta = snapshot && isRecord(snapshot['meta']) ? snapshot['meta'] : null;
  const nodeFields = meta ? toStringArray(meta['node_fields']) : [];
  const stackFieldIndex = nodeFields.indexOf('allocation_stack');
  if (stackFieldIndex < 0) {
    return {
      ...empty,
      error:
        'heap snapshot has no allocation_stack node field — allocation-tracking data is absent from this snapshot',
    };
  }
  const nameFieldIndex = nodeFields.indexOf('name');
  const idFieldIndex = nodeFields.indexOf('id');
  const selfSizeFieldIndex = nodeFields.indexOf('self_size');
  const nodes = raw['nodes'];
  if (!Array.isArray(nodes)) {
    return { ...empty, error: 'heap snapshot missing nodes array' };
  }
  const strings = raw['strings'];
  const stride = nodeFields.length;
  const infos = parseTraceFunctionInfos(raw);
  const tree = parseTraceTree(raw);

  const allocations: LiveAllocation[] = [];
  let totalLiveBytes = 0;
  let trackedNodeCount = 0;

  for (let offset = 0; offset + stride <= nodes.length; offset += stride) {
    const stackValue = nodes[offset + stackFieldIndex];
    const hasStack =
      typeof stackValue === 'number' && Number.isFinite(stackValue) && stackValue >= 0;
    if (!hasStack) {
      continue;
    }
    trackedNodeCount += 1;
    const selfSize =
      typeof nodes[offset + selfSizeFieldIndex] === 'number'
        ? (nodes[offset + selfSizeFieldIndex] as number)
        : 0;
    const objectId =
      idFieldIndex >= 0 && typeof nodes[offset + idFieldIndex] === 'number'
        ? (nodes[offset + idFieldIndex] as number)
        : offset / stride;
    const nodeName =
      nameFieldIndex >= 0 ? resolveStringIndex(strings, nodes[offset + nameFieldIndex]) : '';
    const frame = resolveStackFrame(infos, tree, stackValue, strings, nodeName);
    allocations.push({
      objectId,
      sizeBytes: selfSize,
      functionName: frame.functionName || '(unknown)',
      scriptId: frame.scriptId,
      url: frame.url,
      lineNumber: frame.lineNumber,
    });
    totalLiveBytes += selfSize;
  }

  return { ok: true, allocations, totalLiveBytes, trackedNodeCount };
}

/**
 * Parse a tracking snapshot into live allocations, off the main thread when a
 * pool is wired in.
 *
 * With a pool: the chunks array is posted to the heap-parse worker, which does
 * the `join('')` + `JSON.parse` + allocation build + size sort (the GB-scale
 * work that otherwise freezes the event loop). Without a pool (direct handler
 * calls / tests): falls back to the synchronous `parseAllocationSnapshot` and
 * sorts on the main thread. Production injects the shared pool via impl.ts.
 */
async function parseAllocationSnapshotWithPool(
  chunks: string[],
  pool?: HeapParsePool,
): Promise<ParsedAllocationSnapshot> {
  if (!pool) {
    const parsed = parseAllocationSnapshot(chunks);
    parsed.allocations.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return parsed;
  }
  return pool.submit({ chunks }, HEAP_PARSE_JOB_TIMEOUT_MS);
}

export async function handleAllocationTrack(
  args: Record<string, unknown>,
  source?: SessionSource,
  pool?: HeapParsePool,
): Promise<AllocationTrackResult> {
  const durationRaw = argNumber(args, 'durationMs', 3000);
  const durationMs = Math.min(
    30000,
    Math.max(500, Number.isFinite(durationRaw) ? durationRaw : 3000),
  );
  const topN = Math.min(500, Math.max(1, argNumber(args, 'topN', 50)));

  const { session, owned } = await resolveTargetSession(normalizeSessionSource(source));
  if (!session) {
    return {
      success: false,
      error:
        'No CDP session available — browser must be connected via browser_launch or browser_attach',
      durationMs: 0,
      trackedCount: 0,
      returnedCount: 0,
      totalLiveBytes: 0,
      allocations: [],
      summary: 'CDP session unavailable',
    };
  }

  const startTime = Date.now();
  // Set once startTrackingHeapObjects succeeds so the finally block only
  // sends the stop command when tracking was actually started.
  let trackingStarted = false;
  // Set once the tracking snapshot was collected, so the finally block does
  // not stop tracking a second time (which would trigger another snapshot).
  let stopped = false;
  let enabled = false;
  const seenObjectIds: number[] = [];
  const cdp = session as unknown as EventedSession;
  const objectIdHandler = (params: unknown) => {
    const event = params as LastSeenObjectIdEvent | null;
    if (typeof event?.lastSeenObjectId === 'number') {
      seenObjectIds.push(event.lastSeenObjectId);
    }
  };

  try {
    await session.send('HeapProfiler.enable');
    enabled = true;
    if (typeof cdp.on === 'function') {
      cdp.on('HeapProfiler.lastSeenObjectId', objectIdHandler);
    }
    await session.send('HeapProfiler.startTrackingHeapObjects', { trackAllocations: true });
    trackingStarted = true;

    // Capture window — wait for the interaction's allocations to land.
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

    // Stop tracking. Chrome captures the tracking heap snapshot as part of
    // the stop call and streams it via addHeapSnapshotChunk; the response is
    // `{}` (it never carries an `entries` payload).
    let chunks = await collectSnapshotChunks(session, cdp, 'HeapProfiler.stopTrackingHeapObjects');
    stopped = true;

    // Fallback for clients/versions that answer the stop call without
    // streaming a snapshot — take an explicit heap snapshot instead.
    if (chunks.length === 0) {
      chunks = await collectSnapshotChunks(session, cdp, 'HeapProfiler.takeHeapSnapshot');
    }

    const parsed = await parseAllocationSnapshotWithPool(chunks, pool);
    if (!parsed.ok) {
      return {
        success: false,
        error: `Allocation tracking stopped, but the heap snapshot could not be read: ${parsed.error}`,
        durationMs: Date.now() - startTime,
        trackedCount: seenObjectIds.length,
        returnedCount: 0,
        totalLiveBytes: 0,
        allocations: [],
        summary: 'Allocation tracking failed — no allocation data in snapshot',
      };
    }

    if (parsed.trackedNodeCount === 0) {
      return {
        success: true,
        durationMs: Date.now() - startTime,
        trackedCount: seenObjectIds.length,
        returnedCount: 0,
        totalLiveBytes: 0,
        allocations: [],
        summary: `No live objects with allocation stacks found — nothing allocated during the ${durationMs}ms window survived GC`,
      };
    }

    // Allocations are already sorted by size descending (the worker sorts, as
    // does the sync fallback in parseAllocationSnapshotWithPool).
    const top = parsed.allocations.slice(0, topN);

    return {
      success: true,
      durationMs: Date.now() - startTime,
      trackedCount: seenObjectIds.length,
      returnedCount: top.length,
      totalLiveBytes: parsed.totalLiveBytes,
      allocations: top,
      summary: `${top.length} live objects (${parsed.totalLiveBytes} bytes) survived the ${durationMs}ms window; ${parsed.trackedNodeCount} nodes carried allocation stacks`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
      trackedCount: 0,
      returnedCount: 0,
      totalLiveBytes: 0,
      allocations: [],
      summary: 'Allocation tracking failed',
    };
  } finally {
    if (typeof cdp.off === 'function') {
      cdp.off('HeapProfiler.lastSeenObjectId', objectIdHandler);
    }
    if (trackingStarted && !stopped) {
      await session.send('HeapProfiler.stopTrackingHeapObjects').catch(() => undefined);
    }
    if (enabled) {
      // Pair the enable with a disable before the session is released.
      await session.send('HeapProfiler.disable').catch(() => undefined);
    }
    if (owned) await session.detach().catch(() => undefined);
  }
}
