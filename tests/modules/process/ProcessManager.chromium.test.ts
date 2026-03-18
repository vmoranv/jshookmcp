import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  findChromiumProcessesWithConfig,
  type ChromiumDiscoveryDeps,
} from '@modules/process/ProcessManager.chromium';
import type {
  TargetAppConfig,
  ProcessInfo,
  WindowInfo,
} from '@modules/process/ProcessManager.types';

function makeDeps(overrides?: Partial<ChromiumDiscoveryDeps>): ChromiumDiscoveryDeps {
  return {
    findProcesses: vi.fn().mockResolvedValue([]),
    getProcessCommandLine: vi.fn().mockResolvedValue({}),
    getProcessWindows: vi.fn().mockResolvedValue([]),
    logInfo: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

function makeProcess(override?: Partial<ProcessInfo>): ProcessInfo {
  return { pid: 100, name: 'chromium', ...override };
}

function makeWindow(override?: Partial<WindowInfo>): WindowInfo {
  return {
    handle: '0x1',
    title: 'Test Window',
    className: 'Chrome_WidgetWin',
    processId: 100,
    threadId: 1,
    ...override,
  };
}

describe('ProcessManager.chromium', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findChromiumProcessesWithConfig', () => {
    it('returns empty result when no processes are found', async () => {
      const deps = makeDeps();
      const config: TargetAppConfig = { processNamePattern: 'chromium' };

      const result = await findChromiumProcessesWithConfig(config, deps);

      expect(result.rendererProcesses).toEqual([]);
      expect(result.utilityProcesses).toEqual([]);
      expect(result.mainProcess).toBeUndefined();
      expect(result.gpuProcess).toBeUndefined();
      expect(result.targetWindow).toBeUndefined();
    });

    it('classifies processes by command line --type flag', async () => {
      const procs = [
        makeProcess({ pid: 1, name: 'chromium' }),
        makeProcess({ pid: 2, name: 'chromium' }),
        makeProcess({ pid: 3, name: 'chromium' }),
        makeProcess({ pid: 4, name: 'chromium' }),
      ];

      const deps = makeDeps({
        findProcesses: vi.fn().mockResolvedValue(procs),
        getProcessCommandLine: vi
          .fn()
          .mockResolvedValueOnce({ commandLine: 'chromium --no-sandbox' })
          .mockResolvedValueOnce({ commandLine: 'chromium --type=renderer --pid=2' })
          .mockResolvedValueOnce({ commandLine: 'chromium --type=gpu-process' })
          .mockResolvedValueOnce({ commandLine: 'chromium --type=utility' }),
      });

      const result = await findChromiumProcessesWithConfig(
        { processNamePattern: 'chromium' },
        deps
      );

      expect(result.mainProcess).toMatchObject({ pid: 1 });
      expect(result.rendererProcesses).toHaveLength(1);
      expect(result.rendererProcesses[0]).toMatchObject({ pid: 2 });
      expect(result.gpuProcess).toMatchObject({ pid: 3 });
      expect(result.utilityProcesses).toHaveLength(1);
      expect(result.utilityProcesses[0]).toMatchObject({ pid: 4 });
    });

    it('assigns mainProcess when commandLine is missing', async () => {
      const deps = makeDeps({
        findProcesses: vi.fn().mockResolvedValue([makeProcess({ pid: 10 })]),
        getProcessCommandLine: vi.fn().mockResolvedValue({}),
      });

      const result = await findChromiumProcessesWithConfig(
        { processNamePattern: 'chromium' },
        deps
      );

      expect(result.mainProcess).toMatchObject({ pid: 10 });
    });

    it('uses regex filtering when processNamePattern is a RegExp', async () => {
      const allProcs = [
        makeProcess({ pid: 1, name: 'chrome' }),
        makeProcess({ pid: 2, name: 'node' }),
        makeProcess({ pid: 3, name: 'msedge' }),
      ];

      const deps = makeDeps({
        findProcesses: vi.fn().mockResolvedValue(allProcs),
        getProcessCommandLine: vi.fn().mockResolvedValue({ commandLine: 'chrome --no-sandbox' }),
      });

      const config: TargetAppConfig = {
        processNamePattern: /^(chrome|msedge)$/i,
      };

      const result = await findChromiumProcessesWithConfig(config, deps);

      // findProcesses is called with '' for regex pattern
      expect(deps.findProcesses).toHaveBeenCalledWith('');
      // Only chrome and msedge match the regex, node is filtered out
      // Both chrome (pid=1) and msedge (pid=3) match, both have no --type= flag
      // so pid=1 becomes mainProcess first, then pid=3 overwrites it (last wins)
      expect(result.mainProcess).toBeDefined();
    });

    it('defaults processNamePattern to "chromium" when not provided', async () => {
      const deps = makeDeps();
      const config: TargetAppConfig = {};

      await findChromiumProcessesWithConfig(config, deps);

      expect(deps.findProcesses).toHaveBeenCalledWith('chromium');
    });

    it('matches target window by title pattern', async () => {
      const deps = makeDeps({
        findProcesses: vi.fn().mockResolvedValue([makeProcess({ pid: 5 })]),
        getProcessCommandLine: vi.fn().mockResolvedValue({ commandLine: 'chromium' }),
        getProcessWindows: vi
          .fn()
          .mockResolvedValue([makeWindow({ title: 'Google - Chrome', processId: 5 })]),
      });

      const config: TargetAppConfig = {
        processNamePattern: 'chromium',
        windowTitlePattern: 'Google',
      };

      const result = await findChromiumProcessesWithConfig(config, deps);

      expect(result.targetWindow).toBeDefined();
      expect(result.targetWindow!.title).toBe('Google - Chrome');
    });

    it('matches target window by className pattern', async () => {
      const deps = makeDeps({
        findProcesses: vi.fn().mockResolvedValue([makeProcess({ pid: 7 })]),
        getProcessCommandLine: vi.fn().mockResolvedValue({ commandLine: 'chromium' }),
        getProcessWindows: vi
          .fn()
          .mockResolvedValue([
            makeWindow({ className: 'Chrome_WidgetWin_1', title: 'No Match Title' }),
          ]),
      });

      const config: TargetAppConfig = {
        processNamePattern: 'chromium',
        windowClassPattern: 'Chrome_WidgetWin',
      };

      const result = await findChromiumProcessesWithConfig(config, deps);

      expect(result.targetWindow).toBeDefined();
    });

    it('matches target window with regex patterns', async () => {
      const deps = makeDeps({
        findProcesses: vi.fn().mockResolvedValue([makeProcess({ pid: 8 })]),
        getProcessCommandLine: vi.fn().mockResolvedValue({ commandLine: 'chromium' }),
        getProcessWindows: vi
          .fn()
          .mockResolvedValue([makeWindow({ title: 'My App v2.0', className: 'Electron' })]),
      });

      const config: TargetAppConfig = {
        processNamePattern: 'chromium',
        windowTitlePattern: /My App v\d+\.\d+/,
      };

      const result = await findChromiumProcessesWithConfig(config, deps);

      expect(result.targetWindow).toBeDefined();
      expect(result.targetWindow!.title).toBe('My App v2.0');
    });

    it('returns empty result and logs error when findProcesses throws', async () => {
      const logError = vi.fn();
      const deps = makeDeps({
        findProcesses: vi.fn().mockRejectedValue(new Error('access denied')),
        logError,
      });

      const result = await findChromiumProcessesWithConfig(
        { processNamePattern: 'chromium' },
        deps
      );

      expect(result.rendererProcesses).toEqual([]);
      expect(result.utilityProcesses).toEqual([]);
      expect(logError).toHaveBeenCalledWith(
        'Failed to find Chromium processes:',
        expect.any(Error)
      );
    });

    it('does not overwrite mainProcess with a second process lacking commandLine', async () => {
      const deps = makeDeps({
        findProcesses: vi
          .fn()
          .mockResolvedValue([makeProcess({ pid: 1 }), makeProcess({ pid: 2 })]),
        getProcessCommandLine: vi
          .fn()
          .mockResolvedValueOnce({ commandLine: 'chromium --main' })
          .mockResolvedValueOnce({}),
      });

      const result = await findChromiumProcessesWithConfig(
        { processNamePattern: 'chromium' },
        deps
      );

      // First process becomes main via command line, second is skipped since mainProcess already set
      expect(result.mainProcess).toMatchObject({ pid: 1 });
    });

    it('scans renderer PIDs for windows as well', async () => {
      const getProcessWindows = vi
        .fn()
        .mockResolvedValueOnce([]) // main process has no matching window
        .mockResolvedValueOnce([makeWindow({ title: 'Target Tab', processId: 20 })]); // renderer does

      const deps = makeDeps({
        findProcesses: vi
          .fn()
          .mockResolvedValue([makeProcess({ pid: 10 }), makeProcess({ pid: 20 })]),
        getProcessCommandLine: vi
          .fn()
          .mockResolvedValueOnce({ commandLine: 'chromium' })
          .mockResolvedValueOnce({ commandLine: 'chromium --type=renderer' }),
        getProcessWindows,
      });

      const config: TargetAppConfig = {
        processNamePattern: 'chromium',
        windowTitlePattern: 'Target',
      };

      const result = await findChromiumProcessesWithConfig(config, deps);

      expect(result.targetWindow).toBeDefined();
      expect(result.targetWindow!.title).toBe('Target Tab');
      expect(getProcessWindows).toHaveBeenCalledTimes(2);
    });
  });
});
