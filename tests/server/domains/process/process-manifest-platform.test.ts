import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@server/domains/process/index', () => ({
  ProcessToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'ProcessToolHandlers' })),
}));

const CROSS_PLATFORM_TOOLS = [
  'electron_attach',
  'process_list',
  'process_find',
  'process_get',
  'process_windows',
  'process_check_debug_port',
  'process_launch_debug',
  'process_kill',
  'memory_read',
  'memory_write',
  'memory_scan',
  'memory_check_protection',
  'memory_scan_filtered',
  'memory_batch_write',
  'memory_dump_region',
  'memory_list_regions',
  'memory_audit_export',
  'inject_dll',
  'inject_shellcode',
  'enumerate_modules',
  'check_debug_port',
];

async function loadManifestWithPlatform(platform?: 'win32' | 'linux' | 'darwin') {
  vi.resetModules();
  if (platform) {
    process.env.JSHOOK_REGISTRY_PLATFORM = platform;
  } else {
    delete process.env.JSHOOK_REGISTRY_PLATFORM;
  }

  const mod = await import('@server/domains/process/manifest');
  return mod.default;
}

afterEach(() => {
  delete process.env.JSHOOK_REGISTRY_PLATFORM;
});

describe('process manifest platform filtering', () => {
  it('should dynamically import manifest', async () => {
    const manifest = await loadManifestWithPlatform();
    expect(manifest).toBeDefined();
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.domain).toBe('process');
  });

  it('should include cross-platform tools on linux override', async () => {
    const manifest = await loadManifestWithPlatform('linux');
    const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

    expect(manifest.registrations.length).toBe(20);
    for (const tool of CROSS_PLATFORM_TOOLS) {
      if (tool === 'inject_dll' || tool === 'inject_shellcode' || tool === 'check_debug_port') {
        continue;
      }
      expect(registeredNames.has(tool), `Missing cross-platform tool: ${tool}`).toBe(true);
    }
    expect(registeredNames.has('check_debug_port')).toBe(false);
  });
});
