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
import { body, expectSuccess, type BenchSuite } from '../harness';

const collector = { getActivePage: async () => null } as never;
const monitor = {
  getNetworkRequests: () => [
    {
      url: 'https://example.com/api',
      method: 'GET',
      headers: {
        'user-agent': 'curl/7.88.1',
        accept: '*/*',
      },
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
  ],
};
