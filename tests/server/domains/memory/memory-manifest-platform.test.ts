/**
 * Memory manifest platform filtering — unit tests.
 *
 * Verifies that Win32-only tools are correctly filtered on macOS
 * and all cross-platform tools are present.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock all native dependencies that manifest imports at module level
vi.mock('@native/MemoryScanner', () => ({ memoryScanner: {} }));
vi.mock('@native/MemoryScanSession', () => ({ scanSessionManager: {} }));
vi.mock('@native/PointerChainEngine', () => ({ pointerChainEngine: {} }));
vi.mock('@native/StructureAnalyzer', () => ({ structureAnalyzer: {} }));
vi.mock('@native/CodeInjector', () => ({ codeInjector: {} }));
vi.mock('@native/MemoryController', () => ({ memoryController: {} }));
// Win32-only engines — may not be importable on macOS
vi.mock('@native/HardwareBreakpoint', () => ({ hardwareBreakpointEngine: {} }));
vi.mock('@native/Speedhack', () => ({ speedhack: {} }));
vi.mock('@native/HeapAnalyzer', () => ({ heapAnalyzer: {} }));
vi.mock('@native/PEAnalyzer', () => ({ peAnalyzer: {} }));
vi.mock('@native/AntiCheatDetector', () => ({ antiCheatDetector: {} }));

const IS_WIN32 = process.platform === 'win32';

// Win32-only tools that should be absent on macOS
const WIN32_ONLY_TOOLS = new Set([
  'memory_heap_enumerate',
  'memory_heap_stats',
  'memory_heap_anomalies',
  'memory_pe_headers',
  'memory_pe_imports_exports',
  'memory_inline_hook_detect',
  'memory_anticheat_detect',
  'memory_guard_pages',
  'memory_integrity_check',
  'memory_breakpoint_set',
  'memory_breakpoint_remove',
  'memory_breakpoint_list',
  'memory_breakpoint_trace',
  'memory_speedhack_apply',
  'memory_speedhack_set',
]);

// Cross-platform tools that should always be present
const CROSS_PLATFORM_TOOLS = [
  'memory_first_scan',
  'memory_next_scan',
  'memory_unknown_scan',
  'memory_pointer_scan',
  'memory_group_scan',
  'memory_scan_list',
  'memory_scan_delete',
  'memory_scan_export',
  'memory_pointer_chain_scan',
  'memory_pointer_chain_validate',
  'memory_pointer_chain_resolve',
  'memory_pointer_chain_export',
  'memory_structure_analyze',
  'memory_vtable_parse',
  'memory_structure_export_c',
  'memory_structure_compare',
  'memory_patch_bytes',
  'memory_patch_nop',
  'memory_patch_undo',
  'memory_code_caves',
  'memory_write_value',
  'memory_freeze',
  'memory_unfreeze',
  'memory_dump',
  'memory_write_undo',
  'memory_write_redo',
];

describe('memory manifest platform filtering', () => {
  it('should dynamically import manifest', async () => {
    const mod = await import('@server/domains/memory/manifest');
    expect(mod.default).toBeDefined();
    expect(mod.default.kind).toBe('domain-manifest');
    expect(mod.default.domain).toBe('memory');
  });

  it(`should have ${IS_WIN32 ? 41 : 26} tools on ${process.platform}`, async () => {
    const { default: manifest } = await import('@server/domains/memory/manifest');
    const expected = IS_WIN32 ? 41 : 26;
    expect(manifest.registrations.length).toBe(expected);
  });

  it('should always include cross-platform tools', async () => {
    const { default: manifest } = await import('@server/domains/memory/manifest');
    const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

    for (const tool of CROSS_PLATFORM_TOOLS) {
      expect(registeredNames.has(tool), `Missing cross-platform tool: ${tool}`).toBe(true);
    }
  });

  if (!IS_WIN32) {
    it('should exclude Win32-only tools on macOS', async () => {
      const { default: manifest } = await import('@server/domains/memory/manifest');
      const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

      for (const tool of WIN32_ONLY_TOOLS) {
        expect(registeredNames.has(tool), `Win32-only tool present on macOS: ${tool}`).toBe(false);
      }
    });

    it('should not include Win32-only tools in workflowRule.tools', async () => {
      const { default: manifest } = await import('@server/domains/memory/manifest');
      const workflowTools = manifest.workflowRule?.tools ?? [];

      for (const tool of workflowTools) {
        expect(WIN32_ONLY_TOOLS.has(tool), `Win32-only tool in workflowRule: ${tool}`).toBe(false);
      }
    });
  }

  if (IS_WIN32) {
    it('should include all Win32-only tools on Windows', async () => {
      const { default: manifest } = await import('@server/domains/memory/manifest');
      const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

      for (const tool of WIN32_ONLY_TOOLS) {
        expect(registeredNames.has(tool), `Missing Win32-only tool on Windows: ${tool}`).toBe(true);
      }
    });
  }
});
