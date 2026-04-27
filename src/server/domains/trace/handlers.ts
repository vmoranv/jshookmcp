/**
 * Trace domain tool handlers.
 *
 * Implements recording lifecycle, SQL query, timestamp seek,
 * request-scoped network flow retrieval, heap diffing, and export.
 */

import { writeFile } from 'node:fs/promises';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { TraceQueryResult } from '@modules/trace/TraceDB.types';
import { TraceDB } from '@modules/trace/TraceDB';
import { type TraceRecorder } from '@modules/trace/TraceRecorder';
import type { CDPSessionLike } from '@modules/trace/TraceRecorder';
import { resolveArtifactPath } from '@utils/artifacts';
import { argEnum } from '@server/domains/shared/parse-args';
import {
  asBoolean,
  asNumber,
  formatNetworkChunk,
  formatNetworkResource,
  formatTraceEvent,
  getDbForReading,
  readEventsByExpression,
  readTraceBody,
  rowToObject,
  safeParseJSON,
  smartHandleDetailed,
} from '@server/domains/trace/handler-utils';
import {
  summarizeEvents,
  summarizeMemoryDeltas,
  type SummaryDetail,
  type TraceEvent as SummaryTraceEvent,
  type MemoryDelta,
} from '@server/domains/trace/TraceSummarizer';

export class TraceToolHandlers {
  constructor(
    private readonly recorder: TraceRecorder,
    private readonly ctx: MCPServerContext,
  ) {}

  async handleTraceRecording(args: Record<string, unknown>): Promise<unknown> {
    const action = argEnum(args, 'action', new Set(['start', 'stop'] as const));
    return action === 'stop'
      ? this.handleStopTraceRecording()
      : this.handleStartTraceRecording(args);
  }

  async handleStartTraceRecording(args: Record<string, unknown>): Promise<unknown> {
    const cdpDomains = args['cdpDomains'] as string[] | undefined;
    const recordMemoryDeltas = args['recordMemoryDeltas'] as boolean | undefined;
    const recordResponseBodies = args['recordResponseBodies'] as boolean | undefined;
    const streamResponseChunks = args['streamResponseChunks'] as boolean | undefined;
    const networkBodyMaxBytes = args['networkBodyMaxBytes'] as number | undefined;
    const networkInlineBodyBytes = args['networkInlineBodyBytes'] as number | undefined;

    const eventBus = this.ctx.eventBus;
    if (!eventBus) {
      throw new Error('EventBus not available on server context');
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
      network: {
        recordResponseBodies,
        streamResponseChunks,
        maxBodyBytes: networkBodyMaxBytes,
        inlineBodyBytes: networkInlineBodyBytes,
      },
    });

    return {
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
    };
  }

  async handleStopTraceRecording(): Promise<unknown> {
    const session = await this.recorder.stop();

    const duration = session.stoppedAt ? session.stoppedAt - session.startedAt : 0;
    const cleanupErrors = session.cleanupErrors ?? [];
    const status = cleanupErrors.length > 0 ? 'stopped_with_errors' : 'stopped';

    return {
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
          ? `Recording stopped with cleanup errors. ${session.eventCount} events, ${session.memoryDeltaCount} memory deltas, ${session.heapSnapshotCount} heap snapshots, ${session.networkRequestCount ?? 0} network requests, ${session.networkChunkCount ?? 0} network chunks, ${session.networkBodyCount ?? 0} response bodies recorded.`
          : `Recording stopped. ${session.eventCount} events, ${session.memoryDeltaCount} memory deltas, ${session.heapSnapshotCount} heap snapshots, ${session.networkRequestCount ?? 0} network requests, ${session.networkChunkCount ?? 0} network chunks, ${session.networkBodyCount ?? 0} response bodies recorded.`,
    };
  }

  async handleQueryTraceSql(args: Record<string, unknown>): Promise<unknown> {
    const sql = args['sql'] as string;
    const dbPath = args['dbPath'] as string | undefined;

    if (!sql) {
      throw new Error('sql parameter is required');
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
          throw new Error(
            'GRACEFUL: No active recording and no dbPath specified. Start a recording or provide a dbPath.',
          );
        }
        activeDb.flush();
        result = activeDb.query(sql);
      }

      return {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
      };
    } finally {
      if (tempDb) {
        tempDb.close();
      }
    }
  }

  async handleSeekToTimestamp(args: Record<string, unknown>): Promise<unknown> {
    const timestamp = args['timestamp'] as number;
    const dbPath = args['dbPath'] as string | undefined;
    const windowMs = (args['windowMs'] as number) ?? 100;
    const timeDomain = (args['timeDomain'] as 'wall' | 'monotonic' | undefined) ?? 'wall';

    if (!timestamp) {
      throw new Error('timestamp parameter is required');
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

      const debuggerEventsResult = db.query(
        `SELECT * FROM events WHERE category = 'debugger' AND ${eventTimeExpr} <= ${timestamp} ORDER BY ${eventTimeExpr} DESC, sequence DESC LIMIT 5`,
      );

      const memoryStateResult =
        timeDomain === 'wall'
          ? db.query(
              `SELECT m1.* FROM memory_deltas m1
               INNER JOIN (SELECT address, MAX(timestamp) as max_ts FROM memory_deltas WHERE timestamp <= ${timestamp} GROUP BY address) m2
               ON m1.address = m2.address AND m1.timestamp = m2.max_ts
               ORDER BY m1.address`,
            )
          : null;

      let networkResult = db.query(
        `SELECT * FROM network_resources
         WHERE ${networkTimeExpr} IS NOT NULL AND ${networkTimeExpr} <= ${timestamp}
         ORDER BY ${networkTimeExpr} DESC
         LIMIT 20`,
      );
      if (networkResult.rowCount === 0) {
        networkResult = db.query(
          `SELECT * FROM events
           WHERE category = 'network'
             AND event_type = 'Network.loadingFinished'
             AND ${eventTimeExpr} <= ${timestamp}
           ORDER BY ${eventTimeExpr} DESC
           LIMIT 20`,
        );
      }

      const snapshotResult =
        timeDomain === 'wall'
          ? db.query(
              `SELECT id, timestamp, summary FROM heap_snapshots WHERE timestamp <= ${timestamp} ORDER BY timestamp DESC LIMIT 1`,
            )
          : null;

      return {
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
            memoryStateResult?.rows.map((row) => rowToObject(memoryStateResult.columns, row)) ?? [],
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
        nearestHeapSnapshot:
          snapshotResult && snapshotResult.rows.length > 0
            ? rowToObject(snapshotResult.columns, snapshotResult.rows[0]!)
            : null,
        ...(timeDomain === 'monotonic'
          ? {
              nearestHeapSnapshotOmittedReason:
                'Heap snapshots are only indexed by wall-clock timestamps and are omitted for monotonic seeks.',
            }
          : {}),
      };
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleGetTraceNetworkFlow(args: Record<string, unknown>): Promise<unknown> {
    const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : '';
    const dbPath = args['dbPath'] as string | undefined;
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
      throw new Error('requestId parameter is required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const resource = db.getNetworkResource(requestId);
      if (!resource) {
        throw new Error(`No recorded network flow found for requestId: ${requestId}`);
      }

      const chunks = includeChunks ? db.getNetworkChunks(requestId, chunkLimit) : [];
      const events = includeEvents ? db.getEventsByRequestId(requestId) : [];
      const body = includeBody
        ? await readTraceBody(resource, { maxBodyBytes, returnSummary })
        : null;

      return smartHandleDetailed(this.ctx, {
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
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleDiffHeapSnapshots(args: Record<string, unknown>): Promise<unknown> {
    const snapshotId1 = args['snapshotId1'] as number;
    const snapshotId2 = args['snapshotId2'] as number;
    const dbPath = args['dbPath'] as string | undefined;

    if (!snapshotId1 || !snapshotId2) {
      throw new Error('snapshotId1 and snapshotId2 are required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const snap1Result = db.query(
        `SELECT id, timestamp, summary FROM heap_snapshots WHERE id = ${snapshotId1}`,
      );
      const snap2Result = db.query(
        `SELECT id, timestamp, summary FROM heap_snapshots WHERE id = ${snapshotId2}`,
      );

      if (snap1Result.rowCount === 0) {
        throw new Error(`Snapshot with id ${snapshotId1} not found`);
      }
      if (snap2Result.rowCount === 0) {
        throw new Error(`Snapshot with id ${snapshotId2} not found`);
      }

      const snap1Row = rowToObject(snap1Result.columns, snap1Result.rows[0]!);
      const snap2Row = rowToObject(snap2Result.columns, snap2Result.rows[0]!);

      const summary1 = safeParseJSON(snap1Row['summary'] as string) as Record<string, unknown>;
      const summary2 = safeParseJSON(snap2Row['summary'] as string) as Record<string, unknown>;

      const counts1 = (summary1['objectCounts'] ?? {}) as Record<string, number>;
      const counts2 = (summary2['objectCounts'] ?? {}) as Record<string, number>;
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

      const totalSize1 = (summary1['totalSize'] as number) ?? 0;
      const totalSize2 = (summary2['totalSize'] as number) ?? 0;

      return {
        snapshot1: {
          id: snap1Row['id'],
          timestamp: snap1Row['timestamp'],
          totalSize: totalSize1,
          nodeCount: summary1['nodeCount'] ?? 0,
        },
        snapshot2: {
          id: snap2Row['id'],
          timestamp: snap2Row['timestamp'],
          totalSize: totalSize2,
          nodeCount: summary2['nodeCount'] ?? 0,
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
      };
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleExportTrace(args: Record<string, unknown>): Promise<unknown> {
    const dbPath = args['dbPath'] as string | undefined;
    const outputPath = args['outputPath'] as string | undefined;

    let tempDb: TraceDB | null = null;

    try {
      const db = getDbForReading(this.recorder, dbPath);
      if (dbPath) tempDb = db;

      const allEvents = db.query(
        'SELECT timestamp, category, event_type, data, script_id, line_number FROM events ORDER BY timestamp ASC, sequence ASC',
      );

      const pairedBegin = new Set(['Debugger.paused']);
      const pairedEnd = new Set(['Debugger.resumed']);
      const traceEvents = allEvents.rows.map((row) => {
        const ts = (row[0] as number) * 1000;
        const cat = row[1] as string;
        const name = row[2] as string;
        const dataStr = row[3] as string;

        let ph = 'i';
        if (pairedBegin.has(name)) ph = 'B';
        else if (pairedEnd.has(name)) ph = 'E';

        return {
          name,
          cat,
          ph,
          ts,
          pid: 1,
          tid: 1,
          args: safeParseJSON(dataStr),
          ...(ph === 'i' ? { s: 'g' } : {}),
        };
      });

      const finalOutputPath = outputPath
        ? outputPath
        : (
            await resolveArtifactPath({
              category: 'traces',
              toolName: 'trace_export',
              ext: 'json',
            })
          ).absolutePath;

      await writeFile(finalOutputPath, JSON.stringify(traceEvents, null, 2), 'utf-8');

      return {
        exportedPath: finalOutputPath,
        eventCount: traceEvents.length,
        format: 'Chrome Trace Event JSON',
        message: `Exported ${traceEvents.length} events to ${finalOutputPath}. Open in chrome://tracing or ui.perfetto.dev`,
      };
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  async handleSummarizeTrace(args: Record<string, unknown>): Promise<unknown> {
    const detail = (args['detail'] as SummaryDetail) ?? 'balanced';
    const dbPath = args['dbPath'] as string | undefined;

    let db: TraceDB;
    let shouldClose = false;
    if (dbPath) {
      db = new TraceDB({ dbPath });
      shouldClose = true;
    } else if (this.recorder.getState() === 'recording') {
      const activeDb = this.recorder.getDB();
      if (!activeDb) throw new Error('Active recording has no database');
      db = activeDb;
    } else {
      throw new Error('GRACEFUL: No trace database specified and no active recording');
    }

    try {
      const eventsResult = db.query(
        'SELECT timestamp, category, event_type, data, script_id, line_number, wall_time, monotonic_time, request_id, sequence FROM events ORDER BY timestamp, sequence',
      );
      const events: SummaryTraceEvent[] = eventsResult.rows.map((row: unknown[]) => ({
        timestamp: row[0] as number,
        category: row[1] as string,
        eventType: row[2] as string,
        data: typeof row[3] === 'string' ? safeParseJSON(row[3]) : row[3],
        scriptId: (row[4] as string | null) ?? undefined,
        lineNumber: (row[5] as number | null) ?? undefined,
      }));

      const deltasResult = db.query(
        'SELECT timestamp, address, old_value, new_value, size, value_type FROM memory_deltas ORDER BY timestamp',
      );
      const deltas: MemoryDelta[] = deltasResult.rows.map((row: unknown[]) => ({
        timestamp: row[0] as number,
        address: row[1] as string,
        oldValue: row[2] as string,
        newValue: row[3] as string,
        size: row[4] as number,
        valueType: row[5] as string,
      }));

      const networkSummary = db.query(
        `SELECT
            COUNT(*) as requestCount,
            COALESCE(SUM(chunk_count), 0) as chunkCount,
            SUM(CASE WHEN body_capture_state IN ('inline', 'artifact', 'truncated') THEN 1 ELSE 0 END) as bodyCount
         FROM network_resources`,
      );

      return {
        events: summarizeEvents(events, detail),
        memory: summarizeMemoryDeltas(deltas),
        network:
          networkSummary.rows.length > 0
            ? rowToObject(networkSummary.columns, networkSummary.rows[0]!)
            : { requestCount: 0, chunkCount: 0, bodyCount: 0 },
        metadata: {
          dbPath: dbPath ?? 'active recording',
          generatedAt: new Date().toISOString(),
        },
      };
    } finally {
      if (shouldClose) {
        db.close();
      }
    }
  }
}
