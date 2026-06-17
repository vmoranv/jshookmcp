/**
 * CRIT-07: Test for missing process_find/get/kill/list tool registrations
 * This test should FAIL before the fix and PASS after.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { processToolDefinitions } from '@server/domains/process/definitions';
import manifest from '@server/domains/process/manifest';

describe('CRIT-07: Missing process tool registrations', () => {
  let mockContext: MCPServerContext;
  let handlers: Awaited<ReturnType<typeof manifest.ensure>>;

  beforeEach(async () => {
    mockContext = {} as MCPServerContext;
    handlers = await manifest.ensure(mockContext);
  });

  describe('Tool definitions', () => {
    it('should define process_find', () => {
      const tool = processToolDefinitions.find((t) => t.name === 'process_find');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('process_find');
      expect(tool?.inputSchema.required).toContain('pattern');
    });

    it('should define process_get', () => {
      const tool = processToolDefinitions.find((t) => t.name === 'process_get');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('process_get');
      expect(tool?.inputSchema.required).toContain('pid');
    });

    it('should define process_kill', () => {
      const tool = processToolDefinitions.find((t) => t.name === 'process_kill');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('process_kill');
      expect(tool?.inputSchema.required).toContain('pid');
    });

    it('should define process_list', () => {
      const tool = processToolDefinitions.find((t) => t.name === 'process_list');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('process_list');
    });
  });

  describe('Manifest registrations', () => {
    it('should register process_find', () => {
      const reg = manifest.registrations.find((r) => r.tool.name === 'process_find');
      expect(reg).toBeDefined();
      expect(reg?.tool.name).toBe('process_find');
    });

    it('should register process_get', () => {
      const reg = manifest.registrations.find((r) => r.tool.name === 'process_get');
      expect(reg).toBeDefined();
      expect(reg?.tool.name).toBe('process_get');
    });

    it('should register process_kill', () => {
      const reg = manifest.registrations.find((r) => r.tool.name === 'process_kill');
      expect(reg).toBeDefined();
      expect(reg?.tool.name).toBe('process_kill');
    });

    it('should register process_list', () => {
      const reg = manifest.registrations.find((r) => r.tool.name === 'process_list');
      expect(reg).toBeDefined();
      expect(reg?.tool.name).toBe('process_list');
    });

    it('should use correct depKey', () => {
      expect(manifest.depKey).toBe('processHandlers');
    });
  });

  describe('Handler method bindings', () => {
    it('should bind handleProcessFind', () => {
      expect(handlers.handleProcessFind).toBeDefined();
      expect(typeof handlers.handleProcessFind).toBe('function');
    });

    it('should bind handleProcessGet', () => {
      expect(handlers.handleProcessGet).toBeDefined();
      expect(typeof handlers.handleProcessGet).toBe('function');
    });

    it('should bind handleProcessKill', () => {
      expect(handlers.handleProcessKill).toBeDefined();
      expect(typeof handlers.handleProcessKill).toBe('function');
    });
  });

  describe('Tool count verification', () => {
    it('should have at least 20 process tools total', () => {
      // Before fix: 16 tools (missing 4)
      // After fix: 20 tools (16 + 4)
      expect(processToolDefinitions.length).toBeGreaterThanOrEqual(20);
    });

    it('should register all defined tools in manifest', () => {
      const definedNames = new Set(processToolDefinitions.map((t) => t.name));
      const registeredNames = new Set(manifest.registrations.map((r) => r.tool.name));

      // All registered tools must be defined
      for (const name of registeredNames) {
        expect(definedNames.has(name)).toBe(true);
      }

      // On Win32, all tools should be registered
      // On non-Win32, Win32-only tools are filtered
      const platform =
        process.env.JSHOOK_REGISTRY_PLATFORM === 'win32' ||
        process.env.JSHOOK_REGISTRY_PLATFORM === 'linux' ||
        process.env.JSHOOK_REGISTRY_PLATFORM === 'darwin'
          ? process.env.JSHOOK_REGISTRY_PLATFORM
          : process.platform;

      if (platform === 'win32') {
        expect(registeredNames.size).toBe(definedNames.size);
      } else {
        // check_debug_port is Win32-only
        expect(registeredNames.size).toBe(definedNames.size - 1);
      }
    });
  });
});
