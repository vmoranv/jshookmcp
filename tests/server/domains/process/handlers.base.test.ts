import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessFindResponse } from '@tests/server/domains/shared/common-test-types';

const pm = {
  getPlatform: vi.fn(() => 'win32'),
  findProcesses: vi.fn(),
  getProcessByPid: vi.fn(),
  getProcessCommandLine: vi.fn(),
  checkDebugPort: vi.fn(),
  getProcessWindows: vi.fn(),
  launchWithDebug: vi.fn(),
  killProcess: vi.fn(),
};
const mm = {
  checkAvailability: vi.fn(),
  checkMemoryProtection: vi.fn(),
  enumerateModules: vi.fn(),
};

vi.mock('@server/domains/shared/modules', () => ({
  UnifiedProcessManager: class {
    static readonly mock = true;

    constructor() {
      return pm;
    }
  },
  MemoryManager: class {
    static readonly mock = true;

    constructor() {
      return mm;
    }
  },
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  validatePid,
  requireString,
  requirePositiveNumber,
  ProcessToolHandlersBase,
} from '@server/domains/process/handlers.impl.core.runtime.base';

type MemoryDiagnosticsInput = {
  pid?: number;
  address?: string;
  size?: number;
  operation: string;
  error?: string;
};

class TestProcessToolHandlersBase extends ProcessToolHandlersBase {
  buildDiagnostics(input: MemoryDiagnosticsInput) {
    return this.buildMemoryDiagnostics(input);
  }
}

describe('Validation helpers', () => {
  describe('validatePid', () => {
    it('returns a valid positive integer PID', async () => {
      expect(validatePid(1234)).toBe(1234);
      expect(validatePid('5678')).toBe(5678);
    });

    it('throws on zero', async () => {
      expect(() => validatePid(0)).toThrow('Invalid PID');
    });

    it('throws on negative', async () => {
      expect(() => validatePid(-1)).toThrow('Invalid PID');
    });

    it('throws on non-integer', async () => {
      expect(() => validatePid(1.5)).toThrow('Invalid PID');
    });

    it('throws on NaN', async () => {
      expect(() => validatePid('abc')).toThrow('Invalid PID');
    });

    it('throws on null/undefined', async () => {
      expect(() => validatePid(null)).toThrow('Invalid PID');
      expect(() => validatePid(undefined)).toThrow('Invalid PID');
    });
  });

  describe('requireString', () => {
    it('returns valid non-empty string', async () => {
      expect(requireString('hello', 'field')).toBe('hello');
    });

    it('throws on empty string', async () => {
      expect(() => requireString('', 'field')).toThrow('field must be a non-empty string');
    });

    it('throws on non-string', async () => {
      expect(() => requireString(123, 'field')).toThrow('field must be a non-empty string');
    });

    it('throws on null', async () => {
      expect(() => requireString(null, 'field')).toThrow('field must be a non-empty string');
    });
  });

  describe('requirePositiveNumber', () => {
    it('returns valid positive number', async () => {
      expect(requirePositiveNumber(42, 'size')).toBe(42);
      expect(requirePositiveNumber('10', 'size')).toBe(10);
    });

    it('throws on zero', async () => {
      expect(() => requirePositiveNumber(0, 'size')).toThrow('size must be a positive number');
    });

    it('throws on negative', async () => {
      expect(() => requirePositiveNumber(-5, 'size')).toThrow('size must be a positive number');
    });

    it('throws on NaN', async () => {
      expect(() => requirePositiveNumber('abc', 'size')).toThrow('size must be a positive number');
    });

    it('throws on Infinity', async () => {
      expect(() => requirePositiveNumber(Infinity, 'size')).toThrow(
        'size must be a positive number',
      );
    });
  });
});

describe('ProcessToolHandlersBase', () => {
  let handlers: TestProcessToolHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TestProcessToolHandlersBase();
  });

  describe('handleProcessWindows', () => {
    it('returns windows for a process', async () => {
      pm.getProcessWindows.mockResolvedValue([
        { handle: '0x1', title: 'Main Window', className: 'WinClass', processId: 10 },
      ]);

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessWindows({ pid: 10 }));
      expect(body.success).toBe(true);
      expect(body.windowCount).toBe(1);
      expect(body.windows![0]!.title).toBe('Main Window');
    });

    it('returns error on invalid pid', async () => {
      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessWindows({ pid: 'abc' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid PID');
    });
  });

  describe('handleProcessLaunchDebug', () => {
    it('launches process with debug port', async () => {
      pm.launchWithDebug.mockResolvedValue({
        pid: 400,
        name: 'electron',
        executablePath: '/usr/bin/electron',
      });

      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessLaunchDebug({
          executablePath: '/usr/bin/electron',
          debugPort: 9333,
          args: ['--headless'],
        }),
      );
      expect(body.success).toBe(true);
      expect(body.process!.pid).toBe(400);
      expect(body.debugPort).toBe(9333);
      expect(body.attachUrl).toBe('http://localhost:9333');
    });

    it('returns failure when launch returns null', async () => {
      pm.launchWithDebug.mockResolvedValue(null);

      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessLaunchDebug({
          executablePath: '/usr/bin/electron',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.message).toBe('Failed to launch process');
    });

    it('uses default debugPort 9222', async () => {
      pm.launchWithDebug.mockResolvedValue({
        pid: 500,
        name: 'app',
        executablePath: '/usr/bin/app',
      });

      await handlers.handleProcessLaunchDebug({ executablePath: '/usr/bin/app' });
      expect(pm.launchWithDebug).toHaveBeenCalledWith('/usr/bin/app', 9222, []);
    });
  });

  describe('buildMemoryDiagnostics', () => {
    it('builds complete diagnostics with all checks passing', async () => {
      mm.checkAvailability.mockResolvedValue({ available: true });
      pm.getProcessByPid.mockResolvedValue({ pid: 100, name: 'app' });
      mm.checkMemoryProtection.mockResolvedValue({
        success: true,
        protection: 'RW',
        isWritable: true,
        isReadable: true,
        isExecutable: false,
        regionStart: '0x1000',
        regionSize: 4096,
      });
      mm.enumerateModules.mockResolvedValue({
        success: true,
        modules: [{ name: 'mod.dll', baseAddress: '0x1000', size: 4096 }],
      });

      const diagnostics = await handlers.buildDiagnostics({
        pid: 100,
        address: '0x1000',
        size: 16,
        operation: 'memory_read',
      });

      expect(diagnostics.permission.available).toBe(true);
      expect(diagnostics.process.exists).toBe(true);
      expect(diagnostics.process.name).toBe('app');
      expect(diagnostics.address.valid).toBe(true);
      expect(diagnostics.aslr.heuristic).toBe(true);
      expect(diagnostics.aslr.note).toContain('1 module');
    });

    it('adds recommended action when permission unavailable', async () => {
      mm.checkAvailability.mockResolvedValue({ available: false, reason: 'Not admin' });
      mm.enumerateModules.mockResolvedValue({ success: false });

      const diagnostics = await handlers.buildDiagnostics({
        operation: 'memory_read',
      });

      expect(diagnostics.permission.available).toBe(false);
      expect(diagnostics.recommendedActions).toContain('Run as administrator');
    });

    it('adds recommended action when process not found', async () => {
      mm.checkAvailability.mockResolvedValue({ available: true });
      pm.getProcessByPid.mockResolvedValue(null);
      mm.enumerateModules.mockResolvedValue({ success: false });

      const diagnostics = await handlers.buildDiagnostics({
        pid: 999,
        operation: 'memory_read',
      });

      expect(diagnostics.process.exists).toBe(false);
      expect(diagnostics.recommendedActions).toContain('Check if process is still running');
    });

    it('recommends writable check for write operations on non-writable memory', async () => {
      mm.checkAvailability.mockResolvedValue({ available: true });
      pm.getProcessByPid.mockResolvedValue({ pid: 100, name: 'app' });
      mm.checkMemoryProtection.mockResolvedValue({
        success: true,
        protection: 'R',
        isWritable: false,
        isReadable: true,
        isExecutable: false,
        regionStart: '0x1000',
        regionSize: 4096,
      });
      mm.enumerateModules.mockResolvedValue({ success: false });

      const diagnostics = await handlers.buildDiagnostics({
        pid: 100,
        address: '0x1000',
        operation: 'memory_write',
      });

      expect(diagnostics.recommendedActions).toContain('Ensure target memory region is writable');
    });
  });
});
