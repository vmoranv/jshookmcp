import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probeView8Availability: vi.fn().mockResolvedValue({
    available: false,
    reason: 'view8 missing',
  }),
  getElectronIPCSniffRuntimeCapability: vi.fn().mockReturnValue({
    available: true,
  }),
}));

vi.mock('@server/domains/platform/handlers/v8-bytecode-handler', () => ({
  probeView8Availability: mocks.probeView8Availability,
}));

vi.mock('@server/domains/platform/handlers/electron-ipc-sniffer', () => ({
  getElectronIPCSniffRuntimeCapability: mocks.getElectronIPCSniffRuntimeCapability,
}));

import { handlePlatformCapabilities } from '@server/domains/platform/handlers/capabilities';

describe('handlePlatformCapabilities', () => {
  it('reports external and fallback backend states', async () => {
    const runner = {
      probeAll: vi.fn().mockResolvedValue({
        'miniapp.unpacker': {
          available: false,
          reason: 'unveilr missing',
        },
      }),
    };

    const result = await handlePlatformCapabilities(runner as any);
    const parsed = JSON.parse(result.content[0]!.text!);
    const capabilityNames = parsed.capabilities.map(
      (entry: { capability: string }) => entry.capability,
    );

    expect(parsed.tool).toBe('platform_capabilities');
    expect(capabilityNames).toContain('miniapp_unpacker');
    expect(capabilityNames).toContain('view8');
    expect(capabilityNames).toContain('electron_ipc_sniff_runtime');
  });
});
