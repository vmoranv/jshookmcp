export async function runV8Phase(ctx) {
  const { report, clients, state, helpers } = ctx;
  const { client } = clients;
  const { callTool, callToolCaptureError, isRecord, extractString, pickScriptForV8Inspection } =
    helpers;
  const { v8BytecodeFixturePath } = state.platformPaths;

  report.v8.debugger = await callTool(client, 'debugger_lifecycle', { action: 'enable' }, 30000);
  report.v8.version = await callTool(client, 'v8_version_detect', {}, 30000);
  report.v8.scripts = await callTool(client, 'get_all_scripts', { maxScripts: 200 }, 30000);
  const firstScript = pickScriptForV8Inspection(report.v8.scripts?.scripts);
  report.v8.firstScriptId =
    isRecord(firstScript) && typeof firstScript.scriptId === 'string' ? firstScript.scriptId : null;
  report.v8.firstScriptUrl =
    isRecord(firstScript) && typeof firstScript.url === 'string' && firstScript.url.length > 0
      ? firstScript.url
      : null;
  report.browser.scriptSource = await callTool(
    client,
    'get_script_source',
    { url: '*audit-probe.js', preview: true, maxLines: 20 },
    30000,
  );
  report.v8.auditProbeScriptId =
    typeof report.browser.scriptSource?.scriptId === 'string'
      ? report.browser.scriptSource.scriptId
      : null;
  if (report.v8.firstScriptUrl) {
    report.v8.breakpointSet = await callTool(
      client,
      'breakpoint',
      {
        action: 'set',
        type: 'code',
        url: report.v8.firstScriptUrl,
        lineNumber: 0,
      },
      30000,
    );
    report.v8.breakpointList = await callTool(
      client,
      'breakpoint',
      { action: 'list', type: 'code' },
      15000,
    );
    report.v8.sessionExport = await callTool(
      client,
      'debugger_session',
      { action: 'export', metadata: { source: 'runtime-audit' } },
      15000,
    );
    report.v8.sessionSave = await callTool(
      client,
      'debugger_session',
      { action: 'save', metadata: { source: 'runtime-audit' } },
      15000,
    );
    report.v8.sessionList = await callTool(client, 'debugger_session', { action: 'list' }, 15000);
    const debuggerBreakpointId =
      typeof report.v8.breakpointSet?.breakpoint?.breakpointId === 'string'
        ? report.v8.breakpointSet.breakpoint.breakpointId
        : null;
    if (debuggerBreakpointId) {
      report.v8.breakpointRemove = await callTool(
        client,
        'breakpoint',
        { action: 'remove', type: 'code', breakpointId: debuggerBreakpointId },
        15000,
      );
      report.v8.breakpointListAfterRemove = await callTool(
        client,
        'breakpoint',
        { action: 'list', type: 'code' },
        15000,
      );
    }
    if (isRecord(report.v8.sessionExport?.session)) {
      report.v8.sessionLoad = await callTool(
        client,
        'debugger_session',
        {
          action: 'load',
          sessionData: JSON.stringify(report.v8.sessionExport.session),
        },
        30000,
      );
      report.v8.breakpointListAfterLoad = await callTool(
        client,
        'breakpoint',
        { action: 'list', type: 'code' },
        15000,
      );
    }
    report.v8.blackboxAdd = await callTool(
      client,
      'blackbox_add',
      { urlPattern: '*audit-probe.js' },
      30000,
    );
    report.v8.blackboxAddCommon = await callTool(client, 'blackbox_add_common', {}, 30000);
    report.v8.blackboxList = await callTool(client, 'blackbox_list', {}, 15000);
  }
  if (report.v8.auditProbeScriptId) {
    report.v8.bytecode = await callTool(
      client,
      'v8_bytecode_extract',
      { scriptId: report.v8.auditProbeScriptId },
      30000,
    );
    report.v8.bytecodeSourceFallback = await callTool(
      client,
      'v8_bytecode_extract',
      {
        scriptId: report.v8.auditProbeScriptId,
        includeSourceFallback: true,
      },
      30000,
    );
    report.v8.jit = await callTool(
      client,
      'v8_jit_inspect',
      { scriptId: report.v8.auditProbeScriptId },
      30000,
    );
    report.v8.bytecodeDecompile = await callToolCaptureError(
      client,
      'v8_bytecode_decompile',
      { filePath: v8BytecodeFixturePath },
      30000,
    );
    report.analysis.extractFunctionTree = await callTool(
      client,
      'extract_function_tree',
      {
        scriptId: report.v8.auditProbeScriptId,
        functionName: 'auditProbeFn',
        maxDepth: 3,
      },
      30000,
    );
  }
  report.browser.largeScriptPreview = await callTool(
    client,
    'get_script_source',
    { url: '*audit-large.js', preview: true, maxLines: 5 },
    30000,
  );
  report.browser.largeScriptId =
    typeof report.browser.largeScriptPreview?.scriptId === 'string'
      ? report.browser.largeScriptPreview.scriptId
      : null;
  if (report.browser.largeScriptId) {
    report.browser.largeScriptSource = await callTool(
      client,
      'get_script_source',
      { scriptId: report.browser.largeScriptId, preview: false },
      30000,
    );
    if (typeof report.browser.largeScriptSource?.detailId === 'string') {
      const largeScriptSource = await callTool(
        client,
        'get_detailed_data',
        { detailId: report.browser.largeScriptSource.detailId, path: 'source' },
        30000,
      );
      const detailedSource =
        isRecord(largeScriptSource) && largeScriptSource.success === true
          ? largeScriptSource.data
          : largeScriptSource;
      report.browser.largeScriptDetailedData = {
        detailId: report.browser.largeScriptSource.detailId,
        sourceLength: typeof detailedSource === 'string' ? detailedSource.length : null,
        hasMarker:
          typeof detailedSource === 'string' && detailedSource.includes('window.__auditLargeText'),
      };
    }
  }
  report.v8.seedPauseTimer = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        if (window.__auditPauseTimer) {
          clearInterval(window.__auditPauseTimer);
        }
        window.__auditPauseCounter = 0;
        window.__auditPauseTimer = setInterval(() => {
          window.__auditPauseCounter = (window.__auditPauseCounter ?? 0) + 1;
        }, 25);
        return { intervalMs: 25, started: true };
      })()`,
    },
    15000,
  );
  report.v8.pause = await callTool(client, 'debugger_pause', {}, 15000);
  report.v8.waitForPaused = await callTool(
    client,
    'debugger_wait_for_paused',
    { timeout: 5000 },
    10000,
  );
  report.v8.pausedState = await callTool(client, 'debugger_get_paused_state', {}, 15000);
  report.v8.callStack = await callTool(client, 'get_call_stack', {}, 15000);
  report.v8.frameEvaluate = await callTool(
    client,
    'debugger_evaluate',
    { expression: '1 + 2 + 4' },
    15000,
  );
  report.v8.scopeEnhanced = await callTool(
    client,
    'get_scope_variables_enhanced',
    {
      includeObjectProperties: false,
      maxDepth: 1,
    },
    30000,
  );
  {
    const scopedObject =
      Array.isArray(report.v8.scopeEnhanced?.variables) &&
      report.v8.scopeEnhanced.variables.find(
        (entry) =>
          isRecord(entry) && typeof entry.objectId === 'string' && entry.objectId.length > 0,
      );
    report.v8.scopeObjectId =
      isRecord(scopedObject) && typeof scopedObject.objectId === 'string'
        ? scopedObject.objectId
        : null;
    report.v8.scopeObjectName =
      isRecord(scopedObject) && typeof scopedObject.name === 'string' ? scopedObject.name : null;
  }
  if (report.v8.scopeObjectId) {
    report.v8.objectInspect = await callTool(
      client,
      'v8_object_inspect',
      { address: report.v8.scopeObjectId },
      15000,
    );
  }
  const pausedCallFrameId = extractString(report.v8.callStack, [
    'callStack',
    'frames',
    0,
    'callFrameId',
  ]);
  report.v8.watchAdd = await callTool(
    client,
    'watch',
    { action: 'add', expression: 'window.__auditPauseCounter ?? null', name: 'pauseCounter' },
    15000,
  );
  report.v8.watchList = await callTool(client, 'watch', { action: 'list' }, 15000);
  report.v8.watchEvaluateAll = await callTool(
    client,
    'watch',
    pausedCallFrameId
      ? { action: 'evaluate_all', callFrameId: pausedCallFrameId }
      : { action: 'evaluate_all' },
    15000,
  );
  if (report.v8.scopeObjectId) {
    report.v8.objectProperties = await callTool(
      client,
      'get_object_properties',
      { objectId: report.v8.scopeObjectId },
      30000,
    );
  }
  report.v8.stepOver = await callTool(client, 'debugger_step', { direction: 'over' }, 15000);
  report.v8.waitAfterStep = await callTool(
    client,
    'debugger_wait_for_paused',
    { timeout: 5000 },
    10000,
  );
  report.v8.resume = await callTool(client, 'debugger_resume', {}, 15000);
  report.v8.pausedAfterResume = await callTool(client, 'debugger_get_paused_state', {}, 15000);
  report.v8.clearPauseTimer = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        const counter = window.__auditPauseCounter ?? 0;
        if (window.__auditPauseTimer) {
          clearInterval(window.__auditPauseTimer);
        }
        delete window.__auditPauseTimer;
        return { counter, cleared: true };
      })()`,
    },
    15000,
  );
  report.v8.watchClearAll = await callTool(client, 'watch', { action: 'clear_all' }, 15000);
}
