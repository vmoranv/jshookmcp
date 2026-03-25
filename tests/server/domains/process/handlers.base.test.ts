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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    it('returns a valid positive integer PID', () => {
      expect(validatePid(1234)).toBe(1234);
      expect(validatePid('5678')).toBe(5678);
    });

    it('throws on zero', () => {
      expect(() => validatePid(0)).toThrow('Invalid PID');
    });

    it('throws on negative', () => {
      expect(() => validatePid(-1)).toThrow('Invalid PID');
    });

    it('throws on non-integer', () => {
      expect(() => validatePid(1.5)).toThrow('Invalid PID');
    });

    it('throws on NaN', () => {
      expect(() => validatePid('abc')).toThrow('Invalid PID');
    });

    it('throws on null/undefined', () => {
      expect(() => validatePid(null)).toThrow('Invalid PID');
      expect(() => validatePid(undefined)).toThrow('Invalid PID');
    });
  });

  describe('requireString', () => {
    it('returns valid non-empty string', () => {
      expect(requireString('hello', 'field')).toBe('hello');
    });

    it('throws on empty string', () => {
      expect(() => requireString('', 'field')).toThrow('field must be a non-empty string');
    });

    it('throws on non-string', () => {
      expect(() => requireString(123, 'field')).toThrow('field must be a non-empty string');
    });

    it('throws on null', () => {
      expect(() => requireString(null, 'field')).toThrow('field must be a non-empty string');
    });
  });

  describe('requirePositiveNumber', () => {
    it('returns valid positive number', () => {
      expect(requirePositiveNumber(42, 'size')).toBe(42);
      expect(requirePositiveNumber('10', 'size')).toBe(10);
    });

    it('throws on zero', () => {
      expect(() => requirePositiveNumber(0, 'size')).toThrow('size must be a positive number');
    });

    it('throws on negative', () => {
      expect(() => requirePositiveNumber(-5, 'size')).toThrow('size must be a positive number');
    });

    it('throws on NaN', () => {
      expect(() => requirePositiveNumber('abc', 'size')).toThrow('size must be a positive number');
    });

    it('throws on Infinity', () => {
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

  describe('handleProcessFind', () => {
    it('returns validation error for empty pattern', async () => {
      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessFind({ pattern: '' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('pattern');
    });

    it('returns matching processes', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.findProcesses.mockResolvedValue([
        {
          pid: 100,
          name: 'node',
          executablePath: '/usr/bin/node',
          windowTitle: 'Terminal',
          windowHandle: '0xA',
          memoryUsage: 100 * 1024 * 1024,
        },
      ]);

      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessFind({ pattern: 'node' }),
      );
      expect(body.success).toBe(true);
      expect(body.count).toBe(1);
      expect(body.processes![0]).toMatchObject({
        pid: 100,
        name: 'node',
        path: '/usr/bin/node',
        memoryMB: 100,
      });
    });

    it('handles findProcesses error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.findProcesses.mockRejectedValue(new Error('access denied'));

      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessFind({ pattern: 'node' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe('access denied');
    });
  });

  describe('handleProcessGet', () => {
    it('returns not found for missing PID', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessByPid.mockResolvedValue(null);
      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessGet({ pid: 999 }));
      expect(body.success).toBe(false);
      expect(body.message).toContain('999');
    });

    it('returns process with debug port info', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessByPid.mockResolvedValue({ pid: 50, name: 'chrome' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessCommandLine.mockResolvedValue({
        commandLine: 'chrome --headless',
        parentPid: 1,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.checkDebugPort.mockResolvedValue(9222);

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessGet({ pid: 50 }));
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.process!.debugPort).toBe(9222);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.process!.commandLine).toBe('chrome --headless');
    });

    it('handles error when getProcessByPid throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessByPid.mockRejectedValue(new Error('boom'));

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessGet({ pid: 50 }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('boom');
    });
  });

  describe('handleProcessWindows', () => {
    it('returns windows for a process', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessWindows.mockResolvedValue([
        { handle: '0x1', title: 'Main Window', className: 'WinClass', processId: 10 },
      ]);

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessWindows({ pid: 10 }));
      expect(body.success).toBe(true);
      expect(body.windowCount).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

  describe('handleProcessFindChromium', () => {
    it('returns disabled response', async () => {
      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessFindChromium({}));
      expect(body.success).toBe(false);
      expect(body.disabled).toBe(true);
      expect(body.guidance).toBeDefined();
      expect(body.platform).toBe('win32');
    });
  });

  describe('handleProcessCheckDebugPort', () => {
    it('returns canAttach with valid debug port', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.checkDebugPort.mockResolvedValue(9229);

      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessCheckDebugPort({ pid: 300 }),
      );
      expect(body.success).toBe(true);
      expect(body.canAttach).toBe(true);
      expect(body.attachUrl).toBe('http://localhost:9229');
    });

    it('returns canAttach false when no debug port', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.checkDebugPort.mockResolvedValue(null);

      const body = parseJson<ProcessFindResponse>(
        await handlers.handleProcessCheckDebugPort({ pid: 300 }),
      );
      expect(body.success).toBe(true);
      expect(body.canAttach).toBe(false);
      expect(body.attachUrl).toBeNull();
    });
  });

  describe('handleProcessLaunchDebug', () => {
    it('launches process with debug port', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.process!.pid).toBe(400);
      expect(body.debugPort).toBe(9333);
      expect(body.attachUrl).toBe('http://localhost:9333');
    });

    it('returns failure when launch returns null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.launchWithDebug.mockResolvedValue({
        pid: 500,
        name: 'app',
        executablePath: '/usr/bin/app',
      });

      await handlers.handleProcessLaunchDebug({ executablePath: '/usr/bin/app' });
      expect(pm.launchWithDebug).toHaveBeenCalledWith('/usr/bin/app', 9222, []);
    });
  });

  describe('handleProcessKill', () => {
    it('kills process successfully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.killProcess.mockResolvedValue(true);

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessKill({ pid: 600 }));
      expect(body.success).toBe(true);
      expect(body.message).toContain('killed successfully');
    });

    it('reports failure when kill fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.killProcess.mockResolvedValue(false);

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessKill({ pid: 600 }));
      expect(body.success).toBe(false);
      expect(body.message).toContain('Failed to kill');
    });

    it('handles errors thrown by killProcess', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.killProcess.mockRejectedValue(new Error('no permission'));

      const body = parseJson<ProcessFindResponse>(await handlers.handleProcessKill({ pid: 600 }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('no permission');
    });
  });

  describe('buildMemoryDiagnostics', () => {
    it('builds complete diagnostics with all checks passing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.checkAvailability.mockResolvedValue({ available: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessByPid.mockResolvedValue({ pid: 100, name: 'app' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.checkMemoryProtection.mockResolvedValue({
        success: true,
        protection: 'RW',
        isWritable: true,
        isReadable: true,
        isExecutable: false,
        regionStart: '0x1000',
        regionSize: 4096,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.checkAvailability.mockResolvedValue({ available: false, reason: 'Not admin' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.enumerateModules.mockResolvedValue({ success: false });

      const diagnostics = await handlers.buildDiagnostics({
        operation: 'memory_read',
      });

      expect(diagnostics.permission.available).toBe(false);
      expect(diagnostics.recommendedActions).toContain('Run as administrator');
    });

    it('adds recommended action when process not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.checkAvailability.mockResolvedValue({ available: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessByPid.mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.enumerateModules.mockResolvedValue({ success: false });

      const diagnostics = await handlers.buildDiagnostics({
        pid: 999,
        operation: 'memory_read',
      });

      expect(diagnostics.process.exists).toBe(false);
      expect(diagnostics.recommendedActions).toContain('Check if process is still running');
    });

    it('recommends writable check for write operations on non-writable memory', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.checkAvailability.mockResolvedValue({ available: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pm.getProcessByPid.mockResolvedValue({ pid: 100, name: 'app' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mm.checkMemoryProtection.mockResolvedValue({
        success: true,
        protection: 'R',
        isWritable: false,
        isReadable: true,
        isExecutable: false,
        regionStart: '0x1000',
        regionSize: 4096,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
