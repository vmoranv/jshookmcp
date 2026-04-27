import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export async function runSourcemapAttachSyscallPhase(ctx) {
  const { report, server, clients, state, helpers, constants } = ctx;
  const { client } = clients;
  const {
    withTimeout,
    callTool,
    callToolCaptureError,
    createClientTransport,
    flattenStrings,
    getFreePort,
    getPreferredBrowserExecutable,
    isRecord,
    waitForBrowserEndpoint,
  } = helpers;
  const { BODY_MARKER, SOURCEMAP_MARKER } = constants;
  const resources = state.runtimeResources;

  report.browser.sourceMapNavigate = await callTool(
    client,
    'page_navigate',
    { url: server.sourceMapPageUrl, waitUntil: 'load', timeout: 15000 },
    60000,
  );
  report.sourcemap.discover = await callTool(
    client,
    'sourcemap_discover',
    { includeInline: true },
    30000,
  );
  report.sourcemap.discoveredCount = Array.isArray(report.sourcemap.discover)
    ? report.sourcemap.discover.length
    : 0;
  const discoveredMap = Array.isArray(report.sourcemap.discover)
    ? report.sourcemap.discover.find(
        (item) =>
          isRecord(item) &&
          typeof item.scriptUrl === 'string' &&
          item.scriptUrl.includes('/sourcemap/app.min.js'),
      )
    : null;
  report.sourcemap.discoveredMapUrl =
    isRecord(discoveredMap) && typeof discoveredMap.sourceMapUrl === 'string'
      ? discoveredMap.sourceMapUrl
      : server.sourceMapUrl;
  report.sourcemap.parsed = await callTool(
    client,
    'sourcemap_fetch_and_parse',
    { sourceMapUrl: report.sourcemap.discoveredMapUrl },
    30000,
  );
  report.sourcemap.containsMarker = flattenStrings(report.sourcemap.parsed).some((entry) =>
    entry.includes(SOURCEMAP_MARKER),
  );
  report.sourcemap.reconstructed = await callTool(
    client,
    'sourcemap_reconstruct_tree',
    {
      sourceMapUrl: report.sourcemap.discoveredMapUrl,
      outputDir: join('.tmp_mcp_artifacts', `jshook-sourcemap-audit-${Date.now()}`),
    },
    30000,
  );
  report.sourcemap.reconstructedContainsMarker = false;
  if (
    isRecord(report.sourcemap.reconstructed) &&
    typeof report.sourcemap.reconstructed.outputDir === 'string' &&
    Array.isArray(report.sourcemap.reconstructed.files)
  ) {
    for (const relativePath of report.sourcemap.reconstructed.files) {
      if (typeof relativePath !== 'string') continue;
      try {
        const content = await readFile(
          join(process.cwd(), report.sourcemap.reconstructed.outputDir, relativePath),
          'utf8',
        );
        if (content.includes(SOURCEMAP_MARKER)) {
          report.sourcemap.reconstructedContainsMarker = true;
          break;
        }
      } catch {}
    }
  }
  report.graphql.scriptReplacePersist = await callTool(
    client,
    'script_replace_persist',
    {
      url: `${server.baseUrl}/sourcemap/app.min.js`,
      replacement: `window.__scriptReplacePersistAudit = ${JSON.stringify(BODY_MARKER)};`,
    },
    30000,
  );
  report.graphql.scriptReplaceNavigate = await callTool(
    client,
    'page_navigate',
    { url: server.sourceMapPageUrl, waitUntil: 'load', timeout: 15000 },
    30000,
  );
  report.graphql.scriptReplaceState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        replaced: window.__scriptReplacePersistAudit ?? null,
        originalSeen: window.__sourceMapAudit ?? null,
      }))()`,
    },
    15000,
  );
  report.browser.emulateDevice = await callTool(
    client,
    'page_emulate_device',
    { device: 'iPhone' },
    15000,
  );
  report.browser.emulatedState = await callTool(
    client,
    'page_evaluate',
    { code: '(() => ({ width: window.innerWidth, ua: navigator.userAgent }))()' },
    15000,
  );
  report.analysis.clearCollectedData = await callTool(client, 'clear_collected_data', {}, 15000);
  report.maintenance.manualCleanup = await callTool(client, 'manual_token_cleanup', {}, 15000);
  report.maintenance.resetTokenBudget = await callTool(client, 'reset_token_budget', {}, 15000);
  report.maintenance.tokenStatsAfterReset = await callTool(
    client,
    'get_token_budget_stats',
    {},
    15000,
  );
  report.maintenance.clearAllCaches = await callTool(client, 'clear_all_caches', {}, 15000);
  report.maintenance.cleanupArtifacts = await callTool(
    client,
    'cleanup_artifacts',
    { dryRun: true, retentionDays: 0, maxTotalBytes: 1024 * 1024 },
    30000,
  );

  const externalBrowserPort = await getFreePort();
  const externalBrowserURL = `http://127.0.0.1:${externalBrowserPort}`;
  const browserExecutable = getPreferredBrowserExecutable();
  resources.externalBrowserUserDataDir = await mkdtemp(join(tmpdir(), 'jshook-browser-attach-'));
  resources.externalBrowserProc = spawn(
    browserExecutable,
    [
      `--remote-debugging-port=${externalBrowserPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${resources.externalBrowserUserDataDir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--no-sandbox',
      server.baseUrl,
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  report.browser.attachExternalVersion = await waitForBrowserEndpoint(externalBrowserURL, 20000);
  resources.attachClient = new Client(
    { name: 'runtime-tool-probe-browser-attach', version: '1.0.0' },
    { capabilities: {} },
  );
  resources.attachTransport = createClientTransport('full', ctx.sharedEnv);
  await withTimeout(
    resources.attachClient.connect(resources.attachTransport),
    'connect-browser-attach',
    30000,
  );
  report.browser.attachExternal = await callTool(
    resources.attachClient,
    'browser_attach',
    { browserURL: externalBrowserURL, pageIndex: 0 },
    30000,
  );
  report.browser.attachExternalEval = await callTool(
    resources.attachClient,
    'page_evaluate',
    { code: '(() => ({ href: location.href, title: document.title }))()' },
    15000,
  );

  if (!report.canvas.traceClick && isRecord(report.canvas.traceClickInput)) {
    report.canvas.traceClick = await callToolCaptureError(
      client,
      'canvas_trace_click_handler',
      report.canvas.traceClickInput,
      10000,
    );
  }
  report.network.disable = await callTool(client, 'network_disable', {}, 15000);
  if (Number.isFinite(resources.memoryProbePid) && resources.memoryProbePid > 0) {
    report.syscall.start = await callToolCaptureError(
      client,
      'syscall_start_monitor',
      { backend: 'etw', pid: resources.memoryProbePid, simulate: true },
      15000,
    );
    report.syscall.capture = await callToolCaptureError(
      client,
      'syscall_capture_events',
      { filter: { pid: resources.memoryProbePid } },
      15000,
    );
    report.syscall.filter = await callToolCaptureError(
      client,
      'syscall_filter',
      { names: ['NtCreateFile'] },
      15000,
    );
    report.syscall.correlate = await callToolCaptureError(
      client,
      'syscall_correlate_js',
      {
        syscallEvents: [
          {
            timestamp: Date.now(),
            pid: resources.memoryProbePid,
            syscall: 'NtCreateFile',
            args: ['0x1', '0x2'],
            returnValue: 0,
            duration: 1,
          },
        ],
      },
      15000,
    );
    report.syscall.stats = await callToolCaptureError(client, 'syscall_get_stats', {}, 15000);
    report.syscall.stop = await callToolCaptureError(client, 'syscall_stop_monitor', {}, 15000);
    report.tls.certPinBypass = await callToolCaptureError(
      client,
      'tls_cert_pin_bypass',
      { target: 'desktop' },
      15000,
    );
    report.tls.certPinBypassFrida = await callToolCaptureError(
      client,
      'tls_cert_pin_bypass_frida',
      {},
      15000,
    );
  }
}
