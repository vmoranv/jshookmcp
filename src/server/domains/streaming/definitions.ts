import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const streamingTools: Tool[] = [
  {
    name: 'ws_monitor_enable',
    description:
      'Enable WebSocket frame capture via CDP Network events (webSocketFrameSent / webSocketFrameReceived).',
    inputSchema: {
      type: 'object',
      properties: {
        urlFilter: {
          type: 'string',
          description: 'Optional regex filter for WebSocket URL (only matching connections are tracked).',
        },
        maxFrames: {
          type: 'number',
          description: 'Maximum frames to keep in memory (default: 1000).',
          default: 1000,
        },
      },
    },
  },
  {
    name: 'ws_monitor_disable',
    description: 'Disable WebSocket monitoring and return capture summary.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ws_get_frames',
    description:
      'Get captured WebSocket frames with pagination and optional payload regex filter.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['sent', 'received', 'all'],
          description: 'Frame direction filter (default: all).',
          default: 'all',
        },
        limit: {
          type: 'number',
          description: 'Maximum frames to return (default: 100, max: 5000).',
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0).',
          default: 0,
        },
        payloadFilter: {
          type: 'string',
          description: 'Optional regex filter applied to frame payload sample.',
        },
      },
    },
  },
  {
    name: 'ws_get_connections',
    description: 'Get tracked WebSocket connections and frame counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sse_monitor_enable',
    description:
      'Enable SSE monitoring by injecting an EventSource constructor interceptor in page context.',
    inputSchema: {
      type: 'object',
      properties: {
        urlFilter: {
          type: 'string',
          description: 'Optional regex filter for EventSource URL.',
        },
        maxEvents: {
          type: 'number',
          description: 'Maximum SSE events to keep in memory (default: 2000).',
          default: 2000,
        },
      },
    },
  },
  {
    name: 'sse_get_events',
    description: 'Get captured SSE events with filters and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceUrl: {
          type: 'string',
          description: 'Filter by EventSource URL (exact match).',
        },
        eventType: {
          type: 'string',
          description: 'Filter by SSE event type (e.g. "message", custom event name).',
        },
        limit: {
          type: 'number',
          description: 'Maximum events to return (default: 100, max: 5000).',
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0).',
          default: 0,
        },
      },
    },
  },
];
