import type {
  NetworkTraceChunk,
  NetworkTraceResource,
  TraceEvent,
} from '@modules/trace/TraceDB.types';

export interface TraceDBStatements {
  insertEventStmt: import('better-sqlite3').Statement;
  insertDeltaStmt: import('better-sqlite3').Statement;
  insertSnapshotStmt: import('better-sqlite3').Statement;
  upsertMetadataStmt: import('better-sqlite3').Statement;
  upsertNetworkResourceStmt: import('better-sqlite3').Statement;
  insertNetworkChunkStmt: import('better-sqlite3').Statement;
}

export function initializeTraceSchema(db: import('better-sqlite3').Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        category TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        script_id TEXT,
        line_number INTEGER,
        wall_time REAL,
        monotonic_time REAL,
        request_id TEXT,
        sequence INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_category_type ON events(category, event_type);
      CREATE INDEX IF NOT EXISTS idx_events_script_id ON events(script_id);
      CREATE INDEX IF NOT EXISTS idx_events_request_id ON events(request_id);

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

      CREATE TABLE IF NOT EXISTS network_resources (
        request_id TEXT PRIMARY KEY,
        url TEXT,
        method TEXT,
        resource_type TEXT,
        request_headers TEXT NOT NULL DEFAULT '{}',
        request_post_data TEXT,
        status INTEGER,
        status_text TEXT,
        response_headers TEXT NOT NULL DEFAULT '{}',
        mime_type TEXT,
        protocol TEXT,
        remote_address TEXT,
        from_disk_cache INTEGER NOT NULL DEFAULT 0,
        from_service_worker INTEGER NOT NULL DEFAULT 0,
        started_wall_time REAL,
        response_wall_time REAL,
        finished_wall_time REAL,
        started_monotonic_time REAL,
        response_monotonic_time REAL,
        finished_monotonic_time REAL,
        encoded_data_length INTEGER,
        received_data_length INTEGER NOT NULL DEFAULT 0,
        received_encoded_data_length INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        streaming_enabled INTEGER NOT NULL DEFAULT 0,
        streaming_supported INTEGER,
        streaming_error TEXT,
        body_capture_state TEXT NOT NULL DEFAULT 'none',
        body_inline TEXT,
        body_artifact_path TEXT,
        body_base64_encoded INTEGER NOT NULL DEFAULT 0,
        body_size INTEGER,
        body_truncated INTEGER NOT NULL DEFAULT 0,
        body_error TEXT,
        failed INTEGER NOT NULL DEFAULT 0,
        error_text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_network_resources_started_wall_time
      ON network_resources(started_wall_time);

      CREATE TABLE IF NOT EXISTS network_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp REAL NOT NULL,
        monotonic_time REAL,
        data_length INTEGER NOT NULL,
        encoded_data_length INTEGER NOT NULL,
        chunk_data TEXT,
        chunk_is_base64 INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_network_chunks_request_sequence
      ON network_chunks(request_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_network_chunks_timestamp
      ON network_chunks(timestamp);
    `);

  ensureColumn(db, 'events', 'wall_time', 'REAL');
  ensureColumn(db, 'events', 'monotonic_time', 'REAL');
  ensureColumn(db, 'events', 'request_id', 'TEXT');
  ensureColumn(db, 'events', 'sequence', 'INTEGER');
}

export function prepareTraceStatements(db: import('better-sqlite3').Database): TraceDBStatements {
  return {
    insertEventStmt: db.prepare(`
      INSERT INTO events (
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
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertDeltaStmt: db.prepare(`
      INSERT INTO memory_deltas (timestamp, address, old_value, new_value, size, value_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertSnapshotStmt: db.prepare(`
      INSERT INTO heap_snapshots (timestamp, snapshot_data, summary)
      VALUES (?, ?, ?)
    `),
    upsertMetadataStmt: db.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    upsertNetworkResourceStmt: db.prepare(`
      INSERT INTO network_resources (
        request_id,
        url,
        method,
        resource_type,
        request_headers,
        request_post_data,
        status,
        status_text,
        response_headers,
        mime_type,
        protocol,
        remote_address,
        from_disk_cache,
        from_service_worker,
        started_wall_time,
        response_wall_time,
        finished_wall_time,
        started_monotonic_time,
        response_monotonic_time,
        finished_monotonic_time,
        encoded_data_length,
        received_data_length,
        received_encoded_data_length,
        chunk_count,
        streaming_enabled,
        streaming_supported,
        streaming_error,
        body_capture_state,
        body_inline,
        body_artifact_path,
        body_base64_encoded,
        body_size,
        body_truncated,
        body_error,
        failed,
        error_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        url = excluded.url,
        method = excluded.method,
        resource_type = excluded.resource_type,
        request_headers = excluded.request_headers,
        request_post_data = excluded.request_post_data,
        status = excluded.status,
        status_text = excluded.status_text,
        response_headers = excluded.response_headers,
        mime_type = excluded.mime_type,
        protocol = excluded.protocol,
        remote_address = excluded.remote_address,
        from_disk_cache = excluded.from_disk_cache,
        from_service_worker = excluded.from_service_worker,
        started_wall_time = excluded.started_wall_time,
        response_wall_time = excluded.response_wall_time,
        finished_wall_time = excluded.finished_wall_time,
        started_monotonic_time = excluded.started_monotonic_time,
        response_monotonic_time = excluded.response_monotonic_time,
        finished_monotonic_time = excluded.finished_monotonic_time,
        encoded_data_length = excluded.encoded_data_length,
        received_data_length = excluded.received_data_length,
        received_encoded_data_length = excluded.received_encoded_data_length,
        chunk_count = excluded.chunk_count,
        streaming_enabled = excluded.streaming_enabled,
        streaming_supported = excluded.streaming_supported,
        streaming_error = excluded.streaming_error,
        body_capture_state = excluded.body_capture_state,
        body_inline = excluded.body_inline,
        body_artifact_path = excluded.body_artifact_path,
        body_base64_encoded = excluded.body_base64_encoded,
        body_size = excluded.body_size,
        body_truncated = excluded.body_truncated,
        body_error = excluded.body_error,
        failed = excluded.failed,
        error_text = excluded.error_text
    `),
    insertNetworkChunkStmt: db.prepare(`
      INSERT INTO network_chunks (
        request_id,
        sequence,
        timestamp,
        monotonic_time,
        data_length,
        encoded_data_length,
        chunk_data,
        chunk_is_base64
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
}

export function mapEventRow(row: Record<string, unknown>): TraceEvent {
  return {
    id: row['id'] as number,
    timestamp: row['timestamp'] as number,
    category: row['category'] as string,
    eventType: row['event_type'] as string,
    data: row['data'] as string,
    scriptId: (row['script_id'] as string) ?? null,
    lineNumber: (row['line_number'] as number) ?? null,
    wallTime: (row['wall_time'] as number) ?? null,
    monotonicTime: (row['monotonic_time'] as number) ?? null,
    requestId: (row['request_id'] as string) ?? null,
    sequence: (row['sequence'] as number) ?? null,
  };
}

export function mapNetworkChunkRow(
  row: Record<string, unknown>,
  fromSqliteBoolean: (value: unknown) => boolean,
): NetworkTraceChunk {
  return {
    id: row['id'] as number,
    requestId: row['request_id'] as string,
    sequence: row['sequence'] as number,
    timestamp: row['timestamp'] as number,
    monotonicTime: (row['monotonic_time'] as number) ?? null,
    dataLength: row['data_length'] as number,
    encodedDataLength: row['encoded_data_length'] as number,
    chunkData: (row['chunk_data'] as string) ?? null,
    chunkIsBase64: fromSqliteBoolean(row['chunk_is_base64']),
  };
}

export function mapNetworkResourceRow(
  row: Record<string, unknown>,
  fromSqliteBoolean: (value: unknown) => boolean,
): NetworkTraceResource {
  return {
    requestId: row['request_id'] as string,
    url: (row['url'] as string) ?? null,
    method: (row['method'] as string) ?? null,
    resourceType: (row['resource_type'] as string) ?? null,
    requestHeaders: (row['request_headers'] as string) ?? '{}',
    requestPostData: (row['request_post_data'] as string) ?? null,
    status: (row['status'] as number) ?? null,
    statusText: (row['status_text'] as string) ?? null,
    responseHeaders: (row['response_headers'] as string) ?? '{}',
    mimeType: (row['mime_type'] as string) ?? null,
    protocol: (row['protocol'] as string) ?? null,
    remoteAddress: (row['remote_address'] as string) ?? null,
    fromDiskCache: fromSqliteBoolean(row['from_disk_cache']),
    fromServiceWorker: fromSqliteBoolean(row['from_service_worker']),
    startedWallTime: (row['started_wall_time'] as number) ?? null,
    responseWallTime: (row['response_wall_time'] as number) ?? null,
    finishedWallTime: (row['finished_wall_time'] as number) ?? null,
    startedMonotonicTime: (row['started_monotonic_time'] as number) ?? null,
    responseMonotonicTime: (row['response_monotonic_time'] as number) ?? null,
    finishedMonotonicTime: (row['finished_monotonic_time'] as number) ?? null,
    encodedDataLength: (row['encoded_data_length'] as number) ?? null,
    receivedDataLength: (row['received_data_length'] as number) ?? 0,
    receivedEncodedDataLength: (row['received_encoded_data_length'] as number) ?? 0,
    chunkCount: (row['chunk_count'] as number) ?? 0,
    streamingEnabled: fromSqliteBoolean(row['streaming_enabled']),
    streamingSupported:
      row['streaming_supported'] === null || row['streaming_supported'] === undefined
        ? null
        : fromSqliteBoolean(row['streaming_supported']),
    streamingError: (row['streaming_error'] as string) ?? null,
    bodyCaptureState:
      (row['body_capture_state'] as NetworkTraceResource['bodyCaptureState']) ?? 'none',
    bodyInline: (row['body_inline'] as string) ?? null,
    bodyArtifactPath: (row['body_artifact_path'] as string) ?? null,
    bodyBase64Encoded: fromSqliteBoolean(row['body_base64_encoded']),
    bodySize: (row['body_size'] as number) ?? null,
    bodyTruncated: fromSqliteBoolean(row['body_truncated']),
    bodyError: (row['body_error'] as string) ?? null,
    failed: fromSqliteBoolean(row['failed']),
    errorText: (row['error_text'] as string) ?? null,
  };
}

function ensureColumn(
  db: import('better-sqlite3').Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
