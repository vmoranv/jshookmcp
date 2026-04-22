import manifest from '@server/domains/protocol-analysis/manifest';
import { describe, expect, it } from 'vitest';

describe('Protocol Analysis Domain Manifest', () => {
  it('registers payload, packet, and pcap atomic tools', async () => {
    const toolNames = manifest.registrations.map((registration) => registration.tool.name);
    expect(toolNames).toContain('payload_template_build');
    expect(toolNames).toContain('payload_mutate');
    expect(toolNames).toContain('ethernet_frame_build');
    expect(toolNames).toContain('arp_build');
    expect(toolNames).toContain('raw_ip_packet_build');
    expect(toolNames).toContain('icmp_echo_build');
    expect(toolNames).toContain('checksum_apply');
    expect(toolNames).toContain('pcap_write');
    expect(toolNames).toContain('pcap_read');
  });

  it('keeps callable bindings for all atomic tools', async () => {
    const expectedTools = [
      'payload_template_build',
      'payload_mutate',
      'ethernet_frame_build',
      'arp_build',
      'raw_ip_packet_build',
      'icmp_echo_build',
      'checksum_apply',
      'pcap_write',
      'pcap_read',
    ];

    for (const toolName of expectedTools) {
      const registration = manifest.registrations.find((entry) => entry.tool.name === toolName);
      expect(registration?.domain).toBe('protocol-analysis');
      expect(registration?.bind).toBeDefined();
    }
  });

  it('caches the ensured handler instance on the context', async () => {
    const instances = new Map<string, unknown>();
    const ctx = {
      eventBus: {},
      getDomainInstance<T>(key: string): T | undefined {
        return instances.get(key) as T | undefined;
      },
      setDomainInstance(key: string, value: unknown): void {
        instances.set(key, value);
      },
    };

    const first = await manifest.ensure(ctx as never);
    const second = await manifest.ensure(ctx as never);

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});
