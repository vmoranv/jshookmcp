import { readFile } from 'node:fs/promises';
import type { MCPServerContext } from '@server/MCPServer.context';
import { TraceDB } from '@modules/trace/TraceDB';
import type {
  NetworkTraceChunk,
  NetworkTraceResource,
  TraceEvent as DbTraceEvent,
} from '@modules/trace/TraceDB.types';
import type { TraceRecorder } from '@modules/trace/TraceRecorder';

export const TRACE_DETAIL_THRESHOLD_BYTES = 25_600;

export const asBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === 'boolean' ? value : defaultValue;

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
  const result = db.query(`
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
      WHERE ${timeExpr} >= ${start} AND ${timeExpr} <= ${end}
      ORDER BY ${timeExpr} ASC, sequence ASC
    `);

  return result.rows.map((row: unknown[]) => ({
    timestamp: row[0] as number,
    category: row[1] as string,
    eventType: row[2] as string,
    data: row[3] as string,
    scriptId: (row[4] as string | null) ?? null,
    lineNumber: (row[5] as number | null) ?? null,
    wallTime: (row[6] as number | null) ?? null,
    monotonicTime: (row[7] as number | null) ?? null,
    requestId: (row[8] as string | null) ?? null,
    sequence: (row[9] as number | null) ?? null,
  }));
};

export const smartHandleDetailed = <T>(
  ctx: MCPServerContext,
  payload: T,
): T | ReturnType<MCPServerContext['detailedData']['smartHandle']> => {
  const detailedData = ctx.detailedData;
  return detailedData ? detailedData.smartHandle(payload, TRACE_DETAIL_THRESHOLD_BYTES) : payload;
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
