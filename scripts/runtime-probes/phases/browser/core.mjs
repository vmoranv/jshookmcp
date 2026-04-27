import { join } from 'node:path';

export async function runBrowserCorePhase(ctx) {
  const { report, server, clients, helpers, constants, paths, state } = ctx;
  const { client } = clients;
  const { callTool, callToolCaptureError } = helpers;
  const { BODY_MARKER } = constants;
  const { runtimeArtifactDir } = paths;

  report.browser.launch = await callTool(client, 'browser_launch', { headless: true }, 60000);
  report.browser.status = await callTool(client, 'browser_status', {}, 15000);
  report.browser.navigate = await callTool(
    client,
    'page_navigate',
    { url: server.baseUrl, waitUntil: 'load', timeout: 15000 },
    60000,
  );
  report.analysis.collectCode = await callTool(
    client,
    'collect_code',
    {
      url: server.baseUrl,
      returnSummaryOnly: true,
      includeInline: true,
      includeExternal: true,
      includeDynamic: true,
      smartMode: 'summary',
    },
    60000,
  );
  report.analysis.searchInScripts = await callTool(
    client,
    'search_in_scripts',
    {
      keyword: '__auditRuntimeProbeMarker__',
      returnSummary: true,
      maxMatches: 20,
    },
    30000,
  );
  report.analysis.collectionStats = await callTool(client, 'get_collection_stats', {}, 15000);
  report.analysis.deobfuscate = await callTool(
    client,
    'deobfuscate',
    { code: 'var a = 1;' },
    30000,
  );
  report.analysis.llmSuggestNames = await callToolCaptureError(
    client,
    'llm_suggest_names',
    {
      code: 'function a(_0x1,_0x2){const _0x3=_0x1+_0x2;return _0x3;}',
      identifiers: ['_0x1', '_0x2', '_0x3'],
    },
    30000,
  );
  report.analysis.webcrackUnpack = await callTool(
    client,
    'webcrack_unpack',
    {
      code: 'eval(atob("Y29uc3QgYSA9IDE7"))',
      unpack: true,
      unminify: true,
    },
    30000,
  );
  report.analysis.understandCode = await callTool(
    client,
    'understand_code',
    { code: 'function add(a, b) { return a + b; }', focus: 'all' },
    30000,
  );
  report.analysis.detectCrypto = await callTool(
    client,
    'detect_crypto',
    { code: 'crypto.subtle.digest("SHA-256", data)' },
    30000,
  );
  report.analysis.detectObfuscation = await callTool(
    client,
    'detect_obfuscation',
    { code: 'eval(atob("YWxlcnQoMSk="))', generateReport: false },
    30000,
  );
  report.analysis.astTransformPreview = await callTool(
    client,
    'ast_transform_preview',
    { code: 'var a = 1;', transforms: ['rename_vars'] },
    15000,
  );
  report.analysis.astTransformChain = await callTool(
    client,
    'ast_transform_chain',
    {
      name: 'runtime_audit_chain',
      transforms: ['rename_vars'],
      description: 'rename vars',
    },
    15000,
  );
  report.analysis.astTransformApply = await callTool(
    client,
    'ast_transform_apply',
    { code: 'var a = 1;', chainName: 'runtime_audit_chain' },
    15000,
  );
  report.analysis.cryptoHarness = await callTool(
    client,
    'crypto_test_harness',
    {
      code: 'globalThis.encrypt = (d) => String(d).toUpperCase()',
      functionName: 'encrypt',
      testInputs: ['audit', 'probe'],
    },
    30000,
  );
  report.analysis.cryptoCompare = await callTool(
    client,
    'crypto_compare',
    {
      code1: 'globalThis.encrypt = (d) => String(d).toUpperCase()',
      code2: 'globalThis.encrypt = (d) => d.toString().toUpperCase()',
      functionName: 'encrypt',
      testInputs: ['audit', 'probe'],
    },
    30000,
  );
  report.analysis.seedCryptoStandalone = await callTool(
    client,
    'page_inject_script',
    {
      script: [
        "window.auditCryptoSalt = 'runtime-audit-salt';",
        'window.auditCryptoSign = function auditCryptoSign(input) {',
        "  return ['sig', window.auditCryptoSalt, String(input)].join(':');",
        '};',
      ].join('\n'),
    },
    15000,
  );
  report.analysis.cryptoExtractStandalone = await callTool(
    client,
    'crypto_extract_standalone',
    { targetFunction: 'window.auditCryptoSign', includePolyfills: true },
    30000,
  );

  const auditHost = new URL(server.baseUrl).hostname;
  const auditPort = Number(new URL(server.baseUrl).port);
  state.browserContext = {
    auditHost,
    auditPort,
    screenshotPath: join(runtimeArtifactDir, 'runtime-audit-element.png'),
    performanceTracePath: join(runtimeArtifactDir, 'runtime-performance-trace.json'),
    cpuProfilePath: join(runtimeArtifactDir, 'runtime-audit.cpuprofile'),
    heapSamplingPath: join(runtimeArtifactDir, 'runtime-heap-sampling.json'),
    bodyMarker: BODY_MARKER,
  };
}
