import { join } from 'node:path';

export async function runGraphqlWasmPhase(ctx) {
  const { report, server, clients, helpers, constants } = ctx;
  const { client } = clients;
  const { callTool } = helpers;
  const { GRAPHQL_BUFFER_PROBE_CODE, WEBPACK_MARKER } = constants;

  report.graphql.fetchInterceptor = await callTool(
    client,
    'console_inject_fetch_interceptor',
    { persistent: true },
    15000,
  );
  report.graphql.navigate = await callTool(
    client,
    'page_navigate',
    { url: server.graphqlPageUrl, waitUntil: 'load', timeout: 15000 },
    30000,
  );
  report.graphql.pageFetchInterceptor = await callTool(
    client,
    'console_inject_fetch_interceptor',
    { persistent: false },
    15000,
  );
  report.graphql.bufferStateBeforeSeed = await callTool(
    client,
    'page_evaluate',
    { code: GRAPHQL_BUFFER_PROBE_CODE },
    15000,
  );
  report.graphql.introspect = await callTool(
    client,
    'graphql_introspect',
    { endpoint: server.graphqlEndpointUrl },
    30000,
  );
  report.graphql.replay = await callTool(
    client,
    'graphql_replay',
    {
      endpoint: server.graphqlEndpointUrl,
      query: 'query AuditGreeting($name: String!) { auditGreeting(name: $name) __typename marker }',
      operationName: 'AuditGreeting',
      variables: { name: 'RuntimeAuditReplay' },
    },
    30000,
  );
  report.graphql.seedRequests = await callTool(
    client,
    'page_evaluate',
    { code: `window.runGraphqlAudit(${JSON.stringify('RuntimeAuditExtract')})` },
    30000,
  );
  report.graphql.bufferStateAfterSeed = await callTool(
    client,
    'page_evaluate',
    { code: GRAPHQL_BUFFER_PROBE_CODE },
    15000,
  );
  report.trace.heapSeedAfter = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        window.__traceAuditHeap = Array.from({ length: 8192 }, (_, index) => ({
          index,
          marker: 'trace-after',
          payload: 'b'.repeat(64),
        }));
        return { seeded: window.__traceAuditHeap.length };
      })()`,
    },
    15000,
  );
  report.trace.heapSnapshotAfter = await callTool(
    client,
    'performance_take_heap_snapshot',
    {},
    90000,
  );
  report.graphql.extract = await callTool(client, 'graphql_extract_queries', { limit: 10 }, 30000);
  report.wasm.hookPreset = await callTool(
    client,
    'hook_preset',
    {
      preset: 'webassembly-full',
      method: 'evaluateOnNewDocument',
      captureStack: false,
      logToConsole: false,
    },
    30000,
  );
  report.wasm.navigate = await callTool(
    client,
    'page_navigate',
    { url: server.wasmPageUrl, waitUntil: 'load', timeout: 15000 },
    30000,
  );
  report.wasm.pageState = await callTool(
    client,
    'page_evaluate',
    { code: '(() => window.__wasmRuntimeAudit ?? null)()' },
    15000,
  );
  report.wasm.capabilitiesAfterPage = await callTool(client, 'wasm_capabilities', {}, 15000);
  report.wasm.dump = await callTool(client, 'wasm_dump', {}, 30000);
  report.wasm.vmpTrace = await callTool(client, 'wasm_vmp_trace', { maxEvents: 20 }, 30000);
  report.wasm.memoryInspect = await callTool(
    client,
    'wasm_memory_inspect',
    { offset: 0, length: 32, searchPattern: 'WASM-AUDIT' },
    30000,
  );
  const wasmFixturePath = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'wasm', 'sample.wasm');
  report.wasm.disassemble = await callTool(
    client,
    'wasm_disassemble',
    { inputPath: wasmFixturePath },
    30000,
  );
  report.wasm.decompile = await callTool(
    client,
    'wasm_decompile',
    { inputPath: wasmFixturePath },
    30000,
  );
  report.wasm.inspectSections = await callTool(
    client,
    'wasm_inspect_sections',
    { inputPath: wasmFixturePath },
    30000,
  );
  report.wasm.offlineRun = await callTool(
    client,
    'wasm_offline_run',
    { inputPath: wasmFixturePath, functionName: 'main', runtime: 'wasmtime' },
    30000,
  );
  report.wasm.optimize = await callTool(
    client,
    'wasm_optimize',
    { inputPath: wasmFixturePath, level: 'O2' },
    45000,
  );
  report.analysis.webpackNavigate = await callTool(
    client,
    'page_navigate',
    { url: server.webpackPageUrl, waitUntil: 'load', timeout: 15000 },
    30000,
  );
  report.analysis.webpackEnumerate = await callTool(
    client,
    'webpack_enumerate',
    { searchKeyword: WEBPACK_MARKER, forceRequireAll: true, maxResults: 10 },
    30000,
  );
}
