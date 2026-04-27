export async function runProxyAndTraceSetupPhase(ctx) {
  const { report, server, clients, helpers, constants } = ctx;
  const { client } = clients;
  const { callTool, callToolCaptureError, flattenStrings, getFreePort, sendRawHttpRequest } =
    helpers;
  const { BODY_MARKER } = constants;

  const proxyPort = await getFreePort();
  report.proxy.start = await callTool(
    client,
    'proxy_start',
    { port: proxyPort, useHttps: true },
    30000,
  );
  report.proxy.status = await callTool(client, 'proxy_status', {}, 15000);
  report.proxy.ca = await callTool(client, 'proxy_export_ca', {}, 15000);
  report.proxy.caHasPem = flattenStrings(report.proxy.ca).some((entry) =>
    entry.includes('BEGIN CERTIFICATE'),
  );
  report.proxy.setupAdbDevice = await callToolCaptureError(
    client,
    'proxy_setup_adb_device',
    { deviceSerial: 'runtime-audit-device' },
    30000,
  );
  report.adb.analyzeApk = await callToolCaptureError(
    client,
    'adb_apk_analyze',
    { serial: 'runtime-audit-device', packageName: 'com.runtime.audit' },
    30000,
  );
  report.adb.webviewList = await callToolCaptureError(
    client,
    'adb_webview_list',
    { serial: 'runtime-audit-device', hostPort: 9222 },
    30000,
  );
  report.adb.webviewAttach = await callToolCaptureError(
    client,
    'adb_webview_attach',
    { serial: 'runtime-audit-device', targetId: 'runtime-audit-target', hostPort: 9222 },
    30000,
  );
  report.proxy.rule = await callTool(
    client,
    'proxy_add_rule',
    {
      action: 'forward',
      method: 'GET',
      urlPattern: '/^\\/body$/',
    },
    30000,
  );
  const forwardedRawResponse = await sendRawHttpRequest(
    proxyPort,
    `GET ${server.baseUrl}/body?via=proxy HTTP/1.1\r\nHost: 127.0.0.1:${new URL(server.baseUrl).port}\r\nConnection: close\r\n\r\n`,
  );
  const headerSeparator = forwardedRawResponse.indexOf('\r\n\r\n');
  const statusLine =
    headerSeparator === -1
      ? (forwardedRawResponse.split('\r\n', 1)[0] ?? '')
      : (forwardedRawResponse.slice(0, headerSeparator).split('\r\n', 1)[0] ?? '');
  const bodyText =
    headerSeparator === -1 ? '' : forwardedRawResponse.slice(headerSeparator + '\r\n\r\n'.length);
  report.proxy.forwarded = {
    success: statusLine.length > 0,
    statusLine,
    responseBytes: Buffer.byteLength(forwardedRawResponse),
    bodyPreview: bodyText.slice(0, 256),
  };
  report.proxy.bodyHasMarker = bodyText.includes(BODY_MARKER);
  report.proxy.requestLogs = await callTool(
    client,
    'proxy_get_requests',
    { urlFilter: '/body?via=proxy' },
    15000,
  );
  report.proxy.clearLogs = await callTool(client, 'proxy_clear_logs', {}, 15000);
  report.proxy.logsAfterClear = await callTool(client, 'proxy_get_requests', {}, 15000);

  report.network.enable = await callTool(client, 'network_enable', {}, 15000);
  report.network.monitor = await callTool(client, 'network_monitor', { action: 'status' }, 15000);
  report.browser.consoleMonitor = await callTool(
    client,
    'console_monitor',
    { action: 'enable' },
    15000,
  );
  report.network.consoleInjectScript = await callTool(
    client,
    'console_inject',
    { type: 'script' },
    15000,
  );
  report.network.consoleInjectFetch = await callTool(
    client,
    'console_inject',
    { type: 'fetch' },
    15000,
  );
  report.network.consoleInjectXhr = await callTool(
    client,
    'console_inject_xhr_interceptor',
    { persistent: true },
    15000,
  );
  report.streaming.wsMonitor = await callTool(
    client,
    'ws_monitor',
    { action: 'enable', maxFrames: 1000 },
    15000,
  );
  report.streaming.sseMonitor = await callTool(
    client,
    'sse_monitor_enable',
    { maxEvents: 100, persistent: true },
    15000,
  );
  report.trace.start = await callTool(
    client,
    'start_trace_recording',
    {
      recordResponseBodies: true,
      streamResponseChunks: true,
      networkBodyMaxBytes: 1024 * 1024,
    },
    15000,
  );
  report.trace.heapSeedBefore = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        window.__traceAuditHeap = Array.from({ length: 4096 }, (_, index) => ({
          index,
          marker: 'trace-before',
          payload: 'a'.repeat(32),
        }));
        return { seeded: window.__traceAuditHeap.length };
      })()`,
    },
    15000,
  );
  report.trace.heapSnapshotBefore = await callTool(
    client,
    'performance_take_heap_snapshot',
    {},
    90000,
  );
}
