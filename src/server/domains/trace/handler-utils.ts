import { readFile } from 'node:fs/promises';
import { ToolError } from '@errors/ToolError';
import type { MCPServerContext } from '@server/MCPServer.context';
import { TraceDB } from '@modules/trace/TraceDB';
import type {
  NetworkTraceChunk,
  NetworkTraceResource,
  TraceEvent as DbTraceEvent,
} from '@modules/trace/TraceDB.types';
import type { TraceRecorder } from '@modules/trace/TraceRecorder';
import type {
  MemoryDelta as SummaryMemoryDelta,
  TraceEvent as SummaryTraceEvent,
} from '@server/domains/trace/TraceSummarizer';

const TRACE_DETAIL_THRESHOLD_BYTES = 25_600;

export const asBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === 'boolean' ? value : defaultValue;

const readStringValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const readNumberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readObjectValue = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const validationError = (fieldName: string, expected: string): ToolError =>
  new ToolError('VALIDATION', `${fieldName} must be ${expected}`);

export const optionalStringArg = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = readStringValue(value);
  if (parsed === undefined) {
    throw validationError(fieldName, 'a string');
  }
  return parsed;
};

export const optionalBooleanArg = (value: unknown, fieldName: string): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw validationError(fieldName, 'a boolean');
  }
  return value;
};

export const optionalNumberArg = (value: unknown, fieldName: string): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = readNumberValue(value);
  if (parsed === undefined) {
    throw validationError(fieldName, 'a finite number');
  }
  return parsed;
};

export const optionalStringArrayArg = (value: unknown, fieldName: string): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw validationError(fieldName, 'an array of strings');
  }
  return [...value];
};

export const asNumber = (
  value: unknown,
  options: { defaultValue: number; min?: number; max?: number; integer?: boolean },
): number => {
  let parsed = typeof value === 'number' && Number.isFinite(value) ? value : options.defaultValue;
  if (options.integer) parsed = Math.trunc(parsed);
  if (typeof options.min === 'number') parsed = Math.max(options.min, parsed);
  if (typeof options.max === 'number') parsed = Math.min(options.max, parsed);
  return parsed;
};

export const rowToObject = (columns: string[], row: unknown[]): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]!] = row[i];
  }
  return obj;
};

export const safeParseJSON = (str: string): unknown => {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
};

export const parseTraceSummary = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === 'string' ? safeParseJSON(value) : value;
  return readObjectValue(parsed) ?? {};
};

export const readTraceSummaryObjectCounts = (
  summary: Record<string, unknown>,
): Record<string, number> => {
  const counts = readObjectValue(summary['objectCounts']);
  if (!counts) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
};

/**
 * Reads the per-class retained-self-size map from a heap snapshot summary.
 * `objectSizes` is populated by `TraceRecorder.extractHeapSummary` (sum of each
 * node's `self_size` grouped by constructor name). Empty for snapshots recorded
 * before the field was added — callers should treat absence as "unknown".
 */
export const readTraceSummaryObjectSizes = (
  summary: Record<string, unknown>,
): Record<string, number> => {
  const sizes = readObjectValue(summary['objectSizes']);
  if (!sizes) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(sizes)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = value;
    }
  }
  return normalized;
};

export const readTraceSummaryNumber = (summary: Record<string, unknown>, key: string): number =>
  readNumberValue(summary[key]) ?? 0;

const readDbTraceEventRow = (row: unknown[]): DbTraceEvent => ({
  timestamp: readNumberValue(row[0]) ?? 0,
  category: readStringValue(row[1]) ?? '',
  eventType: readStringValue(row[2]) ?? '',
  data: readStringValue(row[3]) ?? '',
  scriptId: readStringValue(row[4]) ?? null,
  lineNumber: readNumberValue(row[5]) ?? null,
  wallTime: readNumberValue(row[6]) ?? null,
  monotonicTime: readNumberValue(row[7]) ?? null,
  requestId: readStringValue(row[8]) ?? null,
  sequence: readNumberValue(row[9]) ?? null,
});

export const readSummaryTraceEventRow = (row: unknown[]): SummaryTraceEvent => ({
  timestamp: readNumberValue(row[0]) ?? 0,
  category: readStringValue(row[1]) ?? '',
  eventType: readStringValue(row[2]) ?? '',
  data: typeof row[3] === 'string' ? safeParseJSON(row[3]) : row[3],
  scriptId: readStringValue(row[4]),
  lineNumber: readNumberValue(row[5]),
});

export const readSummaryMemoryDeltaRow = (row: unknown[]): SummaryMemoryDelta => ({
  timestamp: readNumberValue(row[0]) ?? 0,
  address: readStringValue(row[1]) ?? '',
  oldValue: readStringValue(row[2]) ?? '',
  newValue: readStringValue(row[3]) ?? '',
  size: readNumberValue(row[4]) ?? 0,
  valueType: readStringValue(row[5]) ?? '',
});

export const readExportTraceRow = (
  row: unknown[],
): {
  timestampMs: number;
  category: string;
  eventType: string;
  data: string;
} => ({
  timestampMs: readNumberValue(row[0]) ?? 0,
  category: readStringValue(row[1]) ?? '',
  eventType: readStringValue(row[2]) ?? '',
  data: readStringValue(row[3]) ?? '',
});

export const formatTraceEvent = (event: DbTraceEvent): Record<string, unknown> => ({
  timestamp: event.timestamp,
  wallTime: event.wallTime ?? null,
  monotonicTime: event.monotonicTime ?? null,
  category: event.category,
  eventType: event.eventType,
  data: typeof event.data === 'string' ? safeParseJSON(event.data) : event.data,
  scriptId: event.scriptId,
  lineNumber: event.lineNumber,
  requestId: event.requestId ?? null,
  sequence: event.sequence ?? null,
});

export const formatNetworkResource = (resource: NetworkTraceResource): Record<string, unknown> => ({
  requestId: resource.requestId,
  url: resource.url,
  method: resource.method,
  resourceType: resource.resourceType,
  requestHeaders: safeParseJSON(resource.requestHeaders),
  requestPostDataPresent: resource.requestPostData !== null,
  status: resource.status,
  statusText: resource.statusText,
  responseHeaders: safeParseJSON(resource.responseHeaders),
  mimeType: resource.mimeType,
  protocol: resource.protocol,
  remoteAddress: resource.remoteAddress,
  fromDiskCache: resource.fromDiskCache,
  fromServiceWorker: resource.fromServiceWorker,
  startedWallTime: resource.startedWallTime,
  responseWallTime: resource.responseWallTime,
  finishedWallTime: resource.finishedWallTime,
  startedMonotonicTime: resource.startedMonotonicTime,
  responseMonotonicTime: resource.responseMonotonicTime,
  finishedMonotonicTime: resource.finishedMonotonicTime,
  encodedDataLength: resource.encodedDataLength,
  receivedDataLength: resource.receivedDataLength,
  receivedEncodedDataLength: resource.receivedEncodedDataLength,
  chunkCount: resource.chunkCount,
  streamingEnabled: resource.streamingEnabled,
  streamingSupported: resource.streamingSupported,
  streamingError: resource.streamingError,
  bodyCaptureState: resource.bodyCaptureState,
  bodySize: resource.bodySize,
  bodyBase64Encoded: resource.bodyBase64Encoded,
  bodyTruncated: resource.bodyTruncated,
  bodyArtifactPath: resource.bodyArtifactPath,
  bodyError: resource.bodyError,
  failed: resource.failed,
  errorText: resource.errorText,
});

export const formatNetworkChunk = (chunk: NetworkTraceChunk): Record<string, unknown> => ({
  sequence: chunk.sequence,
  timestamp: chunk.timestamp,
  monotonicTime: chunk.monotonicTime,
  dataLength: chunk.dataLength,
  encodedDataLength: chunk.encodedDataLength,
  hasChunkData: chunk.chunkData !== null,
  chunkPreview:
    chunk.chunkData !== null
      ? `${chunk.chunkData.slice(0, 120)}${chunk.chunkData.length > 120 ? '...' : ''}`
      : null,
  chunkIsBase64: chunk.chunkIsBase64,
});

export const readTraceBody = async (
  resource: NetworkTraceResource,
  options: { maxBodyBytes: number; returnSummary: boolean },
): Promise<Record<string, unknown> | null> => {
  if (
    resource.bodyCaptureState === 'none' &&
    resource.bodyInline === null &&
    resource.bodyArtifactPath === null
  ) {
    return null;
  }

  const body = await readPersistedBody(resource);
  if (body === null) {
    return {
      state: resource.bodyCaptureState,
      error: resource.bodyError ?? 'Body content is not available',
      truncated: resource.bodyTruncated,
    };
  }

  const size = resource.bodySize ?? body.length;
  const shouldSummarize = options.returnSummary || size > options.maxBodyBytes;
  if (shouldSummarize) {
    return {
      state: resource.bodyCaptureState,
      summary: {
        size,
        sizeKB: (size / 1024).toFixed(2),
        base64Encoded: resource.bodyBase64Encoded,
        preview: `${body.slice(0, 500)}${body.length > 500 ? '...' : ''}`,
        truncated: resource.bodyTruncated || size > options.maxBodyBytes,
        reason: options.returnSummary
          ? 'Summary mode enabled'
          : `Response too large (${(size / 1024).toFixed(2)} KB > ${(options.maxBodyBytes / 1024).toFixed(2)} KB)`,
      },
    };
  }

  return {
    state: resource.bodyCaptureState,
    body,
    base64Encoded: resource.bodyBase64Encoded,
    size,
    sizeKB: (size / 1024).toFixed(2),
    truncated: resource.bodyTruncated,
    ...(resource.bodyError ? { warning: resource.bodyError } : {}),
  };
};

export const readEventsByExpression = (
  db: TraceDB,
  timeExpr: string,
  start: number,
  end: number,
): DbTraceEvent[] => {
  const result = db.queryWithParams(
    `
      SELECT
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
      WHERE ${timeExpr} >= ? AND ${timeExpr} <= ?
      ORDER BY ${timeExpr} ASC, sequence ASC
    `,
    [start, end],
  );

  return result.rows.map(readDbTraceEventRow);
};

export const smartHandleDetailed = async <T>(
  ctx: MCPServerContext,
  payload: T,
): Promise<T | Awaited<ReturnType<MCPServerContext['detailedData']['smartHandle']>>> => {
  const detailedData = ctx.detailedData;
  return detailedData
    ? await detailedData.smartHandle(payload, TRACE_DETAIL_THRESHOLD_BYTES)
    : payload;
};

export const getDbForReading = (recorder: TraceRecorder, dbPath?: string): TraceDB => {
  if (dbPath) {
    return new TraceDB({ dbPath });
  }

  const activeDb = recorder.getDB();
  if (!activeDb) {
    throw new Error(
      'GRACEFUL: No active recording and no dbPath specified. Start a recording or provide a dbPath.',
    );
  }
  activeDb.flush();
  return activeDb;
};

const readPersistedBody = async (resource: NetworkTraceResource): Promise<string | null> => {
  if (typeof resource.bodyInline === 'string') {
    return resource.bodyInline;
  }
  if (resource.bodyArtifactPath) {
    return readFile(resource.bodyArtifactPath, 'utf8');
  }
  return null;
};
