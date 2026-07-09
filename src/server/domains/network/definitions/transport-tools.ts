import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { networkAuthorizationSchema } from '@server/domains/network/authorization-schema';
import { tool } from '@server/registry/tool-builder';

export const transportTools: Tool[] = [
  tool('http_request_build', (t) =>
    t
      .desc('Build a raw HTTP/1.x request payload.')
      .string('method', 'HTTP method token')
      .string('target', 'Request target, such as /path, *, or an absolute-form URL')
      .string('host', 'Optional Host header value to inject when addHostHeader is enabled')
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Optional HTTP headers to include in the request',
      )
      .string('body', 'Optional UTF-8 request body')
      .enum('httpVersion', ['1.0', '1.1'], 'HTTP protocol version to emit', {
        default: '1.1',
      })
      .boolean('addHostHeader', 'Auto-add the Host header when host is provided', {
        default: true,
      })
      .boolean(
        'addContentLength',
        'Auto-add Content-Length when a body is present and Transfer-Encoding is absent',
        { default: true },
      )
      .boolean('addConnectionClose', 'Auto-add Connection: close when absent', {
        default: true,
      })
      .requiredOpenWorld('method', 'target'),
  ),
  tool('http_plain_request', (t) =>
    t
      .desc('Send a raw HTTP request over plain TCP.')
      .string('host', 'Target hostname or IP literal')
      .number('port', 'TCP port to connect to. Default: 80', {
        default: 80,
        minimum: 1,
        maximum: 65535,
      })
      .string('requestText', 'Raw HTTP request text to send as UTF-8 bytes')
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP targets. Use exact hosts/CIDRs ' +
          'instead of process-wide bypasses.',
      )
      .number('timeoutMs', 'Socket timeout in milliseconds', {
        default: 30000,
        minimum: 1000,
        maximum: 120000,
      })
      .number(
        'maxResponseBytes',
        'Maximum number of raw response bytes to capture before truncating the exchange',
        { default: 512000, minimum: 1024, maximum: 10485760 },
      )
      .requiredOpenWorld('host', 'requestText'),
  ),
  tool('http2_probe', (t) =>
    t
      .desc('Probe an HTTP/2 endpoint.')
      .string('url', 'Absolute http:// or https:// URL to probe')
      .string('method', 'HTTP method token to send. Default: GET')
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Optional request headers to include. Header names are normalized to lowercase for HTTP/2.',
      )
      .string('body', 'Optional UTF-8 request body to send with the probe')
      .array('alpnProtocols', { type: 'string' }, 'ALPN protocols to offer')
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP targets. Use exact hosts/CIDRs ' +
          'instead of process-wide bypasses.',
      )
      .number('timeoutMs', 'Probe timeout in milliseconds', {
        default: 30000,
        minimum: 1000,
        maximum: 120000,
      })
      .number(
        'maxBodyBytes',
        'Maximum number of response body bytes to capture for the snippet before truncating',
        { default: 32768, minimum: 1024, maximum: 1048576 },
      )
      .requiredOpenWorld('url'),
  ),
  tool('http2_frame_build', (t) =>
    t
      .desc('Build a raw HTTP/2 frame.')
      .string(
        'frameType',
        'HTTP/2 frame type: DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, PUSH_PROMISE, or RAW',
      )
      .number('streamId', 'Stream identifier (0 for connection-level frames). Default: 0', {
        default: 0,
        minimum: 0,
        maximum: 2147483647,
      })
      .number('flags', 'Raw flags byte (0-255). Overrides type-specific defaults when set.', {
        minimum: 0,
        maximum: 255,
      })
      .number(
        'frameTypeCode',
        'Explicit frame type code for RAW frames (0-255). Required when frameType is RAW.',
        { minimum: 0, maximum: 255 },
      )
      .string('payloadHex', 'Frame payload as a hex string. Mutually exclusive with payloadText.')
      .string('payloadText', 'Frame payload as a text string. Mutually exclusive with payloadHex.')
      .string('payloadEncoding', 'Encoding for payloadText: utf8 or ascii. Default: utf8')
      .array(
        'settings',
        {
          type: 'object',
          properties: { id: { type: 'number' }, value: { type: 'number' } },
          required: ['id', 'value'],
        },
        'Array of {id, value} entries for SETTINGS frames',
      )
      .boolean('ack', 'Set the ACK flag on SETTINGS or PING frames')
      .string('pingOpaqueDataHex', 'Exactly 8 bytes of opaque data for PING frames (hex string)')
      .number('windowSizeIncrement', 'Window size increment for WINDOW_UPDATE frames (1 to 2^31-1)')
      .number('errorCode', 'Error code for RST_STREAM or GOAWAY frames (0 to 2^32-1)')
      .number('lastStreamId', 'Last stream ID for GOAWAY frames (0 to 2^31-1)')
      .string('debugDataText', 'Optional debug data for GOAWAY frames')
      .string('debugDataEncoding', 'Encoding for debugDataText: utf8 or ascii. Default: utf8')
      .requiredOpenWorld('frameType'),
  ),
  tool('http2_frame_parse', (t) =>
    t
      .desc(
        'Decode a raw HTTP/2 frame (hex string) back into its header fields and ' +
          'type-specific payload (SETTINGS entries, PING opaque data, WINDOW_UPDATE increment, ' +
          'RST_STREAM/GOAWAY error codes, GOAWAY debug data). Inverse of http2_frame_build. ' +
          'Lenient: malformed payloads set decodeError but still return payloadHex.',
      )
      .string(
        'frameHex',
        'HTTP/2 frame as a hex string (9-byte header + payload). Whitespace tolerated.',
      )
      .requiredOpenWorld('frameHex'),
  ),
  tool('network_http2_fingerprint', (t) =>
    t
      .desc(
        'Compute an Akamai-style HTTP/2 fingerprint from one or more captured HTTP/2 frames ' +
          '(the client connection preface: SETTINGS + stream-0 WINDOW_UPDATE + any PRIORITY frames). ' +
          'Returns the canonical "<settings>|<window_update>|<priority>" string, a sha256 hash, ' +
          'and the structured fields (settings entries, window update increment, priorities). ' +
          'Ships NO hardcoded feature library — the structured fields are authoritative; the caller ' +
          'decides what is "bad". Pair with network_tls_fingerprint for full client identity.',
      )
      .string(
        'framesHex',
        'One or more concatenated HTTP/2 frames as a hex string. The 24-byte connection ' +
          'preface magic ("PRI * HTTP/2.0...") is auto-detected and skipped if present. ' +
          'Whitespace tolerated.',
      )
      .requiredOpenWorld('framesHex'),
  ),
  tool('grpc_frame_parse', (t) =>
    t
      .desc(
        'Split a captured gRPC / gRPC-Web body into its length-prefixed messages. Each message ' +
          'is 1 compressed-flag byte + 4-byte big-endian length + payload. Detects gRPC-Web ' +
          'trailer frames (flag bit 7) and the compression flag (bit 0). Lenient: a truncated ' +
          'trailing message is still emitted with a warning. Each message exposes payloadHex and ' +
          'payloadBase64 — feed payloadBase64 directly to protobuf_decode_raw to complete the ' +
          'gRPC decode chain (capture body -> grpc_frame_parse -> protobuf_decode_raw).',
      )
      .string('data', 'gRPC body as hex (default) or base64. Whitespace tolerated.')
      .string(
        'encoding',
        'Input encoding: hex (default) or base64. Use base64 for CDP response bodies.',
      )
      .requiredOpenWorld('data'),
  ),
  tool('grpc_frame_build', (t) =>
    t
      .desc(
        'Encode one or more messages into a gRPC / gRPC-Web length-prefixed body. Inverse of ' +
          'grpc_frame_parse — for constructing test or replay bodies. Each message takes ' +
          'payloadHex plus optional compressed / isTrailer flags.',
      )
      .array(
        'messages',
        {
          type: 'object',
          properties: {
            payloadHex: { type: 'string' },
            compressed: { type: 'number' },
            isTrailer: { type: 'number' },
          },
          required: ['payloadHex'],
        },
        'Array of { payloadHex, compressed?, isTrailer? }',
      )
      .requiredOpenWorld('messages'),
  ),
  tool('dns_resolve', (t) =>
    t
      .desc(
        'Resolve a hostname to DNS records using the system resolver or an optional DNS server.',
      )
      .string('hostname', 'Hostname to resolve (e.g. google.com)')
      .string('rrType', 'DNS record type: A, AAAA, MX, TXT, NS, CNAME, SOA, PTR, SRV, or ANY', {
        default: 'A',
      })
      .string('server', 'Optional DNS resolver server, for example 1.1.1.1 or 8.8.8.8')
      .requiredOpenWorld('hostname'),
  ),
  tool('dns_reverse', (t) =>
    t
      .desc('Reverse DNS lookup — find hostnames for an IP address.')
      .string('ip', 'IP address to reverse lookup (e.g. 8.8.8.8)')
      .string('server', 'Optional DNS resolver server, for example 1.1.1.1 or 8.8.8.8')
      .requiredOpenWorld('ip'),
  ),
  tool('dns_probe', (t) =>
    t
      .desc('Run a DNS query and return structured status instead of throwing.')
      .string('hostname', 'Hostname to query')
      .string('rrType', 'DNS record type: A, AAAA, MX, TXT, NS, CNAME, SOA, PTR, SRV, or ANY', {
        default: 'A',
      })
      .string('server', 'Optional DNS resolver server, for example 1.1.1.1 or 8.8.8.8')
      .requiredOpenWorld('hostname'),
  ),
  tool('dns_cname_chain', (t) =>
    t
      .desc('Trace the full CNAME chain for a hostname.')
      .string('hostname', 'Hostname to trace CNAME chain for')
      .number('maxDepth', 'Maximum chain depth to follow. Default: 10', {
        default: 10,
        minimum: 1,
        maximum: 30,
      })
      .string('server', 'Optional DNS resolver server, for example 1.1.1.1 or 8.8.8.8')
      .requiredOpenWorld('hostname'),
  ),
  tool('dns_bulk_resolve', (t) =>
    t
      .desc('Resolve many hostnames concurrently with per-host status.')
      .array('hostnames', { type: 'string' }, 'List of hostnames to resolve (max 1000)')
      .string('rrType', 'DNS record type: A, AAAA, MX, TXT, NS, CNAME, SOA, PTR, SRV, or ANY', {
        default: 'A',
      })
      .number('concurrency', 'Maximum number of concurrent DNS queries. Default: 10', {
        default: 10,
        minimum: 1,
        maximum: 50,
      })
      .string('server', 'Optional DNS resolver server, for example 1.1.1.1 or 8.8.8.8')
      .requiredOpenWorld('hostnames'),
  ),
  tool('network_rtt_measure', (t) =>
    t
      .desc('Measure round-trip time to a target URL.')
      .string('url', 'Target URL to measure RTT to')
      .enum('probeType', ['tcp', 'tls', 'http'], 'Probe type', { default: 'tcp' })
      .number('iterations', 'Number of probe iterations (1-50). Default: 5', {
        default: 5,
        minimum: 1,
        maximum: 50,
      })
      .number('timeoutMs', 'Per-probe timeout in milliseconds (100-30000). Default: 5000', {
        default: 5000,
        minimum: 100,
        maximum: 30000,
      })
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP measurement. Use exact hosts/CIDRs ' +
          'instead of process-wide bypasses.',
      )
      .requiredOpenWorld('url'),
  ),
  tool('network_latency_stats', (t) =>
    t
      .desc('Measure repeated latency and compute percentile stats.')
      .string('url', 'Target URL to measure')
      .enum('probeType', ['tcp', 'tls', 'http'], 'Probe type', { default: 'http' })
      .number('iterations', 'Number of probes', { default: 20, minimum: 5, maximum: 100 })
      .number('concurrency', 'Max concurrent probes', { default: 5, minimum: 1, maximum: 20 })
      .number('timeoutMs', 'Per-probe timeout ms', { default: 5000, minimum: 100, maximum: 30000 })
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP measurement. Use exact hosts/CIDRs ' +
          'instead of process-wide bypasses.',
      )
      .requiredOpenWorld('url'),
  ),
];
