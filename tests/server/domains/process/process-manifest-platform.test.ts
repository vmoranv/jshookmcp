import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@server/domains/process/index', () => ({
  ProcessToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'ProcessToolHandlers' })),
}));

const WIN32_ONLY_TOOLS = new Set(['inject_dll', 'inject_shellcode', 'check_debug_port']);

const CROSS_PLATFORM_TOOLS = [
  'electron_attach',
  'process_find',
  'process_get',
  'process_windows',
  'process_find_chromium',
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
  'enumerate_modules',
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

    expect(manifest.registrations.length).toBe(21);
    for (const tool of CROSS_PLATFORM_TOOLS) {
      expect(registeredNames.has(tool), `Missing cross-platform tool: ${tool}`).toBe(true);
    }
  });

  it('should exclude Win32-only tools on linux override', async () => {
    const manifest = await loadManifestWithPlatform('linux');
    const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

    for (const tool of WIN32_ONLY_TOOLS) {
      expect(registeredNames.has(tool), `Win32-only tool present on linux override: ${tool}`).toBe(
        false,
      );
    }
  });

  it('should include Win32-only tools on win32 override', async () => {
    const manifest = await loadManifestWithPlatform('win32');
    const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

    expect(manifest.registrations.length).toBe(26);
    for (const tool of WIN32_ONLY_TOOLS) {
      expect(registeredNames.has(tool), `Missing Win32-only tool on win32 override: ${tool}`).toBe(
        true,
      );
    }
  });
});
