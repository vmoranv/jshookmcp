/**
 * TraceDB type definitions for time-travel trace recording and analysis.
 */

/** A single recorded event from CDP or EventBus. */
export interface TraceEvent {
  id?: number;
  /** Timestamp in milliseconds (Date.now()) */
  timestamp: number;
  /** Event category: 'debugger', 'network', 'runtime', 'page', 'tool', 'memory', 'browser', 'session', 'other' */
  category: string;
  /** Specific event type: 'breakpoint_hit', 'requestWillBeSent', etc. */
  eventType: string;
  /** JSON-stringified event payload */
  data: string;
  /** CDP scriptId when relevant */
  scriptId: string | null;
  /** Line number when relevant */
  lineNumber: number | null;
}

/** A single memory write delta for differential tracing. */
export interface MemoryDelta {
  id?: number;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Hex memory address */
  address: string;
  /** Previous value (hex or typed representation) */
  oldValue: string;
  /** New value (hex or typed representation) */
  newValue: string;
  /** Size in bytes */
  size: number;
  /** Value type: 'int32', 'float64', 'bytes', 'string', etc. */
  valueType: string;
}

/** A stored heap snapshot record. */
export interface HeapSnapshotRecord {
  id?: number;
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Compressed snapshot data BLOB */
  snapshotData: Buffer;
  /** JSON summary: { totalSize, nodeCount, objectCounts: { Constructor: count } } */
  summary: string;
}

/** Key-value metadata for a trace session. */
export interface TraceMetadata {
  key: string;
  value: string;
}

/** Options for creating a TraceDB instance. */
export interface TraceDBOptions {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Number of events to buffer before flushing to disk (default: 200) */
  batchSize?: number;
}

/** Result from a SQL query against the trace database. */
export interface TraceQueryResult {
  /** Column names */
  columns: string[];
  /** Row data as arrays */
  rows: unknown[][];
  /** Number of rows returned */
  rowCount: number;
}
