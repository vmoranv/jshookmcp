import type { Tool } from '@modelcontextprotocol/server';
import { objectTool } from './support';

export const rawSocketTools: Tool[] = [
  objectTool(
    'net_raw_tcp_send',
    'Send raw TCP data to a remote host; accepts hex or text input.',
    {
      host: { type: 'string', default: '127.0.0.1', description: 'Target host address' },
      port: { type: 'number', description: 'Target port number (1-65535)' },
      dataHex: { type: 'string', description: 'Hex-encoded data to send' },
      dataText: { type: 'string', description: 'Text data to send (alternative to dataHex)' },
      timeout: { type: 'number', default: 5000, description: 'Connection timeout in ms' },
    },
    ['port'],
  ),
  objectTool(
    'net_raw_tcp_listen',
    'Listen on a local TCP port for one incoming connection.',
    {
      port: { type: 'number', description: 'Local port to listen on (1-65535)' },
      timeout: { type: 'number', default: 10000, description: 'Listen timeout in ms' },
    },
    ['port'],
  ),
  objectTool(
    'net_raw_udp_send',
    'Send a raw UDP datagram and wait for a response.',
    {
      host: { type: 'string', default: '127.0.0.1', description: 'Target host address' },
      port: { type: 'number', description: 'Target port number (1-65535)' },
      dataHex: { type: 'string', description: 'Hex-encoded data to send' },
      dataText: { type: 'string', description: 'Text data to send (alternative to dataHex)' },
      timeout: { type: 'number', default: 5000, description: 'Response timeout in ms' },
    },
    ['port'],
  ),
  objectTool(
    'net_raw_udp_listen',
    'Listen on a local UDP port for an incoming datagram.',
    {
      port: { type: 'number', description: 'Local port to listen on (1-65535)' },
      timeout: { type: 'number', default: 10000, description: 'Listen timeout in ms' },
    },
    ['port'],
  ),
];
