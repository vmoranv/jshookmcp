/**
 * TraceDB — SQLite storage engine for time-travel trace recording.
 *
 * Stores CDP events, memory deltas, and heap snapshots in a queryable
 * SQLite database using better-sqlite3's synchronous API.
 */

import type {
  TraceDBOptions,
  TraceEvent,
  TraceQueryResult,
  MemoryDelta,
  HeapSnapshotRecord,
} from '@modules/trace/TraceDB.types';

// better-sqlite3 is an optional dependency — lazy-load to fail gracefully
let Database: typeof import('better-sqlite3');
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3');
} catch {
  // Will throw at construction time if not installed
}

/** Write-modify SQL keywords rejected by the safety filter. */
const WRITE_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|PRAGMA)\b/i;

export class TraceDB {
  private readonly db: import('better-sqlite3').Database;
  private readonly batchSize: number;
  private eventBuffer: TraceEvent[] = [];
  private memoryBuffer: MemoryDelta[] = [];
  private closed = false;

  // Cached prepared statements
  private insertEventStmt!: import('better-sqlite3').Statement;
  private insertDeltaStmt!: import('better-sqlite3').Statement;
  private insertSnapshotStmt!: import('better-sqlite3').Statement;
  private upsertMetadataStmt!: import('better-sqlite3').Statement;

  constructor(private readonly options: TraceDBOptions) {
    if (!Database) {
      throw new Error(
        'better-sqlite3 is not installed. Install it with: pnpm add better-sqlite3'
      );
    }

    this.db = new Database(options.dbPath);
    this.batchSize = options.batchSize ?? 200;

    // Performance pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.createSchema();
    this.prepareStatements();
  }

  /** Database file path. */
  get dbPath(): string {
    return this.options.dbPath;
  }

  // ── Schema ──

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        category TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        script_id TEXT,
        line_number INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_category_type ON events(category, event_type);
      CREATE INDEX IF NOT EXISTS idx_events_script_id ON events(script_id);

      CREATE TABLE IF NOT EXISTS memory_deltas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        address TEXT NOT NULL,
        old_value TEXT NOT NULL,
        new_value TEXT NOT NULL,
        size INTEGER NOT NULL,
        value_type TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON memory_deltas(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memory_address ON memory_deltas(address);

      CREATE TABLE IF NOT EXISTS heap_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        snapshot_data BLOB,
        summary TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private prepareStatements(): void {
    this.insertEventStmt = this.db.prepare(`
      INSERT INTO events (timestamp, category, event_type, data, script_id, line_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.insertDeltaStmt = this.db.prepare(`
      INSERT INTO memory_deltas (timestamp, address, old_value, new_value, size, value_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.insertSnapshotStmt = this.db.prepare(`
      INSERT INTO heap_snapshots (timestamp, snapshot_data, summary)
      VALUES (?, ?, ?)
    `);

    this.upsertMetadataStmt = this.db.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
  }

  // ── Write operations ──

  /** Buffer an event for batched insertion. */
  insertEvent(event: TraceEvent): void {
    this.ensureOpen();
    this.eventBuffer.push(event);
    if (this.eventBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  /** Buffer a memory delta for batched insertion. */
  insertMemoryDelta(delta: MemoryDelta): void {
    this.ensureOpen();
    this.memoryBuffer.push(delta);
    if (this.memoryBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  /** Insert a heap snapshot immediately (infrequent, large). */
  insertHeapSnapshot(snapshot: HeapSnapshotRecord): void {
    this.ensureOpen();
    this.insertSnapshotStmt.run(
      snapshot.timestamp,
      snapshot.snapshotData,
      snapshot.summary
    );
  }

  /** Set or update a metadata key-value pair. */
  setMetadata(key: string, value: string): void {
    this.ensureOpen();
    this.upsertMetadataStmt.run(key, value);
  }

  /** Flush all buffered events and memory deltas to disk in a single transaction. */
  flush(): void {
    if (this.closed) return;

    const flushTransaction = this.db.transaction(() => {
      for (const e of this.eventBuffer) {
        this.insertEventStmt.run(
          e.timestamp, e.category, e.eventType, e.data,
          e.scriptId, e.lineNumber
        );
      }
      for (const d of this.memoryBuffer) {
        this.insertDeltaStmt.run(
          d.timestamp, d.address, d.oldValue, d.newValue,
          d.size, d.valueType
        );
      }
    });

    flushTransaction();
    this.eventBuffer = [];
    this.memoryBuffer = [];
  }

  // ── Read operations ──

  /**
   * Execute a read-only SQL query against the trace database.
   * Write statements are rejected for safety.
   */
  query(sql: string): TraceQueryResult {
    this.ensureOpen();

    // Defense-in-depth: reject write statements before execution
    if (WRITE_SQL_PATTERN.test(sql)) {
      throw new Error(`Write operations are not allowed in trace queries. Rejected SQL: ${sql.slice(0, 100)}`);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];

    if (rows.length === 0) {
      // Try to get column names from the statement
      const columns = stmt.columns().map((c: { name: string }) => c.name);
      return { columns, rows: [], rowCount: 0 };
    }

    const columns = Object.keys(rows[0]!);
    const rowArrays = rows.map(row => columns.map(col => row[col]));

    return { columns, rows: rowArrays, rowCount: rows.length };
  }

  /** Get events within a time range. */
  getEventsByTimeRange(start: number, end: number): TraceEvent[] {
    this.ensureOpen();
    this.flush(); // Ensure buffered events are queryable

    const stmt = this.db.prepare(`
      SELECT id, timestamp, category, event_type, data, script_id, line_number
      FROM events
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    return (stmt.all(start, end) as Array<Record<string, unknown>>).map(row => ({
      id: row['id'] as number,
      timestamp: row['timestamp'] as number,
      category: row['category'] as string,
      eventType: row['event_type'] as string,
      data: row['data'] as string,
      scriptId: (row['script_id'] as string) ?? null,
      lineNumber: (row['line_number'] as number) ?? null,
    }));
  }

  /** Get memory deltas for a specific address. */
  getMemoryDeltasByAddress(address: string): MemoryDelta[] {
    this.ensureOpen();
    this.flush();

    const stmt = this.db.prepare(`
      SELECT id, timestamp, address, old_value, new_value, size, value_type
      FROM memory_deltas
      WHERE address = ?
      ORDER BY timestamp ASC
    `);

    return (stmt.all(address) as Array<Record<string, unknown>>).map(row => ({
      id: row['id'] as number,
      timestamp: row['timestamp'] as number,
      address: row['address'] as string,
      oldValue: row['old_value'] as string,
      newValue: row['new_value'] as string,
      size: row['size'] as number,
      valueType: row['value_type'] as string,
    }));
  }

  /** Get all heap snapshots ordered by timestamp. */
  getHeapSnapshots(): HeapSnapshotRecord[] {
    this.ensureOpen();

    const stmt = this.db.prepare(`
      SELECT id, timestamp, snapshot_data, summary
      FROM heap_snapshots
      ORDER BY timestamp ASC
    `);

    return (stmt.all() as Array<Record<string, unknown>>).map(row => ({
      id: row['id'] as number,
      timestamp: row['timestamp'] as number,
      snapshotData: row['snapshot_data'] as Buffer,
      summary: row['summary'] as string,
    }));
  }

  /** Get all metadata as a key-value record. */
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

  /** Flush buffers and close the database connection. */
  close(): void {
    if (this.closed) return;
    this.flush();
    this.db.close();
    this.closed = true;
  }

  /** Check if the database is closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('TraceDB is closed');
    }
  }
}
