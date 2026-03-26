import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const streamingTools: Tool[] = [
  tool('ws_monitor_enable')
    .desc('Enable WebSocket frame capture via CDP Network events')
    .string('urlFilter', 'Regex filter for WebSocket URL')
    .number('maxFrames', 'Maximum frames in memory', { default: 1000 })
    .build(),

  tool('ws_monitor_disable')
    .desc('Disable WebSocket monitoring and return capture summary')
    .destructive()
    .build(),

  tool('ws_get_frames')
    .desc('Get captured WebSocket frames with pagination and payload filter')
    .enum('direction', ['sent', 'received', 'all'], 'Frame direction filter', { default: 'all' })
    .number('limit', 'Maximum frames to return', { default: 100 })
    .number('offset', 'Pagination offset', { default: 0 })
    .string('payloadFilter', 'Regex filter on frame payload')
    .readOnly()
    .build(),

  tool('ws_get_connections')
    .desc('Get tracked WebSocket connections and frame counts')
    .readOnly()
    .build(),

  tool('sse_monitor_enable')
    .desc('Enable SSE monitoring by injecting EventSource interceptor')
    .string('urlFilter', 'Regex filter for EventSource URL')
    .number('maxEvents', 'Maximum SSE events in memory', { default: 2000 })
    .boolean('persistent', 'Survive page navigations via evaluateOnNewDocument')
    .build(),

  tool('sse_get_events')
    .desc('Get captured SSE events with filters and pagination')
    .string('sourceUrl', 'Filter by EventSource URL')
    .string('eventType', 'Filter by SSE event type')
    .number('limit', 'Maximum events', { default: 100 })
    .number('offset', 'Pagination offset', { default: 0 })
    .readOnly()
    .build(),
];
