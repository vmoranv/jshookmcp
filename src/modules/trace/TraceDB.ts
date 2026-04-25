/**
 * TraceDB — SQLite storage engine for time-travel trace recording.
 *
 * Stores CDP/EventBus events, memory deltas, heap snapshots, and
 * request-scoped network flow data in a queryable SQLite database.
 */

import type {
  HeapSnapshotRecord,
  MemoryDelta,
  NetworkTraceChunk,
  NetworkTraceResource,
  TraceDBOptions,
  TraceEvent,
  TraceQueryResult,
} from '@modules/trace/TraceDB.types';
import {
  initializeTraceSchema,
  mapEventRow,
  mapNetworkChunkRow,
  mapNetworkResourceRow,
  prepareTraceStatements,
} from '@modules/trace/TraceDB.internal';
import { formatBetterSqlite3Error } from '@utils/betterSqlite3';

// better-sqlite3 is an optional dependency — lazy-load to fail gracefully
let Database: typeof import('better-sqlite3');
try {
  Database = require('better-sqlite3');
} catch {
  // Will throw at construction time if not installed
}

/** Write-modify SQL keywords rejected by the safety filter. */
const WRITE_SQL_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|PRAGMA)\b/i;

export class TraceDB {
  private readonly db: import('better-sqlite3').Database;
  private readonly batchSize: number;
  private eventBuffer: TraceEvent[] = [];
  private memoryBuffer: MemoryDelta[] = [];
  private networkChunkBuffer: NetworkTraceChunk[] = [];
  private closed = false;

  private insertEventStmt!: import('better-sqlite3').Statement;
  private insertDeltaStmt!: import('better-sqlite3').Statement;
  private insertSnapshotStmt!: import('better-sqlite3').Statement;
  private upsertMetadataStmt!: import('better-sqlite3').Statement;
  private upsertNetworkResourceStmt!: import('better-sqlite3').Statement;
  private insertNetworkChunkStmt!: import('better-sqlite3').Statement;

  constructor(private readonly options: TraceDBOptions) {
    if (!Database) {
      throw new Error(formatBetterSqlite3Error(new Error("Cannot find package 'better-sqlite3'")));
    }

    try {
      this.db = new Database(options.dbPath);
    } catch (error) {
      throw new Error(formatBetterSqlite3Error(error), { cause: error });
    }
    this.batchSize = options.batchSize ?? 200;

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    initializeTraceSchema(this.db);
    const statements = prepareTraceStatements(this.db);
    this.insertEventStmt = statements.insertEventStmt;
    this.insertDeltaStmt = statements.insertDeltaStmt;
    this.insertSnapshotStmt = statements.insertSnapshotStmt;
    this.upsertMetadataStmt = statements.upsertMetadataStmt;
    this.upsertNetworkResourceStmt = statements.upsertNetworkResourceStmt;
    this.insertNetworkChunkStmt = statements.insertNetworkChunkStmt;
  }

  /** Database file path. */
  get dbPath(): string {
    return this.options.dbPath;
  }

  // ── Write operations ──

  insertEvent(event: TraceEvent): void {
    this.ensureOpen();
    this.eventBuffer.push(event);
    if (this.eventBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  insertMemoryDelta(delta: MemoryDelta): void {
    this.ensureOpen();
    this.memoryBuffer.push(delta);
    if (this.memoryBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  insertNetworkChunk(chunk: NetworkTraceChunk): void {
    this.ensureOpen();
    this.networkChunkBuffer.push(chunk);
    if (this.networkChunkBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  upsertNetworkResource(resource: NetworkTraceResource): void {
    this.ensureOpen();
    this.upsertNetworkResourceStmt.run(
      resource.requestId,
      resource.url,
      resource.method,
      resource.resourceType,
      resource.requestHeaders,
      resource.requestPostData,
      resource.status,
      resource.statusText,
      resource.responseHeaders,
      resource.mimeType,
      resource.protocol,
      resource.remoteAddress,
      resource.fromDiskCache ? 1 : 0,
      resource.fromServiceWorker ? 1 : 0,
      resource.startedWallTime,
      resource.responseWallTime,
      resource.finishedWallTime,
      resource.startedMonotonicTime,
      resource.responseMonotonicTime,
      resource.finishedMonotonicTime,
      resource.encodedDataLength,
      resource.receivedDataLength,
      resource.receivedEncodedDataLength,
      resource.chunkCount,
      resource.streamingEnabled ? 1 : 0,
      resource.streamingSupported === null ? null : resource.streamingSupported ? 1 : 0,
      resource.streamingError,
      resource.bodyCaptureState,
      resource.bodyInline,
      resource.bodyArtifactPath,
      resource.bodyBase64Encoded ? 1 : 0,
      resource.bodySize,
      resource.bodyTruncated ? 1 : 0,
      resource.bodyError,
      resource.failed ? 1 : 0,
      resource.errorText,
    );
  }

  insertHeapSnapshot(snapshot: HeapSnapshotRecord): void {
    this.ensureOpen();
    this.insertSnapshotStmt.run(snapshot.timestamp, snapshot.snapshotData, snapshot.summary);
  }

  setMetadata(key: string, value: string): void {
    this.ensureOpen();
    this.upsertMetadataStmt.run(key, value);
  }

  flush(): void {
    if (this.closed) return;

    const flushTransaction = this.db.transaction(() => {
      for (const event of this.eventBuffer) {
        this.insertEventStmt.run(
          event.timestamp,
          event.category,
          event.eventType,
          event.data,
          event.scriptId,
          event.lineNumber,
          event.wallTime ?? null,
          event.monotonicTime ?? null,
          event.requestId ?? null,
          event.sequence ?? null,
        );
      }

      for (const delta of this.memoryBuffer) {
        this.insertDeltaStmt.run(
          delta.timestamp,
          delta.address,
          delta.oldValue,
          delta.newValue,
          delta.size,
          delta.valueType,
        );
      }

      for (const chunk of this.networkChunkBuffer) {
        this.insertNetworkChunkStmt.run(
          chunk.requestId,
          chunk.sequence,
          chunk.timestamp,
          chunk.monotonicTime,
          chunk.dataLength,
          chunk.encodedDataLength,
          chunk.chunkData,
          chunk.chunkIsBase64 ? 1 : 0,
        );
      }
    });

    flushTransaction();
    this.eventBuffer = [];
    this.memoryBuffer = [];
    this.networkChunkBuffer = [];
  }

  // ── Read operations ──

  query(sql: string): TraceQueryResult {
    this.ensureOpen();

    if (WRITE_SQL_PATTERN.test(sql)) {
      throw new Error(
        `Write operations are not allowed in trace queries. Rejected SQL: ${sql.slice(0, 100)}`,
      );
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];

    if (rows.length === 0) {
      const columns = stmt.columns().map((column: { name: string }) => column.name);
      return { columns, rows: [], rowCount: 0 };
    }

    const columns = Object.keys(rows[0]!);
    return {
      columns,
      rows: rows.map((row) => columns.map((column) => row[column])),
      rowCount: rows.length,
    };
  }

  getEventsByTimeRange(start: number, end: number): TraceEvent[] {
    this.ensureOpen();
    this.flush();

    const stmt = this.db.prepare(`
      SELECT
        id,
        timestamp,
        category,
        event_type,
        data,
        script_id,
        line_number,
        wall_time,
        monotonic_time,
        request_id,
        sequence
      FROM events
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC, sequence ASC, id ASC
    `);

    return (stmt.all(start, end) as Array<Record<string, unknown>>).map(mapEventRow);
  }

  getEventsByRequestId(requestId: string): TraceEvent[] {
    this.ensureOpen();
    this.flush();

    const stmt = this.db.prepare(`
      SELECT
        id,
        timestamp,
        category,
        event_type,
        data,
        script_id,
        line_number,
        wall_time,
        monotonic_time,
        request_id,
        sequence
      FROM events
      WHERE request_id = ?
      ORDER BY COALESCE(monotonic_time, timestamp) ASC, sequence ASC, id ASC
    `);

    return (stmt.all(requestId) as Array<Record<string, unknown>>).map(mapEventRow);
  }

  getNetworkResource(requestId: string): NetworkTraceResource | null {
    this.ensureOpen();
    this.flush();

    const stmt = this.db.prepare(`
      SELECT *
      FROM network_resources
      WHERE request_id = ?
      LIMIT 1
    `);

    const row = stmt.get(requestId) as Record<string, unknown> | undefined;
    return row ? mapNetworkResourceRow(row, this.fromSqliteBoolean) : null;
  }

  getNetworkChunks(requestId: string, limit?: number): NetworkTraceChunk[] {
    this.ensureOpen();
    this.flush();

    const sql = `
      SELECT
        id,
        request_id,
        sequence,
        timestamp,
        monotonic_time,
        data_length,
        encoded_data_length,
        chunk_data,
        chunk_is_base64
      FROM network_chunks
      WHERE request_id = ?
      ORDER BY sequence ASC
      ${typeof limit === 'number' ? 'LIMIT ?' : ''}
    `;

    const stmt = this.db.prepare(sql);
    const rows =
      typeof limit === 'number'
        ? (stmt.all(requestId, limit) as Array<Record<string, unknown>>)
        : (stmt.all(requestId) as Array<Record<string, unknown>>);

    return rows.map((row) => mapNetworkChunkRow(row, this.fromSqliteBoolean));
  }

  getMemoryDeltasByAddress(address: string): MemoryDelta[] {
    this.ensureOpen();
    this.flush();

    const stmt = this.db.prepare(`
      SELECT id, timestamp, address, old_value, new_value, size, value_type
      FROM memory_deltas
      WHERE address = ?
      ORDER BY timestamp ASC
    `);

    return (stmt.all(address) as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as number,
      timestamp: row['timestamp'] as number,
      address: row['address'] as string,
      oldValue: row['old_value'] as string,
      newValue: row['new_value'] as string,
      size: row['size'] as number,
      valueType: row['value_type'] as string,
    }));
  }

  getHeapSnapshots(): HeapSnapshotRecord[] {
    this.ensureOpen();

    const stmt = this.db.prepare(`
      SELECT id, timestamp, snapshot_data, summary
      FROM heap_snapshots
      ORDER BY timestamp ASC
    `);

    return (stmt.all() as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as number,
      timestamp: row['timestamp'] as number,
      snapshotData: row['snapshot_data'] as Buffer,
      summary: row['summary'] as string,
    }));
  }

  getMetadata(): Record<string, string> {
    this.ensureOpen();

    const stmt = this.db.prepare('SELECT key, value FROM metadata');
    const rows = stmt.all() as Array<{ key: string; value: string }>;

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ── Lifecycle ──

  close(): void {
    if (this.closed) return;
    this.flush();
    this.db.close();
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private fromSqliteBoolean(value: unknown): boolean {
    return value === 1 || value === true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('TraceDB is closed');
    }
  }
}
