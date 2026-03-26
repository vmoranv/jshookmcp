import { parseJson, ProcessFindResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const mm = {};

const unifiedPmCtor = vi.fn(() => pm);
const memoryCtor = vi.fn(() => mm);

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/process/index', () => ({
  // oxlint-disable-next-line no-extraneous-class
  UnifiedProcessManager: class {
    constructor() {
      return unifiedPmCtor();
    }
  },
  // oxlint-disable-next-line no-extraneous-class
  MemoryManager: class {
    constructor() {
      return memoryCtor();
    }
  },
}));

import { ProcessToolHandlers } from '@server/domains/process/handlers';

describe('ProcessToolHandlers', () => {
  let handlers: ProcessToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ProcessToolHandlers();
  });

  it('returns validation error when process_find has empty pattern', async () => {
    const body = parseJson<ProcessFindResponse>(await handlers.handleProcessFind({ pattern: '' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('pattern');
  });

  it('maps process_find result fields', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.findProcesses.mockResolvedValue([
      {
        pid: 100,
        name: 'browser.exe',
        executablePath: 'C:/browser.exe',
        windowTitle: 'Browser',
        windowHandle: '0x1',
        memoryUsage: 50 * 1024 * 1024,
      },
    ]);

    const body = parseJson<ProcessFindResponse>(
      await handlers.handleProcessFind({ pattern: 'browser' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.count).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.processes[0]).toMatchObject({
      pid: 100,
      path: 'C:/browser.exe',
      memoryMB: 50,
    });
  });

  it('returns not-found message for missing PID', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.getProcessByPid.mockResolvedValue(null);
    const body = parseJson<ProcessFindResponse>(await handlers.handleProcessGet({ pid: 1234 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('1234');
  });

  it('returns process_get with command line and debug port', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.getProcessByPid.mockResolvedValue({ pid: 77, name: 'node' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.getProcessCommandLine.mockResolvedValue({ commandLine: 'node app.js', parentPid: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.checkDebugPort.mockResolvedValue(9222);

    const body = parseJson<ProcessFindResponse>(await handlers.handleProcessGet({ pid: 77 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.process.commandLine).toBe('node app.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.process.parentPid).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.process.debugPort).toBe(9222);
    expect(pm.checkDebugPort).toHaveBeenCalledWith(77, { commandLine: 'node app.js' });
  });

  it('returns disabled response for process_find_chromium', async () => {
    const body = parseJson<ProcessFindResponse>(await handlers.handleProcessFindChromium({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.disabled).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.platform).toBe('win32');
  });

  it('returns canAttach on process_check_debug_port', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.checkDebugPort.mockResolvedValue(9333);
    const body = parseJson<ProcessFindResponse>(
      await handlers.handleProcessCheckDebugPort({ pid: 200 }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.canAttach).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.attachUrl).toBe('http://localhost:9333');
  });

  it('returns a stable failure message when process_launch_debug cannot resolve a process', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pm.launchWithDebug.mockResolvedValue(null);

    const body = parseJson<ProcessFindResponse>(
      await handlers.handleProcessLaunchDebug({
        executablePath: 'C:/browser.exe',
        debugPort: 9222,
        args: ['--headless'],
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toBe('Failed to launch process');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBeUndefined();
  });
});
