import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { streamingTools } from './definitions.js';

const t = toolLookup(streamingTools);

export const streamingRegistrations: readonly ToolRegistration[] = [
  { tool: t('ws_monitor_enable'), domain: 'streaming', bind: (d) => (a) => d.streamingHandlers.handleWsMonitorEnable(a) },
  { tool: t('ws_monitor_disable'), domain: 'streaming', bind: (d) => (a) => d.streamingHandlers.handleWsMonitorDisable(a) },
  { tool: t('ws_get_frames'), domain: 'streaming', bind: (d) => (a) => d.streamingHandlers.handleWsGetFrames(a) },
  { tool: t('ws_get_connections'), domain: 'streaming', bind: (d) => (a) => d.streamingHandlers.handleWsGetConnections(a) },
  { tool: t('sse_monitor_enable'), domain: 'streaming', bind: (d) => (a) => d.streamingHandlers.handleSseMonitorEnable(a) },
  { tool: t('sse_get_events'), domain: 'streaming', bind: (d) => (a) => d.streamingHandlers.handleSseGetEvents(a) },
];
