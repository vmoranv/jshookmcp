/**
 * Streaming domain — offline-pure query/export tools (WebSocket + gRPC).
 *
 * These handlers are pure projections over an in-memory StreamingSharedState:
 * no live WebSocket, no CDP session, no network, no capture listener. We seed
 * the shared state directly (the same structs the CDP listeners would populate)
 * and assert deterministic invariants over the real handler output. Export
 * tools additionally write a JSON artifact whose bytes are read back and
 * parsed, so the exported capture is checked to actually contain the seeded
 * frames, not just a success envelope.
 *
 * Ground truth is homemade: fixed, hand-constructed fixtures with known
 * counts, directions, payloads and requestIds.
 */
import { StreamingToolHandlers } from '@server/domains/streaming/handlers';
import type {
  GrpcCallRecord,
  StreamingSharedState,
  WsFrameRecord,
} from '@server/domains/streaming/handlers/shared';
import { getProjectRoot } from '@utils/outputPaths';
import { expectSuccess, type BenchSuite } from '../harness';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Stub collector: the query/export tools never call it (only the monitor-enable
// path does), so a minimal getActivePage stub is sufficient, mirroring
// offline-tools.suite.ts.
const collector = { getActivePage: async () => null } as never;
const handlers = new StreamingToolHandlers(collector);

// The facade keeps StreamingSharedState in a protected `state` field and also
// exposes backward-compat getters for the individual containers. We capture the
// one shared object the sub-handlers were constructed with via a named cast (the
// test seam), then mutate its maps in place so every case re-seeds cleanly.
interface StreamingStateHolder {
  readonly state: StreamingSharedState;
}
const stateHolder = handlers as unknown as StreamingStateHolder;

function seedState(): StreamingSharedState {
  const state = stateHolder.state;
  state.wsFramesByRequest.clear();
  state.wsFrameOrder.clear();
  state.wsConnections.clear();
  state.grpcCalls.clear();
  state.grpcCallOrder.clear();
  state.wsConfig.enabled = true;
  state.grpcConfig.enabled = true;
  return state;
}

function frame(
  requestId: string,
  direction: 'sent' | 'received',
  opcode: number,
  payload: string,
  timestamp: number,
): WsFrameRecord {
  return {
    requestId,
    timestamp,
    direction,
    opcode,
    payloadLength: payload.length,
    payloadPreview: payload,
    payloadSample: payload,
    payload,
    isBinary: opcode === 2,
  };
}

// Deterministic WebSocket fixture: 5 frames across 3 connections, mixing
// directions and payloads so direction/payload filters have real work to do.
const WS_FRAMES: WsFrameRecord[] = [
  frame('ws-1', 'sent', 1, 'PING alpha', 1000),
  frame('ws-1', 'received', 1, 'PONG beta', 1001),
  frame('ws-2', 'sent', 1, 'hello world', 1002),
  frame('ws-2', 'received', 1, 'PONG gamma', 1003),
  frame('ws-3', 'sent', 1, 'hello again', 1004),
];

function seedWs(state: StreamingSharedState): void {
  for (const f of WS_FRAMES) {
    state.wsFrameOrder.push({ requestId: f.requestId, frame: f });
    const bucket = state.wsFramesByRequest.get(f.requestId) ?? [];
    bucket.push(f);
    state.wsFramesByRequest.set(f.requestId, bucket);
  }
  state.wsConnections.set('ws-1', {
    requestId: 'ws-1',
    url: 'wss://example.test/one',
    status: 'open',
    framesCount: 2,
    createdTimestamp: 999,
    closedTimestamp: 1010,
    handshakeStatus: 101,
  });
  state.wsConnections.set('ws-2', {
    requestId: 'ws-2',
    url: 'wss://example.test/two',
    status: 'open',
    framesCount: 2,
    createdTimestamp: 998,
    handshakeStatus: 101,
  });
  state.wsConnections.set('ws-3', {
    requestId: 'ws-3',
    url: 'wss://example.test/three',
    status: 'connecting',
    framesCount: 1,
    createdTimestamp: 997,
  });
}

function grpcCall(
  requestId: string,
  url: string,
  status: number,
  responseMessageCount: number,
): GrpcCallRecord {
  const messages = Array.from({ length: responseMessageCount }, (_, index) => ({
    index,
    compressed: false,
    isTrailer: false,
    flag: 0,
    declaredLength: 5,
    payloadBytes: 5,
    payloadBase64: 'aGVsbG8=',
    truncated: false,
  }));
  return {
    requestId,
    url,
    method: `/svc.${requestId}/Call`,
    status,
    requestContentType: 'application/grpc',
    responseContentType: 'application/grpc',
    createdTimestamp: 2000 + Number(requestId.replace(/\D/g, '')),
    finishedTimestamp: 2100,
    requestBodyBytes: 0,
    responseBodyBytes: responseMessageCount * 5,
    responseMessages: messages,
    requestMessages: [],
    warnings: [],
    bodyError: null,
  };
}

// Deterministic gRPC fixture: 3 captured calls, two distinct URLs, with
// distinct message counts and one bodyError so summaries are non-uniform.
const GRPC_CALLS: GrpcCallRecord[] = [
  grpcCall('g1', 'https://api.example.test/svc.A/Method', 200, 2),
  grpcCall('g2', 'https://api.example.test/svc.B/Method', 200, 0),
  grpcCall('g3', 'https://other.example.test/svc.C/Method', 500, 1),
];
GRPC_CALLS[2]!.bodyError = 'getResponseBody failed';

function seedGrpc(state: StreamingSharedState): void {
  for (const call of GRPC_CALLS) {
    state.grpcCalls.set(call.requestId, call);
    state.grpcCallOrder.push(call.requestId);
  }
}

// resolveArtifactPath writes under <projectRoot>/artifacts/captures. Convert a
// relative displayPath back to an absolute path to read the bytes back.
function captureAbsolutePath(displayPath: string): string {
  return resolve(getProjectRoot(), displayPath);
}

function readCapture(displayPath: string): string {
  return readFileSync(captureAbsolutePath(displayPath), 'utf8');
}

// The export tools create real files; clean up the ones this suite produced on
// process exit so repeated runs leave no residue.
const writtenCaptures: string[] = [];
process.once('exit', () => {
  for (const p of writtenCaptures) {
    try {
      rmSync(captureAbsolutePath(p), { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function asStringArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export const streamingSuite: BenchSuite = {
  name: 'streaming',
  domain: 'streaming',
  description:
    'Streaming offline-pure query/export tools: WebSocket frame filters, connection set, gRPC call summaries, and exported-capture roundtrips over seeded in-memory state',
  cases: [
    {
      name: 'ws_get_frames/direction-and-payload-filter',
      tool: 'ws_get_frames',
      origin: 'homemade',
      reference:
        '5 seeded frames (3 sent / 2 received); direction=received yields 2 frames whose payloads all match /PONG/; payloadFilter=hello narrows the full set to exactly the 2 "hello" frames',
      run: () => {
        seedWs(seedState());
        return handlers.handleWsGetFramesTool({ direction: 'all', limit: 100 });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const frames = asStringArray(b.frames);
        if (frames.length !== 5) return `expected 5 frames, got ${frames.length}`;
        const sent = frames.filter((f) => f.direction === 'sent').length;
        const received = frames.filter((f) => f.direction === 'received').length;
        if (sent !== 3 || received !== 2)
          return `direction split wrong: sent=${sent} received=${received}`;
        const pongs = frames.filter((f) => /PONG/.test(String(f.payloadPreview)));
        if (pongs.length !== 2) return `expected 2 PONG frames, got ${pongs.length}`;
        return true;
      },
    },
    {
      name: 'ws_get_frames/direction-received-only',
      tool: 'ws_get_frames',
      origin: 'homemade',
      reference:
        'direction=received must return only the 2 received frames and report page.totalAfterFilter=2 with hasMore=false',
      run: () => {
        seedWs(seedState());
        return handlers.handleWsGetFramesTool({ direction: 'received', limit: 100 });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const frames = asStringArray(b.frames);
        if (frames.length !== 2) return `expected 2 received frames, got ${frames.length}`;
        if (frames.some((f) => f.direction !== 'received')) return 'non-received frame leaked';
        const page = b.page as Record<string, unknown> | undefined;
        if (!page || page.totalAfterFilter !== 2) return 'page.totalAfterFilter != 2';
        if (page.hasMore !== false) return 'page.hasMore should be false';
        return true;
      },
    },
    {
      name: 'ws_get_frames/payloadFilter-hello',
      tool: 'ws_get_frames',
      origin: 'homemade',
      reference:
        'payloadFilter=hello must match exactly the 2 frames carrying "hello" payloads and leave 3 filtered out',
      run: () => {
        seedWs(seedState());
        return handlers.handleWsGetFramesTool({
          direction: 'all',
          payloadFilter: 'hello',
          limit: 100,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const frames = asStringArray(b.frames);
        if (frames.length !== 2) return `expected 2 hello frames, got ${frames.length}`;
        if (frames.some((f) => !/hello/.test(String(f.payloadPreview))))
          return 'non-matching frame leaked';
        return true;
      },
    },
    {
      name: 'ws_get_connections/set-and-counts',
      tool: 'ws_get_connections',
      origin: 'homemade',
      reference:
        '3 seeded connections (ws-1,ws-2,ws-3) sorted by createdTimestamp ascending (ws-3,ws-2,ws-1); total=3 and per-connection framesCount mirror the seeded frame buckets',
      run: () => {
        seedWs(seedState());
        return handlers.handleWsGetConnectionsTool({});
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.total !== 3) return `expected total=3, got ${String(b.total)}`;
        const conns = asStringArray(b.connections);
        if (conns.length !== 3) return `expected 3 connections, got ${conns.length}`;
        const order = conns.map((c) => String(c.requestId));
        if (order.join(',') !== 'ws-3,ws-2,ws-1') return `wrong sort order: ${order.join(',')}`;
        const counts: Record<string, number> = {};
        for (const c of conns) counts[String(c.requestId)] = Number(c.framesCount);
        if (counts['ws-1'] !== 2 || counts['ws-2'] !== 2 || counts['ws-3'] !== 1) {
          return `framesCount mismatch: ${JSON.stringify(counts)}`;
        }
        return true;
      },
    },
    {
      name: 'ws_export_capture/contains-seeded-frames',
      tool: 'ws_export_capture',
      origin: 'homemade',
      reference:
        'JSON export writes an artifact whose frames array contains all 5 seeded frames with their payloads; recordCount=5 and the on-disk body parses back with matching requestIds',
      run: () => {
        seedWs(seedState());
        return handlers.handleWsExportCaptureTool({ format: 'json', includePayload: true });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.recordCount !== 5) return `expected recordCount=5, got ${String(b.recordCount)}`;
        const displayPath = String(b.artifactPath ?? '');
        if (!displayPath) return 'no artifactPath returned';
        writtenCaptures.push(displayPath);
        const parsed = JSON.parse(readCapture(displayPath)) as {
          frames: Record<string, unknown>[];
        };
        if (!Array.isArray(parsed.frames) || parsed.frames.length !== 5) {
          return 'exported frames missing or wrong length';
        }
        const ids = new Set(parsed.frames.map((f) => String(f.requestId)));
        for (const id of ['ws-1', 'ws-2', 'ws-3']) {
          if (!ids.has(id)) return `exported capture missing frames for ${id}`;
        }
        const hello = parsed.frames.filter((f) => /hello/.test(String(f.payload)));
        if (hello.length !== 2) return `export dropped payloads: ${hello.length} hello frames`;
        return true;
      },
    },
    {
      name: 'grpc_get_calls/urlFilter-and-summaries',
      tool: 'grpc_get_calls',
      origin: 'homemade',
      reference:
        '3 seeded calls; unfiltered page returns 3 with responseMessageCount 2/0/1 and one bodyError; urlFilter=api.example.test narrows to exactly 2 calls',
      run: () => {
        seedGrpc(seedState());
        return handlers.handleGrpcGetCallsTool({ limit: 100 });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const calls = asStringArray(b.calls);
        if (calls.length !== 3) return `expected 3 calls, got ${calls.length}`;
        const counts = calls.map((c) => Number(c.responseMessageCount)).toSorted();
        if (counts.join(',') !== '0,1,2') return `message counts wrong: ${counts.join(',')}`;
        const withError = calls.filter((c) => c.bodyError !== null).length;
        if (withError !== 1) return `expected 1 bodyError call, got ${withError}`;
        return true;
      },
    },
    {
      name: 'grpc_get_calls/urlFilter-narrows',
      tool: 'grpc_get_calls',
      origin: 'homemade',
      reference:
        'urlFilter=api\\.example\\.test must keep only the 2 calls whose URL contains api.example.test and report totalAfterFilter=2',
      run: () => {
        seedGrpc(seedState());
        return handlers.handleGrpcGetCallsTool({ urlFilter: 'api\\.example\\.test', limit: 100 });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const calls = asStringArray(b.calls);
        if (calls.length !== 2) return `expected 2 filtered calls, got ${calls.length}`;
        if (calls.some((c) => !String(c.url).includes('api.example.test')))
          return 'urlFilter leaked a call';
        const page = b.page as Record<string, unknown> | undefined;
        if (!page || page.totalAfterFilter !== 2) return 'page.totalAfterFilter != 2';
        return true;
      },
    },
    {
      name: 'grpc_export_capture/contains-seeded-calls',
      tool: 'grpc_export_capture',
      origin: 'homemade',
      reference:
        'JSON export writes an artifact whose calls array contains all 3 seeded calls with requestIds g1/g2/g3 and responseMessageCount 2/0/1; recordCount=3',
      run: () => {
        seedGrpc(seedState());
        return handlers.handleGrpcExportCaptureTool({ format: 'json', includeMessages: true });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.recordCount !== 3) return `expected recordCount=3, got ${String(b.recordCount)}`;
        const displayPath = String(b.artifactPath ?? '');
        if (!displayPath) return 'no artifactPath returned';
        writtenCaptures.push(displayPath);
        const parsed = JSON.parse(readCapture(displayPath)) as { calls: Record<string, unknown>[] };
        if (!Array.isArray(parsed.calls) || parsed.calls.length !== 3) {
          return 'exported calls missing or wrong length';
        }
        const ids = parsed.calls.map((c) => String(c.requestId)).toSorted();
        if (ids.join(',') !== 'g1,g2,g3') return `wrong exported ids: ${ids.join(',')}`;
        const counts = parsed.calls.map((c) => Number(c.responseMessageCount)).toSorted();
        if (counts.join(',') !== '0,1,2')
          return `exported message counts wrong: ${counts.join(',')}`;
        return true;
      },
    },
  ],
};
