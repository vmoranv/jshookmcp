export function createEmptyReport({ generatedAt, baseUrl, wsUrl, http2Url }) {
  return {
    generatedAt,
    baseUrl,
    wsUrl,
    http2Url,
    tools: [],
    platform: {},
    encoding: {},
    protocol: {},
    browser: {},
    graphql: {},
    meta: {},
    analysis: {},
    network: {},
    performance: {},
    proxy: {},
    coordination: {},
    sourcemap: {},
    streaming: {},
    trace: {},
    captcha: {},
    stealth: {},
    canvas: {},
    wasm: {},
    crossDomain: {},
    evidence: {},
    binary: {},
    mojo: {},
    macro: {},
    sandbox: {},
    maintenance: {},
    workflow: {},
    process: {},
    instrumentation: {},
    adb: {},
    memory: {},
    electron: {},
    syscall: {},
    tls: {},
    v8: {},
    extensionRegistry: {},
  };
}

/**
 * Per-section summary line builders. Extracted from the former single
 * summarizeReport body so each function stays under the complexity gate;
 * the joined output is byte-identical to the previous implementation.
 */
const networkLine = (report) =>
  `network: requestId=${report.network.requestId ?? 'n/a'} bodyMarker=${report.network.bodyHasMarker}`;
const network_rawLine = (report) =>
  `network-raw: http=${report.network.rawHttp?.response?.statusCode ?? 'n/a'} h2=${report.network.http2?.statusCode ?? 'n/a'} rtt=${report.network.rtt?.stats?.count ?? 0}`;
const network_extraLine = (report) =>
  `network-extra: auth=${report.network.extractAuth?.found ?? 'n/a'} har=${report.network.harEntryCount ?? 'n/a'} replay=${report.network.replayLive?.status ?? 'n/a'} interceptHits=${report.network.interceptList?.totalHits ?? 'n/a'} tcp=${report.network.tcpRead?.matchedDelimiter ?? 'n/a'} tls=${report.network.tlsRead?.matchedDelimiter ?? 'n/a'} wsRaw=${report.network.rawWebSocketReply?.dataText ?? 'n/a'}`;
const proxyLine = (report) =>
  `proxy: running=${report.proxy.status?.running ?? false} logs=${report.proxy.requestLogs?.count ?? 0} bodyMarker=${report.proxy.bodyHasMarker ?? false}`;
const sourcemapLine = (report) =>
  `sourcemap: discovered=${report.sourcemap.discoveredCount ?? 0} parsed=${report.sourcemap.parsed?.mappingsCount ?? 'n/a'} reconstructed=${report.sourcemap.reconstructed?.writtenFiles ?? 'n/a'} reconstructedMarker=${report.sourcemap.reconstructedContainsMarker ?? false}`;
const platformLine = (report) =>
  `platform: miniapps=${report.platform?.miniappScan?.count ?? 'n/a'} fuseWire=${report.platform?.electronFuses?.fuseWireFound ?? 'n/a'} userdata=${report.platform?.electronUserdata?.totalScanned ?? 'n/a'} asarFiles=${report.platform?.asarExtract?.totalFiles ?? 'n/a'} asarMatches=${report.platform?.asarSearch?.totalMatches ?? 'n/a'}`;
const metaLine = (report) =>
  `meta: searchTop=${report.meta.searchTools?.results?.[0]?.name ?? 'n/a'} callInactive=${report.meta.callInactive?.success ?? 'n/a'} callActive=${report.meta.callTool?.success ?? 'n/a'} domainActivated=${report.meta.activateDomain?.activated ?? 'n/a'}`;
const encodingLine = (report) =>
  `encoding: detect=${report.encoding.detect?.success ?? 'n/a'} requestIdPath=${report.encoding.detectRequestId?.success ?? 'n/a'} decodeMarker=${report.encoding.decodeMarker ?? false} encodeMarker=${report.encoding.encodeMarker ?? false} protoFields=${Array.isArray(report.encoding.protobuf?.fields) ? report.encoding.protobuf.fields.length : 'n/a'}`;
const protocolLine = (report) =>
  `protocol: template=${report.protocol.payloadTemplate?.hexPayload ?? 'n/a'} mutate=${report.protocol.payloadMutate?.mutatedHex ?? 'n/a'} ipv4=${report.protocol.rawIp?.checksumHex ?? 'n/a'} pcapPackets=${Array.isArray(report.protocol.pcapRead?.packets) ? report.protocol.pcapRead.packets.length : 'n/a'} auto=${report.protocol.autoDetect?.success ?? 'n/a'}`;
const coordinationLine = (report) =>
  `coordination: handoff=${report.coordination.create?.taskId ?? 'n/a'} insights=${report.coordination.appendInsight?.totalInsights ?? 'n/a'} snapshots=${report.coordination.snapshotList?.total ?? 'n/a'} restoredCookie=${report.coordination.restoreState?.result?.hasCookie ?? 'n/a'}`;
const analysisLine = (report) =>
  `analysis: collectFiles=${report.analysis.collectCode?.filesCount ?? 'n/a'} collectSize=${report.analysis.collectCode?.totalSize ?? 'n/a'} searchMatches=${report.analysis.searchInScripts?.totalMatches ?? 'n/a'} deobf=${typeof report.analysis.deobfuscate?.code === 'string'} webcrack=${report.analysis.webcrackUnpack?.success ?? 'n/a'} treeFunctions=${Array.isArray(report.analysis.extractFunctionTree?.functions) ? report.analysis.extractFunctionTree.functions.length : 'n/a'}`;
const browser_pageLine = (report) =>
  `browser-page: typed=${report.browser.interactionState?.result?.typedValue ?? 'n/a'} key=${report.browser.interactionState?.result?.lastKey ?? 'n/a'} select=${report.browser.interactionState?.result?.selectedValue ?? 'n/a'} hover=${report.browser.interactionState?.result?.hoverCount ?? 'n/a'} click=${report.browser.interactionState?.result?.clickCount ?? 'n/a'} reload=${report.browser.reloadState?.result?.reloadCount ?? 'n/a'}`;
const browser_historyLine = (report) =>
  `browser-history: back=${report.browser.historyBackState?.result?.title ?? 'n/a'} forward=${report.browser.historyForwardState?.result?.title ?? 'n/a'} framework=${report.browser.frameworkState?.detected ?? 'n/a'} screenshotBytes=${report.browser.screenshotBytes ?? 'n/a'} mobileWidth=${report.browser.emulatedState?.result?.width ?? 'n/a'}`;
const performanceLine = (report) =>
  `performance: metrics=${report.performance.metrics?.success ?? 'n/a'} coverage=${report.performance.coverageStop?.totalScripts ?? 'n/a'} traceEvents=${report.performance.traceStop?.eventCount ?? 'n/a'} cpuSamples=${report.performance.cpuStop?.totalSamples ?? 'n/a'} heapSamples=${report.performance.heapSamplingStop?.sampleCount ?? 'n/a'}`;
const buildersLine = (report) =>
  `builders: httpReq=${report.network.httpRequestBuild?.requestBytes ?? 'n/a'} h2Frame=${report.network.http2FrameBuild?.frameType ?? 'n/a'} indexeddb=${Object.keys(report.browser.indexedDbDump ?? {}).length || 0} tabs=${report.browser.tabWorkflowList?.aliases?.length ?? 'n/a'}`;
const streamingLine = (report) =>
  `streaming: wsFrames=${report.streaming.wsFrameCount} sseEvents=${report.streaming.sseEventCount}`;
const traceLine = (report) =>
  `trace: status=${report.trace.stop?.status ?? 'n/a'} bodies=${report.trace.stop?.networkBodyCount ?? 0} chunks=${report.trace.stop?.networkChunkCount ?? 0} bodyState=${report.trace.flow?.request?.bodyCaptureState ?? 'n/a'}`;
const trace_extraLine = (report) =>
  `trace-extra: seekEvents=${Array.isArray(report.trace.seek?.events) ? report.trace.seek.events.length : 'n/a'} summarizedReq=${report.trace.summary?.network?.requestCount ?? 'n/a'} exported=${report.trace.export?.eventCount ?? 'n/a'} alias=${report.trace.aliasStop?.status ?? 'n/a'} heapDiff=${report.trace.heapDiff?.diff?.totalSizeDelta ?? 'n/a'}`;
const captchaLine = (report) =>
  `captcha: manual=${report.captcha.manualAvailable ?? 'n/a'} ext2captcha=${report.captcha.external2captchaAvailable ?? 'n/a'} hook=${report.captcha.widgetHookAvailable ?? 'n/a'} provider=${report.captcha.configuredProvider ?? 'n/a'}`;
const stealthLine = (report) =>
  `stealth: inject=${report.stealth.inject?.success ?? 'n/a'} verify=${report.stealth.verify?.success ?? 'n/a'} fingerprint=${report.stealth.fingerprint?.success ?? 'n/a'} ua=${report.stealth.userAgent?.success ?? 'n/a'}`;
const canvasLine = (report) =>
  `canvas: canvases=${report.canvas.fingerprint?.canvasCount ?? 'n/a'} scene=${report.canvas.sceneDump?.completeness ?? 'n/a'} pick=${report.canvas.pick?.success ?? 'n/a'} traceFrames=${Array.isArray(report.canvas.traceClick?.handlerFrames) ? report.canvas.traceClick.handlerFrames.length : 'n/a'}`;
const wasmLine = (report) =>
  `wasm: page=${report.wasm.pageCaptureAvailable ?? 'n/a'} wasm2wat=${report.wasm.wasm2watAvailable ?? 'n/a'} runtime=${report.wasm.offlineRuntimeAvailable ?? 'n/a'}`;
const cross_domainLine = (report) =>
  `cross-domain: workflows=${report.crossDomain.capabilities?.workflows?.length ?? 'n/a'} suggestion=${report.crossDomain.suggest?.workflowKey ?? 'n/a'} nodes=${report.crossDomain.stats?.nodeCount ?? 'n/a'} evidenceHits=${report.evidence.query?.resultCount ?? 'n/a'} chain=${report.evidence.chain?.chainLength ?? 'n/a'}`;
const binaryLine = (report) =>
  `binary: fridaAvailable=${report.binary.capabilitiesAvailable} modules=${Array.isArray(report.binary.moduleSample) ? report.binary.moduleSample.join(', ') || 'n/a' : (report.binary.moduleSample ?? 'n/a')}`;
const mojoLine = (report) =>
  `mojo: backend=${report.mojo.capabilitiesAvailable} live=${report.mojo.liveCaptureAvailable} simulation=${report.mojo.monitorSimulation} catalog=${report.mojo.interfaceCatalogSource} messages=${report.mojo.messageCount}`;
const sandboxLine = (report) =>
  `sandbox: success=${report.sandbox.ok ?? 'n/a'} persisted=${report.sandbox.persisted ?? 'n/a'}`;
const maintenanceLine = (report) =>
  `maintenance: tokenUsage=${report.maintenance.tokenStats?.currentUsage ?? 'n/a'} cacheEntries=${report.maintenance.cacheStats?.totalEntries ?? 'n/a'} doctor=${report.maintenance.doctor?.ok ?? report.maintenance.doctor?.success ?? 'n/a'} install=${report.maintenance.installExtension?.success ?? 'n/a'}`;
const workflowLine = (report) =>
  `workflow: count=${report.workflow.count ?? 0} run=${report.workflow.run?.success ?? 'n/a'}`;
const graphqlLine = (report) =>
  `graphql: introspect=${report.graphql.introspect?.success ?? 'n/a'} replay=${report.graphql.replay?.success ?? 'n/a'} extracted=${Array.isArray(report.graphql.extract?.queries) ? report.graphql.extract.queries.length : 'n/a'} replace=${report.graphql.scriptReplaceState?.result?.replaced ?? report.graphql.scriptReplaceState?.replaced ?? 'n/a'}`;
const extension_registryLine = (report) =>
  `extension-registry: installed=${Array.isArray(report.extensionRegistry.listInstalled?.plugins) ? report.extensionRegistry.listInstalled.plugins.length : 'n/a'} execute=${report.extensionRegistry.execute?.success ?? 'n/a'} reload=${report.extensionRegistry.reload?.success ?? 'n/a'} uninstall=${report.extensionRegistry.uninstall?.success ?? 'n/a'}`;
const process_tlsLine = (report) =>
  `process-tls: launch=${report.process.launchDebug?.success ?? 'n/a'} debugPort=${report.process.checkDebugPort?.debugPort ?? 'n/a'} nativeDebug=${report.process.nativeCheckDebugPort?.success ?? 'n/a'} tlsProbe=${report.tls.probeEndpoint?.ok ?? 'n/a'} keylog=${report.tls.keylogParse?.summary?.totalEntries ?? 'n/a'} rawTcp=${report.tls.rawTcpSend?.ok ?? 'n/a'} rawUdp=${report.tls.rawUdpSend?.ok ?? 'n/a'}`;
const attachLine = (report) =>
  `attach: external=${report.browser.attachExternal?.success ?? 'n/a'} eval=${report.browser.attachExternalEval?.success ?? 'n/a'}`;
const v8Line = (report) =>
  `v8: launchFlag=${report.browser.launch?.v8NativeSyntaxEnabled ?? 'n/a'} simulated=${report.v8.capture?.simulated ?? 'n/a'} sizeBytes=${report.v8.capture?.sizeBytes ?? 0} statsUsed=${report.v8.stats?.heapUsage?.jsHeapSizeUsed ?? 'n/a'} script=${report.v8.firstScriptUrl ?? report.v8.firstScriptId ?? 'n/a'} inspect=${Boolean(report.v8.objectInspect?.objectData)} bytecode=${report.v8.bytecode?.success ?? 'skipped'} bytecodeMode=${report.v8.bytecode?.mode ?? 'n/a'} jit=${Array.isArray(report.v8.jit?.functions) ? report.v8.jit.functions.length : 'skipped'} jitMode=${report.v8.jit?.inspectionMode ?? 'n/a'} diff=${report.v8.diff?.sizeDeltaBytes ?? 'n/a'} natives=${report.v8.version?.features?.nativesSyntax ?? 'n/a'}`;

const SECTION_LINES = [
  networkLine,
  network_rawLine,
  network_extraLine,
  proxyLine,
  sourcemapLine,
  platformLine,
  metaLine,
  encodingLine,
  protocolLine,
  coordinationLine,
  analysisLine,
  browser_pageLine,
  browser_historyLine,
  performanceLine,
  buildersLine,
  streamingLine,
  traceLine,
  trace_extraLine,
  captchaLine,
  stealthLine,
  canvasLine,
  wasmLine,
  cross_domainLine,
  binaryLine,
  mojoLine,
  sandboxLine,
  maintenanceLine,
  workflowLine,
  graphqlLine,
  extension_registryLine,
  process_tlsLine,
  attachLine,
  v8Line,
];

export function summarizeReport(report) {
  return [
    `Runtime Probe ${report.generatedAt}`,
    `baseUrl: ${report.baseUrl}`,
    '',
    ...SECTION_LINES.map((build) => build(report)),
    '',
    'Use --json for the full machine-readable report.',
  ].join('\n');
}
