// @ts-expect-error — auto-suppressed [TS1484]
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
const mm = {
  checkDebugPort: vi.fn(),
  enumerateModules: vi.fn(),
};

const unifiedPmCtor = vi.fn(() => pm);
const memoryCtor = vi.fn(() => mm);

vi.mock('@src/modules/process/index', () => ({
  UnifiedProcessManager: function UnifiedProcessManagerMock() {
    return unifiedPmCtor();
  },
  MemoryManager: function MemoryManagerMock() {
    return memoryCtor();
  },
}));

import { ProcessToolHandlers } from '@server/domains/process/handlers';

describe('ProcessToolHandlers', () => {
  let handlers: ProcessToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ProcessToolHandlers();
  });

  it('returns process_check_debug_port results through the facade', async () => {
    pm.checkDebugPort.mockResolvedValue(9333);

    const body = parseJson<ProcessFindResponse>(
      await handlers.handleProcessCheckDebugPort({ pid: 77 }),
    );
    expect(body.success).toBe(true);
    expect(body.debugPort).toBe(9333);
    expect(body.canAttach).toBe(true);
    expect(body.attachUrl).toBe('http://localhost:9333');
  });

  it('returns check_debug_port results through the injection facade', async () => {
    mm.checkDebugPort.mockResolvedValue({ success: true, isDebugged: false });

    const body = parseJson<ProcessFindResponse>(await handlers.handleCheckDebugPort({ pid: 77 }));
    expect(body.success).toBe(true);
    expect(body.pid).toBe(77);
    expect(body.isDebugged).toBe(false);
  });

  it('returns enumerate_modules results through the injection facade', async () => {
    mm.enumerateModules.mockResolvedValue({
      success: true,
      modules: [{ name: 'app.dll', baseAddress: '0x1000', size: 4096 }],
    });

    const body = parseJson<ProcessFindResponse>(await handlers.handleEnumerateModules({ pid: 77 }));
    expect(body.success).toBe(true);
    expect(body.pid).toBe(77);
    expect(body.moduleCount).toBe(1);
    expect(body.modules[0]!.name).toBe('app.dll');
  });

  it('returns a stable failure message when process_launch_debug cannot resolve a process', async () => {
    pm.launchWithDebug.mockResolvedValue(null);

    const body = parseJson<ProcessFindResponse>(
      await handlers.handleProcessLaunchDebug({
        executablePath: 'C:/browser.exe',
        debugPort: 9222,
        args: ['--headless'],
      }),
    );

    expect(body.success).toBe(false);
    expect(body.message).toBe('Failed to launch process');
    expect(body.error).toBeUndefined();
  });
});
