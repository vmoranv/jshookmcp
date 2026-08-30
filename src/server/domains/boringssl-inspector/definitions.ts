import type { Tool } from '@modelcontextprotocol/server';
import { fridaTools } from './definitions/frida-tools';
import { rawSocketTools } from './definitions/raw-socket-tools';
import { sessionTools } from './definitions/session-tools';
import { tlsAnalysisTools } from './definitions/tls-analysis-tools';
import { websocketTools } from './definitions/websocket-tools';

export const boringsslInspectorTools: Tool[] = [
  ...tlsAnalysisTools,
  ...sessionTools,
  ...websocketTools,
  ...fridaTools,
  ...rawSocketTools,
];
