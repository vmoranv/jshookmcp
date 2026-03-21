/**
 * Trace domain tool handlers.
 *
 * Implements start/stop recording, SQL query, timestamp seek,
 * heap snapshot diffing, and Chrome Trace Event export.
 */

import { writeFile } from 'node:fs/promises';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { TraceQueryResult } from '@modules/trace/TraceDB.types';
import { TraceDB } from '@modules/trace/TraceDB';
import { TraceRecorder } from '@modules/trace/TraceRecorder';
import type { CDPSessionLike } from '@modules/trace/TraceRecorder';
import { resolveArtifactPath } from '@utils/artifacts';

export class TraceToolHandlers {
  constructor(
    private readonly recorder: TraceRecorder,
    private readonly ctx: MCPServerContext
  ) {}

  // ── start_trace_recording ──

  async handleStartTraceRecording(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const cdpDomains = args['cdpDomains'] as string[] | undefined;
    const recordMemoryDeltas = args['recordMemoryDeltas'] as boolean | undefined;

    const eventBus = this.ctx.eventBus;
    if (!eventBus) {
      throw new Error('EventBus not available on server context');
    }

    // Get CDP session from browser if available
    let cdpSession: CDPSessionLike | null = null;
    try {
      if (this.ctx.collector) {
        const page = await this.ctx.collector.getActivePage();
        // Duck-type: Page from puppeteer/playwright has createCDPSession
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
    });

    return {
      status: 'recording',
      sessionId: session.sessionId,
      dbPath: session.dbPath,
      message: `Recording started. CDP session: ${cdpSession ? 'active' : 'not available'}`,
    };
  }

  // ── stop_trace_recording ──

  async handleStopTraceRecording(): Promise<unknown> {
    const session = this.recorder.stop();

    const duration = session.stoppedAt
      ? session.stoppedAt - session.startedAt
      : 0;

    return {
      status: 'stopped',
      sessionId: session.sessionId,
      dbPath: session.dbPath,
      eventCount: session.eventCount,
      memoryDeltaCount: session.memoryDeltaCount,
      heapSnapshotCount: session.heapSnapshotCount,
      durationMs: duration,
      message: `Recording stopped. ${session.eventCount} events, ${session.memoryDeltaCount} memory deltas, ${session.heapSnapshotCount} heap snapshots recorded.`,
    };
  }

  // ── query_trace_sql ──

  async handleQueryTraceSql(
    args: Record<string, unknown>
  ): Promise<unknown> {
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
            'No active recording and no dbPath specified. Start a recording or provide a dbPath.'
          );
        }
        // Flush pending events before querying
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

  // ── seek_to_timestamp ──

  async handleSeekToTimestamp(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const timestamp = args['timestamp'] as number;
    const dbPath = args['dbPath'] as string | undefined;
    const windowMs = (args['windowMs'] as number) ?? 100;

    if (!timestamp) {
      throw new Error('timestamp parameter is required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = this.getDbForReading(dbPath);
      if (dbPath) tempDb = db;

      // Get events in the time window
      const events = db.getEventsByTimeRange(
        timestamp - windowMs,
        timestamp + windowMs
      );

      // Get debugger state — find last pause/resume events before timestamp
      const debuggerEventsResult = db.query(
        `SELECT * FROM events WHERE category = 'debugger' AND timestamp <= ${timestamp} ORDER BY timestamp DESC LIMIT 5`
      );

      // Get memory state — latest value for each address up to timestamp
      const memoryStateResult = db.query(
        `SELECT m1.* FROM memory_deltas m1
         INNER JOIN (SELECT address, MAX(timestamp) as max_ts FROM memory_deltas WHERE timestamp <= ${timestamp} GROUP BY address) m2
         ON m1.address = m2.address AND m1.timestamp = m2.max_ts
         ORDER BY m1.address`
      );

      // Get network state — completed requests before timestamp
      const networkResult = db.query(
        `SELECT * FROM events WHERE category = 'network' AND event_type = 'Network.loadingFinished' AND timestamp <= ${timestamp} ORDER BY timestamp DESC LIMIT 20`
      );

      // Find nearest heap snapshot
      const snapshotResult = db.query(
        `SELECT id, timestamp, summary FROM heap_snapshots WHERE timestamp <= ${timestamp} ORDER BY timestamp DESC LIMIT 1`
      );

      return {
        seekTimestamp: timestamp,
        windowMs,
        events: events.map(e => ({
          timestamp: e.timestamp,
          category: e.category,
          eventType: e.eventType,
          data: this.safeParseJSON(e.data),
          scriptId: e.scriptId,
          lineNumber: e.lineNumber,
        })),
        debuggerState: {
          recentEvents: debuggerEventsResult.rows.map(row =>
            this.rowToObject(debuggerEventsResult.columns, row)
          ),
        },
        memoryState: {
          addressValues: memoryStateResult.rows.map(row =>
            this.rowToObject(memoryStateResult.columns, row)
          ),
        },
        networkState: {
          completedRequests: networkResult.rows.map(row =>
            this.rowToObject(networkResult.columns, row)
          ),
        },
        nearestHeapSnapshot: snapshotResult.rows.length > 0
          ? this.rowToObject(snapshotResult.columns, snapshotResult.rows[0]!)
          : null,
      };
    } finally {
      if (tempDb) tempDb.close();
    }
  }

  // ── diff_heap_snapshots ──

  async handleDiffHeapSnapshots(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const snapshotId1 = args['snapshotId1'] as number;
    const snapshotId2 = args['snapshotId2'] as number;
    const dbPath = args['dbPath'] as string | undefined;

    if (!snapshotId1 || !snapshotId2) {
      throw new Error('snapshotId1 and snapshotId2 are required');
    }

    let tempDb: TraceDB | null = null;

    try {
      const db = this.getDbForReading(dbPath);
      if (dbPath) tempDb = db;

      // Get both snapshots
      const snap1Result = db.query(
        `SELECT id, timestamp, summary FROM heap_snapshots WHERE id = ${snapshotId1}`
      );
      const snap2Result = db.query(
        `SELECT id, timestamp, summary FROM heap_snapshots WHERE id = ${snapshotId2}`
      );

      if (snap1Result.rowCount === 0) {
        throw new Error(`Snapshot with id ${snapshotId1} not found`);
      }
      if (snap2Result.rowCount === 0) {
        throw new Error(`Snapshot with id ${snapshotId2} not found`);
      }

      const snap1Row = this.rowToObject(snap1Result.columns, snap1Result.rows[0]!);
      const snap2Row = this.rowToObject(snap2Result.columns, snap2Result.rows[0]!);

      const summary1 = this.safeParseJSON(snap1Row['summary'] as string) as Record<string, unknown>;
      const summary2 = this.safeParseJSON(snap2Row['summary'] as string) as Record<string, unknown>;

      const counts1 = (summary1['objectCounts'] ?? {}) as Record<string, number>;
      const counts2 = (summary2['objectCounts'] ?? {}) as Record<string, number>;

      // Compute diff
      const allKeys = new Set([...Object.keys(counts1), ...Object.keys(counts2)]);
      const added: Array<{ name: string; count: number }> = [];
      const removed: Array<{ name: string; count: number }> = [];
      const changed: Array<{ name: string; countBefore: number; countAfter: number; delta: number }> = [];

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

      // Sort changed by absolute delta descending
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

  // ── export_trace ──

  async handleExportTrace(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const dbPath = args['dbPath'] as string | undefined;
    const outputPath = args['outputPath'] as string | undefined;

    let tempDb: TraceDB | null = null;

    try {
      const db = this.getDbForReading(dbPath);
      if (dbPath) tempDb = db;

      // Query all events sorted by timestamp
      const allEvents = db.query(
        'SELECT timestamp, category, event_type, data, script_id, line_number FROM events ORDER BY timestamp ASC'
      );

      // Map to Chrome Trace Event format
      // paired events: Debugger.paused → 'B', Debugger.resumed → 'E', all others → 'i'
      const PAIRED_BEGIN = new Set(['Debugger.paused']);
      const PAIRED_END = new Set(['Debugger.resumed']);

      const traceEvents = allEvents.rows.map(row => {
        const ts = (row[0] as number) * 1000; // ms → µs for Chrome format
        const cat = row[1] as string;
        const name = row[2] as string;
        const dataStr = row[3] as string;

        let ph = 'i'; // instant event
        if (PAIRED_BEGIN.has(name)) ph = 'B';
        else if (PAIRED_END.has(name)) ph = 'E';

        return {
          name,
          cat,
          ph,
          ts,
          pid: 1,
          tid: 1,
          args: this.safeParseJSON(dataStr),
          ...(ph === 'i' ? { s: 'g' } : {}), // global scope for instant events
        };
      });

      // Resolve output path
      let finalOutputPath: string;
      if (outputPath) {
        finalOutputPath = outputPath;
      } else {
        const { absolutePath } = await resolveArtifactPath({
          category: 'traces',
          toolName: 'trace_export',
          ext: 'json',
        });
        finalOutputPath = absolutePath;
      }

      // Write Chrome Trace Event format
      const output = JSON.stringify(traceEvents, null, 2);
      await writeFile(finalOutputPath, output, 'utf-8');

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

  // ── Private helpers ──

  /**
   * Get a TraceDB instance for reading — either from an explicit path
   * or from the active recorder.
   */
  private getDbForReading(dbPath?: string): TraceDB {
    if (dbPath) {
      return new TraceDB({ dbPath });
    }

    const activeDb = this.recorder.getDB();
    if (!activeDb) {
      throw new Error(
        'No active recording and no dbPath specified. Start a recording or provide a dbPath.'
      );
    }
    activeDb.flush();
    return activeDb;
  }

  /**
   * Convert a row array + column names to an object.
   */
  private rowToObject(columns: string[], row: unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!] = row[i];
    }
    return obj;
  }

  /**
   * Safely parse JSON, returning the raw string on parse failure.
   */
  private safeParseJSON(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}
