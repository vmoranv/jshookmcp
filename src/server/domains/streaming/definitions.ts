import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const streamingTools: Tool[] = [
  tool('ws_monitor', (t) =>
    t
      .desc('Enable or disable WebSocket frame capture.')
      .enum('action', ['enable', 'disable'], 'Monitor action')
      .string('urlFilter', 'Regex filter for WebSocket URL (action=enable)')
      .number('maxFrames', 'Maximum frames in memory (action=enable, default: 1000)', {
        default: 1000,
        minimum: 1,
        maximum: 20000,
      })
      .required('action')
      .destructive(),
  ),
  tool('ws_get_frames', (t) =>
    t
      .desc('Get captured WebSocket frames with pagination and payload filter.')
      .enum('direction', ['sent', 'received', 'all'], 'Frame direction filter', { default: 'all' })
      .number('limit', 'Maximum frames to return', { default: 100, minimum: 1, maximum: 10000 })
      .number('offset', 'Pagination offset', { default: 0, minimum: 0 })
      .string('payloadFilter', 'Regex filter on frame payload')
      .boolean('fullPayload', 'Include the full captured payload for each returned frame', {
        default: false,
      })
      .readOnly(),
  ),
  tool('ws_get_connections', (t) =>
    t.desc('Get tracked WebSocket connections, frame counts, and timing metadata.').readOnly(),
  ),
  tool('ws_export_capture', (t) =>
    t
      .desc('Export captured WebSocket frames to artifacts/captures as JSON or NDJSON.')
      .enum('format', ['json', 'ndjson'], 'Export file format', { default: 'json' })
      .enum('direction', ['sent', 'received', 'all'], 'Frame direction filter', { default: 'all' })
      .string('payloadFilter', 'Regex filter on frame payload')
      .boolean('includePayload', 'Include full captured payloads in the artifact', {
        default: true,
      })
      .openWorld(),
  ),
  tool('sse_monitor_enable', (t) =>
    t
      .desc('Enable SSE monitoring by injecting EventSource interceptor.')
      .string('urlFilter', 'Regex filter for EventSource URL')
      .number('maxEvents', 'Maximum SSE events in memory', {
        default: 2000,
        minimum: 1,
        maximum: 50000,
      })
      .boolean('persistent', 'Survive page navigations via evaluateOnNewDocument'),
  ),
  tool('sse_get_events', (t) =>
    t
      .desc('Get captured SSE events with filters and pagination.')
      .string('sourceUrl', 'Filter by EventSource URL')
      .string('eventType', 'Filter by SSE event type')
      .number('limit', 'Maximum events', { default: 100, minimum: 1, maximum: 10000 })
      .number('offset', 'Pagination offset', { default: 0, minimum: 0 })
      .boolean('fullData', 'Include full captured SSE event data when available', {
        default: false,
      })
      .readOnly(),
  ),
  tool('sse_export_capture', (t) =>
    t
      .desc('Export captured SSE events to artifacts/captures as JSON or NDJSON.')
      .enum('format', ['json', 'ndjson'], 'Export file format', { default: 'json' })
      .string('sourceUrl', 'Filter by EventSource URL')
      .string('eventType', 'Filter by SSE event type')
      .boolean('includeData', 'Include full captured event data in the artifact', {
        default: true,
      })
      .openWorld(),
  ),
  tool('grpc_monitor', (t) =>
    t
      .desc(
        'Enable or disable live capture of gRPC / gRPC-Web calls. gRPC calls are ' +
          'detected by content-type application/grpc(-web)?(+proto)? on the HTTP/2 response. ' +
          'On loadingFinished the response body is pulled (base64) and split into length-prefixed ' +
          'messages; feed each message payloadBase64 to protobuf_decode_raw to complete the decode ' +
          'chain. Must be enabled before navigating so requests are captured from the start.',
      )
      .enum('action', ['enable', 'disable'], 'Monitor action')
      .string('urlFilter', 'Regex filter for the gRPC request URL (action=enable)')
      .number('maxCalls', 'Maximum captured gRPC calls in memory (action=enable, default: 100)', {
        default: 100,
        minimum: 1,
        maximum: 5000,
      })
      .required('action')
      .destructive(),
  ),
  tool('grpc_get_calls', (t) =>
    t
      .desc(
        'Get captured gRPC / gRPC-Web calls with parsed message summaries. Set fullMessages=true ' +
          'to include the parsed message arrays (each carries payloadBase64 — feed to ' +
          'protobuf_decode_raw). Without fullMessages only per-call counts and flags are returned.',
      )
      .string('urlFilter', 'Regex filter on the gRPC request URL')
      .number('limit', 'Maximum calls to return', { default: 50, minimum: 1, maximum: 1000 })
      .number('offset', 'Pagination offset', { default: 0, minimum: 0 })
      .boolean('fullMessages', 'Include parsed message arrays (payloads) for each call', {
        default: false,
      })
      .readOnly(),
  ),
  tool('fetch_stream_monitor', (t) =>
    t
      .desc(
        'Enable or disable capture of fetch()-based streams. Wraps window.fetch and, for ' +
          'responses with content-type text/event-stream, clones the body and parses the SSE ' +
          'frame stream into events. Covers the LLM / GraphQL-subscription streaming that the ' +
          'EventSource-based sse_monitor_enable misses (fetch + POST + custom headers). Use ' +
          'fetch_stream_get_events to read captured events.',
      )
      .enum('action', ['enable', 'disable'], 'Monitor action', { default: 'enable' })
      .string('urlFilter', 'Regex filter for the fetched stream URL')
      .number('maxEvents', 'Maximum events in memory (default: 2000)', {
        default: 2000,
        minimum: 1,
        maximum: 50000,
      })
      .boolean('persistent', 'Survive page navigations via evaluateOnNewDocument')
      .openWorld(),
  ),
  tool('fetch_stream_get_events', (t) =>
    t
      .desc(
        'Get events captured by the fetch()-based stream monitor (text/event-stream consumed ' +
          'via fetch). Set fullData=true to include full event data.',
      )
      .string('sourceUrl', 'Filter by the fetched stream URL')
      .string('eventType', 'Filter by SSE event type')
      .number('limit', 'Maximum events', { default: 100, minimum: 1, maximum: 5000 })
      .number('offset', 'Pagination offset', { default: 0, minimum: 0 })
      .boolean('fullData', 'Include full captured event data when available', { default: false })
      .readOnly(),
  ),
];
