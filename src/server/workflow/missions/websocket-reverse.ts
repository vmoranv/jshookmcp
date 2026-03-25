import type { MissionWorkflow } from '../types';

export const websocketReverseMission: MissionWorkflow = {
  id: 'websocket-reverse',
  name: 'WebSocket 逆向 / WebSocket Reverse',
  description:
    'Capture, decode, and replay WebSocket messages to understand real-time communication protocols.',
  triggerPatterns: [
    /websocket\s*(reverse|逆向|intercept|capture|decode)/i,
    /(ws|wss)\s*(message|消息|拦截|抓包)/i,
    /(逆向|分析).*(websocket|ws)/i,
  ],
  requiredDomains: ['network', 'hooks', 'encoding'],
  priority: 90,
  steps: [
    {
      id: 'connect',
      toolName: 'network_enable',
      description: 'Enable network capture before reproducing the WebSocket flow',
      prerequisites: [],
      evidenceNodeType: 'request',
    },
    {
      id: 'intercept',
      toolName: 'network_get_requests',
      description:
        'Inspect captured handshake and frame-related requests to locate the WebSocket channel',
      prerequisites: ['connect'],
      evidenceNodeType: 'captured-data',
    },
    {
      id: 'decode',
      toolName: 'binary_decode',
      description: 'Decode binary or encoded payload fragments extracted from the WebSocket flow',
      prerequisites: ['intercept'],
      parallel: true,
      evidenceNodeType: 'captured-data',
    },
    {
      id: 'replay',
      toolName: 'network_replay_request',
      description: 'Replay a captured request from the WebSocket flow to test protocol behavior',
      prerequisites: ['decode'],
      evidenceNodeType: 'replay-artifact',
    },
  ],
};
