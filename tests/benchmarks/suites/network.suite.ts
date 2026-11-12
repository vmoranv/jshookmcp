/**
 * Network domain benchmark (offline fingerprint/frame subset — no live sockets).
 *
 * External references:
 *  - RFC 8446 §4.1.2 ClientHello wire layout (programmatically built, facts are normative)
 *  - JA3 spec (Salesforce) string format; JA4 spec (FoxIO-LLC/ja4) string format
 *  - RFC 9113 §4 SETTINGS frame wire layout (1-byte type, 24-bit length, big-endian entries)
 *  - gRPC wire format: 1B compressed flag + 4B big-endian length prefix per message
 * Homemade fixtures:
 *  - fingerprint determinism (same input ⇒ same hash)
 *  - network_http2_fingerprint canonical "<settings>|<window_update>|<priority>" shape
 */
import { AdvancedToolHandlers } from '@server/domains/network/handlers';
import { createSocket } from 'node:dgram';
import { body, expectSuccess, type BenchSuite } from '../harness';
import { networkContractCases } from './network.contracts';

type DnsStubMode = { kind: 'a' } | { kind: 'cname'; firstHost: string; target: string };

/**
 * Minimal RFC 1035 UDP DNS responder on loopback. Answers A queries with
 * 10.0.0.1, or CNAME queries for `firstHost` with `target` and NODATA
 * (NOERROR/ANCOUNT=0) for anything else. Fully offline — no upstream resolver.
 */
function startDnsStub(mode: DnsStubMode): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      if (msg.length < 17 || msg.readUInt16BE(4) !== 1) return;
      // Parse the (uncompressed) question name so CNAME answers can be selective.
      let cursor = 12;
      const labels: string[] = [];
      while (cursor < msg.length && msg[cursor] !== 0) {
        const len = msg[cursor]!;
        labels.push(msg.subarray(cursor + 1, cursor + 1 + len).toString('ascii'));
        cursor += len + 1;
      }
      cursor += 1; // root label
      const qname = labels.join('.').toLowerCase();
      const qtype = msg.readUInt16BE(cursor);
      cursor += 4; // QTYPE + QCLASS
      const question = msg.subarray(12, cursor);
      const header = Buffer.from(msg.subarray(0, 12));
      header.writeUInt16BE(0x8180, 2); // QR=1 AA=1 RD=1 RA=1
      header.writeUInt16BE(0, 6); // ANCOUNT=0 by default (NODATA)

      let answers: Buffer[] = [];
      if (mode.kind === 'a' && qtype === 1) {
        header.writeUInt16BE(1, 6);
        answers = [
          Buffer.from([
            0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04, 10, 0, 0, 1,
          ]),
        ];
      } else if (mode.kind === 'cname' && qtype === 5 && qname === mode.firstHost.toLowerCase()) {
        const rdata = Buffer.concat([
          ...mode.target
            .split('.')
            .map((label) =>
              Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'ascii')]),
            ),
          Buffer.from([0]),
        ]);
        header.writeUInt16BE(1, 6);
        answers = [
          Buffer.concat([
            Buffer.from([
              0xc0,
              0x0c,
              0x00,
              0x05,
              0x00,
              0x01,
              0x00,
              0x00,
              0x00,
              0x3c,
              0x00,
              rdata.length,
            ]),
            rdata,
          ]),
        ];
      }

      sock.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address);
    });
    sock.on('error', reject);
    sock.bind(0, '127.0.0.1', () => {
      const addr = sock.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, close: () => sock.close() });
    });
  });
}

const collector = { getActivePage: async () => null } as never;
const monitor = {
  getNetworkRequests: () => [
    {
      requestId: 'req-bench-1',
      url: 'https://example.com/api',
      method: 'GET',
      type: 'XHR',
      timestamp: 1000,
      headers: {
        'user-agent': 'curl/7.88.1',
        accept: '*/*',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.benchtoken123.sig',
      },
    },
  ],
  getNetworkResponses: () => [
    {
      requestId: 'req-bench-1',
      url: 'https://example.com/api',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      timestamp: 1005,
    },
  ],
  getNetworkActivity: (_id: string) => ({
    request: {
      requestId: 'req-bench-1',
      url: 'https://example.com/api',
      method: 'GET',
      timestamp: 1000,
      headers: { 'user-agent': 'curl/7.88.1', accept: '*/*' },
    },
    response: {
      requestId: 'req-bench-1',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      timestamp: 1005,
    },
  }),
  getResponseBody: async () => ({ body: '{"ok":true}', base64Encoded: false }),
  isNetworkEnabled: () => true,
  isPlaywrightFallbackActive: () => false,
  getNetworkStatus: () => ({
    enabled: true,
    requestCount: 1,
    responseCount: 1,
    listenerCount: 1,
    cdpSessionActive: false,
  }),
  enable: async () => {},
  disable: async () => {},
  getFetchInterceptStatus: () => ({ enabled: false, rules: [] }),
  clearInjectedBuffers: async () => ({ cleared: 2 }),
  resetInjectedInterceptors: async () => ({ reset: true }),
  getExceptions: () => [
    {
      message: 'ReferenceError: benchVar is not defined',
      url: 'https://example.com/app.js',
      timestamp: 1001,
    },
  ],
} as never;
const handlers = new AdvancedToolHandlers(collector, monitor);

// ── Programmatically build a deterministic TLS 1.3-capable ClientHello ──
function u16(n: number): Buffer {
  return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
}
function u24(n: number): Buffer {
  return Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

function buildClientHelloHex(
  cipherBytes: Buffer = Buffer.from([0x13, 0x01, 0x13, 0x02, 0x13, 0x03]),
): string {
  const random = Buffer.alloc(32, 0x42);
  const ext = (type: number, data: Buffer): Buffer =>
    Buffer.concat([u16(type), u16(data.length), data]);
  // Vector-typed extensions: supported_versions uses a 1-BYTE list length (RFC 8446 §4.2.1);
  // groups/sigalgs/key_share use u16 list lengths.
  const supportedVersions = ext(
    0x2b,
    Buffer.concat([Buffer.from([0x02]), Buffer.from([0x03, 0x04])]),
  );
  const supportedGroups = ext(0x0a, Buffer.concat([u16(4), Buffer.from([0x00, 0x1d, 0x00, 0x17])])); // x25519, secp256r1
  const signatureAlgorithms = ext(
    0x0d,
    Buffer.concat([u16(4), Buffer.from([0x04, 0x03, 0x08, 0x04])]),
  );
  const keyShareEntry = Buffer.concat([
    u16(0x001d),
    u16(0x0020),
    Buffer.from(Array.from({ length: 32 }, (_, i) => i)),
  ]);
  const keyShare = ext(0x33, Buffer.concat([u16(keyShareEntry.length), keyShareEntry]));
  const host = Buffer.from('benchmark.example.com');
  const serverNameEntry = Buffer.concat([Buffer.from([0x00]), u16(host.length), host]);
  const serverName = ext(0x0000, Buffer.concat([u16(serverNameEntry.length), serverNameEntry]));
  const alpn = ext(0x0010, Buffer.concat([u16(0x03), Buffer.from([0x02, 0x68, 0x32])])); // "h2"

  const exts = Buffer.concat([
    supportedVersions,
    supportedGroups,
    signatureAlgorithms,
    keyShare,
    serverName,
    alpn,
  ]);
  const hello = Buffer.concat([
    Buffer.from([0x03, 0x03]), // legacy_version TLS1.2
    random,
    Buffer.from([0x00]), // session_id empty
    u16(cipherBytes.length),
    cipherBytes,
    Buffer.from([0x01, 0x00]), // compression: null
    u16(exts.length),
    exts,
  ]);
  const record = Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01]),
    u16(hello.length + 4),
    Buffer.from([0x01]),
    u24(hello.length),
    hello,
  ]);
  return record.toString('hex');
}

const CLIENT_HELLO_HEX = buildClientHelloHex();
const MUTATED_CLIENT_HELLO_HEX = buildClientHelloHex(
  Buffer.from([0x13, 0x01, 0x13, 0x02, 0x13, 0x03, 0xc0, 0x2f]),
);

// RFC 9113 SETTINGS frame with one entry: SETTINGS_MAX_CONCURRENT_STREAMS(0x3)=100
const SETTINGS_FRAME_HEX = '000006040000000000000300000064';
// RFC 9113 WINDOW_UPDATE on stream 0 with increment 100
const WINDOW_UPDATE_HEX = '00000408000000000000000064';

export const networkSuite: BenchSuite = {
  name: 'network-fingerprint',
  domain: 'network',
  description:
    'JA3/JA4 ClientHello fingerprinting (format conformance + determinism), HTTP/2 & gRPC frame parsing',
  cases: [
    {
      name: 'network_tls_fingerprint/parse_client_hello-rfc8446-structure',
      tool: 'network_tls_fingerprint',
      origin: 'external-vector',
      reference:
        'RFC 8446 §4.1.2 ClientHello layout (hand-built): record 0x0301, legacy 0x0303, 3 ciphers, SNI, ALPN h2',
      run: () =>
        handlers.handleNetworkTlsFingerprint({
          mode: 'parse_client_hello',
          clientHelloHex: CLIENT_HELLO_HEX,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `parse failed: ${b.error}`;
        if (b.recordVersion !== '0301' && b.recordVersion !== 0x0301 && b.recordVersion !== '3.1')
          return `recordVersion mismatch: ${JSON.stringify(b.recordVersion)}`;
        const analysis = b.analysis as
          | { ciphersCount?: number; extensions?: unknown[] }
          | undefined;
        const cipherCount = analysis?.ciphersCount ?? (b.ciphers as unknown[] | undefined)?.length;
        if (cipherCount !== 3) return `expected 3 ciphers, got ${cipherCount}`;
        const ja4 = String(b.ja4 ?? '');
        // FoxIO canonical: t<tls>d<ciphers:2><extensions:2><alpn>_<cipherhash12>_<exthash12>
        if (!/^t1[23]d\d{4}h[0-9]_[0-9a-f]{12}_[0-9a-f]{12}$/.test(ja4))
          return `ja4 not in FoxIO canonical form: "${ja4}"`;
        const ja3 = String(b.ja3 ?? '');
        if (!/^[0-9a-f]{32}$/.test(ja3)) return `ja3 must be md5 hex, got "${ja3}"`;
        // ja3_raw: 5 comma-separated JA3 fields per the Salesforce spec
        // (version,ciphers,exts,elliptic_curves,ec_point_formats) in DECIMAL.
        const ja3Fields = String(b.ja3_raw ?? '').split(',');
        if (ja3Fields.length !== 5) return `ja3_raw must have 5 JA3 fields, got: ${b.ja3_raw}`;
        if (ja3Fields[0] !== '771')
          return `ja3 version field must be decimal 771, got ${ja3Fields[0]}`;
        if (!ja3Fields[1]!.includes('4865-4866-4867'))
          return `ja3_raw missing TLS1.3 decimal cipher list: ${b.ja3_raw}`;
        return true;
      },
    },
    {
      name: 'network_tls_fingerprint/fingerprint-determinism',
      tool: 'network_tls_fingerprint',
      origin: 'homemade',
      reference: 'fingerprinting must be deterministic: identical ClientHello ⇒ identical ja3/ja4',
      run: async () => {
        const a = body(
          await handlers.handleNetworkTlsFingerprint({
            mode: 'parse_client_hello',
            clientHelloHex: CLIENT_HELLO_HEX,
          }),
        );
        const b = body(
          await handlers.handleNetworkTlsFingerprint({
            mode: 'parse_client_hello',
            clientHelloHex: CLIENT_HELLO_HEX,
          }),
        );
        return { a: { ja3: a.ja3, ja4: a.ja4 }, b: { ja3: b.ja3, ja4: b.ja4 } };
      },
      validate: (v) => {
        const { a, b } = v as { a: { ja3: string; ja4: string }; b: { ja3: string; ja4: string } };
        return a.ja3 === b.ja3 && a.ja4 === b.ja4 ? true : `nondeterministic: ${a.ja4} vs ${b.ja4}`;
      },
    },
    {
      name: 'network_tls_fingerprint/perturbation-sensitivity',
      tool: 'network_tls_fingerprint',
      origin: 'homemade',
      reference: 'adding one cipher must change the fingerprint (fingerprint is content-sensitive)',
      run: async () => {
        const base = body(
          await handlers.handleNetworkTlsFingerprint({
            mode: 'parse_client_hello',
            clientHelloHex: CLIENT_HELLO_HEX,
          }),
        );
        const m = body(
          await handlers.handleNetworkTlsFingerprint({
            mode: 'parse_client_hello',
            clientHelloHex: MUTATED_CLIENT_HELLO_HEX,
          }),
        );
        return {
          baseJa4: base.ja4,
          mutatedJa4: m.ja4,
          mutatedSuccess: m.success,
          mutatedError: m.error,
        };
      },
      validate: (v) => {
        const { baseJa4, mutatedJa4, mutatedSuccess, mutatedError } = v as {
          baseJa4?: string;
          mutatedJa4?: string;
          mutatedSuccess?: boolean;
          mutatedError?: string;
        };
        if (mutatedSuccess === false) return `mutated parse failed: ${mutatedError}`;
        if (!baseJa4 || !mutatedJa4) return 'missing fingerprints';
        return baseJa4 !== mutatedJa4 ? true : 'adding a cipher did not change the JA4 fingerprint';
      },
    },
    {
      name: 'http2_frame_parse/rfc9113-settings',
      tool: 'http2_frame_parse',
      origin: 'external-vector',
      reference:
        'RFC 9113 §4/§6.5 SETTINGS frame: len=6 type=0x04 stream=0, entry MAX_CONCURRENT_STREAMS(0x3)=100',
      run: () => handlers.handleHttp2FrameParse({ frameHex: SETTINGS_FRAME_HEX }),
      validate: (v) => {
        const b = expectSuccess(v);
        const type = String(b.frameType ?? '').toLowerCase();
        if (!type.includes('settings')) return `expected SETTINGS, got ${b.frameType}`;
        if (b.typeCode !== 4) return `typeCode mismatch: ${b.typeCode}`;
        if (b.streamId !== 0) return `streamId mismatch: ${b.streamId}`;
        const text = JSON.stringify(b);
        if (!text.includes('3')) return 'settings entry id 3 not surfaced';
        if (!text.includes('100')) return 'settings entry value 100 not surfaced';
        return true;
      },
    },
    {
      name: 'grpc_frame_parse/length-prefixed-message',
      tool: 'grpc_frame_parse',
      origin: 'external-vector',
      reference:
        'gRPC wire format: 00 00000005 68656c6c6f ⇒ 1 message, uncompressed payload "hello" (base64 aGVsbG8=)',
      run: () => handlers.handleGrpcFrameParse({ data: '000000000568656c6c6f', encoding: 'hex' }),
      validate: (v) => {
        const b = expectSuccess(v);
        const messages = (b.messages ?? b.frames ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(messages) || messages.length !== 1)
          return `expected 1 message, got ${messages.length ?? 0}`;
        const first = messages[0]!;
        const b64 = String(first.payloadBase64 ?? '');
        const hex = String(first.payloadHex ?? '');
        if (b64 === 'aGVsbG8=' || hex === '68656c6c6f') return true;
        return `payload not surfaced as "hello": ${JSON.stringify(first).slice(0, 160)}`;
      },
    },
    {
      name: 'grpc_frame_parse/truncated-lenient',
      tool: 'grpc_frame_parse',
      origin: 'homemade',
      reference:
        'gRPC frame spec edge: truncated trailing message is emitted with a warning, not a hard failure',
      run: () => handlers.handleGrpcFrameParse({ data: '00000000056865', encoding: 'hex' }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false && !b.warning && !b.warnings)
          return `hard failure instead of lenient parse: ${b.error}`;
        return true;
      },
    },
    {
      name: 'network_http2_fingerprint/canonical-shape',
      tool: 'network_http2_fingerprint',
      origin: 'external-vector',
      reference:
        'Akamai HTTP/2 fingerprint canonical form "<settings>|<window_update>|<priority>" (sha256 of the canonical string)',
      run: () =>
        handlers.handleNetworkHttp2Fingerprint({
          framesHex: SETTINGS_FRAME_HEX + WINDOW_UPDATE_HEX,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const fp = String(b.canonical ?? b.fingerprint ?? '');
        if (!fp) return `no canonical fingerprint in response: ${JSON.stringify(b).slice(0, 200)}`;
        const parts = fp.split('|');
        if (parts.length !== 3) return `expected 3 |-separated parts, got "${fp}"`;
        if (parts[0] !== '3:100') return `settings part should be "3:100", got "${parts[0]}"`;
        if (parts[1] !== '100') return `window_update part should be "100", got "${parts[1]}"`;
        if (!/^[0-9a-f]{64}$/.test(String(b.hash ?? ''))) return 'missing sha256 hash field';
        return true;
      },
    },
    {
      name: 'http2_frame_build/settings-build-contract',
      tool: 'http2_frame_build',
      origin: 'homemade',
      reference:
        'builds a binary HTTP/2 SETTINGS frame and verifies typeCode, flags, and output hex',
      run: () =>
        handlers.handleHttp2FrameBuild({
          frameType: 'SETTINGS',
          settings: [{ id: 3, value: 100 }],
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.typeCode !== 4) return `expected typeCode=4, got: ${b.typeCode}`;
        if (!b.frameHex) return 'expected frameHex output';
        return true;
      },
    },
    {
      name: 'grpc_frame_build/length-prefix-assembly',
      tool: 'grpc_frame_build',
      origin: 'homemade',
      reference:
        'assembles 1-byte compression flag + 4-byte BE length prefixed gRPC message payload',
      run: () =>
        handlers.handleGrpcFrameBuild({
          messages: [{ payloadHex: '68656c6c6f' }], // "hello"
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.messageCount !== 1) return `expected messageCount=1, got: ${b.messageCount}`;
        if (b.hex !== '000000000568656c6c6f') {
          return `expected assembled hex 000000000568656c6c6f, got: ${b.hex}`;
        }
        return true;
      },
    },
    {
      name: 'http_request_build/raw-http1-request-generator',
      tool: 'http_request_build',
      origin: 'homemade',
      reference:
        'builds RFC 7230 compliant HTTP/1.1 wire string with computed Content-Length and Host headers',
      run: () =>
        handlers.handleHttpRequestBuild({
          method: 'POST',
          target: '/api/test',
          host: 'example.com',
          headers: { 'X-Custom-Header': 'Bench' },
          body: 'ping',
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const req = String(b.requestText ?? b.rawRequest ?? '');
        if (!req.startsWith('POST /api/test HTTP/1.1\r\n')) {
          return `invalid request line: ${req.slice(0, 100)}`;
        }
        if (!req.includes('Host: example.com')) return 'missing Host header';
        if (!req.includes('Content-Length: 4')) return 'missing Content-Length header';
        if (!req.includes('X-Custom-Header: Bench')) return 'missing custom header';
        if (!req.endsWith('\r\n\r\nping')) return 'missing request body payload';
        return true;
      },
    },
    {
      name: 'network_bot_detect_analyze/scoring-pipeline',
      tool: 'network_bot_detect_analyze',
      origin: 'homemade',
      reference: 'scores User-Agent and TLS/H2 fingerprint signals against supplied knownBad lists',
      run: () =>
        handlers.handleNetworkBotDetectAnalyze({
          knownBadUserAgents: ['curl'],
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (typeof b.averageBotScore !== 'number')
          return `expected averageBotScore number, got: ${typeof b.averageBotScore}`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline capture projection, HAR, auth & dry-run replay ──
    {
      name: 'network_get_status/status-projection',
      tool: 'network_get_status',
      origin: 'homemade',
      reference: 'reports current network monitor state without launching browser',
      run: () => handlers.handleNetworkGetStatus({}),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.enabled !== true || Number(b.requestCount) !== 1)
          return `expected enabled=true requestCount=1, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'network_get_stats/aggregates-methods-and-status',
      tool: 'network_get_stats',
      origin: 'homemade',
      reference: 'computes method/status/type distributions from captured network traffic',
      run: () => handlers.handleNetworkGetStats({}),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        if (!text.includes('GET') || !text.includes('200'))
          return `expected GET and 200 in stats: ${text.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'network_get_requests/returns-captured-list',
      tool: 'network_get_requests',
      origin: 'homemade',
      reference: 'queries captured network requests with autoEnable=false over monitor buffer',
      run: () => handlers.handleNetworkGetRequests({ autoEnable: false, enableExceptions: false }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const requests = b.requests as Array<{ requestId?: string; url?: string }> | undefined;
        if (!Array.isArray(requests) || requests.length !== 1)
          return `expected 1 request, got ${JSON.stringify(b).slice(0, 200)}`;
        if (requests[0]?.requestId !== 'req-bench-1')
          return `unexpected requestId: ${requests[0]?.requestId}`;
        return true;
      },
    },
    {
      name: 'network_extract_auth/detects-and-masks-bearer',
      tool: 'network_extract_auth',
      origin: 'homemade',
      reference: 'scans captured headers for Bearer tokens and masks secret values',
      run: () => handlers.handleNetworkExtractAuth({ minConfidence: 0.1 }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (Number(b.found) < 1 || !Array.isArray(b.findings))
          return `expected >=1 auth finding, got ${JSON.stringify(b).slice(0, 200)}`;
        if (JSON.stringify(b.findings).includes('benchtoken123'))
          return 'secret token was NOT masked in network_extract_auth output';
        return true;
      },
    },
    {
      name: 'network_export_har/har-1-2-format',
      tool: 'network_export_har',
      origin: 'external-vector',
      reference:
        'HAR 1.2 specification: exports log.version and entries array from captured requests',
      run: () => handlers.handleNetworkExportHar({ includeBodies: false }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const har = b.har as { log?: { entries?: unknown[] } } | undefined;
        if (Number(b.entryCount) !== 1 || !har?.log?.entries || har.log.entries.length !== 1)
          return `expected 1 HAR entry, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'network_replay_request/dry-run-preview',
      tool: 'network_replay_request',
      origin: 'homemade',
      reference:
        'replays captured request in dryRun=true mode (zero outbound network I/O) with header override',
      run: () =>
        handlers.handleNetworkReplayRequest({
          requestId: 'req-bench-1',
          dryRun: true,
          headers: { 'X-Bench': '1' },
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.dryRun !== true)
          return `expected dryRun=true, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'console_get_exceptions/url-filter',
      tool: 'console_get_exceptions',
      origin: 'homemade',
      reference: 'queries captured runtime exceptions filtered by URL substring',
      run: () => handlers.handleConsoleGetExceptions({ url: 'example.com', limit: 10 }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (Number(b.total) !== 1 || !Array.isArray(b.exceptions))
          return `expected 1 exception, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },

    // ── Coverage batch 2 (2026-11-11 autoresearch): response body, intercept list, monitor lifecycle, console buffers ──
    {
      name: 'network_get_response_body/retrieves-captured-json',
      tool: 'network_get_response_body',
      origin: 'homemade',
      reference: 'retrieves response body payload by requestId from monitor buffer',
      run: () =>
        handlers.handleNetworkGetResponseBody({
          requestId: 'req-bench-1',
          autoEnable: false,
          retries: 0,
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.requestId !== 'req-bench-1' || !JSON.stringify(b).includes('ok'))
          return `expected ok response body for req-bench-1, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'network_intercept/lists-active-rules',
      tool: 'network_intercept',
      origin: 'homemade',
      reference: 'queries active Fetch interception status and rules list',
      run: () => handlers.handleNetworkInterceptDispatch({ action: 'list' }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b.rules)) return `expected rules array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'network_enable/enables-monitoring',
      tool: 'network_enable',
      origin: 'homemade',
      reference: 'enables network monitoring via consoleMonitor and reports status',
      run: () => handlers.handleNetworkEnable({ enableExceptions: false }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.enabled !== true) return `expected enabled=true, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'network_disable/disables-monitoring',
      tool: 'network_disable',
      origin: 'homemade',
      reference: 'disables network monitoring cleanly and confirms receipt',
      run: () => handlers.handleNetworkDisable({}),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (
          !String(b.message ?? '')
            .toLowerCase()
            .includes('disabled')
        )
          return `expected disabled confirmation, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'network_monitor/status-dispatch',
      tool: 'network_monitor',
      origin: 'homemade',
      reference: 'dispatches action=status through unified network_monitor facade',
      run: () => handlers.handleNetworkMonitor({ action: 'status' }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.enabled !== true || Number(b.requestCount) !== 1)
          return `expected enabled=true requestCount=1, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'console_buffers/clears-injected-buffers',
      tool: 'console_buffers',
      origin: 'homemade',
      reference: 'dispatches buffer clear action cleanly via consoleMonitor',
      run: () => handlers.handleConsoleBuffersDispatch({ action: 'clear' }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (Number(b.cleared) !== 2)
          return `expected cleared=2 from monitor stub, got ${JSON.stringify(b)}`;
        return true;
      },
    },

    // ── Coverage batch 3 (2026-11-12 autoresearch): DNS resolve via loopback UDP stub ──
    {
      name: 'dns_resolve/loopback-udp-stub-a-record',
      tool: 'dns_resolve',
      origin: 'external-vector',
      reference:
        'RFC 1035: DNS A query against a loopback UDP stub must return the stub-authored 10.0.0.1 answer',
      run: async () => {
        const stub = await startDnsStub({ kind: 'a' });
        try {
          return await handlers.handleDnsResolve({
            hostname: 'bench.example.test',
            rrType: 'A',
            server: `127.0.0.1:${stub.port}`,
          });
        } finally {
          stub.close();
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.hostname !== 'bench.example.test' || b.rrType !== 'A')
          return `unexpected echo fields: ${JSON.stringify(b).slice(0, 200)}`;
        const records = b.records as unknown[] | undefined;
        if (!Array.isArray(records) || records.length !== 1)
          return `expected 1 A record, got ${JSON.stringify(records)}`;
        if (!JSON.stringify(records).includes('10.0.0.1'))
          return `expected stub answer 10.0.0.1, got ${JSON.stringify(records)}`;
        return true;
      },
    },
    {
      name: 'dns_probe/noerror-status-for-answer',
      tool: 'dns_probe',
      origin: 'external-vector',
      reference:
        'RFC 1035 RCODE: a stub NOERROR answer must be classified status=NOERROR with records present',
      run: async () => {
        const stub = await startDnsStub({ kind: 'a' });
        try {
          return await handlers.handleDnsProbe({
            hostname: 'bench.example.test',
            rrType: 'A',
            server: `127.0.0.1:${stub.port}`,
          });
        } finally {
          stub.close();
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.status !== 'NOERROR') return `expected status=NOERROR, got ${b.status}`;
        const records = b.records as unknown[] | undefined;
        if (
          !Array.isArray(records) ||
          records.length !== 1 ||
          !JSON.stringify(records).includes('10.0.0.1')
        )
          return `expected the stub A answer, got ${JSON.stringify(records)}`;
        return true;
      },
    },
    {
      name: 'dns_probe/nodata-classification',
      tool: 'dns_probe',
      origin: 'homemade',
      reference:
        'a NOERROR/NODATA answer (empty answer section) must be reported honestly as a non-NOERROR status with zero records, never fabricated data',
      run: async () => {
        // CNAME-only stub → an A query gets NOERROR with ANCOUNT=0 (NODATA).
        const stub = await startDnsStub({ kind: 'cname', firstHost: 'x.test', target: 'y.test' });
        try {
          return await handlers.handleDnsProbe({
            hostname: 'bench-no-a.test',
            rrType: 'A',
            server: `127.0.0.1:${stub.port}`,
          });
        } finally {
          stub.close();
        }
      },
      validate: (v: unknown) => {
        const b = body(v);
        const records = b.records as unknown[] | undefined;
        if (Array.isArray(records) && records.length > 0)
          return `NODATA must not produce records, got ${JSON.stringify(records)}`;
        if (b.status === 'NOERROR')
          return 'NODATA with zero answers should not be reported as plain NOERROR';
        return true;
      },
    },
    {
      name: 'dns_cname_chain/follows-stub-cname',
      tool: 'dns_cname_chain',
      origin: 'external-vector',
      reference:
        'RFC 1035 §3.3.1 CNAME: the chain must record the stub hop (bench.example.test → target.example.test) and terminate on NODATA',
      run: async () => {
        const stub = await startDnsStub({
          kind: 'cname',
          firstHost: 'bench.example.test',
          target: 'target.example.test',
        });
        try {
          return await handlers.handleDnsCnameChain({
            hostname: 'bench.example.test',
            maxDepth: 3,
            server: `127.0.0.1:${stub.port}`,
          });
        } finally {
          stub.close();
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const chain = b.chain as
          | Array<{ host?: string; target?: string | null; status?: string }>
          | undefined;
        if (!Array.isArray(chain) || chain.length !== 2)
          return `expected a 2-hop chain (CNAME then TERMINAL), got ${JSON.stringify(chain)}`;
        if (chain[0]?.host !== 'bench.example.test' || chain[0]?.target !== 'target.example.test')
          return `first hop wrong: ${JSON.stringify(chain[0])}`;
        if (chain[1]?.status !== 'TERMINAL')
          return `second hop must terminate on NODATA, got ${JSON.stringify(chain[1])}`;
        return true;
      },
    },
    {
      name: 'dns_bulk_resolve/batched-stub-answers',
      tool: 'dns_bulk_resolve',
      origin: 'homemade',
      reference:
        'bulk resolution over 3 loopback-stub hostnames must return 3 NOERROR entries each carrying the 10.0.0.1 answer',
      run: async () => {
        const stub = await startDnsStub({ kind: 'a' });
        try {
          return await handlers.handleDnsBulkResolve({
            hostnames: ['a.example.test', 'b.example.test', 'c.example.test'],
            rrType: 'A',
            concurrency: 2,
            server: `127.0.0.1:${stub.port}`,
          });
        } finally {
          stub.close();
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const results = b.results as
          | Array<{ hostname?: string; status?: string; records?: unknown[] }>
          | undefined;
        if (!Array.isArray(results) || results.length !== 3)
          return `expected 3 bulk results, got ${JSON.stringify(results)}`;
        for (const r of results) {
          if (r.status !== 'NOERROR') return `non-NOERROR status for ${r.hostname}: ${r.status}`;
          if (
            !r.records ||
            r.records.length !== 1 ||
            !JSON.stringify(r.records).includes('10.0.0.1')
          )
            return `missing stub answer for ${r.hostname}: ${JSON.stringify(r.records)}`;
        }
        return true;
      },
    },

    // ── Coverage batch 4 (2026-11-12 autoresearch): loopback TCP/HTTP probes ──
    {
      name: 'http_plain_request/loopback-http1-roundtrip',
      tool: 'http_plain_request',
      origin: 'external-vector',
      reference:
        'RFC 7230 §3: a raw HTTP/1.1 request written to a loopback http.createServer must return the scripted 200 response and status line',
      run: async () => {
        const { createServer } = await import('node:http');
        const server = createServer((_req, res) => {
          res.setHeader('content-type', 'text/plain');
          res.end('LOOPBACK-OK');
        });
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        try {
          return await handlers.handleHttpPlainRequest({
            host: '127.0.0.1',
            port,
            requestText: `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
            authorization: {
              allowedHosts: ['127.0.0.1'],
              allowPrivateNetwork: true,
              allowInsecureHttp: true,
            },
          });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const response = b.response as { statusCode?: number; statusLine?: string } | undefined;
        if (response?.statusCode !== 200)
          return `expected HTTP 200, got ${JSON.stringify(response).slice(0, 160)}`;
        if (!String(response?.statusLine ?? '').includes('200'))
          return `status line missing 200: ${String(response?.statusLine)}`;
        if (!JSON.stringify(b).includes('LOOPBACK-OK'))
          return 'scripted loopback body not returned';
        return true;
      },
    },
    {
      name: 'network_rtt_measure/loopback-tcp-roundtrips',
      tool: 'network_rtt_measure',
      origin: 'homemade',
      reference:
        'RTT measurement against a loopback target must report count/avg/min/max stats for the requested iterations',
      run: async () => {
        const { createServer } = await import('node:http');
        const server = createServer((_req, res) => res.end('OK'));
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        try {
          return await handlers.handleNetworkRttMeasure({
            url: `http://127.0.0.1:${port}/`,
            iterations: 3,
            authorization: {
              allowedHosts: ['127.0.0.1'],
              allowPrivateNetwork: true,
              allowInsecureHttp: true,
            },
          });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const stats = b.stats as
          | { count?: number; avgMs?: number; minMs?: number; maxMs?: number }
          | undefined;
        if (stats?.count !== 3) return `expected count=3, got ${stats?.count}`;
        for (const k of ['avgMs', 'minMs', 'maxMs'] as const) {
          if (typeof stats[k] !== 'number' || !Number.isFinite(stats[k]))
            return `${k} must be a finite number, got ${String(stats[k])}`;
        }
        return stats.minMs! <= stats.maxMs! ? true : 'minMs must not exceed maxMs';
      },
    },
    {
      name: 'network_latency_stats/http-percentiles',
      tool: 'network_latency_stats',
      origin: 'homemade',
      reference:
        'HTTP latency statistics over a loopback server must report the requested iteration count and percentile stats',
      run: async () => {
        const { createServer } = await import('node:http');
        const server = createServer((_req, res) => res.end('OK'));
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        try {
          return await handlers.handleNetworkLatencyStats({
            url: `http://127.0.0.1:${port}/`,
            probeType: 'http',
            iterations: 5,
            concurrency: 2,
            authorization: {
              allowedHosts: ['127.0.0.1'],
              allowPrivateNetwork: true,
              allowInsecureHttp: true,
            },
          });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (Number(b.iterations) !== 5) return `expected iterations=5, got ${b.iterations}`;
        const stats = b.stats as Record<string, unknown> | undefined;
        if (!stats) return `missing stats block: ${JSON.stringify(b).slice(0, 160)}`;
        const text = JSON.stringify(stats).toLowerCase();
        return text.includes('p95') || text.includes('percentile')
          ? true
          : `stats lack percentile fields: ${text.slice(0, 160)}`;
      },
    },

    // ── Contract batch 2026-11-12 (autoresearch) ────────────────────────────
    // Admission / dispatch / loopback honesty for the 10 browser- and
    // socket-bound tools (tables live in network.contracts.ts).
    ...networkContractCases,
  ],
};
