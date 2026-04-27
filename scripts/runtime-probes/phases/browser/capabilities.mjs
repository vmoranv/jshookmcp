export async function runBrowserCapabilitiesPhase(ctx) {
  const { report, server, clients, helpers, constants, state } = ctx;
  const { client } = clients;
  const {
    callTool,
    callToolCaptureError,
    getFreePort,
    isCapabilityAvailable,
    extractString,
    getCapability,
    pickBrowserCdpTarget,
    isRecord,
  } = helpers;
  const { BODY_MARKER, HEAP_MARKER, HOOK_PRESET_MARKER } = constants;
  const { cpuProfilePath, heapSamplingPath } = state.browserContext;

  report.analysis.antidebugBypass = await callToolCaptureError(
    client,
    'antidebug_bypass',
    { types: ['timing', 'console_detect'], persistent: true },
    30000,
  );
  report.analysis.antidebugDetect = await callToolCaptureError(
    client,
    'antidebug_detect_protections',
    {},
    30000,
  );
  report.browser.aiHookInject = await callToolCaptureError(
    client,
    'ai_hook',
    {
      action: 'inject',
      hookId: 'runtime-audit-ai-hook',
      code: `(() => {
        window.__aiHooks = window.__aiHooks || {};
        window.__aiHookMetadata = window.__aiHookMetadata || {};
        window.__aiHooks['runtime-audit-ai-hook'] = window.__aiHooks['runtime-audit-ai-hook'] || [];
        window.__aiHookMetadata['runtime-audit-ai-hook'] = { enabled: true, source: 'runtime-audit' };
        window.__aiHooks['runtime-audit-ai-hook'].push({ marker: ${JSON.stringify(BODY_MARKER)}, ts: Date.now() });
        return true;
      })()`,
    },
    30000,
  );
  report.browser.aiHookData = await callToolCaptureError(
    client,
    'ai_hook',
    { action: 'get_data', hookId: 'runtime-audit-ai-hook' },
    30000,
  );
  report.browser.aiHookList = await callToolCaptureError(
    client,
    'ai_hook',
    { action: 'list' },
    30000,
  );
  report.browser.camoufoxGeolocation = await callToolCaptureError(
    client,
    'camoufox_geolocation',
    { locale: 'en-US' },
    30000,
  );
  report.browser.camoufoxServer = await callToolCaptureError(
    client,
    'camoufox_server',
    { action: 'launch', port: await getFreePort(), headless: true },
    30000,
  );
  report.captcha.visionManual = await callToolCaptureError(
    client,
    'captcha_vision_solve',
    { mode: 'manual', challengeType: 'auto' },
    30000,
  );
  report.captcha.widgetManual = await callToolCaptureError(
    client,
    'widget_challenge_solve',
    { mode: 'manual' },
    30000,
  );
  report.instrumentation.sessionCreate = await callToolCaptureError(
    client,
    'instrumentation_session',
    { action: 'create', name: 'runtime-audit-session' },
    30000,
  );
  report.instrumentation.sessionList = await callToolCaptureError(
    client,
    'instrumentation_session',
    { action: 'list' },
    30000,
  );
  state.instrumentationSessionId =
    typeof report.instrumentation.sessionCreate?.session?.id === 'string'
      ? report.instrumentation.sessionCreate.session.id
      : null;
  if (state.instrumentationSessionId) {
    report.instrumentation.sessionStatus = await callToolCaptureError(
      client,
      'instrumentation_session',
      { action: 'status', sessionId: state.instrumentationSessionId },
      30000,
    );
    report.instrumentation.operationRegister = await callToolCaptureError(
      client,
      'instrumentation_operation',
      {
        action: 'register',
        sessionId: state.instrumentationSessionId,
        type: 'runtime-hook',
        target: 'runtime-audit-operation',
        config: { marker: BODY_MARKER },
      },
      30000,
    );
    report.instrumentation.operationList = await callToolCaptureError(
      client,
      'instrumentation_operation',
      { action: 'list', sessionId: state.instrumentationSessionId },
      30000,
    );
    const instrumentationOperationId =
      typeof report.instrumentation.operationRegister?.operation?.id === 'string'
        ? report.instrumentation.operationRegister.operation.id
        : null;
    if (instrumentationOperationId) {
      report.instrumentation.artifactRecord = await callToolCaptureError(
        client,
        'instrumentation_artifact',
        {
          action: 'record',
          sessionId: state.instrumentationSessionId,
          operationId: instrumentationOperationId,
          data: { marker: BODY_MARKER, phase: 'manual-record' },
        },
        30000,
      );
    }
    report.instrumentation.artifactQuery = await callToolCaptureError(
      client,
      'instrumentation_artifact',
      { action: 'query', sessionId: state.instrumentationSessionId, limit: 10 },
      30000,
    );
    report.instrumentation.hookPreset = await callToolCaptureError(
      client,
      'instrumentation_hook_preset',
      {
        sessionId: state.instrumentationSessionId,
        preset: 'runtime-audit-instrumentation',
        customTemplate: {
          id: 'runtime-audit-instrumentation',
          description: 'Sets an instrumentation marker on window.',
          body: `window.__instrumentationHookMarker = ${JSON.stringify(HOOK_PRESET_MARKER)};`,
        },
        method: 'evaluate',
        logToConsole: false,
      },
      30000,
    );
  }
  report.analysis.manageHooksCreate = await callTool(
    client,
    'manage_hooks',
    { action: 'create', target: 'fetch', type: 'function', hookAction: 'log' },
    15000,
  );
  report.analysis.manageHooksList = await callTool(
    client,
    'manage_hooks',
    { action: 'list' },
    15000,
  );
  const managedHookId =
    typeof report.analysis.manageHooksCreate?.hookId === 'string'
      ? report.analysis.manageHooksCreate.hookId
      : null;
  if (managedHookId) {
    report.analysis.manageHooksRecords = await callTool(
      client,
      'manage_hooks',
      { action: 'records', hookId: managedHookId },
      15000,
    );
    report.analysis.manageHooksClear = await callTool(
      client,
      'manage_hooks',
      { action: 'clear', hookId: managedHookId },
      15000,
    );
  }
  report.browser.seedHeapMarker = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        window.__auditHeapMarker = ${JSON.stringify(HEAP_MARKER)};
        window.__auditHeapStore = {
          marker: window.__auditHeapMarker,
          nested: [window.__auditHeapMarker, 'secondary']
        };
        return {
          marker: window.__auditHeapMarker,
          nestedCount: window.__auditHeapStore.nested.length
        };
      })()`,
    },
    15000,
  );
  report.browser.jsHeapSearch = await callTool(
    client,
    'js_heap_search',
    { pattern: HEAP_MARKER, maxResults: 5 },
    90000,
  );
  report.workflow.jsBundleSearch = await callTool(
    client,
    'js_bundle_search',
    {
      url: `${server.baseUrl}/app.js`,
      patterns: [
        { name: 'marker', regex: '__auditRuntimeProbeMarker__' },
        { name: 'typing', regex: '__auditTypedValue' },
      ],
      networkPolicy: {
        allowedHosts: ['127.0.0.1'],
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
      },
    },
    30000,
  );
  report.analysis.seedCallGraph = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        window.__functionTraceRecords = [
          { caller: 'auditCaller', callee: 'auditCallee' },
          { caller: 'auditCallee', callee: 'auditLeaf' }
        ];
        return { seeded: true, count: window.__functionTraceRecords.length };
      })()`,
    },
    15000,
  );
  report.analysis.callGraph = await callTool(
    client,
    'call_graph_analyze',
    { filterPattern: 'audit', maxDepth: 3 },
    30000,
  );
  report.performance.metrics = await callTool(client, 'performance_get_metrics', {}, 30000);
  report.performance.coverageStart = await callTool(
    client,
    'performance_coverage',
    { action: 'start' },
    30000,
  );
  report.performance.coverageExercise = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        const values = [];
        for (let i = 0; i < 250; i += 1) values.push(i * 2);
        window.__coverageProbe = values.length;
        return { count: values.length };
      })()`,
    },
    15000,
  );
  report.performance.coverageStop = await callTool(
    client,
    'performance_coverage',
    { action: 'stop' },
    30000,
  );
  report.performance.heapSnapshot = await callTool(
    client,
    'performance_take_heap_snapshot',
    {},
    90000,
  );
  report.performance.cpuStart = await callTool(client, 'profiler_cpu', { action: 'start' }, 30000);
  report.performance.cpuExercise = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        let acc = 0;
        for (let i = 0; i < 200000; i += 1) {
          acc += Math.sqrt(i);
        }
        window.__cpuProbe = acc;
        return { acc };
      })()`,
    },
    30000,
  );
  report.performance.cpuStop = await callTool(
    client,
    'profiler_cpu',
    { action: 'stop', artifactPath: cpuProfilePath },
    60000,
  );
  report.performance.heapSamplingStart = await callTool(
    client,
    'profiler_heap_sampling',
    { action: 'start' },
    30000,
  );
  report.performance.heapSamplingExercise = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        window.__heapProbe = Array.from({ length: 5000 }, (_, i) => ({
          i,
          text: 'x'.repeat(32),
        }));
        return { allocated: window.__heapProbe.length };
      })()`,
    },
    30000,
  );
  report.performance.heapSamplingStop = await callTool(
    client,
    'profiler_heap_sampling',
    { action: 'stop', artifactPath: heapSamplingPath, topN: 10 },
    60000,
  );
  report.browser.listTabs = await callTool(client, 'browser_list_tabs', {}, 30000);
  report.browser.selectTab = await callTool(client, 'browser_select_tab', { index: 0 }, 15000);
  report.browser.cdpTargets = await callTool(client, 'browser_list_cdp_targets', {}, 30000);
  const cdpTarget = pickBrowserCdpTarget(report.browser.cdpTargets?.targets, server.baseUrl);
  report.browser.cdpTargetId =
    isRecord(cdpTarget) && typeof cdpTarget.targetId === 'string' ? cdpTarget.targetId : null;
  if (report.browser.cdpTargetId) {
    report.browser.cdpAttach = await callTool(
      client,
      'browser_attach_cdp_target',
      { targetId: report.browser.cdpTargetId },
      30000,
    );
    report.browser.cdpEvaluate = await callTool(
      client,
      'browser_evaluate_cdp_target',
      {
        code: `(() => ({
          href: location.href,
          title: document.title,
          bodyLength: document.body?.textContent?.length ?? 0
        }))()`,
      },
      30000,
    );
    report.browser.cdpDetach = await callTool(client, 'browser_detach_cdp_target', {}, 15000);
  }
  report.browser.tabWorkflowBind = await callTool(
    client,
    'tab_workflow',
    { action: 'alias_bind', alias: 'main', index: 0 },
    15000,
  );
  report.browser.tabWorkflowContextSet = await callTool(
    client,
    'tab_workflow',
    { action: 'context_set', key: 'auditKey', value: BODY_MARKER },
    15000,
  );
  report.browser.tabWorkflowContextGet = await callTool(
    client,
    'tab_workflow',
    { action: 'context_get', key: 'auditKey' },
    15000,
  );
  report.browser.tabWorkflowTransfer = await callTool(
    client,
    'tab_workflow',
    { action: 'transfer', fromAlias: 'main', key: 'mainTitle', expression: 'document.title' },
    15000,
  );
  report.browser.tabWorkflowOpen = await callTool(
    client,
    'tab_workflow',
    { action: 'alias_open', alias: 'history', url: `${server.baseUrl}/history/one` },
    30000,
  );
  report.browser.tabWorkflowWait = await callTool(
    client,
    'tab_workflow',
    { action: 'wait_for', alias: 'history', selector: '[data-page="one"]', timeoutMs: 10000 },
    15000,
  );
  report.browser.tabWorkflowList = await callTool(
    client,
    'tab_workflow',
    { action: 'list' },
    15000,
  );
  report.browser.tabWorkflowClear = await callTool(
    client,
    'tab_workflow',
    { action: 'clear' },
    15000,
  );
  report.captcha.capabilities = await callTool(client, 'captcha_solver_capabilities', {}, 15000);
  report.captcha.manualAvailable = isCapabilityAvailable(
    report.captcha.capabilities,
    'captcha_manual',
  );
  report.captcha.external2captchaAvailable = isCapabilityAvailable(
    report.captcha.capabilities,
    'captcha_external_service_2captcha',
  );
  report.captcha.widgetHookAvailable = isCapabilityAvailable(
    report.captcha.capabilities,
    'captcha_widget_hook_current_page',
  );
  report.captcha.configuredProvider =
    extractString(report.captcha.capabilities, ['configuredProvider']) ??
    extractString(getCapability(report.captcha.capabilities, 'captcha_external_service_2captcha'), [
      'configuredProvider',
    ]) ??
    null;
  report.captcha.config = await callTool(
    client,
    'captcha_config',
    {
      autoDetectCaptcha: true,
      autoSwitchHeadless: false,
      captchaTimeout: 1500,
    },
    15000,
  );
  report.captcha.detect = await callTool(client, 'captcha_detect', {}, 30000);
  report.captcha.wait = await callTool(client, 'captcha_wait', { timeout: 1500 }, 30000);
  report.stealth.fingerprint = await callTool(
    client,
    'stealth_generate_fingerprint',
    { os: 'windows', browser: 'chrome', locale: 'en-US' },
    30000,
  );
  report.stealth.userAgent = await callTool(
    client,
    'stealth_set_user_agent',
    { platform: 'windows' },
    30000,
  );
  report.stealth.jitter = await callTool(
    client,
    'stealth_configure_jitter',
    { enabled: true, minDelayMs: 1, maxDelayMs: 2, burstMode: false },
    15000,
  );
  report.stealth.inject = await callTool(client, 'stealth_inject', {}, 30000);
  report.stealth.verify = await callTool(client, 'stealth_verify', {}, 30000);
  report.wasm.capabilities = await callTool(client, 'wasm_capabilities', {}, 15000);
  report.wasm.pageCaptureAvailable = isCapabilityAvailable(
    report.wasm.capabilities,
    'wasm_browser_capture_current_page',
  );
  report.wasm.wasm2watAvailable = isCapabilityAvailable(report.wasm.capabilities, 'wabt_wasm2wat');
  report.wasm.offlineRuntimeAvailable = isCapabilityAvailable(
    report.wasm.capabilities,
    'wasm_offline_runtime',
  );
}
