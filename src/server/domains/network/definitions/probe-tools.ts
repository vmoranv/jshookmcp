import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const probeTools: Tool[] = [
  tool('network_traceroute', (t) =>
    t
      .desc(
        'ICMP traceroute with per-hop RTT and error classification. Windows: no admin required. Linux/macOS: requires root or CAP_NET_RAW.',
      )
      .string('target', 'Target IP address to trace route to')
      .number('maxHops', 'Maximum number of hops (1-64). Default: 30', {
        default: 30,
        minimum: 1,
        maximum: 64,
      })
      .number('timeout', 'Per-hop timeout in milliseconds (100-30000). Default: 5000', {
        default: 5000,
        minimum: 100,
        maximum: 30000,
      })
      .number('packetSize', 'ICMP echo request payload size in bytes (8-65500). Default: 32', {
        default: 32,
        minimum: 8,
        maximum: 65500,
      })
      .required('target')
      .query(),
  ),
  tool('network_icmp_probe', (t) =>
    t
      .desc(
        'ICMP echo probe with TTL control and error classification. Windows: no admin required. Linux/macOS: requires root or CAP_NET_RAW.',
      )
      .string('target', 'Target IP address to probe')
      .number('ttl', 'Time-to-live value (1-255). Default: 128', {
        default: 128,
        minimum: 1,
        maximum: 255,
      })
      .number('packetSize', 'ICMP echo request payload size in bytes (8-65500). Default: 32', {
        default: 32,
        minimum: 8,
        maximum: 65500,
      })
      .number('timeout', 'Timeout in milliseconds (100-30000). Default: 5000', {
        default: 5000,
        minimum: 100,
        maximum: 30000,
      })
      .required('target')
      .query(),
  ),
];
