import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ALLOW_DANGEROUS_CAPABILITIES_ENV,
  areDangerousCapabilitiesAllowed,
  buildDangerousCapabilityDenyResponse,
  classifyDangerousCapability,
} from '@server/security/dangerousCapabilities';

describe('dangerous capability gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['nemu_bind_host_fn', 'arbitrary-js'],
    ['nemu_bind_all_imports', 'arbitrary-js'],
    ['nemu_set_vtable_slot', 'arbitrary-js'],
    ['extension_install', 'remote-code'],
    ['extension_reload', 'remote-code'],
    ['inject_dll', 'process-injection'],
    ['inject_shellcode', 'process-injection'],
  ] as const)('classifies %s as %s', (toolName, capability) => {
    expect(classifyDangerousCapability(toolName)).toBe(capability);
  });

  it('leaves ordinary tools ungated', () => {
    for (const name of [
      'nemu_read_memory',
      'nemu_mem_inspect',
      'extension_list_installed',
      'extension_uninstall',
      'process_find',
    ]) {
      expect(classifyDangerousCapability(name), name).toBeNull();
    }
  });

  it('is disabled unless the operator opts in', () => {
    vi.stubEnv(ALLOW_DANGEROUS_CAPABILITIES_ENV, '');
    expect(areDangerousCapabilitiesAllowed()).toBe(false);

    vi.stubEnv(ALLOW_DANGEROUS_CAPABILITIES_ENV, '1');
    expect(areDangerousCapabilitiesAllowed()).toBe(true);
  });

  it('denies with a permission tool error and an actionable remediation', () => {
    const response = buildDangerousCapabilityDenyResponse('nemu_bind_host_fn', 'arbitrary-js');
    expect(response.isError).toBe(true);

    const payload = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('PERMISSION');
    expect(payload.capability).toBe('arbitrary-js');
    expect(String(payload.remediation)).toContain(ALLOW_DANGEROUS_CAPABILITIES_ENV);
  });
});
