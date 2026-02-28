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

vi.mock('../../../../src/modules/process/index.js', () => ({
  UnifiedProcessManager: class {
    constructor() {
      return unifiedPmCtor();
    }
  },
  MemoryManager: class {
    constructor() {
      return memoryCtor();
    }
  },
}));

import { ProcessToolHandlers } from '../../../../src/server/domains/process/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('ProcessToolHandlers', () => {
  let handlers: ProcessToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ProcessToolHandlers();
  });

  it('returns validation error when process_find has empty pattern', async () => {
    const body = parseJson(await handlers.handleProcessFind({ pattern: '' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('pattern');
  });

  it('maps process_find result fields', async () => {
    pm.findProcesses.mockResolvedValue([
      {
        pid: 100,
        name: 'chrome.exe',
        executablePath: 'C:/chrome.exe',
        windowTitle: 'Chrome',
        windowHandle: '0x1',
        memoryUsage: 50 * 1024 * 1024,
      },
    ]);

    const body = parseJson(await handlers.handleProcessFind({ pattern: 'chrome' }));
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.processes[0]).toMatchObject({
      pid: 100,
      path: 'C:/chrome.exe',
      memoryMB: 50,
    });
  });

  it('returns not-found message for missing PID', async () => {
    pm.getProcessByPid.mockResolvedValue(null);
    const body = parseJson(await handlers.handleProcessGet({ pid: 1234 }));
    expect(body.success).toBe(false);
    expect(body.message).toContain('1234');
  });

  it('returns process_get with command line and debug port', async () => {
    pm.getProcessByPid.mockResolvedValue({ pid: 77, name: 'node' });
    pm.getProcessCommandLine.mockResolvedValue({ commandLine: 'node app.js', parentPid: 1 });
    pm.checkDebugPort.mockResolvedValue(9222);

    const body = parseJson(await handlers.handleProcessGet({ pid: 77 }));
    expect(body.success).toBe(true);
    expect(body.process.commandLine).toBe('node app.js');
    expect(body.process.parentPid).toBe(1);
    expect(body.process.debugPort).toBe(9222);
  });

  it('returns disabled response for process_find_chromium', async () => {
    const body = parseJson(await handlers.handleProcessFindChromium({}));
    expect(body.success).toBe(false);
    expect(body.disabled).toBe(true);
    expect(body.platform).toBe('win32');
  });

  it('returns canAttach on process_check_debug_port', async () => {
    pm.checkDebugPort.mockResolvedValue(9333);
    const body = parseJson(await handlers.handleProcessCheckDebugPort({ pid: 200 }));
    expect(body.success).toBe(true);
    expect(body.canAttach).toBe(true);
    expect(body.attachUrl).toBe('http://localhost:9333');
  });
});

