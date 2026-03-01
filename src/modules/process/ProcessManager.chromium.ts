import type {
  ChromiumProcess,
  ProcessInfo,
  TargetAppConfig,
  WindowInfo,
} from './ProcessManager.types.js';

export interface ChromiumDiscoveryDeps {
  findProcesses: (pattern: string) => Promise<ProcessInfo[]>;
  getProcessCommandLine: (pid: number) => Promise<{ commandLine?: string; parentPid?: number }>;
  getProcessWindows: (pid: number) => Promise<WindowInfo[]>;
  logInfo: (message: string, payload?: unknown) => void;
  logError: (message: string, error?: unknown) => void;
}

function matchesPattern(value: string, pattern?: string | RegExp): boolean {
  if (!pattern) {
    return false;
  }
  if (typeof pattern === 'string') {
    return value.includes(pattern);
  }
  return pattern.test(value);
}

export async function findChromiumProcessesWithConfig(
  config: TargetAppConfig,
  deps: ChromiumDiscoveryDeps
): Promise<ChromiumProcess> {
  const result: ChromiumProcess = {
    rendererProcesses: [],
    utilityProcesses: [],
  };

  try {
    let processes: ProcessInfo[];
    if (config.processNamePattern instanceof RegExp) {
      const allProcesses = await deps.findProcesses('');
      const matcher = config.processNamePattern;
      processes = allProcesses.filter((proc) => matcher.test(proc.name));
    } else {
      const processName = config.processNamePattern || 'chromium';
      processes = await deps.findProcesses(processName);
    }

    for (const proc of processes) {
      const detailedInfo = await deps.getProcessCommandLine(proc.pid);
      if (detailedInfo?.commandLine) {
        const cmd = detailedInfo.commandLine.toLowerCase();
        if (cmd.includes('--type=renderer')) {
          result.rendererProcesses.push({ ...proc, ...detailedInfo });
        } else if (cmd.includes('--type=gpu-process')) {
          result.gpuProcess = { ...proc, ...detailedInfo };
        } else if (cmd.includes('--type=utility')) {
          result.utilityProcesses.push({ ...proc, ...detailedInfo });
        } else if (!cmd.includes('--type=')) {
          result.mainProcess = { ...proc, ...detailedInfo };
        }
      } else if (!result.mainProcess) {
        result.mainProcess = proc;
      }
    }

    const allPids = [result.mainProcess?.pid, ...result.rendererProcesses.map((p) => p.pid)].filter(
      Boolean
    ) as number[];

    const windowMatcher = (w: WindowInfo): boolean => {
      return (
        matchesPattern(w.title, config.windowTitlePattern) ||
        matchesPattern(w.className, config.windowClassPattern)
      );
    };

    for (const pid of allPids) {
      const windows = await deps.getProcessWindows(pid);
      const targetWindow = windows.find(windowMatcher);
      if (targetWindow) {
        result.targetWindow = targetWindow;
        break;
      }
    }

    deps.logInfo('Chromium processes found:', {
      main: result.mainProcess?.pid,
      renderers: result.rendererProcesses.length,
      hasTargetWindow: !!result.targetWindow,
    });

    return result;
  } catch (error) {
    deps.logError('Failed to find Chromium processes:', error);
    return result;
  }
}
