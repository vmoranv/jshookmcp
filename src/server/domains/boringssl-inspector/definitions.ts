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
