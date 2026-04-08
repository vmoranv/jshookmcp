import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const emptyProperties: Record<string, object> = {};
const keyLogPathProperties: Record<string, object> = {
  path: {
    type: 'string',
  },
};
const certPinBypassProperties: Record<string, object> = {
  target: {
    type: 'string',
    enum: ['android', 'ios', 'desktop'],
  },
};
const handshakeParseProperties: Record<string, object> = {
  hexPayload: {
    type: 'string',
  },
};
const rawHexProperties: Record<string, object> = {
  rawHex: {
    type: 'string',
  },
};
const cipherSuitesProperties: Record<string, object> = {
  filter: {
    type: 'string',
  },
};

export const boringsslInspectorTools: Tool[] = [
  {
    name: 'tls_keylog_enable',
    description: 'Enable SSLKEYLOGFILE output for BoringSSL-compatible clients.',
    inputSchema: {
      type: 'object',
      properties: emptyProperties,
      required: [],
    },
  },
  {
    name: 'tls_keylog_parse',
    description: 'Parse an SSLKEYLOGFILE and summarize available key material.',
    inputSchema: {
      type: 'object',
      properties: keyLogPathProperties,
      required: [],
    },
  },
  {
    name: 'tls_cert_pin_bypass',
    description: 'Return a mock certificate pinning bypass strategy for the selected platform.',
    inputSchema: {
      type: 'object',
      properties: certPinBypassProperties,
      required: ['target'],
    },
  },
  {
    name: 'tls_handshake_parse',
    description: 'Parse a TLS record header and basic handshake metadata from a hex payload.',
    inputSchema: {
      type: 'object',
      properties: handshakeParseProperties,
      required: ['hexPayload'],
    },
  },
  {
    name: 'tls_parse_handshake',
    description:
      'Parse TLS handshake metadata (version, cipher suites, SNI, extensions) from raw hex.',
    inputSchema: {
      type: 'object',
      properties: rawHexProperties,
      required: ['rawHex'],
    },
  },
  {
    name: 'tls_cipher_suites',
    description: 'List IANA TLS cipher suites, optionally filtered by keyword.',
    inputSchema: {
      type: 'object',
      properties: cipherSuitesProperties,
      required: [],
    },
  },
  {
    name: 'tls_parse_certificate',
    description: 'Parse a TLS Certificate message from raw hex and extract fingerprints.',
    inputSchema: {
      type: 'object',
      properties: rawHexProperties,
      required: ['rawHex'],
    },
  },
  {
    name: 'tls_cert_pin_bypass_frida',
    description:
      'Bypass certificate pinning via Frida injection (supports BoringSSL, Chrome, OkHttp).',
    inputSchema: {
      type: 'object',
      properties: emptyProperties,
      required: [],
    },
  },
];
