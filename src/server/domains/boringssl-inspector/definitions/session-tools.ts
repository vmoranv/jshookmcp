import type { Tool } from '@modelcontextprotocol/server';
import { objectTool, TLS_VERSION_VALUES } from './support';

export const sessionTools: Tool[] = [
  objectTool(
    'tcp_open',
    'Open a TCP session.',
    {
      host: {
        type: 'string',
        default: '127.0.0.1',
        description: 'Target host name or IP address',
      },
      port: {
        type: 'number',
        description: 'Target TCP port',
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
    ['port'],
  ),
  objectTool(
    'tcp_write',
    'Write data to an open TCP session.',
    {
      sessionId: {
        type: 'string',
        description: 'TCP session ID',
      },
      dataHex: {
        type: 'string',
        description: 'Hex-encoded payload to write',
      },
      dataText: {
        type: 'string',
        description: 'UTF-8 text payload to write',
      },
      timeoutMs: {
        type: 'number',
        default: 5000,
        description: 'Write timeout in milliseconds',
      },
    },
    ['sessionId'],
  ),
  objectTool(
    'tcp_read_until',
    'Read from an open TCP session until a delimiter or byte limit is reached.',
    {
      sessionId: {
        type: 'string',
        description: 'TCP session ID',
      },
      delimiterHex: {
        type: 'string',
        description: 'Hex-encoded delimiter to stop at',
      },
      delimiterText: {
        type: 'string',
        description: 'UTF-8 delimiter to stop at',
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
    ['sessionId'],
  ),
  objectTool(
    'tcp_close',
    'Close an open TCP session.',
    {
      sessionId: {
        type: 'string',
        description: 'TCP session ID',
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
    ['sessionId'],
  ),
  objectTool(
    'tls_open',
    'Open a TLS session.',
    {
      host: {
        type: 'string',
        description: 'Target host name or IP address',
      },
      port: {
        type: 'number',
        default: 443,
        description: 'Target TLS port',
      },
      servername: {
        type: 'string',
        description: 'Optional SNI and hostname validation override',
      },
      alpnProtocols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional ALPN protocols to offer',
      },
      timeoutMs: {
        type: 'number',
        default: 5000,
        description: 'Connection timeout in milliseconds',
      },
      minVersion: {
        type: 'string',
        enum: [...TLS_VERSION_VALUES],
        description: 'Optional minimum TLS version',
      },
      maxVersion: {
        type: 'string',
        enum: [...TLS_VERSION_VALUES],
        description: 'Optional maximum TLS version',
      },
      caPem: {
        type: 'string',
        description: 'Optional PEM-encoded CA bundle',
      },
      caPath: {
        type: 'string',
        description: 'Optional path to a PEM-encoded CA bundle',
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
    ['host'],
  ),
  objectTool(
    'tls_write',
    'Write data to an open TLS session.',
    {
      sessionId: {
        type: 'string',
        description: 'TLS session ID',
      },
      dataHex: {
        type: 'string',
        description: 'Hex-encoded payload to write',
      },
      dataText: {
        type: 'string',
        description: 'UTF-8 text payload to write',
      },
      timeoutMs: {
        type: 'number',
        default: 5000,
        description: 'Write timeout in milliseconds',
      },
    },
    ['sessionId'],
  ),
  objectTool(
    'tls_read_until',
    'Read from an open TLS session until a delimiter or byte limit is reached.',
    {
      sessionId: {
        type: 'string',
        description: 'TLS session ID',
      },
      delimiterHex: {
        type: 'string',
        description: 'Hex-encoded delimiter to stop at',
      },
      delimiterText: {
        type: 'string',
        description: 'UTF-8 delimiter to stop at',
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
    ['sessionId'],
  ),
  objectTool(
    'tls_close',
    'Close an open TLS session.',
    {
      sessionId: {
        type: 'string',
        description: 'TLS session ID',
      },
      force: {
        type: 'boolean',
        default: false,
        description: 'Destroy the TLS socket immediately instead of sending close_notify/FIN first',
      },
      timeoutMs: {
        type: 'number',
        default: 1000,
        description: 'Close wait timeout in milliseconds before forcing socket destruction',
      },
    },
    ['sessionId'],
  ),
];
