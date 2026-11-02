/**
 * Shared POSIX process helpers for LinuxProcessManager / MacProcessManager.
 *
 * The two platform managers previously carried byte-identical 60-line
 * launchWithDebug bodies (fallow clone dup). Platform differences live in the
 * callers' getProcessByPid, which this helper receives as a callback.
 */
import { spawn } from 'node:child_process';
import { logger } from '@utils/logger';
import {
  DEBUG_PORT_CANDIDATES,
  DEFAULT_DEBUG_PORT,
  PROCESS_LAUNCH_WAIT_MS,
  PROCESS_LIST_MAX_BUFFER_BYTES,
} from '@src/constants';
import { buildChromiumDebugLaunch } from '@modules/process/chromium-launch';
import { ProcessRegistry } from '@utils/ProcessRegistry';
import type { ProcessInfo } from '@modules/process/ProcessManager.types';

/** Shell-metacharacter strip shared by pattern searches. */
function sanitizePattern(s: string): string {
  return String(s || '').replace(/[^\w\s.@/\-:,+]/g, '');
}

export async function launchWithDebugPosix(
  executablePath: string,
  getProcessByPid: (pid: number) => Promise<ProcessInfo | null>,
  debugPort: number = DEFAULT_DEBUG_PORT,
  args: string[] = [],
): Promise<ProcessInfo | null> {
  try {
    const plan = buildChromiumDebugLaunch(executablePath, debugPort, args);

    const child = spawn(executablePath, plan.debugArgs, {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
    ProcessRegistry.register(child);

    await new Promise((resolve) => setTimeout(resolve, PROCESS_LAUNCH_WAIT_MS));

    if (!child.pid) {
      logger.error(`Failed to spawn process: PID is undefined for ${executablePath}`);
      return null;
    }
    // Fast-fail (issue #206): a target that died immediately must not be
    // reported as a live debuggable process.
    if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') {
      logger.error(`Debug launch target exited immediately: ${executablePath}`, {
        exitCode: child.exitCode,
        signalCode: child.signalCode,
      });
      return null;
    }
    const process = await getProcessByPid(child.pid);

    logger.info(`Launched process with debug port ${debugPort}:`, {
      pid: child.pid,
      executable: executablePath,
    });

    return process;
  } catch (error) {
    logger.error('Failed to launch process with debug:', error);
    return null;
  }
}

/** Shared `ps aux` pattern search — identical on Linux and macOS. */
export async function findProcessesPosix(
  pattern: string,
  execAsync: (cmd: string, opts?: Record<string, unknown>) => Promise<{ stdout: string }>,
): Promise<ProcessInfo[]> {
  try {
    const safePattern = sanitizePattern(pattern);
    const { stdout } = await execAsync(`ps aux | grep -i "${safePattern}" | grep -v grep || true`, {
      maxBuffer: PROCESS_LIST_MAX_BUFFER_BYTES,
    });

    const processes: ProcessInfo[] = [];
    const lines = stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim());

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        const pid = parseInt(parts[1] || '0', 10);
        if (isNaN(pid)) continue; // skip header line
        const cpu = parseFloat(parts[2] || '0');
        const mem = parseFloat(parts[3] || '0');
        const command = parts.slice(10).join(' ');

        processes.push({
          pid,
          name: parts[10] || command.split(' ')[0] || 'unknown',
          commandLine: command,
          cpuUsage: cpu,
          memoryUsage: mem * 1024 * 1024, // Estimated from %MEM (imprecise)
        });
      }
    }

    logger.info(`Found ${processes.length} processes matching '${pattern}'`);
    return processes;
  } catch (error) {
    logger.error(`Failed to find processes with pattern '${pattern}':`, error);
    return [];
  }
}

/**
 * Shared "which debug port does this PID listen on" scan. The platform
 * managers differ only in (a) the listening-port command (ss/netstat vs lsof)
 * and (b) how they read a process's command line (procfs vs ps); both are
 * injected so the shared body carries the command-line flag match + port scan.
 */
export async function checkDebugPortPosix(
  pid: number,
  listPortsCommand: string,
  safePidFn: (pid: number) => number,
  execAsync: (cmd: string, opts?: Record<string, unknown>) => Promise<{ stdout: string }>,
  getCommandLine: (pid: number) => Promise<string | undefined>,
  options?: { commandLine?: string },
): Promise<number | null> {
  try {
    pid = safePidFn(pid);
    const commandLine = options?.commandLine ?? (await getCommandLine(pid));

    if (commandLine) {
      const match = commandLine.match(/--remote-debugging-port=(\d+)/);
      if (match?.[1]) {
        return parseInt(match[1], 10);
      }
    }

    // Check listening ports for the process
    const { stdout } = await execAsync(listPortsCommand, { maxBuffer: 1024 * 1024 });

    // Common debug ports
    for (const port of DEBUG_PORT_CANDIDATES) {
      if (stdout.includes(`:${port}`)) {
        return port;
      }
    }

    return null;
  } catch (error) {
    logger.error(`Failed to check debug port for PID ${pid}:`, error);
    return null;
  }
}

/**
 * Shared findChromeProcesses classification: enumerate chrome processes and
 * bucket them into renderer/utility/gpu/main from the command line. The
 * platform managers only differ in how they resolve the target window.
 */
import type { WindowInfo } from '@modules/process/ProcessManager.types';

export interface ChromeProcessCore {
  mainProcess?: ProcessInfo;
  rendererProcesses: ProcessInfo[];
  gpuProcess?: ProcessInfo;
  utilityProcesses: ProcessInfo[];
  targetWindow?: WindowInfo;
}

export async function findChromeProcessesPosix(
  findProcesses: (pattern: string) => Promise<ProcessInfo[]>,
  getProcessByPid: (pid: number) => Promise<ProcessInfo | null>,
): Promise<ChromeProcessCore> {
  const result: ChromeProcessCore = {
    rendererProcesses: [],
    utilityProcesses: [],
  };

  try {
    const processes = await findProcesses('chrome');

    // Batch-fetch detailed info to avoid N+1 sequential exec calls
    const detailedInfos = await Promise.all(processes.map((proc) => getProcessByPid(proc.pid)));

    for (let i = 0; i < processes.length; i++) {
      const proc = processes[i];
      const detailedInfo = detailedInfos[i];

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
      } else {
        if (!result.mainProcess) {
          result.mainProcess = proc;
        }
      }
    }

    return result;
  } catch (error) {
    logger.error('Failed to find Chrome processes:', error);
    return result;
  }
}
