/**
 * electron_launch_debug — Launch Electron with dual CDP debugging.
 * Main process: --inspect=<port> (Node.js inspector)
 * Renderer: --remote-debugging-port=<port> (Chromium DevTools)
 *
 * Auto-checks fuse status and warns if debug fuses are disabled.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  pathExists,
} from '@server/domains/platform/handlers/platform-utils';

/** Fuse sentinel for quick check */
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZIA';
const FUSE_ENABLE = 0x31;

/** Track launched processes for cleanup */
const launchedProcesses = new Map<
  string,
  { child: ChildProcess; pid: number; ports: { main: number; renderer: number } }
>();

interface FuseCheckResult {
  fuseFound: boolean;
  runAsNode: boolean;
  inspectArgs: boolean;
  nodeOptions: boolean;
}

/**
 * Quick-check if critical debug fuses are enabled.
 */
async function quickFuseCheck(exePath: string): Promise<FuseCheckResult> {
  try {
    const buffer = await readFile(exePath);
    const sentinelBuf = Buffer.from(FUSE_SENTINEL, 'ascii');
    const idx = buffer.indexOf(sentinelBuf);
    if (idx === -1)
      return { fuseFound: false, runAsNode: false, inspectArgs: false, nodeOptions: false };

    const base = idx + sentinelBuf.length;
    return {
      fuseFound: true,
      runAsNode: buffer[base] === FUSE_ENABLE, // index 0: RunAsNode
      nodeOptions: buffer[base + 2] === FUSE_ENABLE, // index 2: EnableNodeOptionsEnvironmentVariable
      inspectArgs: buffer[base + 3] === FUSE_ENABLE, // index 3: EnableNodeCliInspectArguments
    };
  } catch {
    return { fuseFound: false, runAsNode: false, inspectArgs: false, nodeOptions: false };
  }
}

/**
 * Wait for a CDP port to become available (returns JSON version info).
 */
async function waitForCDP(
  port: number,
  timeoutMs: number = 10_000,
): Promise<{ ok: boolean; info?: string; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const info = await res.text();
        return { ok: true, info };
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, error: `CDP port ${port} did not respond within ${timeoutMs}ms` };
}

export async function handleElectronLaunchDebug(
  args: Record<string, unknown>,
): Promise<ReturnType<typeof toTextResponse>> {
  try {
    const exePath = parseStringArg(args, 'exePath', true);
    if (!exePath) {
      throw new Error('exePath is required — path to the Electron .exe');
    }

    if (!(await pathExists(exePath))) {
      return toTextResponse({
        success: false,
        tool: 'electron_launch_debug',
        error: `File does not exist: ${exePath}`,
      });
    }

    // SECURITY: Validate that exePath looks like an Electron binary.
    // Reject arbitrary executables (python, bash, node, etc.)
    const exeBaseName = exePath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    const ELECTRON_EXE_PATTERNS = [
      /^electron/i,
      /\.app$/i,
      /chrome/i,
      /chromium/i,
    ];
    const isElectronBinary = ELECTRON_EXE_PATTERNS.some((p) => p.test(exeBaseName));
    if (!isElectronBinary) {
      return toTextResponse({
        success: false,
        tool: 'electron_launch_debug',
        error: `exePath does not appear to be an Electron binary: ${exeBaseName}. Only Electron/Chromium executables are allowed.`,
      });
    }

    const mainPort = (args.mainPort as number | undefined) ?? 9229;
    const rendererPort = (args.rendererPort as number | undefined) ?? 9222;
    const rawExtraArgs = (args.args as string[] | undefined) ?? [];
    // SECURITY: Filter out dangerous flags that could enable arbitrary code execution
    const BLOCKED_FLAGS = ['--require', '--loader', '--import', '-e', '--eval', '-p', '--print'];
    const extraArgs = rawExtraArgs.filter(
      (arg) => !BLOCKED_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
    );
    const skipFuseCheck = (args.skipFuseCheck as boolean | undefined) === true;
    const waitMs = (args.waitMs as number | undefined) ?? 8000;

    // Check fuses before launching
    const fuseWarnings: string[] = [];
    if (!skipFuseCheck) {
      const fuses = await quickFuseCheck(exePath);
      if (fuses.fuseFound) {
        if (!fuses.inspectArgs) {
          fuseWarnings.push(
            'EnableNodeCliInspectArguments is DISABLED — main process --inspect may be blocked. Use electron_patch_fuses first.',
          );
        }
        if (!fuses.nodeOptions) {
          fuseWarnings.push(
            'EnableNodeOptionsEnvironmentVariable is DISABLED — NODE_OPTIONS injection blocked.',
          );
        }
        if (!fuses.runAsNode) {
          fuseWarnings.push('RunAsNode is DISABLED — ELECTRON_RUN_AS_NODE=1 will not work.');
        }
      }
    }

    // Build launch arguments
    const launchArgs = [
      `--inspect=${mainPort}`,
      `--remote-debugging-port=${rendererPort}`,
      ...extraArgs,
    ];

    // Launch the process
    const child = spawn(exePath, launchArgs, {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env },
    });

    child.unref();

    if (!child.pid) {
      return toTextResponse({
        success: false,
        tool: 'electron_launch_debug',
        error: 'Failed to spawn process — no PID returned.',
      });
    }

    const sessionId = `electron-${child.pid}`;
    launchedProcesses.set(sessionId, {
      child,
      pid: child.pid,
      ports: { main: mainPort, renderer: rendererPort },
    });

    // Wait for CDP ports to become available
    const [mainCDP, rendererCDP] = await Promise.all([
      waitForCDP(mainPort, waitMs),
      waitForCDP(rendererPort, waitMs),
    ]);

    return toTextResponse({
      success: true,
      tool: 'electron_launch_debug',
      sessionId,
      pid: child.pid,
      ports: {
        main: { port: mainPort, available: mainCDP.ok, info: mainCDP.ok ? 'Ready' : mainCDP.error },
        renderer: {
          port: rendererPort,
          available: rendererCDP.ok,
          info: rendererCDP.ok ? 'Ready' : rendererCDP.error,
        },
      },
      fuseWarnings: fuseWarnings.length > 0 ? fuseWarnings : undefined,
      usage: {
        main: `Use electron_attach(port=${mainPort}) to debug the main process (Node.js)`,
        renderer: `Use electron_attach(port=${rendererPort}) to debug the renderer (Chromium)`,
        combined: 'Both sessions can be used simultaneously for cross-process analysis',
      },
    });
  } catch (error) {
    return toErrorResponse('electron_launch_debug', error);
  }
}

export async function handleElectronDebugStatus(
  args: Record<string, unknown>,
): Promise<ReturnType<typeof toTextResponse>> {
  try {
    const sessionId = parseStringArg(args, 'sessionId');

    if (sessionId) {
      const session = launchedProcesses.get(sessionId);
      if (!session) {
        return toTextResponse({
          success: false,
          tool: 'electron_debug_status',
          error: `No session found: ${sessionId}`,
          activeSessions: Array.from(launchedProcesses.keys()),
        });
      }

      const [mainCDP, rendererCDP] = await Promise.all([
        waitForCDP(session.ports.main, 2000),
        waitForCDP(session.ports.renderer, 2000),
      ]);

      return toTextResponse({
        success: true,
        tool: 'electron_debug_status',
        sessionId,
        pid: session.pid,
        main: { port: session.ports.main, alive: mainCDP.ok },
        renderer: { port: session.ports.renderer, alive: rendererCDP.ok },
      });
    }

    // List all sessions
    const sessions = Array.from(launchedProcesses.entries()).map(([id, s]) => ({
      sessionId: id,
      pid: s.pid,
      ports: s.ports,
    }));

    return toTextResponse({
      success: true,
      tool: 'electron_debug_status',
      sessions,
    });
  } catch (error) {
    return toErrorResponse('electron_debug_status', error);
  }
}
