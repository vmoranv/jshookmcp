import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeToCodePointArrayLiteral } from '../../helpers/inline-script.mjs';

export async function runNetworkTracePhase(ctx) {
  const { report, server, clients, state, paths, helpers, constants } = ctx;
  const { client } = clients;
  const {
    callTool,
    callToolCaptureError,
    extractString,
    flattenStrings,
    findRequestByUrl,
    getTabularRowValue,
  } = helpers;
  const { runtimeArtifactDir } = paths;
  const { BODY_MARKER, HTTP2_MARKER, AUTH_API_KEY_MARKER, AUTH_SIGNATURE_MARKER } = constants;
  const bodyMarkerCodePoints = serializeToCodePointArrayLiteral(BODY_MARKER);
  const traceAliasUrlCodePoints = serializeToCodePointArrayLiteral(
    `${server.baseUrl}/body?via=trace-alias`,
  );

  report.network.requests = await callTool(client, 'network_get_requests', {}, 15000);
  report.network.status = await callTool(client, 'network_get_status', {}, 15000);
  report.network.stats = await callTool(client, 'network_get_stats', {}, 15000);
  const requestRecord = findRequestByUrl(report.network.requests.requests, '/body?via=eval');
  report.network.requestId = extractString(requestRecord, ['requestId', 'id']);
  const authRequestRecord = findRequestByUrl(report.network.requests.requests, '/body?via=auth');
  report.network.authRequestId = extractString(authRequestRecord, ['requestId', 'id']);
  report.network.extractAuth = await callTool(
    client,
    'network_extract_auth',
    { minConfidence: 0.3 },
    30000,
  );
  {
    const authStrings = flattenStrings(report.network.extractAuth);
    report.network.authHasBearerMarker = authStrings.some((entry) =>
      entry.toLowerCase().includes('bearer'),
    );
    report.network.authHasApiKeyMarker = authStrings.some((entry) =>
      entry.includes(AUTH_API_KEY_MARKER.slice(0, 6)),
    );
    report.network.authHasSignatureMarker = authStrings.some((entry) =>
      entry.includes(AUTH_SIGNATURE_MARKER.slice(0, 6)),
    );
  }
  const harPath = join(runtimeArtifactDir, 'runtime-network.har');
  report.network.exportHar = await callTool(
    client,
    'network_export_har',
    { outputPath: harPath },
    30000,
  );
  try {
    const harText = await readFile(harPath, 'utf8');
    const harJson = JSON.parse(harText);
    report.network.harEntryCount = Array.isArray(harJson?.log?.entries)
      ? harJson.log.entries.length
      : null;
  } catch {
    report.network.harEntryCount = null;
  }

  if (report.network.requestId) {
    report.network.responseBody = await callTool(
      client,
      'network_get_response_body',
      { requestId: report.network.requestId },
      30000,
    );
    const responseStrings = flattenStrings(report.network.responseBody);
    report.network.bodyHasMarker = responseStrings.some((entry) => entry.includes(BODY_MARKER));
    report.encoding.detectRequestId = await callTool(
      client,
      'binary_detect_format',
      { source: 'raw', requestId: report.network.requestId },
      15000,
    );

    const responseBodyText =
      typeof report.network.responseBody?.body === 'string' ? report.network.responseBody.body : '';
    const responseBodyBase64 =
      report.network.responseBody?.base64Encoded === true
        ? responseBodyText
        : Buffer.from(responseBodyText, 'utf8').toString('base64');
    report.encoding.detect = await callTool(
      client,
      'binary_detect_format',
      { source: 'base64', data: responseBodyBase64 },
      15000,
    );
    report.encoding.entropy = await callTool(
      client,
      'binary_entropy_analysis',
      {
        source: 'base64',
        data: responseBodyBase64,
        blockSize: 256,
      },
      15000,
    );
    report.network.replayPreview = await callTool(
      client,
      'network_replay_request',
      {
        requestId: report.network.requestId,
        dryRun: true,
        timeoutMs: 15000,
        authorization: {
          allowedHosts: ['127.0.0.1'],
          allowPrivateNetwork: true,
          allowInsecureHttp: true,
          reason: 'runtime audit loopback replay',
        },
      },
      30000,
    );
    report.network.replayLive = await callTool(
      client,
      'network_replay_request',
      {
        requestId: report.network.requestId,
        dryRun: false,
        timeoutMs: 15000,
        authorization: {
          allowedHosts: ['127.0.0.1'],
          allowPrivateNetwork: true,
          allowInsecureHttp: true,
          reason: 'runtime audit loopback replay',
        },
      },
      30000,
    );
    if (state.instrumentationSessionId) {
      report.instrumentation.networkReplay = await callToolCaptureError(
        client,
        'instrumentation_network_replay',
        {
          sessionId: state.instrumentationSessionId,
          requestId: report.network.requestId,
          dryRun: true,
          timeoutMs: 15000,
          authorization: {
            allowedHosts: ['127.0.0.1'],
            allowPrivateNetwork: true,
            allowInsecureHttp: true,
            reason: 'runtime audit loopback replay',
          },
        },
        30000,
      );
    }
  } else {
    report.network.bodyHasMarker = false;
    report.encoding.detect = await callTool(
      client,
      'binary_detect_format',
      { source: 'base64', data: Buffer.from(BODY_MARKER, 'utf8').toString('base64') },
      15000,
    );
    report.encoding.entropy = await callTool(
      client,
      'binary_entropy_analysis',
      {
        source: 'base64',
        data: Buffer.from(`${BODY_MARKER}:${HTTP2_MARKER}`, 'utf8').toString('base64'),
        blockSize: 32,
      },
      15000,
    );
  }
  report.encoding.decode = await callTool(
    client,
    'binary_decode',
    {
      data: Buffer.from(BODY_MARKER, 'utf8').toString('base64'),
      encoding: 'base64',
      outputFormat: 'utf8',
    },
    15000,
  );
  report.encoding.decodeMarker = flattenStrings(report.encoding.decode).some((entry) =>
    entry.includes(BODY_MARKER),
  );
  report.encoding.encode = await callTool(
    client,
    'binary_encode',
    {
      data: JSON.stringify({ marker: BODY_MARKER }),
      inputFormat: 'json',
      outputEncoding: 'base64',
    },
    15000,
  );
  report.encoding.encodeMarker =
    typeof report.encoding.encode?.output === 'string' &&
    Buffer.from(report.encoding.encode.output, 'base64').toString('utf8').includes(BODY_MARKER);
  report.encoding.protobuf = await callTool(
    client,
    'protobuf_decode_raw',
    { data: Buffer.from([0x08, 0x96, 0x01]).toString('base64') },
    15000,
  );

  report.streaming.wsFrames = await callTool(client, 'ws_get_frames', { limit: 20 }, 15000);
  report.streaming.wsConnections = await callTool(client, 'ws_get_connections', {}, 15000);
  report.streaming.sseEvents = await callTool(client, 'sse_get_events', { limit: 20 }, 15000);
  report.streaming.wsFrameCount = Array.isArray(report.streaming.wsFrames?.frames)
    ? report.streaming.wsFrames.frames.length
    : 0;
  report.streaming.sseEventCount = Array.isArray(report.streaming.sseEvents?.events)
    ? report.streaming.sseEvents.events.length
    : 0;

  report.trace.stop = await callTool(client, 'stop_trace_recording', {}, 15000);
  if (report.trace.stop?.dbPath) {
    const traceExportPath = join(runtimeArtifactDir, 'runtime-trace-export.json');
    report.trace.networkRows = await callTool(
      client,
      'query_trace_sql',
      {
        dbPath: report.trace.stop.dbPath,
        sql: `SELECT request_id, url, chunk_count, body_capture_state, body_size, streaming_supported
              FROM network_resources
              WHERE url LIKE '%/body?via=eval%'`,
      },
      15000,
    );
    report.trace.eventRows = await callTool(
      client,
      'query_trace_sql',
      {
        dbPath: report.trace.stop.dbPath,
        sql: `SELECT event_type, COUNT(*) as count
              FROM events
              WHERE event_type IN (
                'Network.dataReceived',
                'Network.eventSourceMessageReceived',
                'Network.webSocketFrameReceived',
                'Network.webSocketFrameSent'
              )
              GROUP BY event_type
              ORDER BY event_type`,
      },
      15000,
    );
    report.trace.heapRows = await callTool(
      client,
      'query_trace_sql',
      {
        dbPath: report.trace.stop.dbPath,
        sql: `SELECT id, timestamp, summary
              FROM heap_snapshots
              ORDER BY id ASC`,
      },
      15000,
    );
    const heapRows = Array.isArray(report.trace.heapRows?.rows) ? report.trace.heapRows.rows : [];
    const heapColumns = Array.isArray(report.trace.heapRows?.columns)
      ? report.trace.heapRows.columns
      : [];
    if (heapRows.length >= 2) {
      const snapshotId1 = getTabularRowValue(heapRows[heapRows.length - 2], heapColumns, 'id');
      const snapshotId2 = getTabularRowValue(heapRows[heapRows.length - 1], heapColumns, 'id');
      if (typeof snapshotId1 === 'number' && typeof snapshotId2 === 'number') {
        report.trace.heapDiff = await callTool(
          client,
          'diff_heap_snapshots',
          {
            dbPath: report.trace.stop.dbPath,
            snapshotId1,
            snapshotId2,
          },
          30000,
        );
      }
    }
    if (report.network.requestId) {
      report.trace.flow = await callTool(
        client,
        'trace_get_network_flow',
        {
          dbPath: report.trace.stop.dbPath,
          requestId: report.network.requestId,
          includeBody: true,
          includeChunks: true,
          includeEvents: false,
        },
        30000,
      );
    }
    report.trace.summary = await callTool(
      client,
      'summarize_trace',
      { dbPath: report.trace.stop.dbPath, detail: 'compact' },
      30000,
    );
    report.trace.export = await callTool(
      client,
      'export_trace',
      { dbPath: report.trace.stop.dbPath, outputPath: traceExportPath },
      30000,
    );
    try {
      report.trace.exportBytes = (await readFile(traceExportPath)).length;
    } catch {}
    const seekTimestamp =
      typeof report.trace.flow?.request?.responseWallTime === 'number'
        ? report.trace.flow.request.responseWallTime
        : typeof report.trace.flow?.request?.startedWallTime === 'number'
          ? report.trace.flow.request.startedWallTime
          : null;
    if (seekTimestamp !== null) {
      report.trace.seek = await callTool(
        client,
        'seek_to_timestamp',
        { dbPath: report.trace.stop.dbPath, timestamp: seekTimestamp, windowMs: 2000 },
        30000,
      );
    }
  }
  report.trace.aliasStart = await callTool(
    client,
    'trace_recording',
    {
      action: 'start',
      recordResponseBodies: true,
      streamResponseChunks: true,
    },
    15000,
  );
  report.trace.aliasExercise = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        const fromCodePoints = (values) => String.fromCodePoint(...values);
        const traceAliasUrl = fromCodePoints(${traceAliasUrlCodePoints});
        const bodyMarker = fromCodePoints(${bodyMarkerCodePoints});
        return fetch(traceAliasUrl)
          .then((resp) => resp.text())
          .then((text) => ({ hasMarker: text.includes(bodyMarker) }));
      })()`,
    },
    30000,
  );
  report.trace.aliasStop = await callTool(client, 'trace_recording', { action: 'stop' }, 15000);
  report.browser.historyNavigateOne = await callTool(
    client,
    'page_navigate',
    { url: `${server.baseUrl}/history/one`, waitUntil: 'load', timeout: 15000 },
    30000,
  );
  report.browser.historyNavigateTwo = await callTool(
    client,
    'page_navigate',
    { url: `${server.baseUrl}/history/two`, waitUntil: 'load', timeout: 15000 },
    30000,
  );
  report.browser.historyBack = await callTool(client, 'page_back', { timeout: 5000 }, 15000);
  report.browser.historyBackState = await callTool(
    client,
    'page_evaluate',
    { code: '(() => ({ href: location.href, title: document.title }))()' },
    15000,
  );
  report.browser.historyForward = await callTool(client, 'page_forward', { timeout: 5000 }, 15000);
  report.browser.historyForwardState = await callTool(
    client,
    'page_evaluate',
    { code: '(() => ({ href: location.href, title: document.title }))()' },
    15000,
  );
}
