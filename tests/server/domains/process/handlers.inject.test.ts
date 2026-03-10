import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  injectDll: vi.fn(),
  injectShellcode: vi.fn(),
  checkDebugPort: vi.fn(),
  enumerateModules: vi.fn(),
  recordMemoryAudit: vi.fn(),
}));

vi.mock(import('@server/domains/shared/modules'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    UnifiedProcessManager: class {
      getPlatform() {
        return 'win32';
      }
    },
    MemoryManager: class {
      injectDll = state.injectDll;
      injectShellcode = state.injectShellcode;
      checkDebugPort = state.checkDebugPort;
      enumerateModules = state.enumerateModules;
    },
  };
});

vi.mock(import('@src/modules/process/memory/AuditTrail'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    MemoryAuditTrail: class {
      record(entry: unknown) {
        state.recordMemoryAudit(entry);
      }

      exportJson() {
        return '[]';
      }

      clear() {}

      size() {
        return 0;
      }
    },
  };
});

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock constants module with configurable ENABLE_INJECTION_TOOLS
const mockEnableInjectionTools = { value: false };
vi.mock(import('@src/constants'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get ENABLE_INJECTION_TOOLS() {
      return mockEnableInjectionTools.value;
    },
  };
});

import { ProcessToolHandlersRuntime } from '@server/domains/process/handlers.impl.core.runtime.inject';

describe('handlers.impl.core.runtime.inject', () => {
  let handler: ProcessToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new ProcessToolHandlersRuntime();
    mockEnableInjectionTools.value = false;
  });

  describe('ENABLE_INJECTION_TOOLS=false branch', () => {
    it('handleInjectDll returns disabled error when injection tools disabled', async () => {
      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Injection tools are disabled by default');
      expect(response.howToEnable).toContain('ENABLE_INJECTION_TOOLS=true');
      expect(response.securityNotice).toBeDefined();

      expect(state.injectDll).not.toHaveBeenCalled();
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_dll',
          pid: 1234,
          address: 'C:\\test.dll',
          result: 'failure',
        })
      );
    });

    it('handleInjectShellcode returns disabled error when injection tools disabled', async () => {
      const result = await handler.handleInjectShellcode({ pid: 1234, shellcode: '909090', encoding: 'hex' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Injection tools are disabled by default');
      expect(response.howToEnable).toContain('ENABLE_INJECTION_TOOLS=true');

      expect(state.injectShellcode).not.toHaveBeenCalled();
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_shellcode',
          pid: 1234,
          size: 3, // 3 bytes from '909090'
          result: 'failure',
        })
      );
    });

    it('handleInjectShellcode calculates base64 size correctly when disabled', async () => {
      // 'AAAA' base64 = 3 bytes
      const shellcode = Buffer.from([0x41, 0x41, 0x41]).toString('base64');
      const result = await handler.handleInjectShellcode({ pid: 1234, shellcode, encoding: 'base64' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 3,
        })
      );
    });

    it('handleInjectDll handles missing pid gracefully when disabled', async () => {
      const result = await handler.handleInjectDll({ dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: null,
          address: 'C:\\test.dll',
        })
      );
    });

    it('handleInjectShellcode handles missing shellcode gracefully when disabled', async () => {
      const result = await handler.handleInjectShellcode({ pid: 1234 });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1234,
          size: null,
        })
      );
    });
  });

  describe('ENABLE_INJECTION_TOOLS=true branch', () => {
    beforeEach(() => {
      mockEnableInjectionTools.value = true;
    });

    it('handleInjectDll delegates to memoryManager when enabled', async () => {
      state.injectDll.mockResolvedValue({ success: true, remoteThreadId: 42 });

      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.remoteThreadId).toBe(42);
      expect(state.injectDll).toHaveBeenCalledWith(1234, 'C:\\test.dll');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_dll',
          pid: 1234,
          address: 'C:\\test.dll',
          result: 'success',
        })
      );
    });

    it('handleInjectDll records failure when injection fails', async () => {
      state.injectDll.mockResolvedValue({ success: false, error: 'Access denied' });

      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Access denied');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failure',
          error: 'Access denied',
        })
      );
    });

    it('handleInjectDll handles exceptions and records audit', async () => {
      state.injectDll.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Unexpected error');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failure',
          error: 'Unexpected error',
        })
      );
    });

    it('handleInjectShellcode delegates to memoryManager when enabled', async () => {
      state.injectShellcode.mockResolvedValue({ success: true, remoteThreadId: 100 });

      const result = await handler.handleInjectShellcode({ pid: 1234, shellcode: '9090', encoding: 'hex' });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.remoteThreadId).toBe(100);
      expect(state.injectShellcode).toHaveBeenCalledWith(1234, '9090', 'hex');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_shellcode',
          size: 2,
          result: 'success',
        })
      );
    });

    it('handleInjectShellcode defaults to hex encoding', async () => {
      state.injectShellcode.mockResolvedValue({ success: true, remoteThreadId: 100 });

      await handler.handleInjectShellcode({ pid: 1234, shellcode: '9090' });

      expect(state.injectShellcode).toHaveBeenCalledWith(1234, '9090', 'hex');
    });
  });

  describe('checkDebugPort', () => {
    it('returns result from memoryManager', async () => {
      state.checkDebugPort.mockResolvedValue({ success: true, isDebugged: false });

      const result = await handler.handleCheckDebugPort({ pid: 1234 });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.isDebugged).toBe(false);
    });

    it('handles errors', async () => {
      state.checkDebugPort.mockRejectedValue(new Error('Check failed'));

      const result = await handler.handleCheckDebugPort({ pid: 1234 });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Check failed');
    });
  });

  describe('enumerateModules', () => {
    it('returns modules from memoryManager', async () => {
      state.enumerateModules.mockResolvedValue({
        success: true,
        modules: [{ name: 'kernel32.dll', baseAddress: '0x7FFE0000', size: 0x1000 }],
      });

      const result = await handler.handleEnumerateModules({ pid: 1234 });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.modules).toHaveLength(1);
      expect(response.modules[0].name).toBe('kernel32.dll');
    });

    it('handles errors', async () => {
      state.enumerateModules.mockRejectedValue(new Error('Enumeration failed'));

      const result = await handler.handleEnumerateModules({ pid: 1234 });
      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Enumeration failed');
    });
  });
});
