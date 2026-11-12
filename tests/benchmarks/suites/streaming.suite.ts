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
import { body, expectSuccess, type BenchSuite } from '../harness';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTestUrl } from '@tests/shared/test-urls';

const WS_URL_ONE = buildTestUrl('example', { path: 'one', scheme: 'wss', suffix: 'test' });
const WS_URL_TWO = buildTestUrl('example', { path: 'two', scheme: 'wss', suffix: 'test' });
const WS_URL_THREE = buildTestUrl('example', { path: 'three', scheme: 'wss', suffix: 'test' });
const GRPC_HOST = 'api.example.test';

// Stub collector: the query/export tools never call it (only the monitor-enable
// path does), so a minimal getActivePage stub is sufficient, mirroring
// offline-tools.suite.ts.
const collector = { getActivePage: async () => null } as never;
const handlers = new StreamingToolHandlers(collector);

/**
 * Handlers over a stub page whose `evaluate` runs the callback against a bare
 * `window` (no monitor state, no EventSource/fetch/RTCPeerConnection). This is
 * the honest "monitor not enabled / API missing" substrate: the host-side
 * refusal and enable/disable reporting logic is the code under test.
 */
function pageHandlers(): StreamingToolHandlers {
  (globalThis as unknown as { window: unknown }).window = {};
  const page = {
    createCDPSession: async () => ({
      send: async () => ({}),
      on: () => {},
      off: () => {},
      detach: async () => {},
    }),
    evaluate: async (fn: unknown, arg: unknown) => {
      if (typeof fn !== 'function') throw new Error('unexpected string evaluate payload');
      return (fn as (a: unknown) => unknown)(arg);
    },
    url: () => 'https://app.example/',
  };
  return new StreamingToolHandlers({ getActivePage: async () => page } as never);
}

/**
 * Assert a query/export tool refuses before its monitor is enabled: explicit
 * message naming the enable step, and no result payload that could be mistaken
 * for an empty capture.
 */
function notEnabledContract(v: unknown, enableHint: string): true | string {
  const b = body(v);
  if (b['success'] !== false)
    return `expected success=false, got ${JSON.stringify(b).slice(0, 200)}`;
  const message = String(b['message'] ?? b['error'] ?? '');
  if (!/not (been )?(enabled|available)/i.test(message))
    return `expected a not-enabled message, got "${message}"`;
  if (!message.includes(enableHint)) return `message should point at ${enableHint}: "${message}"`;
  if (b['events'] !== undefined) return `must not return an events array when disabled`;
  return true;
}

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
    url: WS_URL_ONE,
    status: 'open',
    framesCount: 2,
    createdTimestamp: 999,
    closedTimestamp: 1010,
    handshakeStatus: 101,
  });
  state.wsConnections.set('ws-2', {
    requestId: 'ws-2',
    url: WS_URL_TWO,
    status: 'open',
    framesCount: 2,
    createdTimestamp: 998,
    handshakeStatus: 101,
  });
  state.wsConnections.set('ws-3', {
    requestId: 'ws-3',
    url: WS_URL_THREE,
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
  grpcCall('g1', buildTestUrl('api.example', { path: 'svc.A/Method', suffix: 'test' }), 200, 2),
  grpcCall('g2', buildTestUrl('api.example', { path: 'svc.B/Method', suffix: 'test' }), 200, 0),
  grpcCall('g3', buildTestUrl('other.example', { path: 'svc.C/Method', suffix: 'test' }), 500, 1),
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
        '3 seeded calls; unfiltered page returns 3 with responseMessageCount 2/0/1 and one bodyError; urlFilter narrows to exactly 2 calls',
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
        'urlFilter on the api host must keep only the 2 matching calls and report totalAfterFilter=2',
      run: () => {
        seedGrpc(seedState());
        return handlers.handleGrpcGetCallsTool({
          urlFilter: GRPC_HOST.replaceAll('.', '\\.'),
          limit: 100,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const calls = asStringArray(b.calls);
        if (calls.length !== 2) return `expected 2 filtered calls, got ${calls.length}`;
        if (calls.some((c) => !String(c.url).includes(GRPC_HOST))) return 'urlFilter leaked a call';
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

    // ── Monitor/state-projection batch 2026-11-12 (autoresearch) ────────────
    // The monitor tools split into a page-side capture layer and host-side
    // admission logic. A stub page whose `evaluate` runs the callback against a
    // seeded `window` measures the host half: enable/disable reporting, the
    // "not enabled" refusal for every query/export tool, and filter forwarding.
    {
      name: 'ws_monitor/enable-reports-config-and-stats',
      tool: 'ws_monitor',
      origin: 'homemade',
      reference:
        'monitor control: enable reports the effective config (maxFrames default 1000, no urlFilter, exposeInstances false) plus zeroed capture stats on a fresh state',
      run: () => pageHandlers().handleWsMonitorDispatchTool({ action: 'enable' }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!/enabled/i.test(String(b.message)))
          return `enable message wrong: ${String(b.message)}`;
        const config = b.config as Record<string, unknown> | undefined;
        if (!config || config['maxFrames'] !== 1000 || config['exposeInstances'] !== false)
          return `config not reported: ${JSON.stringify(config)}`;
        if (config['urlFilter'] !== null) return `urlFilter should default to null`;
        const stats = b.stats as Record<string, unknown> | undefined;
        if (!stats || stats['capturedFrames'] !== 0 || stats['trackedConnections'] !== 0)
          return `fresh stats should be zeroed: ${JSON.stringify(stats)}`;
        return true;
      },
    },
    {
      name: 'ws_monitor/disable-reports-summary',
      tool: 'ws_monitor',
      origin: 'homemade',
      reference:
        'monitor control: disable reports a summary over the current capture state (all counters zero on a fresh state) and echoes the config',
      run: () => pageHandlers().handleWsMonitorDispatchTool({ action: 'disable' }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!/disabled/i.test(String(b.message)))
          return `disable message wrong: ${String(b.message)}`;
        const summary = b.summary as Record<string, unknown> | undefined;
        if (!summary) return `summary missing: ${JSON.stringify(b).slice(0, 200)}`;
        for (const key of ['totalFrames', 'sentFrames', 'receivedFrames', 'activeConnections']) {
          if (summary[key] !== 0) return `summary.${key} should be 0 on a fresh state`;
        }
        return true;
      },
    },
    {
      name: 'grpc_monitor/disable-reports-capture-summary',
      tool: 'grpc_monitor',
      origin: 'homemade',
      reference:
        'monitor control: disabling gRPC reports a summary over the captured calls (zeros with no capture) and keeps the content-type detection note available on enable',
      run: async () => {
        const h = pageHandlers();
        const enable = expectSuccess(await h.handleGrpcMonitorTool({ action: 'enable' }));
        const disable = expectSuccess(await h.handleGrpcMonitorTool({ action: 'disable' }));
        return { enable, disable };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const enable = r['enable'] ?? {};
        if (!/application\/grpc/.test(String(enable['note'])))
          return `enable note should describe content-type detection: ${String(enable['note'])}`;
        const summary = (r['disable'] ?? {})['summary'] as Record<string, unknown> | undefined;
        if (!summary) return `disable summary missing`;
        if (
          summary['capturedCalls'] !== 0 ||
          summary['totalResponseMessages'] !== 0 ||
          summary['callsWithBodyError'] !== 0
        ) {
          return `fresh summary should be zeroed: ${JSON.stringify(summary)}`;
        }
        return true;
      },
    },
    {
      name: 'sse_monitor_enable/no-eventsource-honest-failure',
      tool: 'sse_monitor_enable',
      origin: 'homemade',
      reference:
        'capability contract: a page context without EventSource must fail naming the missing API rather than reporting a patched monitor; an invalid urlFilter regex is rejected before patching',
      run: async () => {
        const h = pageHandlers();
        const noApi = body(await h.handleSseMonitorEnableTool({ maxEvents: 10 }));
        const badRegex = body(await h.handleSseMonitorEnableTool({ urlFilter: '(' }));
        return { noApi, badRegex };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const noApi = r['noApi'] ?? {};
        if (noApi['success'] !== false) return `expected failure without EventSource`;
        if (!/EventSource is not available/.test(String(noApi['error'] ?? '')))
          return `missing-API error wrong: ${String(noApi['error'])}`;
        const bad = r['badRegex'] ?? {};
        if (bad['success'] !== false) return `invalid regex must be rejected`;
        if (!/Invalid urlFilter regex/.test(String(bad['error'] ?? '')))
          return `regex error wrong: ${String(bad['error'])}`;
        return true;
      },
    },
    {
      name: 'sse_get_events/not-enabled-refusal',
      tool: 'sse_get_events',
      origin: 'homemade',
      reference:
        'state contract: querying SSE events before sse_monitor_enable returns an explicit not-enabled message with no events array (never a silent empty success)',
      run: () => pageHandlers().handleSseGetEventsTool({}),
      validate: (v) => notEnabledContract(v, 'sse_monitor_enable'),
    },
    {
      name: 'sse_export_capture/not-enabled-refusal',
      tool: 'sse_export_capture',
      origin: 'homemade',
      reference:
        'state contract: exporting before the monitor is enabled refuses with the enable hint instead of writing an empty capture artifact',
      run: () => pageHandlers().handleSseExportCaptureTool({}),
      validate: (v) => {
        const r = notEnabledContract(v, 'sse_monitor_enable');
        if (r !== true) return r;
        const b = body(v) as Record<string, unknown>;
        return b['artifactPath'] === undefined ? true : `must not write an artifact when disabled`;
      },
    },
    {
      name: 'fetch_stream_monitor/enable-needs-fetch',
      tool: 'fetch_stream_monitor',
      origin: 'homemade',
      reference:
        'capability contract: without a page-side fetch the monitor must fail naming the API, while disable still succeeds and states the wrapper stays installed but paused',
      run: async () => {
        const h = pageHandlers();
        const enable = body(await h.handleFetchStreamMonitorTool({ maxEvents: 5 }));
        const disable = body(await h.handleFetchStreamMonitorTool({ action: 'disable' }));
        return { enable, disable };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const enable = r['enable'] ?? {};
        if (enable['success'] !== false) return `enable should fail without fetch`;
        if (!/fetch is not available/.test(String(enable['error'] ?? '')))
          return `missing-API error wrong: ${String(enable['error'])}`;
        const disable = r['disable'] ?? {};
        if (disable['success'] !== true) return `disable should succeed`;
        if (!/wrapper remains installed/.test(String(disable['message'] ?? '')))
          return `disable message should explain the paused wrapper`;
        return true;
      },
    },
    {
      name: 'fetch_stream_get_events/not-enabled-refusal',
      tool: 'fetch_stream_get_events',
      origin: 'homemade',
      reference:
        'state contract: querying fetch-stream events before enabling returns an explicit not-enabled message naming fetch_stream_monitor',
      run: () => pageHandlers().handleFetchStreamGetEventsTool({}),
      validate: (v) => notEnabledContract(v, 'fetch_stream_monitor'),
    },
    {
      name: 'fetch_stream_export_capture/not-enabled-refusal',
      tool: 'fetch_stream_export_capture',
      origin: 'homemade',
      reference:
        'state contract: exporting fetch-stream events while disabled refuses with the enable hint rather than writing an empty capture',
      run: () => pageHandlers().handleFetchStreamExportCaptureTool({}),
      validate: (v) => {
        const r = notEnabledContract(v, 'fetch_stream_monitor');
        if (r !== true) return r;
        const b = body(v) as Record<string, unknown>;
        return b['artifactPath'] === undefined ? true : `must not write an artifact when disabled`;
      },
    },
    {
      name: 'webrtc_monitor/enable-needs-peerconnection',
      tool: 'webrtc_monitor',
      origin: 'homemade',
      reference:
        'capability contract: without RTCPeerConnection the monitor fails naming the API; disable still succeeds and explains that capture is paused',
      run: async () => {
        const h = pageHandlers();
        const enable = body(await h.handleWebRtcMonitorTool({ maxEvents: 5 }));
        const disable = body(await h.handleWebRtcMonitorTool({ action: 'disable' }));
        return { enable, disable };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const enable = r['enable'] ?? {};
        if (enable['success'] !== false) return `enable should fail without RTCPeerConnection`;
        if (!/RTCPeerConnection is not available/.test(String(enable['error'] ?? '')))
          return `missing-API error wrong: ${String(enable['error'])}`;
        const disable = r['disable'] ?? {};
        if (disable['success'] !== true) return `disable should succeed`;
        return true;
      },
    },
    {
      name: 'webrtc_get_events/not-enabled-refusal',
      tool: 'webrtc_get_events',
      origin: 'homemade',
      reference:
        'state contract: querying WebRTC datachannel events before enabling returns an explicit not-enabled message naming webrtc_monitor',
      run: () => pageHandlers().handleWebRtcGetEventsTool({}),
      validate: (v) => notEnabledContract(v, 'webrtc_monitor'),
    },
    {
      name: 'webrtc_export_capture/not-enabled-refusal',
      tool: 'webrtc_export_capture',
      origin: 'homemade',
      reference:
        'state contract: exporting WebRTC events while disabled refuses with the enable hint instead of emitting an empty capture',
      run: () => pageHandlers().handleWebRtcExportCaptureTool({}),
      validate: (v) => {
        const r = notEnabledContract(v, 'webrtc_monitor');
        if (r !== true) return r;
        const b = body(v) as Record<string, unknown>;
        return b['artifactPath'] === undefined ? true : `must not write an artifact when disabled`;
      },
    },
    {
      name: 'ws_send_frame/requires-url-and-payload',
      tool: 'ws_send_frame',
      origin: 'homemade',
      reference:
        'argument contract: a frame needs both url and a string payload; without them the call is rejected by name before touching the page',
      run: async () => {
        const h = pageHandlers();
        const noUrl = body(await h.handleWsSendFrameTool({ payload: 'hi' }));
        const noPayload = body(await h.handleWsSendFrameTool({ url: WS_URL_ONE }));
        return { noUrl, noPayload };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        if (
          r['noUrl']?.['success'] !== false ||
          !/url is required/.test(String(r['noUrl']?.['error']))
        )
          return `missing-url rejection wrong: ${JSON.stringify(r['noUrl'])}`;
        if (
          r['noPayload']?.['success'] !== false ||
          !/payload is required/.test(String(r['noPayload']?.['error']))
        ) {
          return `missing-payload rejection wrong: ${JSON.stringify(r['noPayload'])}`;
        }
        return true;
      },
    },
    {
      name: 'ws_send_frame/exposure-not-enabled-refusal',
      tool: 'ws_send_frame',
      origin: 'homemade',
      reference:
        'state contract: sending to a url with no registered sockets refuses and points at ws_monitor exposeInstances=true rather than silently dropping the frame',
      run: () => pageHandlers().handleWsSendFrameTool({ url: WS_URL_ONE, payload: 'hi' }),
      validate: (v) => notEnabledContract(v, 'exposeInstances'),
    },
  ],
};
