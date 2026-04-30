import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { networkAuthorizationSchema } from '@server/domains/network/authorization-schema';
import { tool } from '@server/registry/tool-builder';

export const transportTools: Tool[] = [
  tool('http_request_build', (t) =>
    t
      .desc(
        'Build a raw HTTP/1.x request payload with CRLF line endings. Useful for preparing deterministic request text for http_plain_request or other raw socket tools.',
      )
      .string('method', 'HTTP method token, e.g. GET, POST, HEAD')
      .string('target', 'Request target, such as /path, *, or an absolute-form URL')
      .string('host', 'Optional Host header value to inject when addHostHeader is enabled')
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Optional HTTP headers to include in the request',
      )
      .string('body', 'Optional UTF-8 request body')
      .enum('httpVersion', ['1.0', '1.1'], 'HTTP protocol version to emit. Default: 1.1', {
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
      .desc(
        'Send a raw HTTP request over plain TCP using deterministic server-side logic with DNS pinning, response parsing, and bounded capture. Non-loopback HTTP targets require explicit request-scoped authorization.',
      )
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
        'Request-scoped authorization policy for private-network or insecure-HTTP targets. Use exact hosts/CIDRs instead of process-wide bypasses.',
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
      .desc(
        'Probe an HTTP/2 endpoint using Node http2 with deterministic DNS pinning and bounded response capture. Reports the negotiated protocol, ALPN result, response headers, status, and a response body snippet. Non-loopback plaintext h2c targets require explicit request-scoped authorization.',
      )
      .string('url', 'Absolute http:// or https:// URL to probe')
      .string('method', 'HTTP method token to send. Default: GET')
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Optional request headers to include. Header names are normalized to lowercase for HTTP/2.',
      )
      .string('body', 'Optional UTF-8 request body to send with the probe')
      .array(
        'alpnProtocols',
        { type: 'string' },
        'Optional ALPN preference list for TLS probes. Default: ["h2", "http/1.1"].',
      )
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP targets. Use exact hosts/CIDRs instead of process-wide bypasses.',
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
      .desc(
        'Build a raw HTTP/2 binary frame of any supported type (DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW). Returns the 9-byte frame header and full frame as hex strings, ready to send over a tcp_write or tls_write channel for protocol-level fuzzing and injection.',
      )
      .string(
        'frameType',
        'HTTP/2 frame type: DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW',
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
  tool('network_rtt_measure', (t) =>
    t
      .desc(
        'Measure round-trip time (RTT) to a target URL using TCP, TLS, or HTTP probes. Returns per-sample latencies and aggregate statistics (min/max/mean/median/p95).',
      )
      .string('url', 'Target URL to measure RTT to')
      .string('probeType', 'Probe type: tcp, tls, or http. Default: tcp', { default: 'tcp' })
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
        { additionalProperties: { type: 'string' } },
        'Authorization policy for network access',
      )
      .requiredOpenWorld('url'),
  ),
];
