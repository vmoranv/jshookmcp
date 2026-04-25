#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);
const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const BODY_MARKER = 'payload-marker-20260425';
const SSE_MARKER = 'payload-marker-sse-20260425';
const SCRIPT_TIMEOUT_MS = 6 * 60 * 1000;

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parseContent(result) {
  if (!isRecord(result) || !Array.isArray(result.content) || result.content.length === 0) {
    return result;
  }
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') {
    return result;
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

function getCapability(report, capability) {
  if (!isRecord(report) || !Array.isArray(report.capabilities)) {
    return null;
  }
  return (
    report.capabilities.find((entry) => isRecord(entry) && entry.capability === capability) ?? null
  );
}

function isCapabilityAvailable(report, capability) {
  const entry = getCapability(report, capability);
  return isRecord(entry) && entry.available === true;
}

async function withTimeout(promise, label, timeoutMs = 30000) {
  return await Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms (${label})`)), timeoutMs),
    ),
  ]);
}

async function callTool(client, name, args = {}, timeoutMs = 30000) {
  return parseContent(
    await withTimeout(client.callTool({ name, arguments: args }), name, timeoutMs),
  );
}

function flattenStrings(value, output = []) {
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, output);
    return output;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) flattenStrings(item, output);
  }
  return output;
}

function extractString(value, keys) {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function findRequestByUrl(requests, needle) {
  if (!Array.isArray(requests)) return null;
  for (const request of requests) {
    if (!isRecord(request)) continue;
    const haystack = flattenStrings(request).join('\n');
    if (haystack.includes(needle)) {
      return request;
    }
  }
  return null;
}

function pickScriptForV8Inspection(scripts) {
  if (!Array.isArray(scripts)) {
    return null;
  }

  const candidates = scripts.filter(
    (script) =>
      isRecord(script) && typeof script.scriptId === 'string' && script.scriptId.length > 0,
  );
  if (candidates.length === 0) {
    return null;
  }

  const preferred = candidates.find((script) => {
    const url = typeof script.url === 'string' ? script.url : '';
    return (
      url.length > 0 &&
      !url.startsWith('pptr:') &&
      !url.startsWith('extensions::') &&
      !url.startsWith('node:')
    );
  });

  const withUrl = candidates.find(
    (script) => typeof script.url === 'string' && script.url.length > 0,
  );

  return preferred ?? withUrl ?? candidates[0] ?? null;
}

function parseWsFrames(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0];
  const second = buffer[1];
  const masked = (second & 0x80) !== 0;
  let payloadLength = second & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    const length = Number(buffer.readBigUInt64BE(offset));
    if (!Number.isSafeInteger(length)) {
      throw new Error('WebSocket frame too large');
    }
    payloadLength = length;
    offset += 8;
  }

  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes + payloadLength) {
    return null;
  }

  let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + payloadLength);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    bytesConsumed: offset + maskBytes + payloadLength,
    fin: (first & 0x80) !== 0,
    opcode: first & 0x0f,
    payload,
  };
}

function sendWsText(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

async function getNewestChromePid() {
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Process chrome -ErrorAction Stop | Sort-Object StartTime | Select-Object -Last 1 -ExpandProperty Id',
      ],
      { windowsHide: true, timeout: 10000 },
    );
    const normalized = stdout.trim();
    return /^\d+$/.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function createProbeServer() {
  const bodyPayload = `${BODY_MARKER}\n${'x'.repeat(12361 - BODY_MARKER.length - 1)}`;
  const sockets = new Set();
  const httpServer = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400).end('missing url');
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>runtime probe</h1></body></html>');
      return;
    }

    if (req.url.startsWith('/body')) {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(bodyPayload);
      return;
    }

    if (req.url.startsWith('/sse')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write(': connected\n\n');
      setTimeout(() => {
        res.write('id: evt-1\n');
        res.write(`data: ${SSE_MARKER}\n\n`);
      }, 150);
      setTimeout(() => {
        try {
          res.end();
        } catch {}
      }, 600);
      return;
    }

    res.writeHead(404).end('not found');
  });

  httpServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  httpServer.on('upgrade', (req, socket) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }

    const secKey = req.headers['sec-websocket-key'];
    if (typeof secKey !== 'string') {
      socket.destroy();
      return;
    }

    const acceptKey = createHash('sha1')
      .update(secKey + WS_MAGIC_GUID)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        '',
      ].join('\r\n'),
    );

    sendWsText(socket, 'server-hello');

    let frameBuffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      while (frameBuffer.length > 0) {
        const frame = parseWsFrames(frameBuffer);
        if (!frame) break;
        frameBuffer = frameBuffer.subarray(frame.bytesConsumed);

        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }

        if (frame.opcode === 0x1) {
          const message = frame.payload.toString('utf8');
          sendWsText(socket, `echo:${message}`);
        }
      }
    });
  });

  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve probe server address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function summarize(report) {
  const lines = [
    `Runtime Probe ${report.generatedAt}`,
    `baseUrl: ${report.baseUrl}`,
    '',
    `network: requestId=${report.network.requestId ?? 'n/a'} bodyMarker=${report.network.bodyHasMarker}`,
    `streaming: wsFrames=${report.streaming.wsFrameCount} sseEvents=${report.streaming.sseEventCount}`,
    `trace: status=${report.trace.stop?.status ?? 'n/a'} bodies=${report.trace.stop?.networkBodyCount ?? 0} chunks=${report.trace.stop?.networkChunkCount ?? 0} bodyState=${report.trace.flow?.request?.bodyCaptureState ?? 'n/a'}`,
    `binary: fridaAvailable=${report.binary.capabilitiesAvailable} modules=${report.binary.moduleSample.join(', ') || 'n/a'}`,
    `mojo: available=${report.mojo.capabilitiesAvailable} simulation=${report.mojo.monitorSimulation} catalog=${report.mojo.interfaceCatalogSource} messages=${report.mojo.messageCount}`,
    `workflow: count=${report.workflow.count ?? 0} run=${report.workflow.run?.success ?? 'skipped'}`,
    `v8: simulated=${report.v8.capture?.simulated ?? 'n/a'} sizeBytes=${report.v8.capture?.sizeBytes ?? 0} statsUsed=${report.v8.stats?.heapUsage?.jsHeapSizeUsed ?? 'n/a'} script=${report.v8.firstScriptUrl ?? report.v8.firstScriptId ?? 'n/a'} bytecode=${report.v8.bytecode?.success ?? 'skipped'} bytecodeMode=${report.v8.bytecode?.mode ?? 'n/a'} jit=${Array.isArray(report.v8.jit?.functions) ? report.v8.jit.functions.length : 'skipped'} jitMode=${report.v8.jit?.inspectionMode ?? 'n/a'} natives=${report.v8.version?.features?.nativesSyntax ?? 'n/a'}`,
    '',
    'Use --json for the full machine-readable report.',
  ];
  return lines.join('\n');
}

async function main() {
  const jsonOnly = process.argv.includes('--json');
  const server = await createProbeServer();
  const client = new Client({ name: 'runtime-tool-probe', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.mjs'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_TRANSPORT: 'stdio',
      MCP_TOOL_PROFILE: 'full',
      LOG_LEVEL: 'error',
      PUPPETEER_HEADLESS: 'true',
    },
    stderr: 'pipe',
  });

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: server.baseUrl,
    wsUrl: server.wsUrl,
    tools: [],
    platform: null,
    browser: {},
    network: {},
    streaming: {},
    trace: {},
    binary: {},
    mojo: {},
    workflow: {},
    v8: {},
  };
  let failure = null;

  try {
    await withTimeout(client.connect(transport), 'connect', 30000);
    const listed = await withTimeout(client.listTools(), 'listTools', 15000);
    report.tools = (listed.tools ?? []).map((tool) => tool.name).toSorted();

    report.platform = await callTool(client, 'platform_capabilities', {}, 15000);
    report.binary.capabilities = await callTool(
      client,
      'binary_instrument_capabilities',
      {},
      15000,
    );
    report.mojo.capabilities = await callTool(client, 'mojo_ipc_capabilities', {}, 15000);
    report.binary.capabilitiesAvailable = isCapabilityAvailable(
      report.binary.capabilities,
      'frida_cli',
    );
    report.mojo.capabilitiesAvailable = isCapabilityAvailable(
      report.mojo.capabilities,
      'mojo_ipc_monitoring',
    );
    report.workflow.list = await callTool(client, 'list_extension_workflows', {}, 15000);
    report.workflow.count = Array.isArray(report.workflow.list?.workflows)
      ? report.workflow.list.workflows.length
      : 0;
    const runnableWorkflow = Array.isArray(report.workflow.list?.workflows)
      ? report.workflow.list.workflows.find((workflow) => isRecord(workflow) && workflow.id)
      : null;
    report.workflow.firstWorkflowId =
      isRecord(runnableWorkflow) && typeof runnableWorkflow.id === 'string'
        ? runnableWorkflow.id
        : null;
    if (report.workflow.firstWorkflowId) {
      report.workflow.run = await callTool(
        client,
        'run_extension_workflow',
        { workflowId: report.workflow.firstWorkflowId, timeoutMs: 15000 },
        30000,
      );
    }

    report.browser.launch = await callTool(client, 'browser_launch', { headless: true }, 60000);
    report.browser.navigate = await callTool(
      client,
      'page_navigate',
      { url: server.baseUrl, waitUntil: 'load', timeout: 15000 },
      60000,
    );

    report.network.enable = await callTool(client, 'network_enable', {}, 15000);
    report.streaming.wsMonitor = await callTool(
      client,
      'ws_monitor',
      { action: 'enable', maxFrames: 1000 },
      15000,
    );
    report.streaming.sseMonitor = await callTool(
      client,
      'sse_monitor_enable',
      { maxEvents: 100 },
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
    report.mojo.monitorStart = await callTool(client, 'mojo_monitor', { action: 'start' }, 30000);

    report.browser.pageEval = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => new Promise(async (resolve, reject) => {
          const result = {};
          try {
            const bodyText = await fetch(${JSON.stringify(`${server.baseUrl}/body?via=eval`)}).then((resp) => resp.text());
            result.fetchContainsMarker = bodyText.includes(${JSON.stringify(BODY_MARKER)});
            result.fetchLength = bodyText.length;

            result.ws = await new Promise((resolveWs, rejectWs) => {
              const ws = new WebSocket(${JSON.stringify(server.wsUrl)});
              const messages = [];
              const timer = setTimeout(() => {
                try { ws.close(); } catch {}
                rejectWs(new Error('timeout waiting for websocket messages'));
              }, 5000);
              ws.onopen = () => ws.send('client-ping');
              ws.onmessage = (event) => {
                messages.push(String(event.data));
                if (messages.includes('server-hello') && messages.includes('echo:client-ping')) {
                  clearTimeout(timer);
                  try { ws.close(); } catch {}
                  resolveWs(messages);
                }
              };
              ws.onerror = () => {
                clearTimeout(timer);
                try { ws.close(); } catch {}
                rejectWs(new Error('websocket error'));
              };
            });

            result.sse = await new Promise((resolveSse, rejectSse) => {
              const es = new EventSource(${JSON.stringify(`${server.baseUrl}/sse`)});
              const timer = setTimeout(() => {
                try { es.close(); } catch {}
                rejectSse(new Error('timeout waiting for sse message'));
              }, 5000);
              es.onmessage = (event) => {
                clearTimeout(timer);
                const payload = { data: String(event.data), lastEventId: event.lastEventId || null };
                try { es.close(); } catch {}
                resolveSse(payload);
              };
              es.onerror = () => {
                clearTimeout(timer);
                try { es.close(); } catch {}
                rejectSse(new Error('sse error'));
              };
            });

            resolve(result);
          } catch (error) {
            reject(error);
          }
        }))()`,
      },
      45000,
    );
    report.v8.debugger = await callTool(client, 'debugger_lifecycle', { action: 'enable' }, 30000);
    report.v8.version = await callTool(client, 'v8_version_detect', {}, 30000);
    report.v8.scripts = await callTool(client, 'get_all_scripts', { maxScripts: 20 }, 30000);
    const firstScript = pickScriptForV8Inspection(report.v8.scripts?.scripts);
    report.v8.firstScriptId =
      isRecord(firstScript) && typeof firstScript.scriptId === 'string'
        ? firstScript.scriptId
        : null;
    report.v8.firstScriptUrl =
      isRecord(firstScript) && typeof firstScript.url === 'string' && firstScript.url.length > 0
        ? firstScript.url
        : null;
    if (report.v8.firstScriptId) {
      report.v8.bytecode = await callTool(
        client,
        'v8_bytecode_extract',
        { scriptId: report.v8.firstScriptId },
        30000,
      );
      report.v8.jit = await callTool(
        client,
        'v8_jit_inspect',
        { scriptId: report.v8.firstScriptId },
        30000,
      );
    }

    report.network.requests = await callTool(client, 'network_get_requests', {}, 15000);
    const requestRecord = findRequestByUrl(report.network.requests.requests, '/body?via=eval');
    report.network.requestId = extractString(requestRecord, ['requestId', 'id']);

    if (report.network.requestId) {
      report.network.responseBody = await callTool(
        client,
        'network_get_response_body',
        { requestId: report.network.requestId },
        30000,
      );
      const responseStrings = flattenStrings(report.network.responseBody);
      report.network.bodyHasMarker = responseStrings.some((entry) => entry.includes(BODY_MARKER));
    } else {
      report.network.bodyHasMarker = false;
    }

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
    }

    const chromePid = await getNewestChromePid();
    report.binary.chromePid = chromePid;
    const fridaTarget = chromePid ?? 'chrome';
    report.binary.attach = await callTool(client, 'frida_attach', { target: fridaTarget }, 30000);
    const sessionId = extractString(report.binary.attach, ['sessionId']);
    report.binary.sessionId = sessionId;

    if (sessionId) {
      report.binary.modules = await callTool(
        client,
        'frida_enumerate_modules',
        { sessionId },
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
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    failure = error;
  } finally {
    try {
      report.browser.close = await callTool(client, 'browser_close', {}, 15000);
    } catch (error) {
      report.browser.closeError = error instanceof Error ? error.message : String(error);
    }
    try {
      await transport.close();
    } catch {}
    try {
      await client.close();
    } catch {}
    await server.close();
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(summarize(report));
  }

  if (failure) {
    throw failure;
  }
}

await withTimeout(main(), 'runtime probe script', SCRIPT_TIMEOUT_MS);
