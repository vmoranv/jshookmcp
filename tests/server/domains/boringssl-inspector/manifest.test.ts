import manifest from '@server/domains/boringssl-inspector/manifest';
import { describe, expect, it } from 'vitest';

describe('BoringSSL Inspector Domain Manifest', () => {
  it('registers tls_probe_endpoint', () => {
    const toolNames = manifest.registrations.map((registration) => registration.tool.name);
    expect(toolNames).toContain('tls_probe_endpoint');
  });

  it('registers the atomic tcp/tls session tools', () => {
    const toolNames = manifest.registrations.map((registration) => registration.tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'tcp_open',
        'tcp_write',
        'tcp_read_until',
        'tcp_close',
        'tls_open',
        'tls_write',
        'tls_read_until',
        'tls_close',
      ]),
    );
  });

  it('registers the atomic websocket session tools', () => {
    const toolNames = manifest.registrations.map((registration) => registration.tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'websocket_open',
        'websocket_send_frame',
        'websocket_read_frame',
        'websocket_close',
      ]),
    );
  });

  it('registers the atomic websocket session tools', () => {
    const toolNames = manifest.registrations.map((registration) => registration.tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'websocket_open',
        'websocket_send_frame',
        'websocket_read_frame',
        'websocket_close',
      ]),
    );
  });

  it('keeps a callable binding for tls_probe_endpoint', () => {
    const registration = manifest.registrations.find(
      (entry) => entry.tool.name === 'tls_probe_endpoint',
    );
    expect(registration).toBeDefined();
    expect(registration?.domain).toBe('boringssl-inspector');
    expect(registration?.bind).toBeDefined();
  });

  it('caches the ensured handler instance on the context', () => {
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

    const first = manifest.ensure(ctx as never);
    const second = manifest.ensure(ctx as never);

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});
