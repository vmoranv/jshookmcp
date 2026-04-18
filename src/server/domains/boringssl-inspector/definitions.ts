import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const boringsslInspectorTools: Tool[] = [
  {
    name: 'tls_keylog_enable',
    description: 'Enable SSLKEYLOGFILE output for BoringSSL-compatible clients.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'tls_keylog_parse',
    description: 'Parse an SSLKEYLOGFILE and summarize available key material.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to SSLKEYLOGFILE (uses default if omitted)',
        },
      },
      required: [],
    },
  },
  {
    name: 'tls_keylog_disable',
    description: 'Disable SSLKEYLOGFILE capture and unset the environment variable.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Specific path to disable (uses current path if omitted)',
        },
      },
      required: [],
    },
  },
  {
    name: 'tls_decrypt_payload',
    description: 'Decrypt a TLS payload using a provided key, nonce, and algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        encryptedHex: {
          type: 'string',
          description: 'Hex-encoded encrypted payload',
        },
        keyHex: {
          type: 'string',
          description: 'Hex-encoded decryption key',
        },
        nonceHex: {
          type: 'string',
          description: 'Hex-encoded nonce/IV',
        },
        algorithm: {
          type: 'string',
          description: 'Cipher algorithm (default: aes-256-gcm)',
          default: 'aes-256-gcm',
        },
        authTagHex: {
          type: 'string',
          description: 'Hex-encoded authentication tag (for AEAD ciphers)',
        },
      },
      required: ['encryptedHex', 'keyHex', 'nonceHex'],
    },
  },
  {
    name: 'tls_keylog_summarize',
    description: 'Summarize the contents of an SSLKEYLOGFILE by label distribution.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Inline keylog content to summarize (uses file if omitted)',
        },
      },
      required: [],
    },
  },
  {
    name: 'tls_keylog_lookup_secret',
    description: 'Look up a TLS secret by client random hex from the parsed keylog.',
    inputSchema: {
      type: 'object',
      properties: {
        clientRandom: {
          type: 'string',
          description: 'Hex-encoded client random',
        },
        label: {
          type: 'string',
          description: 'Optional label filter (e.g. CLIENT_RANDOM)',
        },
      },
      required: ['clientRandom'],
    },
  },
  {
    name: 'tls_cert_pin_bypass',
    description: 'Return a certificate pinning bypass strategy for the selected platform.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['android', 'ios', 'desktop'],
          description: 'Target platform for bypass strategy',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'tls_handshake_parse',
    description: 'Parse a TLS record header and basic handshake metadata from a hex payload.',
    inputSchema: {
      type: 'object',
      properties: {
        hexPayload: {
          type: 'string',
          description: 'Hex-encoded TLS record',
        },
      },
      required: ['hexPayload'],
    },
  },
  {
    name: 'tls_parse_handshake',
    description:
      'Parse TLS handshake metadata (version, cipher suites, SNI, extensions) from raw hex.',
    inputSchema: {
      type: 'object',
      properties: {
        rawHex: {
          type: 'string',
          description: 'Hex-encoded TLS handshake record',
        },
      },
      required: ['rawHex'],
    },
  },
  {
    name: 'tls_cipher_suites',
    description: 'List IANA TLS cipher suites, optionally filtered by keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Keyword filter for cipher suite names',
        },
      },
      required: [],
    },
  },
  {
    name: 'tls_parse_certificate',
    description: 'Parse a TLS Certificate message from raw hex and extract fingerprints.',
    inputSchema: {
      type: 'object',
      properties: {
        rawHex: {
          type: 'string',
          description: 'Hex-encoded certificate data',
        },
      },
      required: ['rawHex'],
    },
  },
  {
    name: 'tls_probe_endpoint',
    description:
      'Connect to a TLS endpoint and report certificate chain basics, trust result, ALPN, protocol, cipher, and SNI/hostname validation details for authorized target testing.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Target host name or IP address',
        },
        port: {
          type: 'number',
          default: 443,
          description: 'Target TLS port (default: 443)',
        },
        servername: {
          type: 'string',
          description: 'Optional SNI and hostname validation override',
        },
        alpnProtocols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional ALPN protocols to offer, in preference order',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Probe timeout in milliseconds',
        },
        minVersion: {
          type: 'string',
          enum: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
          description: 'Optional minimum TLS version',
        },
        maxVersion: {
          type: 'string',
          enum: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
          description: 'Optional maximum TLS version',
        },
        caPem: {
          type: 'string',
          description: 'Optional PEM-encoded CA bundle used for trust evaluation',
        },
        caPath: {
          type: 'string',
          description: 'Optional path to a PEM-encoded CA bundle used for trust evaluation',
        },
        allowInvalidCertificates: {
          type: 'boolean',
          default: false,
          description: 'Allow untrusted certificate chains while still reporting the failure',
        },
        skipHostnameCheck: {
          type: 'boolean',
          default: false,
          description: 'Skip hostname verification while still reporting the requested target',
        },
      },
      required: ['host'],
    },
  },
  {
    name: 'tcp_open',
    description:
      'Open a stateful TCP session and return a sessionId for follow-up read/write calls.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          default: '127.0.0.1',
          description: 'Target host name or IP address',
        },
        port: {
          type: 'number',
          description: 'Target TCP port (1-65535)',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Connection timeout in milliseconds',
        },
        noDelay: {
          type: 'boolean',
          default: true,
          description: 'Enable TCP_NODELAY on the socket after connect',
        },
      },
      required: ['port'],
    },
  },
  {
    name: 'tcp_write',
    description: 'Write raw bytes to an open TCP session; accepts hex or UTF-8 text input.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by tcp_open',
        },
        dataHex: {
          type: 'string',
          description: 'Hex-encoded payload to write',
        },
        dataText: {
          type: 'string',
          description: 'UTF-8 text payload to write (alternative to dataHex)',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Write timeout in milliseconds',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'tcp_read_until',
    description:
      'Read from an open TCP session until a delimiter is observed or a byte limit is reached.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by tcp_open',
        },
        delimiterHex: {
          type: 'string',
          description: 'Hex-encoded delimiter to stop at',
        },
        delimiterText: {
          type: 'string',
          description: 'UTF-8 delimiter to stop at (alternative to delimiterHex)',
        },
        includeDelimiter: {
          type: 'boolean',
          default: true,
          description: 'Include the delimiter bytes in the returned payload',
        },
        maxBytes: {
          type: 'number',
          description: 'Optional maximum number of bytes to return even if no delimiter matches',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Read timeout in milliseconds',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'tcp_close',
    description: 'Close an open TCP session and release its buffered state.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by tcp_open',
        },
        force: {
          type: 'boolean',
          default: false,
          description: 'Destroy the socket immediately instead of sending FIN first',
        },
        timeoutMs: {
          type: 'number',
          default: 1000,
          description: 'Close wait timeout in milliseconds before forcing socket destruction',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'tls_open',
    description:
      'Open a stateful TLS session with explicit trust and hostname policy controls, then return a sessionId.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Target host name or IP address',
        },
        port: {
          type: 'number',
          default: 443,
          description: 'Target TLS port (default: 443)',
        },
        servername: {
          type: 'string',
          description: 'Optional SNI and hostname validation override',
        },
        alpnProtocols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional ALPN protocols to offer, in preference order',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Connection timeout in milliseconds',
        },
        minVersion: {
          type: 'string',
          enum: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
          description: 'Optional minimum TLS version',
        },
        maxVersion: {
          type: 'string',
          enum: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
          description: 'Optional maximum TLS version',
        },
        caPem: {
          type: 'string',
          description: 'Optional PEM-encoded CA bundle used for trust evaluation',
        },
        caPath: {
          type: 'string',
          description: 'Optional path to a PEM-encoded CA bundle used for trust evaluation',
        },
        allowInvalidCertificates: {
          type: 'boolean',
          default: false,
          description: 'Allow untrusted certificate chains while still reporting the failure',
        },
        skipHostnameCheck: {
          type: 'boolean',
          default: false,
          description: 'Skip hostname verification while still reporting the requested target',
        },
      },
      required: ['host'],
    },
  },
  {
    name: 'tls_write',
    description: 'Write raw bytes to an open TLS session; accepts hex or UTF-8 text input.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by tls_open',
        },
        dataHex: {
          type: 'string',
          description: 'Hex-encoded payload to write',
        },
        dataText: {
          type: 'string',
          description: 'UTF-8 text payload to write (alternative to dataHex)',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Write timeout in milliseconds',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'tls_read_until',
    description:
      'Read from an open TLS session until a delimiter is observed or a byte limit is reached.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by tls_open',
        },
        delimiterHex: {
          type: 'string',
          description: 'Hex-encoded delimiter to stop at',
        },
        delimiterText: {
          type: 'string',
          description: 'UTF-8 delimiter to stop at (alternative to delimiterHex)',
        },
        includeDelimiter: {
          type: 'boolean',
          default: true,
          description: 'Include the delimiter bytes in the returned payload',
        },
        maxBytes: {
          type: 'number',
          description: 'Optional maximum number of bytes to return even if no delimiter matches',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Read timeout in milliseconds',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'tls_close',
    description: 'Close an open TLS session and release its buffered state.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by tls_open',
        },
        force: {
          type: 'boolean',
          default: false,
          description:
            'Destroy the TLS socket immediately instead of sending close_notify/FIN first',
        },
        timeoutMs: {
          type: 'number',
          default: 1000,
          description: 'Close wait timeout in milliseconds before forcing socket destruction',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'websocket_open',
    description:
      'Open a stateful WebSocket session over ws or wss, perform the client handshake, and return a sessionId.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Full ws:// or wss:// URL (mutually exclusive with explicit host/path fields)',
        },
        scheme: {
          type: 'string',
          enum: ['ws', 'wss'],
          default: 'ws',
          description: 'WebSocket transport scheme when url is not provided',
        },
        host: {
          type: 'string',
          description: 'Target host name or IP address when url is not provided',
        },
        port: {
          type: 'number',
          description: 'Target port (defaults to 80 for ws, 443 for wss)',
        },
        path: {
          type: 'string',
          default: '/',
          description: 'Request path including optional query string when url is not provided',
        },
        subprotocols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional Sec-WebSocket-Protocol values to offer',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Handshake timeout in milliseconds',
        },
        servername: {
          type: 'string',
          description: 'Optional SNI and hostname validation override for wss sessions',
        },
        alpnProtocols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional ALPN protocols to offer for wss sessions',
        },
        minVersion: {
          type: 'string',
          enum: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
          description: 'Optional minimum TLS version for wss sessions',
        },
        maxVersion: {
          type: 'string',
          enum: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
          description: 'Optional maximum TLS version for wss sessions',
        },
        caPem: {
          type: 'string',
          description: 'Optional PEM-encoded CA bundle for wss trust evaluation',
        },
        caPath: {
          type: 'string',
          description: 'Optional path to a PEM-encoded CA bundle for wss trust evaluation',
        },
        allowInvalidCertificates: {
          type: 'boolean',
          default: false,
          description:
            'Allow untrusted certificate chains for wss while still reporting the failure',
        },
        skipHostnameCheck: {
          type: 'boolean',
          default: false,
          description:
            'Skip hostname verification for wss while still reporting the requested target',
        },
      },
      required: [],
    },
  },
  {
    name: 'websocket_send_frame',
    description:
      'Send a single WebSocket frame on an open session using a minimal opcode set (text, binary, ping, pong, close).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by websocket_open',
        },
        frameType: {
          type: 'string',
          enum: ['text', 'binary', 'ping', 'pong', 'close'],
          description: 'Outgoing frame opcode',
        },
        dataText: {
          type: 'string',
          description: 'UTF-8 payload for text/ping/pong/close frames',
        },
        dataHex: {
          type: 'string',
          description: 'Hex-encoded payload for binary/ping/pong/close frames',
        },
        closeCode: {
          type: 'number',
          description: 'Optional close status code when frameType is close',
        },
        closeReason: {
          type: 'string',
          description: 'Optional UTF-8 close reason when frameType is close',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Write timeout in milliseconds',
        },
      },
      required: ['sessionId', 'frameType'],
    },
  },
  {
    name: 'websocket_read_frame',
    description: 'Read the next queued WebSocket frame from an open session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by websocket_open',
        },
        timeoutMs: {
          type: 'number',
          default: 5000,
          description: 'Read timeout in milliseconds',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'websocket_close',
    description: 'Close an open WebSocket session and release its queued frame state.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id returned by websocket_open',
        },
        force: {
          type: 'boolean',
          default: false,
          description:
            'Destroy the underlying socket immediately without sending a close frame first',
        },
        closeCode: {
          type: 'number',
          description: 'Optional close status code when force is false',
        },
        closeReason: {
          type: 'string',
          description: 'Optional UTF-8 close reason when force is false',
        },
        timeoutMs: {
          type: 'number',
          default: 1000,
          description: 'Close wait timeout in milliseconds before forcing socket destruction',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'tls_cert_pin_bypass_frida',
    description:
      'Bypass certificate pinning via Frida injection (supports BoringSSL, Chrome, OkHttp).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'net_raw_tcp_send',
    description: 'Send raw TCP data to a remote host; accepts hex or text input.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', default: '127.0.0.1', description: 'Target host address' },
        port: { type: 'number', description: 'Target port number (1-65535)' },
        dataHex: { type: 'string', description: 'Hex-encoded data to send' },
        dataText: { type: 'string', description: 'Text data to send (alternative to dataHex)' },
        timeout: { type: 'number', default: 5000, description: 'Connection timeout in ms' },
      },
      required: ['port'],
    },
  },
  {
    name: 'net_raw_tcp_listen',
    description: 'Listen on a local TCP port for one incoming connection.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Local port to listen on (1-65535)' },
        timeout: { type: 'number', default: 10000, description: 'Listen timeout in ms' },
      },
      required: ['port'],
    },
  },
  {
    name: 'net_raw_udp_send',
    description: 'Send a raw UDP datagram and wait for a response.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', default: '127.0.0.1', description: 'Target host address' },
        port: { type: 'number', description: 'Target port number (1-65535)' },
        dataHex: { type: 'string', description: 'Hex-encoded data to send' },
        dataText: { type: 'string', description: 'Text data to send (alternative to dataHex)' },
        timeout: { type: 'number', default: 5000, description: 'Response timeout in ms' },
      },
      required: ['port'],
    },
  },
  {
    name: 'net_raw_udp_listen',
    description: 'Listen on a local UDP port for an incoming datagram.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Local port to listen on (1-65535)' },
        timeout: { type: 'number', default: 10000, description: 'Listen timeout in ms' },
      },
      required: ['port'],
    },
  },
  {
    name: 'net_raw_tcp_scan',
    description: 'Scan a TCP port range on a host for open ports.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', default: '127.0.0.1', description: 'Target host address' },
        startPort: { type: 'number', default: 1, description: 'Start of port range' },
        endPort: { type: 'number', default: 1024, description: 'End of port range' },
        timeout: { type: 'number', default: 1000, description: 'Per-port timeout in ms' },
      },
      required: [],
    },
  },
];
