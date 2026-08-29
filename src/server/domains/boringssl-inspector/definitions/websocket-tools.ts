import type { Tool } from '@modelcontextprotocol/server';
import { objectTool, TLS_VERSION_VALUES } from './support';

export const websocketTools: Tool[] = [
  objectTool('websocket_open', 'Open a WebSocket session.', {
    url: {
      type: 'string',
      description: 'WebSocket URL',
    },
    scheme: {
      type: 'string',
      enum: ['ws', 'wss'],
      default: 'ws',
      description: 'WebSocket transport scheme',
    },
    host: {
      type: 'string',
      description: 'Target host name or IP address',
    },
    port: {
      type: 'number',
      description: 'Target port',
    },
    path: {
      type: 'string',
      default: '/',
      description: 'Request path',
    },
    subprotocols: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional subprotocols to offer',
    },
    timeoutMs: {
      type: 'number',
      default: 5000,
      description: 'Handshake timeout in milliseconds',
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
      description: 'Allow untrusted certificate chains',
    },
    skipHostnameCheck: {
      type: 'boolean',
      default: false,
      description: 'Skip hostname verification',
    },
  }),
  objectTool(
    'websocket_send_frame',
    'Send a WebSocket frame.',
    {
      sessionId: {
        type: 'string',
        description: 'WebSocket session ID',
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
        description: 'Optional close status code',
      },
      closeReason: {
        type: 'string',
        description: 'Optional close reason',
      },
      timeoutMs: {
        type: 'number',
        default: 5000,
        description: 'Write timeout in milliseconds',
      },
    },
    ['sessionId', 'frameType'],
  ),
  objectTool(
    'websocket_read_frame',
    'Read the next queued WebSocket frame from an open session.',
    {
      sessionId: {
        type: 'string',
        description: 'WebSocket session ID',
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
    'websocket_close',
    'Close an open WebSocket session.',
    {
      sessionId: {
        type: 'string',
        description: 'WebSocket session ID',
      },
      force: {
        type: 'boolean',
        default: false,
        description:
          'Destroy the underlying socket immediately without sending a close frame first',
      },
      closeCode: {
        type: 'number',
        description: 'Optional close status code',
      },
      closeReason: {
        type: 'string',
        description: 'Optional close reason',
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
