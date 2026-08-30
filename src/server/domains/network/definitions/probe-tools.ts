import type { Tool } from '@modelcontextprotocol/server';
import { networkAuthorizationSchema } from '@server/domains/network/authorization-schema';
import { tool } from '@server/registry/tool-builder';

export const probeTools: Tool[] = [
  tool('network_traceroute', (t) =>
    t
      .desc('Run an ICMP traceroute.')
      .string('target', 'Target hostname or IP address to trace route to')
      .number('maxHops', 'Maximum number of hops', {
        default: 30,
        minimum: 1,
        maximum: 64,
      })
      .number('timeout', 'Per-hop timeout in milliseconds', {
        default: 5000,
        minimum: 100,
        maximum: 30000,
      })
      .number('packetSize', 'ICMP echo request payload size in bytes', {
        default: 32,
        minimum: 8,
        maximum: 65500,
      })
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network traceroute. Use exact hosts/CIDRs ' +
          'instead of process-wide bypasses.',
      )
      .required('target')
      .query(),
  ),
  tool('network_icmp_probe', (t) =>
    t
      .desc('Run an ICMP echo probe.')
      .string('target', 'Target hostname or IP address to probe')
      .number('ttl', 'Time-to-live value', {
        default: 128,
        minimum: 1,
        maximum: 255,
      })
      .number('packetSize', 'ICMP echo request payload size in bytes', {
        default: 32,
        minimum: 8,
        maximum: 65500,
      })
      .number('timeout', 'Timeout in milliseconds', {
        default: 5000,
        minimum: 100,
        maximum: 30000,
      })
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network ICMP probes. Use exact hosts/CIDRs ' +
          'instead of process-wide bypasses.',
      )
      .required('target')
      .query(),
  ),
];
