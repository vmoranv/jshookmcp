import { serializeForInlineScript } from '../../helpers/inline-script.mjs';

export async function runCrossDomainBinaryPhase(ctx) {
  const { report, server, clients, helpers, constants } = ctx;
  const { client } = clients;
  const { callTool, extractString, flattenStrings, getNewestChromePid, isRecord } = helpers;
  const { BODY_MARKER, HEAP_MARKER } = constants;
  const bodyMarkerLiteral = serializeForInlineScript(BODY_MARKER);
  const heapMarkerLiteral = serializeForInlineScript(HEAP_MARKER);

  const crossDomainUrl = `${server.baseUrl}/body?via=cross-domain`;
  report.crossDomain.capabilities = await callTool(client, 'cross_domain_capabilities', {}, 15000);
  report.crossDomain.suggest = await callTool(
    client,
    'cross_domain_suggest_workflow',
    {
      goal: 'binary frida hook and network correlation',
      preferAvailableOnly: false,
    },
    15000,
  );
  report.crossDomain.health = await callTool(client, 'cross_domain_health', {}, 15000);
  report.crossDomain.correlate = await callTool(
    client,
    'cross_domain_correlate_all',
    {
      sceneTree: {
        layers: [{ id: 'layer-1', label: 'readFileBuffer', type: 'picture', heapObjectId: '0x1' }],
        drawCommands: [{ id: 'draw-1', type: 'text', label: 'readFileBuffer' }],
      },
      jsObjects: [
        {
          objectId: '0x1',
          className: 'Function',
          name: 'readFileBuffer',
          stringProps: ['readFileBuffer'],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ],
      mojoMessages: [
        {
          interface: 'network.mojom.URLLoader',
          method: 'FollowRedirect',
          timestamp: 1000,
          messageId: 'mojo-1',
        },
      ],
      cdpEvents: [{ eventType: 'Network.requestWillBeSent', timestamp: 1010, url: crossDomainUrl }],
      networkRequests: [{ requestId: 'req-cross-1', url: crossDomainUrl, timestamp: 1005 }],
      syscallEvents: [{ pid: 1, tid: 42, syscallName: 'NtReadFile', timestamp: 2000 }],
      jsStacks: [{ threadId: 42, timestamp: 2000, frames: [{ functionName: 'readFileBuffer' }] }],
      ghidraOutput: {
        moduleName: 'audit.dll',
        functions: [{ name: 'JS_readFileBuffer', moduleName: 'audit.dll', address: '0x1000' }],
      },
    },
    30000,
  );
  report.crossDomain.export = await callTool(client, 'cross_domain_evidence_export', {}, 15000);
  report.crossDomain.stats = await callTool(client, 'cross_domain_evidence_stats', {}, 15000);
  report.evidence.query = await callTool(
    client,
    'evidence_query',
    { by: 'url', value: crossDomainUrl },
    15000,
  );
  const firstEvidenceNodeId =
    Array.isArray(report.evidence.query?.nodes) &&
    isRecord(report.evidence.query.nodes[0]) &&
    typeof report.evidence.query.nodes[0].id === 'string'
      ? report.evidence.query.nodes[0].id
      : null;
  if (firstEvidenceNodeId) {
    report.evidence.chain = await callTool(
      client,
      'evidence_chain',
      { nodeId: firstEvidenceNodeId, direction: 'forward' },
      15000,
    );
  }
  report.evidence.exportJson = await callTool(client, 'evidence_export', { format: 'json' }, 15000);
  report.evidence.exportMarkdown = await callTool(
    client,
    'evidence_export',
    { format: 'markdown' },
    15000,
  );

  const sandboxSessionId = `runtime-audit-${Date.now()}`;
  report.sandbox.run = await callTool(
    client,
    'execute_sandbox_script',
    {
      code: `(() => ({ ok: true, marker: ${bodyMarkerLiteral}, __scratchpad: { marker: ${bodyMarkerLiteral} } }))()`,
      sessionId: sandboxSessionId,
      timeoutMs: 2000,
    },
    30000,
  );
  report.sandbox.ok = flattenStrings(report.sandbox.run).some((entry) => entry.includes('Success'));
  report.sandbox.read = await callTool(
    client,
    'execute_sandbox_script',
    {
      code: '__scratchpad.marker',
      sessionId: sandboxSessionId,
      timeoutMs: 2000,
    },
    30000,
  );
  report.sandbox.persisted = flattenStrings(report.sandbox.read).some((entry) =>
    entry.includes(BODY_MARKER),
  );

  const chromePid = await getNewestChromePid();
  report.binary.chromePid = chromePid;
  const fridaTarget = chromePid ?? 'chrome';
  report.binary.attach = await callTool(client, 'frida_attach', { target: fridaTarget }, 30000);
  const sessionId = extractString(report.binary.attach, ['sessionId']);
  report.binary.sessionId = sessionId;
  report.binary.listSessions = await callTool(client, 'frida_list_sessions', {}, 15000);
  report.binary.generateScript = await callTool(
    client,
    'frida_generate_script',
    {
      target: fridaTarget,
      template: 'trace',
      functionName: 'CreateFileW',
    },
    15000,
  );

  if (sessionId) {
    report.binary.modules = await callTool(client, 'frida_enumerate_modules', { sessionId }, 30000);
    const fridaPreferredModule = Array.isArray(report.binary.modules?.modules)
      ? report.binary.modules.modules.find(
          (entry) =>
            isRecord(entry) &&
            typeof entry.name === 'string' &&
            /^(kernel32\.dll|kernelbase\.dll)$/i.test(entry.name),
        )
      : null;
    const fridaModuleName =
      isRecord(fridaPreferredModule) && typeof fridaPreferredModule.name === 'string'
        ? fridaPreferredModule.name
        : 'KERNEL32.DLL';
    report.binary.enumerateFunctions = await callTool(
      client,
      'frida_enumerate_functions',
      { sessionId, moduleName: fridaModuleName },
      30000,
    );
    report.binary.findSymbols = await callTool(
      client,
      'frida_find_symbols',
      { sessionId, pattern: 'CreateFileW' },
      30000,
    );
    report.binary.runScript = await callTool(
      client,
      'frida_run_script',
      {
        sessionId,
        script:
          'console.log(JSON.stringify({pid: Process.id, arch: Process.arch, platform: Process.platform}));',
      },
      30000,
    );
    report.binary.detach = await callTool(client, 'frida_detach', { sessionId }, 15000);
  }

  report.binary.moduleSample = Array.isArray(report.binary.modules?.modules)
    ? report.binary.modules.modules.slice(0, 5).map((entry) => entry.name)
    : [];

  report.mojo.listInterfaces = await callTool(client, 'mojo_list_interfaces', {}, 15000);
  report.mojo.messages = await callTool(client, 'mojo_messages_get', {}, 15000);
  report.mojo.decode = await callTool(
    client,
    'mojo_decode_message',
    { hexPayload: '000100020000000300000000' },
    15000,
  );
  report.mojo.monitorSimulation = Boolean(
    report.mojo.monitorStart?._simulation ?? report.mojo.messages?._simulation,
  );
  report.mojo.interfaceCatalogSource =
    report.mojo.listInterfaces?.interfaceCatalogSource ?? 'unknown';
  report.mojo.messageCount = Array.isArray(report.mojo.messages?.messages)
    ? report.mojo.messages.messages.length
    : 0;

  report.v8.capture = await callTool(client, 'v8_heap_snapshot_capture', {}, 90000);
  report.v8.stats = await callTool(client, 'v8_heap_stats', {}, 30000);
  if (report.v8.capture?.snapshotId) {
    report.v8.analyze = await callTool(
      client,
      'v8_heap_snapshot_analyze',
      { snapshotId: report.v8.capture.snapshotId },
      30000,
    );
    report.v8.heapDiffSeed = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => {
          window.__heapAuditBuffer = Array.from(
            { length: 8192 },
            (_, index) => ${heapMarkerLiteral} + ':' + index,
          );
          return {
            length: window.__heapAuditBuffer.length,
            tail: window.__heapAuditBuffer[window.__heapAuditBuffer.length - 1],
          };
        })()`,
      },
      30000,
    );
    report.v8.captureAfter = await callTool(client, 'v8_heap_snapshot_capture', {}, 90000);
    if (report.v8.captureAfter?.snapshotId) {
      report.v8.diff = await callTool(
        client,
        'v8_heap_diff',
        {
          beforeSnapshotId: report.v8.capture.snapshotId,
          afterSnapshotId: report.v8.captureAfter.snapshotId,
        },
        30000,
      );
    }
  }
}
