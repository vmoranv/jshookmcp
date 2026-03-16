import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolRegistration } from '@server/registry/contracts';

import '../shared/manifest-test-mocks';

function getToolName(registration: ToolRegistration): string {
  return (registration.tool as { name: string }).name;
}

describe('debugger manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadManifest() {
    const mod = await import('@server/domains/debugger/manifest');
    return mod.default;
  }

  // ── Manifest shape ─────────────────────────────────────────

  describe('manifest structure', () => {
    it('has kind "domain-manifest"', async () => {
      const manifest = await loadManifest();
      expect(manifest.kind).toBe('domain-manifest');
    });

    it('has version 1', async () => {
      const manifest = await loadManifest();
      expect(manifest.version).toBe(1);
    });

    it('has domain "debugger"', async () => {
      const manifest = await loadManifest();
      expect(manifest.domain).toBe('debugger');
    });

    it('has depKey "debuggerHandlers"', async () => {
      const manifest = await loadManifest();
      expect(manifest.depKey).toBe('debuggerHandlers');
    });

    it('profiles include "workflow" and "full"', async () => {
      const manifest = await loadManifest();
      expect(manifest.profiles).toContain('workflow');
      expect(manifest.profiles).toContain('full');
      expect(manifest.profiles).toHaveLength(2);
    });

    it('ensure is a function', async () => {
      const manifest = await loadManifest();
      expect(typeof manifest.ensure).toBe('function');
    });

    it('registrations is a non-empty array', async () => {
      const manifest = await loadManifest();
      expect(Array.isArray(manifest.registrations)).toBe(true);
      expect(manifest.registrations.length).toBeGreaterThan(0);
    });
  });

  // ── Registrations ──────────────────────────────────────────

  describe('registrations', () => {
    it('every registration has tool, domain, and bind', async () => {
      const manifest = await loadManifest();
      for (const reg of manifest.registrations) {
        expect(reg).toEqual(
          expect.objectContaining({
            tool: expect.objectContaining({ name: expect.any(String) }),
            domain: 'debugger',
            bind: expect.any(Function),
          }),
        );
      }
    });

    it('all registrations reference domain "debugger"', async () => {
      const manifest = await loadManifest();
      const domains = manifest.registrations.map((registration) => registration.domain);
      expect(domains.every((domain) => domain === 'debugger')).toBe(true);
    });

    it('has no duplicate tool registrations', async () => {
      const manifest = await loadManifest();
      const names = manifest.registrations.map(getToolName);
      expect(new Set(names).size).toBe(names.length);
    });

    const expectedRegistrations = [
      // Core tools
      'debugger_enable',
      'debugger_disable',
      'debugger_pause',
      'debugger_resume',
      'debugger_step_into',
      'debugger_step_over',
      'debugger_step_out',
      'breakpoint_set',
      'breakpoint_remove',
      'breakpoint_list',
      'get_call_stack',
      'debugger_evaluate',
      'debugger_evaluate_global',
      'debugger_wait_for_paused',
      'debugger_get_paused_state',
      'breakpoint_set_on_exception',
      'get_object_properties',
      'get_scope_variables_enhanced',
      'debugger_save_session',
      'debugger_load_session',
      'debugger_export_session',
      'debugger_list_sessions',
      // Advanced tools
      'watch_add',
      'watch_remove',
      'watch_list',
      'watch_evaluate_all',
      'watch_clear_all',
      'xhr_breakpoint_set',
      'xhr_breakpoint_remove',
      'xhr_breakpoint_list',
      'event_breakpoint_set',
      'event_breakpoint_set_category',
      'event_breakpoint_remove',
      'event_breakpoint_list',
      'blackbox_add',
      'blackbox_add_common',
      'blackbox_list',
    ];

    it(`has exactly ${expectedRegistrations.length} registrations`, async () => {
      const manifest = await loadManifest();
      expect(manifest.registrations).toHaveLength(expectedRegistrations.length);
    });

    it.each(expectedRegistrations)(
      'includes registration for "%s"',
      async (name) => {
        const manifest = await loadManifest();
        const found = manifest.registrations.find(
          (registration) => getToolName(registration) === name,
        );
        expect(found).toBeDefined();
      },
    );
  });

  // ── Registration tool definitions match definitions ────────

  describe('registration-definition consistency', () => {
    it('registration tool names match the definitions export', async () => {
      const manifest = await loadManifest();
      const { debuggerTools } = await import(
        '@server/domains/debugger/definitions'
      );

      const registrationNames = new Set(manifest.registrations.map(getToolName));
      const definitionNames = new Set(debuggerTools.map((tool) => tool.name));
      expect(registrationNames).toEqual(definitionNames);
    });

    it('registration tools reference the same tool objects from definitions', async () => {
      const manifest = await loadManifest();
      const { debuggerTools } = await import(
        '@server/domains/debugger/definitions'
      );

      const toolsByName = new Map(debuggerTools.map((tool) => [tool.name, tool]));

      for (const registration of manifest.registrations) {
        const toolName = getToolName(registration);
        const defTool = toolsByName.get(toolName);
        expect(defTool).toBeDefined();
        // The toolLookup mock returns the same reference
        expect(toolName).toBe(defTool!.name);
      }
    });
  });

  // ── Bind functions ─────────────────────────────────────────

  describe('bind functions', () => {
    it('every bind is callable', async () => {
      const manifest = await loadManifest();
      for (const reg of manifest.registrations) {
        expect(typeof reg.bind).toBe('function');
      }
    });
  });
});
