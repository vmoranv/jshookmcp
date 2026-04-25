/**
 * TraceDB type definitions for time-travel trace recording and analysis.
 */

/** A single recorded event from CDP or EventBus. */
export interface TraceEvent {
  id?: number;
  /** Timestamp in milliseconds (Date.now()) */
  timestamp: number;
  /** Wall-clock timestamp in milliseconds when available. */
  wallTime?: number | null;
  /** High-precision monotonic timestamp in milliseconds when available. */
  monotonicTime?: number | null;
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
  /** Optional request identifier for network-correlated events. */
  requestId?: string | null;
  /** Monotonic insert sequence for stable ordering when timestamps collide. */
  sequence?: number | null;
}

/** Per-request network flow state reconstructed during recording. */
export interface NetworkTraceResource {
  requestId: string;
  url: string | null;
  method: string | null;
  resourceType: string | null;
  requestHeaders: string;
  requestPostData: string | null;
  status: number | null;
  statusText: string | null;
  responseHeaders: string;
  mimeType: string | null;
  protocol: string | null;
  remoteAddress: string | null;
  fromDiskCache: boolean;
  fromServiceWorker: boolean;
  startedWallTime: number | null;
  responseWallTime: number | null;
  finishedWallTime: number | null;
  startedMonotonicTime: number | null;
  responseMonotonicTime: number | null;
  finishedMonotonicTime: number | null;
  encodedDataLength: number | null;
  receivedDataLength: number;
  receivedEncodedDataLength: number;
  chunkCount: number;
  streamingEnabled: boolean;
  streamingSupported: boolean | null;
  streamingError: string | null;
  bodyCaptureState: 'none' | 'inline' | 'artifact' | 'truncated' | 'error';
  bodyInline: string | null;
  bodyArtifactPath: string | null;
  bodyBase64Encoded: boolean;
  bodySize: number | null;
  bodyTruncated: boolean;
  bodyError: string | null;
  failed: boolean;
  errorText: string | null;
}

/** A single received response chunk for a request. */
export interface NetworkTraceChunk {
  id?: number;
  requestId: string;
  sequence: number;
  timestamp: number;
  monotonicTime: number | null;
  dataLength: number;
  encodedDataLength: number;
  chunkData: string | null;
  chunkIsBase64: boolean;
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
