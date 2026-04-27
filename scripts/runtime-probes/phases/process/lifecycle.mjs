import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function runProcessLifecyclePhase(ctx) {
  const { report, server, clients, state, helpers, constants } = ctx;
  const { client } = clients;
  const { callTool, callToolCaptureError, getFreePort, getPreferredBrowserExecutable } = helpers;
  const { BODY_MARKER, MEMORY_MARKER } = constants;
  const resources = state.runtimeResources;

  const processDebugPort = await getFreePort();
  resources.memoryProbeProc = spawn(
    process.execPath,
    [
      '-e',
      [
        'global.__runtimeAuditMemoryProbe = Buffer.alloc(1024 * 1024, 0);',
        `global.__runtimeAuditMemoryProbe.write(${JSON.stringify(`${MEMORY_MARKER}:${BODY_MARKER}`)});`,
        'setInterval(() => {}, 1000);',
      ].join(' '),
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  resources.memoryProbePid = Number(resources.memoryProbeProc.pid ?? 0);

  resources.processLaunchUserDataDir = await mkdtemp(join(tmpdir(), 'jshook-process-debug-'));
  report.process.launchDebug = await callTool(
    client,
    'process_launch_debug',
    {
      executablePath: getPreferredBrowserExecutable(),
      debugPort: processDebugPort,
      args: [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${resources.processLaunchUserDataDir}`,
        server.baseUrl,
      ],
    },
    60000,
  );
  resources.processLaunchPid = Number(report.process.launchDebug?.process?.pid ?? 0);
  if (Number.isFinite(resources.processLaunchPid) && resources.processLaunchPid > 0) {
    report.process.windows = await callTool(
      client,
      'process_windows',
      { pid: resources.processLaunchPid },
      15000,
    );
    report.process.checkDebugPort = await callTool(
      client,
      'process_check_debug_port',
      { pid: resources.processLaunchPid },
      15000,
    );
    report.process.nativeCheckDebugPort = await callTool(
      client,
      'check_debug_port',
      { pid: resources.processLaunchPid },
      15000,
    );
  }

  if (Number.isFinite(resources.processLaunchPid) && resources.processLaunchPid > 0) {
    resources.electronDebugUserDataDir = await mkdtemp(join(tmpdir(), 'jshook-electron-debug-'));
    const electronMainPort = await getFreePort();
    const electronRendererPort = await getFreePort();
    report.electron.launchDebug = await callToolCaptureError(
      client,
      'electron_launch_debug',
      {
        exePath: getPreferredBrowserExecutable(),
        mainPort: electronMainPort,
        rendererPort: electronRendererPort,
        waitMs: 10000,
        args: [
          '--headless=new',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-gpu',
          '--no-sandbox',
          `--user-data-dir=${resources.electronDebugUserDataDir}`,
          server.baseUrl,
        ],
      },
      45000,
    );
    resources.electronDebugPid = Number(report.electron.launchDebug?.pid ?? 0);
    report.electron.debugStatus = await callToolCaptureError(
      client,
      'electron_debug_status',
      {},
      15000,
    );
    const electronSessionId =
      typeof report.electron.launchDebug?.sessionId === 'string'
        ? report.electron.launchDebug.sessionId
        : null;
    if (electronSessionId) {
      report.electron.debugStatusSession = await callToolCaptureError(
        client,
        'electron_debug_status',
        { sessionId: electronSessionId },
        15000,
      );
    }
    report.electron.attach = await callToolCaptureError(
      client,
      'electron_attach',
      { port: electronRendererPort, evaluate: 'location.href' },
      30000,
    );
    report.electron.ipcSniffStart = await callToolCaptureError(
      client,
      'electron_ipc_sniff',
      { action: 'start', port: electronRendererPort },
      30000,
    );
    if (typeof report.electron.ipcSniffStart?.sessionId === 'string') {
      report.electron.ipcSniffDump = await callToolCaptureError(
        client,
        'electron_ipc_sniff',
        { action: 'dump', sessionId: report.electron.ipcSniffStart.sessionId },
        30000,
      );
      report.electron.ipcSniffStop = await callToolCaptureError(
        client,
        'electron_ipc_sniff',
        { action: 'stop', sessionId: report.electron.ipcSniffStart.sessionId },
        30000,
      );
    }
  }
}
