/**
 * Trace domain tool handlers.
 *
 * Implements recording lifecycle, SQL query, timestamp seek,
 * request-scoped network flow retrieval, heap diffing, and export.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { TraceQueryResult } from '@modules/trace/TraceDB.types';
import { TraceDB } from '@modules/trace/TraceDB';
import { type TraceRecorder } from '@modules/trace/TraceRecorder';
import type { CDPSessionLike } from '@modules/trace/TraceRecorder';
import { resolveArtifactPath } from '@utils/artifacts';
import { argEnum } from '@server/domains/shared/parse-args';
import { handleSafe, R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { ToolError } from '@errors/ToolError';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { getProjectRoot, getSystemTempRoots } from '@utils/outputPaths';
import { resolveSafeOutputPath, writeTextFileAtomically } from '@utils/safeOutput';
import {
  asBoolean,
  asNumber,
  formatNetworkChunk,
  formatNetworkResource,
  formatTraceEvent,
  getDbForReading,
  optionalBooleanArg,
  optionalNumberArg,
  optionalStringArg,
  optionalStringArrayArg,
  parseTraceSummary,
  readEventsByExpression,
  readExportTraceRow,
  readSummaryMemoryDeltaRow,
  readSummaryTraceEventRow,
  readTraceBody,
  readTraceSummaryNumber,
  readTraceSummaryObjectCounts,
  rowToObject,
  safeParseJSON,
  smartHandleDetailed,
} from '@server/domains/trace/handler-utils';
import {
  summarizeEvents,
  summarizeMemoryDeltas,
  type TraceEvent as SummaryTraceEvent,
  type MemoryDelta,
} from '@server/domains/trace/TraceSummarizer';

/**
 * Maps a trace event category to a Chrome Trace Event thread id (tid) so that
 * different work streams (debugger pauses, network requests, memory deltas, ...)
 * land on separate tracks in chrome://tracing and ui.perfetto.dev instead of
 * collapsing onto a single track. `pid` stays 1 (single browser process); only
 * `tid` varies per category.
 */
const TRACE_TID_BY_CATEGORY: Record<string, number> = {
  debugger: 2,
  network: 3,
  memory: 4,
  runtime: 5,
  page: 6,
  browser: 7,
};
const DEFAULT_TRACE_TID = 1;
const TRACE_THREAD_NAMES: Record<number, string> = {
  1: 'Other',
  2: 'Debugger',
  3: 'Network',
  4: 'Memory',
  5: 'Runtime',
  6: 'Page',
  7: 'Browser',
  8: 'CPU Profile',
};

function deriveTraceTid(category: string | undefined | null): number {
  if (!category) return DEFAULT_TRACE_TID;
  return TRACE_TID_BY_CATEGORY[category] ?? DEFAULT_TRACE_TID;
}

export class TraceToolHandlers {
  constructor(
    private readonly recorder: TraceRecorder,
    private readonly ctx: MCPServerContext,
  ) {}

  async handleTraceRecordingTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTraceRecording(args));
  }

  async handleStartTraceRecordingTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleStartTraceRecording(args));
  }

  async handleStopTraceRecordingTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleStopTraceRecording());
  }

  async handleQueryTraceSqlTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleQueryTraceSql(args));
  }

  async handleSeekToTimestampTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSeekToTimestamp(args));
  }

  async handleGetTraceSamplesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGetTraceSamples(args));
  }

  async handleGetTraceNetworkFlowTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGetTraceNetworkFlow(args));
  }

  async handleDiffHeapSnapshotsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleDiffHeapSnapshots(args));
  }

  async handleExportTraceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleExportTrace(args));
  }

  async handleSummarizeTraceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSummarizeTrace(args));
  }

  async handleTraceRecording(args: Record<string, unknown>): Promise<unknown> {
    const action = argEnum(args, 'action', new Set(['start', 'stop'] as const));
    return action === 'stop'
      ? this.handleStopTraceRecording()
      : this.handleStartTraceRecording(args);
  }

  async handleStartTraceRecording(args: Record<string, unknown>): Promise<unknown> {
    const cdpDomains = optionalStringArrayArg(args['cdpDomains'], 'cdpDomains');
    const recordMemoryDeltas = optionalBooleanArg(args['recordMemoryDeltas'], 'recordMemoryDeltas');
    const recordResponseBodies = optionalBooleanArg(
      args['recordResponseBodies'],
      'recordResponseBodies',
    );
    const streamResponseChunks = optionalBooleanArg(
      args['streamResponseChunks'],
      'streamResponseChunks',
    );
    const networkBodyMaxBytes = optionalNumberArg(
      args['networkBodyMaxBytes'],
      'networkBodyMaxBytes',
    );
    const networkInlineBodyBytes = optionalNumberArg(
      args['networkInlineBodyBytes'],
      'networkInlineBodyBytes',
    );

    const eventBus = this.ctx.eventBus;
    if (!eventBus) {
      throw new PrerequisiteError('EventBus not available on server context');
    }

    let cdpSession: CDPSessionLike | null = null;
    try {
      if (this.ctx.collector) {
        const page = await this.ctx.collector.getActivePage();
        const pageAny = page as unknown as { createCDPSession?: () => Promise<CDPSessionLike> };
        if (typeof pageAny.createCDPSession === 'function') {
          cdpSession = await pageAny.createCDPSession();
        }
      }
    } catch {
      // No browser attached — continue without CDP recording
    }

    const session = await this.recorder.start(eventBus, cdpSession, {
      cdpDomains,
      recordMemoryDeltas: recordMemoryDeltas ?? true,
      ownsSession: cdpSession !== null,
      network: {
        recordResponseBodies,
        streamResponseChunks,
        maxBodyBytes: networkBodyMaxBytes,
        inlineBodyBytes: networkInlineBodyBytes,
      },
    });

    return R.ok()
      .merge({
        status: 'recording',
        sessionId: session.sessionId,
        dbPath: session.dbPath,
        network: {
          recordResponseBodies: recordResponseBodies ?? true,
          streamResponseChunks: streamResponseChunks ?? true,
          maxBodyBytes: networkBodyMaxBytes ?? 10 * 1024 * 1024,
          inlineBodyBytes: networkInlineBodyBytes ?? 256 * 1024,
        },
        message: `Recording started. CDP session: ${cdpSession ? 'active' : 'not available'}`,
      })
      .json();
  }

  async handleStopTraceRecording(): Promise<unknown> {
    const session = await this.recorder.stop();

    const duration = session.stoppedAt ? session.stoppedAt - session.startedAt : 0;
    const cleanupErrors = session.cleanupErrors ?? [];
    const status = cleanupErrors.length > 0 ? 'stopped_with_errors' : 'stopped';

    return R.ok()
      .merge({
        status,
        sessionId: session.sessionId,
        dbPath: session.dbPath,
        eventCount: session.eventCount,
        memoryDeltaCount: session.memoryDeltaCount,
        heapSnapshotCount: session.heapSnapshotCount,
        networkRequestCount: session.networkRequestCount ?? 0,
        networkChunkCount: session.networkChunkCount ?? 0,
        networkBodyCount: session.networkBodyCount ?? 0,
        durationMs: duration,
        ...(cleanupErrors.length > 0 ? { cleanupErrors } : {}),
        message:
          cleanupErrors.length > 0
            ? `Recording stopped with cleanup errors. ${session.eventCount} events, ` +
              `${session.memoryDeltaCount} memory deltas, ${session.heapSnapshotCount} heap snapshots, ` +
              `${session.networkRequestCount ?? 0} network requests, ${session.networkChunkCount ?? 0} ` +
              `network chunks, ${session.networkBodyCount ?? 0} response bodies recorded.`
            : `Recording stopped. ${session.eventCount} events, ${session.memoryDeltaCount} memory deltas, ` +
              `${session.heapSnapshotCount} heap snapshots, ${session.networkRequestCount ?? 0} network requests, ` +
              `${session.networkChunkCount ?? 0} network chunks, ${session.networkBodyCount ?? 0} response bodies ` +
              `recorded.`,
      })
      .json();
  }

  async handleQueryTraceSql(args: Record<string, unknown>): Promise<unknown> {
    const sql = typeof args['sql'] === 'string' ? args['sql'] : '';
    const dbPath = typeof args['dbPath'] === 'string' ? args['dbPath'] : undefined;

    if (!sql) {
      throw new ToolError('VALIDATION', 'sql parameter is required');
    }

    let result: TraceQueryResult;
    let tempDb: TraceDB | null = null;

    try {
      if (dbPath) {
        tempDb = new TraceDB({ dbPath });
        result = tempDb.query(sql);
      } else {
        const activeDb = this.recorder.getDB();
        if (!activeDb) {
          throw new PrerequisiteError(
            'No active recording and no dbPath specified. Start a recording or provide a dbPath.',
          );
        }
        activeDb.flush();
        result = activeDb.query(sql);
      }

      return R.ok()
        .merge({
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
        })
        .json();
    } finally {
      if (tempDb) {
        tempDb.close();
      }
    }
  }

  async handleSeekToTimestamp(args: Record<string, unknown>): Promise<unknown> {
    const timestamp = asNumber(args['timestamp'], {
      defaultValue: Number.NaN,
      min: 0,
    });
    const dbPath = typeof args['dbPath'] === 'string' ? args['dbPath'] : undefined;
    const windowMs = asNumber(args['windowMs'], {
      defaultValue: 100,
      min: 1,
      max: 60_000,
      integer: true,
    });
    const timeDomain =
      argEnum(args, 'timeDomain', new Set(['wall', 'monotonic'] as const), 'wall') ?? 'wall';

    if (!Number.isFinite(timestamp)) {
      throw new ToolError('VALIDATION', 'timestamp parameter is required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const eventTimeExpr =
        timeDomain === 'monotonic' ? 'COALESCE(monotonic_time, timestamp)' : 'timestamp';
      const networkTimeExpr =
        timeDomain === 'monotonic'
          ? 'COALESCE(finished_monotonic_time, response_monotonic_time, started_monotonic_time)'
          : 'COALESCE(finished_wall_time, response_wall_time, started_wall_time)';

      const events =
        timeDomain === 'wall'
          ? db.getEventsByTimeRange(timestamp - windowMs, timestamp + windowMs)
          : readEventsByExpression(db, eventTimeExpr, timestamp - windowMs, timestamp + windowMs);

      const debuggerEventsResult = db.queryWithParams(
        `SELECT * FROM events WHERE category = 'debugger' AND ${eventTimeExpr} <= ? ORDER BY ` +
          `${eventTimeExpr} DESC, sequence DESC LIMIT 5`,
        [timestamp],
      );

      const memoryStateResult =
        timeDomain === 'wall'
          ? db.queryWithParams(
              `SELECT m1.* FROM memory_deltas m1
               INNER JOIN (SELECT address, MAX(timestamp) as max_ts FROM memory_deltas WHERE timestamp <= ? GROUP BY address) m2
               ON m1.address = m2.address AND m1.timestamp = m2.max_ts
               ORDER BY m1.address`,
              [timestamp],
            )
          : null;

      let networkResult = db.queryWithParams(
        `SELECT * FROM network_resources
         WHERE ${networkTimeExpr} IS NOT NULL AND ${networkTimeExpr} <= ?
         ORDER BY ${networkTimeExpr} DESC
         LIMIT 20`,
        [timestamp],
      );
      if (networkResult.rowCount === 0) {
        networkResult = db.queryWithParams(
          `SELECT * FROM events
           WHERE category = 'network'
             AND event_type = 'Network.loadingFinished'
             AND ${eventTimeExpr} <= ?
           ORDER BY ${eventTimeExpr} DESC
           LIMIT 20`,
          [timestamp],
        );
      }

      const snapshotResult =
        timeDomain === 'wall'
          ? db.queryWithParams(
              `SELECT id, timestamp, summary FROM heap_snapshots WHERE timestamp <= ? ORDER BY timestamp ` +
                `DESC LIMIT 1`,
              [timestamp],
            )
          : null;
      const samplesInWindow = db.getSamplesInWindow(timestamp, windowMs);
      const consoleLogs = db.getConsoleLogsByTimeRange(
        timestamp - windowMs,
        timestamp + windowMs,
        timeDomain,
      );
      const exceptions = db.getExceptionsByTimeRange(
        timestamp - windowMs,
        timestamp + windowMs,
        timeDomain,
      );

      return R.ok()
        .merge({
          seekTimestamp: timestamp,
          timeDomain,
          windowMs,
          events: events.map(formatTraceEvent),
          debuggerState: {
            recentEvents: debuggerEventsResult.rows.map((row) =>
              rowToObject(debuggerEventsResult.columns, row),
            ),
          },
          memoryState: {
            addressValues:
              memoryStateResult?.rows.map((row) => rowToObject(memoryStateResult.columns, row)) ??
              [],
            ...(timeDomain === 'monotonic'
              ? {
                  omittedReason:
                    'Memory state is only indexed by wall-clock timestamps and is omitted for monotonic seeks.',
                }
              : {}),
          },
          networkState: {
            completedRequests: networkResult.rows.map((row) =>
              rowToObject(networkResult.columns, row),
            ),
          },
          runtimeState: {
            consoleLogs,
            exceptions,
          },
          nearestHeapSnapshot:
            snapshotResult && snapshotResult.rows.length > 0
              ? rowToObject(snapshotResult.columns, snapshotResult.rows[0]!)
              : null,
          ...(samplesInWindow.length > 0 ? { samplesInWindow } : {}),
          ...(timeDomain === 'monotonic'
            ? {
                nearestHeapSnapshotOmittedReason:
                  'Heap snapshots are only indexed by wall-clock timestamps and are omitted for monotonic seeks.',
              }
            : {}),
        })
        .json();
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleGetTraceSamples(args: Record<string, unknown>): Promise<unknown> {
    const mode =
      argEnum(args, 'mode', new Set(['top', 'function', 'window'] as const), 'top') ?? 'top';
    const functionName = optionalStringArg(args['functionName'], 'functionName');
    const dbPath = optionalStringArg(args['dbPath'], 'dbPath');

    let tempDb: TraceDB | null = null;
    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      if (mode === 'function') {
        if (!functionName) {
          throw new ToolError('VALIDATION', 'functionName is required for mode="function"');
        }
        const limit = asNumber(args['limit'], {
          defaultValue: 20,
          min: 1,
          max: 1000,
          integer: true,
        });
        const samples = db.querySamplesByFunction(functionName, limit);
        return R.ok()
          .merge({ mode, functionName, limit, sampleCount: samples.length, samples })
          .json();
      }

      if (mode === 'window') {
        const timestamp = asNumber(args['timestamp'], { defaultValue: Number.NaN, min: 0 });
        if (!Number.isFinite(timestamp)) {
          throw new ToolError('VALIDATION', 'timestamp is required for mode="window"');
        }
        const windowMs = asNumber(args['windowMs'], {
          defaultValue: 100,
          min: 1,
          max: 60_000,
          integer: true,
        });
        const limit = asNumber(args['limit'], {
          defaultValue: 20,
          min: 1,
          max: 1000,
          integer: true,
        });
        const samples = db.getSamplesInWindow(timestamp, windowMs, limit);
        return R.ok()
          .merge({ mode, timestamp, windowMs, limit, sampleCount: samples.length, samples })
          .json();
      }

      // mode === 'top'
      const limit = asNumber(args['limit'], { defaultValue: 20, min: 1, max: 1000, integer: true });
      const startTs = optionalNumberArg(args['startTimestamp'], 'startTimestamp');
      const endTs = optionalNumberArg(args['endTimestamp'], 'endTimestamp');
      const hasWindow = typeof startTs === 'number' && typeof endTs === 'number';
      const topFunctions = hasWindow
        ? db.getTopFunctions(limit, startTs, endTs)
        : db.getTopFunctions(limit);
      return R.ok()
        .merge({
          mode,
          limit,
          ...(hasWindow ? { startTimestamp: startTs, endTimestamp: endTs } : {}),
          functionCount: topFunctions.length,
          topFunctions,
        })
        .json();
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleGetTraceNetworkFlow(args: Record<string, unknown>): Promise<unknown> {
    const requestId = optionalStringArg(args['requestId'], 'requestId') ?? '';
    const dbPath = optionalStringArg(args['dbPath'], 'dbPath');
    const includeBody = asBoolean(args['includeBody'], true);
    const includeChunks = asBoolean(args['includeChunks'], true);
    const includeEvents = asBoolean(args['includeEvents'], true);
    const chunkLimit = asNumber(args['chunkLimit'], {
      defaultValue: 200,
      min: 1,
      max: 5000,
      integer: true,
    });
    const maxBodyBytes = asNumber(args['maxBodyBytes'], {
      defaultValue: 100_000,
      min: 1_024,
      max: 50 * 1024 * 1024,
      integer: true,
    });
    const returnSummary = asBoolean(args['returnSummary'], false);

    if (!requestId) {
      throw new ToolError('VALIDATION', 'requestId parameter is required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const resource = db.getNetworkResource(requestId);
      if (!resource) {
        throw new ToolError(
          'NOT_FOUND',
          `No recorded network flow found for requestId: ${requestId}`,
        );
      }

      const chunks = includeChunks ? db.getNetworkChunks(requestId, chunkLimit) : [];
      const events = includeEvents ? db.getEventsByRequestId(requestId) : [];
      const body = includeBody
        ? await readTraceBody(resource, { maxBodyBytes, returnSummary })
        : null;

      const flowData = smartHandleDetailed(this.ctx, {
        requestId,
        request: formatNetworkResource(resource),
        body,
        chunks: includeChunks
          ? {
              total: resource.chunkCount,
              returned: chunks.length,
              limit: chunkLimit,
              hasMore: resource.chunkCount > chunks.length,
              items: chunks.map(formatNetworkChunk),
            }
          : null,
        events: includeEvents ? events.map(formatTraceEvent) : null,
      });
      return R.ok()
        .merge(flowData as Record<string, unknown>)
        .json();
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleDiffHeapSnapshots(args: Record<string, unknown>): Promise<unknown> {
    const snapshotId1 = asNumber(args['snapshotId1'], {
      defaultValue: Number.NaN,
      min: 1,
      integer: true,
    });
    const snapshotId2 = asNumber(args['snapshotId2'], {
      defaultValue: Number.NaN,
      min: 1,
      integer: true,
    });
    const dbPath = typeof args['dbPath'] === 'string' ? args['dbPath'] : undefined;

    if (!Number.isFinite(snapshotId1) || !Number.isFinite(snapshotId2)) {
      throw new ToolError('VALIDATION', 'snapshotId1 and snapshotId2 are required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const snap1Result = db.queryWithParams(
        'SELECT id, timestamp, summary FROM heap_snapshots WHERE id = ?',
        [snapshotId1],
      );
      const snap2Result = db.queryWithParams(
        'SELECT id, timestamp, summary FROM heap_snapshots WHERE id = ?',
        [snapshotId2],
      );

      if (snap1Result.rowCount === 0) {
        throw new ToolError('NOT_FOUND', `Snapshot with id ${snapshotId1} not found`);
      }
      if (snap2Result.rowCount === 0) {
        throw new ToolError('NOT_FOUND', `Snapshot with id ${snapshotId2} not found`);
      }

      const snap1Row = rowToObject(snap1Result.columns, snap1Result.rows[0]!);
      const snap2Row = rowToObject(snap2Result.columns, snap2Result.rows[0]!);

      const summary1 = parseTraceSummary(snap1Row['summary']);
      const summary2 = parseTraceSummary(snap2Row['summary']);

      const counts1 = readTraceSummaryObjectCounts(summary1);
      const counts2 = readTraceSummaryObjectCounts(summary2);
      const allKeys = new Set([...Object.keys(counts1), ...Object.keys(counts2)]);
      const added: Array<{ name: string; count: number }> = [];
      const removed: Array<{ name: string; count: number }> = [];
      const changed: Array<{
        name: string;
        countBefore: number;
        countAfter: number;
        delta: number;
      }> = [];

      for (const key of allKeys) {
        const c1 = counts1[key] ?? 0;
        const c2 = counts2[key] ?? 0;

        if (c1 === 0 && c2 > 0) {
          added.push({ name: key, count: c2 });
        } else if (c1 > 0 && c2 === 0) {
          removed.push({ name: key, count: c1 });
        } else if (c1 !== c2) {
          changed.push({ name: key, countBefore: c1, countAfter: c2, delta: c2 - c1 });
        }
      }

      changed.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      const totalSize1 = readTraceSummaryNumber(summary1, 'totalSize');
      const totalSize2 = readTraceSummaryNumber(summary2, 'totalSize');

      return R.ok()
        .merge({
          snapshot1: {
            id: snap1Row['id'],
            timestamp: snap1Row['timestamp'],
            totalSize: totalSize1,
            nodeCount: readTraceSummaryNumber(summary1, 'nodeCount'),
          },
          snapshot2: {
            id: snap2Row['id'],
            timestamp: snap2Row['timestamp'],
            totalSize: totalSize2,
            nodeCount: readTraceSummaryNumber(summary2, 'nodeCount'),
          },
          diff: {
            added: added.slice(0, 50),
            removed: removed.slice(0, 50),
            changed: changed.slice(0, 100),
            totalSizeDelta: totalSize2 - totalSize1,
            addedCount: added.length,
            removedCount: removed.length,
            changedCount: changed.length,
          },
        })
        .json();
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleExportTrace(args: Record<string, unknown>): Promise<unknown> {
    const dbPath = typeof args['dbPath'] === 'string' ? args['dbPath'] : undefined;
    const outputPath =
      typeof args['outputPath'] === 'string' ? args['outputPath'].trim() || undefined : undefined;

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const allEvents = db.query(
        'SELECT timestamp, category, event_type, data, script_id, line_number FROM events ORDER BY timestamp ASC,' +
          ' sequence ASC',
      );

      const pairedBegin = new Set(['Debugger.paused']);
      const pairedEnd = new Set(['Debugger.resumed']);
      const traceEvents = allEvents.rows.map((row) => {
        const traceRow = readExportTraceRow(row);
        const ts = traceRow.timestampMs * 1000;
        const cat = traceRow.category;
        const name = traceRow.eventType;
        const dataStr = traceRow.data;

        let ph = 'i';
        if (pairedBegin.has(name)) ph = 'B';
        else if (pairedEnd.has(name)) ph = 'E';

        return {
          name,
          cat,
          ph,
          ts,
          pid: 1,
          tid: deriveTraceTid(cat),
          args: safeParseJSON(dataStr),
          ...(ph === 'i' ? { s: 'g' } : {}),
        };
      });

      // Aggregate CPU profile samples into per-function Chrome Trace "X" complete
      // events on a dedicated track (tid 8) so flame-graph viewers surface hot
      // functions alongside the event timeline. Pure data projection — ordering
      // follows self-time, no heuristic library.
      const CPU_PROFILE_TID = 8;
      const samplesResult = db.queryWithParams(
        `SELECT function_name,
                SUM(self_time) AS self_time,
                SUM(aggregate_time) AS aggregate_time,
                COUNT(*) AS sample_count,
                MIN(timestamp) AS first_ts,
                script_id, url, line_number, column_number
         FROM samples
         WHERE function_name IS NOT NULL
         GROUP BY function_name
         ORDER BY self_time DESC
         LIMIT 50`,
        [],
      );
      const sampleCols = samplesResult.columns;
      const sampleCol = (name: string): number => sampleCols.indexOf(name);
      const cpuProfileEvents = samplesResult.rows.map((row) => {
        const selfTime = (row[sampleCol('self_time')] as number) ?? 0;
        const firstTs = (row[sampleCol('first_ts')] as number) ?? 0;
        return {
          name: (row[sampleCol('function_name')] as string) ?? '(anonymous)',
          cat: 'cpu-profile',
          ph: 'X',
          ts: firstTs * 1000,
          dur: Math.max(selfTime * 1000, 1),
          pid: 1,
          tid: CPU_PROFILE_TID,
          args: {
            selfTimeMs: selfTime,
            aggregateTimeMs: (row[sampleCol('aggregate_time')] as number) ?? 0,
            sampleCount: (row[sampleCol('sample_count')] as number) ?? 0,
            url: row[sampleCol('url')] ?? null,
            scriptId: row[sampleCol('script_id')] ?? null,
            lineNumber: row[sampleCol('line_number')] ?? null,
          },
        };
      });

      // Prepend thread_name metadata events so chrome://tracing renders friendly
      // track labels (e.g. "Debugger", "Network") instead of bare "Thread N".
      const usedTids = new Set<number>([...traceEvents, ...cpuProfileEvents].map((e) => e.tid));
      const threadNameEvents = [...usedTids]
        .toSorted((a, b) => a - b)
        .map((tid) => ({
          name: 'thread_name',
          cat: '__metadata',
          ph: 'M',
          pid: 1,
          tid,
          args: { name: TRACE_THREAD_NAMES[tid] ?? 'Other' },
        }));
      const outputEvents = [...threadNameEvents, ...traceEvents, ...cpuProfileEvents];

      const allowedRoots = [getProjectRoot(), ...getSystemTempRoots()];
      const finalOutputPath = outputPath
        ? await resolveSafeOutputPath(outputPath, {
            allowedRoots,
            allowedRootsDescription: 'project root or system temp directory',
          })
        : (
            await resolveArtifactPath({
              category: 'traces',
              toolName: 'trace_export',
              ext: 'json',
            })
          ).absolutePath;

      await writeTextFileAtomically(finalOutputPath, JSON.stringify(outputEvents, null, 2), {
        allowedRoots: outputPath ? allowedRoots : undefined,
      });

      const cpuProfileCount = cpuProfileEvents.length;
      return R.ok()
        .merge({
          exportedPath: finalOutputPath,
          eventCount: traceEvents.length,
          threadCount: usedTids.size,
          ...(cpuProfileCount > 0 ? { cpuProfileFunctions: cpuProfileCount } : {}),
          format: 'Chrome Trace Event JSON',
          message:
            `Exported ${traceEvents.length} events` +
            `${cpuProfileCount > 0 ? ` and ${cpuProfileCount} CPU profile function(s)` : ''}` +
            ` across ${usedTids.size} thread(s) to ${finalOutputPath}. ` +
            `Open in chrome://tracing or ui.perfetto.dev`,
        })
        .json();
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleSummarizeTrace(args: Record<string, unknown>): Promise<unknown> {
    const rawDetail = typeof args['detail'] === 'string' ? args['detail'] : undefined;
    const detail =
      rawDetail === 'summary'
        ? 'balanced'
        : (argEnum(args, 'detail', new Set(['compact', 'balanced', 'full'] as const), 'balanced') ??
          'balanced');
    const dbPath = typeof args['dbPath'] === 'string' ? args['dbPath'] : undefined;

    let db: TraceDB;
    let shouldClose = false;
    if (dbPath) {
      db = new TraceDB({ dbPath });
      shouldClose = true;
    } else if (this.recorder.getState() === 'recording') {
      const activeDb = this.recorder.getDB();
      if (!activeDb) throw new PrerequisiteError('Active recording has no database');
      db = activeDb;
    } else {
      throw new PrerequisiteError('No trace database specified and no active recording');
    }

    try {
      const eventsResult = db.query(
        'SELECT timestamp, category, event_type, data, script_id, line_number, wall_time, monotonic_time, ' +
          'request_id, sequence FROM events ORDER BY timestamp, sequence',
      );
      const events: SummaryTraceEvent[] = eventsResult.rows.map(readSummaryTraceEventRow);

      const deltasResult = db.query(
        'SELECT timestamp, address, old_value, new_value, size, value_type FROM memory_deltas ORDER BY timestamp',
      );
      const deltas: MemoryDelta[] = deltasResult.rows.map(readSummaryMemoryDeltaRow);

      const networkSummary = db.query(
        `SELECT
            COUNT(*) as requestCount,
            COALESCE(SUM(chunk_count), 0) as chunkCount,
            SUM(CASE WHEN body_capture_state IN ('inline', 'artifact', 'truncated') THEN 1 ELSE 0 END) as bodyCount
         FROM network_resources`,
      );

      // Surface the hottest CPU profile functions so the summary answers
      // "where was time spent" without a separate query. Pure rollup of the
      // recorded samples — no heuristic hot-function library.
      const topFunctions = db.getTopFunctions(10);
      const sampleCountResult = db.query('SELECT COUNT(*) AS cnt FROM samples');
      const sampleCount =
        sampleCountResult.rows.length > 0 ? ((sampleCountResult.rows[0]![0] as number) ?? 0) : 0;

      return R.ok()
        .merge({
          events: summarizeEvents(events, detail),
          memory: summarizeMemoryDeltas(deltas),
          network:
            networkSummary.rows.length > 0
              ? rowToObject(networkSummary.columns, networkSummary.rows[0]!)
              : { requestCount: 0, chunkCount: 0, bodyCount: 0 },
          cpuProfile: {
            sampleCount,
            topFunctions,
          },
          metadata: {
            dbPath: dbPath ?? 'active recording',
            generatedAt: new Date().toISOString(),
          },
        })
        .json();
    } finally {
      if (shouldClose) {
        db.close();
      }
    }
  }
}
