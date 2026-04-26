#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);
const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const BODY_MARKER = 'payload-marker-20260425';
const SSE_MARKER = 'payload-marker-sse-20260425';
const HTTP2_MARKER = 'payload-marker-h2-20260425';
const SOURCEMAP_MARKER = 'payload-marker-sourcemap-20260425';
const CONSOLE_LOG_MARKER = 'payload-marker-console-20260426';
const CONSOLE_EXCEPTION_MARKER = 'payload-marker-console-exception-20260426';
const AUTH_BEARER_MARKER = 'bearer-audit-20260426';
const AUTH_API_KEY_MARKER = 'api-key-audit-20260426';
const AUTH_SIGNATURE_MARKER = 'sig-audit-20260426';
const INTERCEPT_MARKER = 'intercepted-body-20260426';
const ROOT_RELOAD_KEY = '__audit_reload_count';
const SCRIPT_TIMEOUT_MS = 6 * 60 * 1000;
const DIRECT_RUNTIME_PROBED_TOOLS = new Set();

const TEST_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAw5ph3jyxq4RKueHGkMvnKpysHDHd+UipLwLFT5j2tlaa6YFY
hxhYfQalHf8AtGTW74czhlX9R365GwlBHhE7fR4vcGsxWbnpd/re8AEmLiW9YLrY
C7Ecw/uBpWOEf7EbYp3mh0anTfU9Zbec5CXH1IYl+tFk5luwc0mW7IL/1uZVStBC
+ttSju0bsuFGduGlCpoQwgXAoMWgPkpFIAQJ8N4nOKoe1LlAYT3/s0uqX07C9x+b
BpxdSOu9GhVSAzZ3qq9zlXyzn4XanHEBow4JmyrD8yiEF4qj1GaZnoSASOp3duhg
bH4BCUBPEjpA95OsgUzHptDRKeK+GUfyRhVgFQIDAQABAoIBAA8qZNynfYoEFYwg
dHYNDSUJZTHBbwmxJ8boktZHUJeWEug4Wl4NFe1JqtsuxoX2DJEhPS409BCLQ3xU
ZRtY8DEU+k4fzYF8r9yY05itqiFpVSvPCMmtR4LteOGTG/aPi4VDo1hJMtcRRNui
VxR8VmhEp2SxP/65TK6/nadER+RIMEzk18BdLGerYMS5RfcPcDtU2zDm997niwh6
cOfUk7UqyrOZ7blO+7ZX2b8MYn20aMfTqW/w764tbbnA9CUK5tA4uRvPU9vW7Abm
ZyzGdOX53EIefWFdREXI1x0lCbgkZ3NtxTTDLww8XzBGzPgtahNhiXUmQA20z5fX
YAtQ+uECgYEA5rz4Y4D2zMIqVXyn8AjBBy/neEP3B9rHinWpFhkxvBSOLzmxfkgu
0ZQpjYw0WGb6pTVlfZLFKSKBAdZeFhIkM6ZptF19Y5YgjasEjl7ey5Z4GKZY8S7L
HlEWa3/JL8Wmi7n/Kt794atQm8GDki5EsmvXPlJ98hqoYjlYagwUr7UCgYEA2QSp
DH538zK7HpNTluBSTZVRcmDnZePVzvJPEWn5CGkHArhRRO5lYFZ6pwhwqCfEgUxd
3b16spBJqTs+H2NllBQ3XyPSpCCVB+39F1lp49OdDm0haxcQ+zBBAgZKA4ics1tp
eSM6BsjwC1lhNgk8UrPG1bXtUU0g018cvhZOauECgYAXpvtXR9sEtkqcpMCaTGtt
Dy4NF/p0paqauODyUPbWLs08bg+RwFh8R1HTHrIm9bdvw/95Vdg8FTtgMtdGL+ni
GYbwZDz8PmFr5EH9TiBMgkohTLwFTSSpIOrJbjnzWbFu1Uwg2ubvgR4sOTQBghis
qX1Q+CfM74qfNv2nMUHVmQKBgD7WOpyDgffJGKUhw3JMQYh1U7/qjxXRgncJcht4
s8LbpkwDUoTDAleCssDqkLQfz6Yglo097+kEHlAB91rfTOozcFT76mHbjUtefYnl
OePdwfwLXUHEzAXvUuNjLssXI0hLj56jtImCZP7kQmGDCxRnOYtnwe9ohbiuMYRY
sRwBAoGARZcKdUUPs5X+Q7DxMRg7f5Yv3i7aqiAi/dZysb5W5On+xFXIJx/OPdQC
WKWO8S/U+5KFZQkJ5yxUcJXezd+HguoB5CL6BEQbfxTvDQW+AesXtmiIpoWqIKx4
cDY9yGCvWTzQwOVjlsEOsOpdZPvxPdZ4pG0tR5aF8BkHf0fKa2g=
-----END RSA PRIVATE KEY-----
`;

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIBATANBgkqhkiG9w0BAQsFADAtMRIwEAYDVQQDEwlsb2Nh
bGhvc3QxFzAVBgNVBAoTDmpzaG9va21jcC10ZXN0MB4XDTI0MDEwMTAwMDAwMFoX
DTM0MDEwMTAwMDAwMFowLTESMBAGA1UEAxMJbG9jYWxob3N0MRcwFQYDVQQKEw5q
c2hvb2ttY3AtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMOa
Yd48sauESrnhxpDL5yqcrBwx3flIqS8CxU+Y9rZWmumBWIcYWH0GpR3/ALRk1u+H
M4ZV/Ud+uRsJQR4RO30eL3BrMVm56Xf63vABJi4lvWC62AuxHMP7gaVjhH+xG2Kd
5odGp031PWW3nOQlx9SGJfrRZOZbsHNJluyC/9bmVUrQQvrbUo7tG7LhRnbhpQqa
EMIFwKDFoD5KRSAECfDeJziqHtS5QGE9/7NLql9OwvcfmwacXUjrvRoVUgM2d6qv
c5V8s5+F2pxxAaMOCZsqw/MohBeKo9RmmZ6EgEjqd3boYGx+AQlATxI6QPeTrIFM
x6bQ0SnivhlH8kYVYBUCAwEAAaNFMEMwCQYDVR0TBAIwADALBgNVHQ8EBAMCBaAw
EwYDVR0lBAwwCgYIKwYBBQUHAwEwFAYDVR0RBA0wC4IJbG9jYWxob3N0MA0GCSqG
SIb3DQEBCwUAA4IBAQAImU5ZLT6Rqhd3rWfsipnplqg1SJ8HiS6zKXMYqZ6sh90s
0l3ycj/EM+YnStK+pgHT1g9IRJ+Js8SBqsbhdXHh80cyw82qN1gE8aaLWrcQJBRk
38Cad5dmX/K6r5XmzJ9sAmbumm/YD72HnKOmjRqGu077sgUxFRBKOVS9gkFtSHIW
5BQFM7EF8xLRpGo5ObdBYt2NZyLVyxxbggj3x3II+wCvAQgi8NXOGbL8FOgGWWDH
hYl+QoIs6H1FE3av1uQdZn9ILfBfiq8jj2j85p/WwizYvSDGa78bcuwh8u/T2KIr
2Sn1Vm9W0vOLfa5gF6/w138SPqk5/LSzYSgnNR9q
-----END CERTIFICATE-----
`;

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
  DIRECT_RUNTIME_PROBED_TOOLS.add(name);
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

  const explicitAuditProbe = candidates.find((script) => {
    const url = typeof script.url === 'string' ? script.url : '';
    return url === 'audit-probe.js' || url.endsWith('/audit-probe.js');
  });
  if (explicitAuditProbe) {
    return explicitAuditProbe;
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

function pickBrowserCdpTarget(targets, urlNeedle) {
  if (!Array.isArray(targets)) {
    return null;
  }

  const candidates = targets.filter(
    (target) =>
      isRecord(target) && typeof target.targetId === 'string' && target.targetId.length > 0,
  );
  if (candidates.length === 0) {
    return null;
  }

  const exactPage = candidates.find((target) => {
    const type = typeof target.type === 'string' ? target.type : '';
    const url = typeof target.url === 'string' ? target.url : '';
    return type === 'page' && url.includes(urlNeedle);
  });
  if (exactPage) {
    return exactPage;
  }

  const pageTarget = candidates.find((target) => target.type === 'page');
  return pageTarget ?? candidates[0] ?? null;
}

function buildRuntimeCoverage(registeredTools) {
  const totalRegistered = Array.isArray(registeredTools)
    ? registeredTools.filter((name) => typeof name === 'string').length
    : 0;
  const probedTools = [...DIRECT_RUNTIME_PROBED_TOOLS].toSorted();
  const registeredSet = new Set(
    Array.isArray(registeredTools)
      ? registeredTools.filter((name) => typeof name === 'string')
      : [],
  );
  const unprobedTools = [...registeredSet].filter((name) => !DIRECT_RUNTIME_PROBED_TOOLS.has(name));

  return {
    totalRegistered,
    directRuntimeProbed: probedTools.length,
    coveragePercent:
      totalRegistered === 0 ? 0 : Number(((probedTools.length / totalRegistered) * 100).toFixed(1)),
    probedTools,
    unprobedTools,
  };
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

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });

  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate free port');
  }

  return address.port;
}

async function sendRawHttpRequest(port, requestText) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(requestText);
    });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

function buildMockElectronExe(fuseBytes) {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
  return Buffer.concat([Buffer.alloc(256, 0x90), sentinel, Buffer.from(fuseBytes)]);
}

function buildMockAsar(entries) {
  const dataBuffers = [];
  const headerFiles = {};
  let dataOffset = 0;

  for (const entry of entries) {
    const contentBuf = Buffer.from(entry.content, 'utf8');
    const parts = entry.path.split('/');
    let current = headerFiles;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const dir = parts[index];
      if (!current[dir]) current[dir] = { files: {} };
      current = current[dir].files;
    }

    const fileName = parts[parts.length - 1];
    current[fileName] = { size: contentBuf.length, offset: String(dataOffset) };
    dataBuffers.push(contentBuf);
    dataOffset += contentBuf.length;
  }

  const headerBuf = Buffer.from(JSON.stringify({ files: headerFiles }), 'utf8');
  const headerPrefix = Buffer.alloc(16);
  headerPrefix.writeUInt32LE(headerBuf.length + 8, 0);
  headerPrefix.writeUInt32LE(headerBuf.length + 4, 4);
  headerPrefix.writeUInt32LE(headerBuf.length, 8);
  headerPrefix.writeUInt32LE(0, 12);

  return Buffer.concat([headerPrefix, headerBuf, ...dataBuffers]);
}

function buildMinimalMiniappPkg() {
  const header = Buffer.alloc(18);
  header.writeUInt8(0xbe, 0);
  header.writeUInt32BE(0, 1);
  header.writeUInt32BE(4, 5);
  header.writeUInt32BE(0, 9);
  header.writeUInt8(0, 13);
  header.writeUInt32BE(0, 14);
  return header;
}

async function createProbeServer() {
  const bodyPayload = `${BODY_MARKER}\n${'x'.repeat(12361 - BODY_MARKER.length - 1)}`;
  const rootAppScript = [
    `window.__auditRuntimeProbeMarker__ = ${JSON.stringify(BODY_MARKER)};`,
    'window.__auditRuntimeProbeExternalLoaded = true;',
    'document.addEventListener("DOMContentLoaded", () => {',
    '  const input = document.getElementById("name-input");',
    '  if (input) {',
    '    input.addEventListener("input", () => {',
    '      window.__auditTypedValue = input.value;',
    '      const output = document.getElementById("typed-output");',
    '      if (output) output.textContent = input.value;',
    '    });',
    '  }',
    '  const select = document.getElementById("color-select");',
    '  if (select) {',
    '    select.addEventListener("change", () => {',
    '      window.__auditSelectedValue = select.value;',
    '      const output = document.getElementById("select-output");',
    '      if (output) output.textContent = select.value;',
    '    });',
    '  }',
    '  const hover = document.getElementById("hover-target");',
    '  if (hover) {',
    '    hover.addEventListener("mouseenter", () => {',
    '      window.__auditHoverCount = (window.__auditHoverCount || 0) + 1;',
    '      const output = document.getElementById("hover-output");',
    '      if (output) output.textContent = String(window.__auditHoverCount);',
    '    });',
    '  }',
    '  document.addEventListener("keydown", (event) => {',
    '    window.__auditLastKey = event.key;',
    '    const output = document.getElementById("key-output");',
    '    if (output) output.textContent = event.key;',
    '  });',
    "  console.log('runtime probe external script loaded');",
    '});',
  ].join('\n');
  const sourceMapPayload = JSON.stringify({
    version: 3,
    file: 'app.min.js',
    sources: ['src/main.ts'],
    sourcesContent: [`export const marker = '${SOURCEMAP_MARKER}';\nconsole.log(marker);\n`],
    names: [],
    mappings: 'AAAA',
  });
  const sourceMapDataUri = `data:application/json;base64,${Buffer.from(
    sourceMapPayload,
    'utf8',
  ).toString('base64')}`;
  const sourceMapScript = [
    `window.__SOURCE_MAP_MARKER__ = ${JSON.stringify(SOURCEMAP_MARKER)};`,
    "console.log('sourcemap script loaded');",
    `//# sourceMappingURL=${sourceMapDataUri}`,
  ].join('\n');
  const sockets = new Set();
  const tlsSockets = new Set();
  const httpServer = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400).end('missing url');
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>runtime probe</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 24px; }
      main { max-width: 960px; display: grid; gap: 12px; }
      nav { display: flex; gap: 12px; }
      input, select, button { padding: 8px; font-size: 14px; }
      #hover-target { width: 160px; padding: 12px; border: 1px solid #999; }
      .spacer { height: 1400px; background: linear-gradient(180deg, #f3f3f3 0%, #d9ecff 100%); }
    </style>
    <script>
      const key = ${JSON.stringify(ROOT_RELOAD_KEY)};
      const current = Number(localStorage.getItem(key) || '0');
      localStorage.setItem(key, String(current + 1));
      window.__auditRuntimeProbeInlineLoaded = true;
    </script>
    <script src="/app.js" defer></script>
  </head>
  <body>
    <main>
      <h1>runtime probe</h1>
      <nav>
        <a id="history-link-one" href="/history/one">History One</a>
        <a id="history-link-two" href="/history/two">History Two</a>
      </nav>
      <label for="name-input">Name</label>
      <input id="name-input" name="name" />
      <div id="typed-output"></div>
      <label for="color-select">Color</label>
      <select id="color-select">
        <option value="red">red</option>
        <option value="blue">blue</option>
      </select>
      <div id="select-output"></div>
      <button
        id="click-target"
        onclick="window.__auditClickCount=(window.__auditClickCount||0)+1; document.getElementById('click-output').textContent=String(window.__auditClickCount);"
      >
        Click probe
      </button>
      <div id="click-output">0</div>
      <div id="hover-target">Hover probe</div>
      <div id="hover-output">0</div>
      <div id="key-output"></div>
      <div id="inject-output"></div>
      <div class="spacer"></div>
      <div id="scroll-marker">scroll-target</div>
    </main>
  </body>
</html>`);
      return;
    }

    if (req.url === '/app.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(rootAppScript);
      return;
    }

    if (req.url === '/history/one') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>history-one</title></head><body><h1 data-page="one">history one</h1></body></html>',
      );
      return;
    }

    if (req.url === '/history/two') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>history-two</title></head><body><h1 data-page="two">history two</h1></body></html>',
      );
      return;
    }

    if (req.url === '/sourcemap/' || req.url === '/sourcemap/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><body><h1>sourcemap probe</h1><script src="/sourcemap/app.min.js"></script></body></html>',
      );
      return;
    }

    if (req.url === '/sourcemap/app.min.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(sourceMapScript);
      return;
    }

    if (req.url === '/sourcemap/app.min.js.map') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(sourceMapPayload);
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

    if (req.url.startsWith('/intercept-target')) {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end('original-intercept-body');
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

  const http2Server = http2.createServer();
  http2Server.on('stream', (stream, headers) => {
    const streamPath = typeof headers[':path'] === 'string' ? headers[':path'] : '/';
    if (streamPath !== '/h2') {
      stream.respond({ ':status': 404, 'content-type': 'text/plain; charset=utf-8' });
      stream.end('not found');
      return;
    }

    stream.respond({
      ':status': 200,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    stream.end(HTTP2_MARKER);
  });

  const tlsServer = tls.createServer({ key: TEST_KEY_PEM, cert: TEST_CERT_PEM }, (socket) => {
    tlsSockets.add(socket);
    socket.on('close', () => tlsSockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      const requestText = chunk.toString('utf8');
      if (!requestText.includes('\r\n\r\n')) {
        return;
      }

      socket.write(
        [
          'HTTP/1.1 200 OK',
          'Content-Type: text/plain; charset=utf-8',
          'Cache-Control: no-store',
          `Content-Length: ${Buffer.byteLength(BODY_MARKER, 'utf8')}`,
          'Connection: close',
          '',
          BODY_MARKER,
        ].join('\r\n'),
      );
      socket.end();
    });
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
  http2Server.listen(0, '127.0.0.1');
  await once(http2Server, 'listening');
  tlsServer.listen(0, '127.0.0.1');
  await once(tlsServer, 'listening');
  const address = httpServer.address();
  const http2Address = http2Server.address();
  const tlsAddress = tlsServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve probe server address');
  }
  if (!http2Address || typeof http2Address === 'string') {
    throw new Error('Failed to resolve HTTP/2 probe server address');
  }
  if (!tlsAddress || typeof tlsAddress === 'string') {
    throw new Error('Failed to resolve TLS probe server address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    http2Url: `http://127.0.0.1:${http2Address.port}/h2`,
    tlsPort: tlsAddress.port,
    sourceMapPageUrl: `${baseUrl}/sourcemap/`,
    sourceMapUrl: sourceMapDataUri,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      for (const socket of tlsSockets) {
        socket.destroy();
      }
      await new Promise((resolve) => httpServer.close(resolve));
      await new Promise((resolve) => http2Server.close(resolve));
      await new Promise((resolve) => tlsServer.close(resolve));
    },
  };
}

function summarize(report) {
  const lines = [
    `Runtime Probe ${report.generatedAt}`,
    `baseUrl: ${report.baseUrl}`,
    '',
    `network: requestId=${report.network.requestId ?? 'n/a'} bodyMarker=${report.network.bodyHasMarker}`,
    `network-raw: http=${report.network.rawHttp?.response?.statusCode ?? 'n/a'} h2=${report.network.http2?.statusCode ?? 'n/a'} rtt=${report.network.rtt?.stats?.count ?? 0}`,
    `network-extra: auth=${report.network.extractAuth?.found ?? 'n/a'} har=${report.network.harEntryCount ?? 'n/a'} replay=${report.network.replayLive?.status ?? 'n/a'} interceptHits=${report.network.interceptList?.totalHits ?? 'n/a'} tcp=${report.network.tcpRead?.matchedDelimiter ?? 'n/a'} tls=${report.network.tlsRead?.matchedDelimiter ?? 'n/a'} wsRaw=${report.network.rawWebSocketReply?.dataText ?? 'n/a'}`,
    `proxy: running=${report.proxy.status?.running ?? false} logs=${report.proxy.requestLogs?.count ?? 0} bodyMarker=${report.proxy.bodyHasMarker ?? false}`,
    `sourcemap: discovered=${report.sourcemap.discoveredCount ?? 0} parsed=${report.sourcemap.parsed?.mappingsCount ?? 'n/a'} reconstructed=${report.sourcemap.reconstructed?.writtenFiles ?? 'n/a'} reconstructedMarker=${report.sourcemap.reconstructedContainsMarker ?? false}`,
    `platform: miniapps=${report.platform?.miniappScan?.count ?? 'n/a'} fuseWire=${report.platform?.electronFuses?.fuseWireFound ?? 'n/a'} userdata=${report.platform?.electronUserdata?.totalScanned ?? 'n/a'} asarFiles=${report.platform?.asarExtract?.totalFiles ?? 'n/a'} asarMatches=${report.platform?.asarSearch?.totalMatches ?? 'n/a'}`,
    `encoding: detect=${report.encoding.detect?.success ?? 'n/a'} requestIdPath=${report.encoding.detectRequestId?.success ?? 'n/a'} decodeMarker=${report.encoding.decodeMarker ?? false} encodeMarker=${report.encoding.encodeMarker ?? false} protoFields=${Array.isArray(report.encoding.protobuf?.fields) ? report.encoding.protobuf.fields.length : 'n/a'}`,
    `protocol: template=${report.protocol.payloadTemplate?.hexPayload ?? 'n/a'} mutate=${report.protocol.payloadMutate?.mutatedHex ?? 'n/a'} ipv4=${report.protocol.rawIp?.checksumHex ?? 'n/a'} pcapPackets=${Array.isArray(report.protocol.pcapRead?.packets) ? report.protocol.pcapRead.packets.length : 'n/a'}`,
    `coordination: handoff=${report.coordination.create?.taskId ?? 'n/a'} insights=${report.coordination.appendInsight?.totalInsights ?? 'n/a'} snapshots=${report.coordination.snapshotList?.total ?? 'n/a'} restoredCookie=${report.coordination.restoreState?.result?.hasCookie ?? 'n/a'}`,
    `analysis: collectFiles=${report.analysis.collectCode?.filesCount ?? 'n/a'} collectSize=${report.analysis.collectCode?.totalSize ?? 'n/a'} treeFunctions=${Array.isArray(report.analysis.extractFunctionTree?.functions) ? report.analysis.extractFunctionTree.functions.length : 'n/a'}`,
    `browser-page: typed=${report.browser.interactionState?.result?.typedValue ?? 'n/a'} key=${report.browser.interactionState?.result?.lastKey ?? 'n/a'} select=${report.browser.interactionState?.result?.selectedValue ?? 'n/a'} hover=${report.browser.interactionState?.result?.hoverCount ?? 'n/a'} click=${report.browser.interactionState?.result?.clickCount ?? 'n/a'} reload=${report.browser.reloadState?.result?.reloadCount ?? 'n/a'}`,
    `browser-history: back=${report.browser.historyBackState?.result?.title ?? 'n/a'} forward=${report.browser.historyForwardState?.result?.title ?? 'n/a'} screenshotBytes=${report.browser.screenshotBytes ?? 'n/a'} mobileWidth=${report.browser.emulatedState?.result?.width ?? 'n/a'}`,
    `performance: metrics=${report.performance.metrics?.success ?? 'n/a'} coverage=${report.performance.coverageStop?.totalScripts ?? 'n/a'} traceEvents=${report.performance.traceStop?.eventCount ?? 'n/a'} cpuSamples=${report.performance.cpuStop?.totalSamples ?? 'n/a'} heapSamples=${report.performance.heapSamplingStop?.sampleCount ?? 'n/a'}`,
    `streaming: wsFrames=${report.streaming.wsFrameCount} sseEvents=${report.streaming.sseEventCount}`,
    `trace: status=${report.trace.stop?.status ?? 'n/a'} bodies=${report.trace.stop?.networkBodyCount ?? 0} chunks=${report.trace.stop?.networkChunkCount ?? 0} bodyState=${report.trace.flow?.request?.bodyCaptureState ?? 'n/a'}`,
    `trace-extra: seekEvents=${Array.isArray(report.trace.seek?.events) ? report.trace.seek.events.length : 'n/a'} summarizedReq=${report.trace.summary?.network?.requestCount ?? 'n/a'} exported=${report.trace.export?.eventCount ?? 'n/a'} alias=${report.trace.aliasStop?.status ?? 'n/a'}`,
    `captcha: manual=${report.captcha.manualAvailable ?? 'n/a'} ext2captcha=${report.captcha.external2captchaAvailable ?? 'n/a'} hook=${report.captcha.widgetHookAvailable ?? 'n/a'} provider=${report.captcha.configuredProvider ?? 'n/a'}`,
    `wasm: page=${report.wasm.pageCaptureAvailable ?? 'n/a'} wasm2wat=${report.wasm.wasm2watAvailable ?? 'n/a'} runtime=${report.wasm.offlineRuntimeAvailable ?? 'n/a'}`,
    `cross-domain: workflows=${report.crossDomain.capabilities?.workflows?.length ?? 'n/a'} suggestion=${report.crossDomain.suggest?.workflowKey ?? 'n/a'} nodes=${report.crossDomain.stats?.nodeCount ?? 'n/a'} evidenceHits=${report.evidence.query?.resultCount ?? 'n/a'} chain=${report.evidence.chain?.chainLength ?? 'n/a'}`,
    `binary: fridaAvailable=${report.binary.capabilitiesAvailable} modules=${report.binary.moduleSample.join(', ') || 'n/a'}`,
    `mojo: backend=${report.mojo.capabilitiesAvailable} live=${report.mojo.liveCaptureAvailable} simulation=${report.mojo.monitorSimulation} catalog=${report.mojo.interfaceCatalogSource} messages=${report.mojo.messageCount}`,
    `sandbox: success=${report.sandbox.ok ?? 'n/a'} persisted=${report.sandbox.persisted ?? 'n/a'}`,
    `maintenance: tokenUsage=${report.maintenance.tokenStats?.currentUsage ?? 'n/a'} cacheEntries=${report.maintenance.cacheStats?.totalEntries ?? 'n/a'} doctor=${report.maintenance.doctor?.ok ?? report.maintenance.doctor?.success ?? 'n/a'}`,
    `workflow: count=${report.workflow.count ?? 0} run=${report.workflow.run?.success ?? 'skipped'}`,
    `v8: launchFlag=${report.browser.launch?.v8NativeSyntaxEnabled ?? 'n/a'} simulated=${report.v8.capture?.simulated ?? 'n/a'} sizeBytes=${report.v8.capture?.sizeBytes ?? 0} statsUsed=${report.v8.stats?.heapUsage?.jsHeapSizeUsed ?? 'n/a'} script=${report.v8.firstScriptUrl ?? report.v8.firstScriptId ?? 'n/a'} bytecode=${report.v8.bytecode?.success ?? 'skipped'} bytecodeMode=${report.v8.bytecode?.mode ?? 'n/a'} jit=${Array.isArray(report.v8.jit?.functions) ? report.v8.jit.functions.length : 'skipped'} jitMode=${report.v8.jit?.inspectionMode ?? 'n/a'} natives=${report.v8.version?.features?.nativesSyntax ?? 'n/a'}`,
    '',
    'Use --json for the full machine-readable report.',
  ];
  return lines.join('\n');
}

async function main() {
  const jsonOnly = process.argv.includes('--json');
  const server = await createProbeServer();
  const runtimeArtifactDir = join(process.cwd(), '.tmp_mcp_artifacts');
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
    http2Url: server.http2Url,
    tools: [],
    platform: {},
    encoding: {},
    protocol: {},
    browser: {},
    analysis: {},
    network: {},
    performance: {},
    proxy: {},
    coordination: {},
    sourcemap: {},
    streaming: {},
    trace: {},
    captcha: {},
    wasm: {},
    crossDomain: {},
    evidence: {},
    binary: {},
    mojo: {},
    sandbox: {},
    maintenance: {},
    workflow: {},
    v8: {},
  };
  let failure = null;
  let platformProbeDir = null;

  try {
    await withTimeout(client.connect(transport), 'connect', 30000);
    await mkdir(runtimeArtifactDir, { recursive: true });
    const listed = await withTimeout(client.listTools(), 'listTools', 15000);
    report.tools = (listed.tools ?? []).map((tool) => tool.name).toSorted();

    report.platform.capabilities = await callTool(client, 'platform_capabilities', {}, 15000);
    platformProbeDir = await mkdtemp(join(tmpdir(), 'jshook-platform-audit-'));
    const electronExePath = join(platformProbeDir, 'mock-electron.exe');
    const electronUserdataDir = join(platformProbeDir, 'userdata');
    const asarPath = join(platformProbeDir, 'mock-app.asar');
    const miniappDir = join(platformProbeDir, 'miniapp');
    const miniappPkgPath = join(miniappDir, 'app.pkg');

    await mkdir(electronUserdataDir, { recursive: true });
    await mkdir(miniappDir, { recursive: true });
    await writeFile(
      electronExePath,
      buildMockElectronExe([0x31, 0x30, 0x31, 0x30, 0x72, 0x31, 0x30, 0x31]),
    );
    await writeFile(join(electronUserdataDir, 'config.json'), JSON.stringify({ key: 'value' }));
    await writeFile(join(electronUserdataDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    await writeFile(
      asarPath,
      buildMockAsar([
        { path: 'src/main.js', content: 'const isPro = true;\nconst marker = "asar-marker";\n' },
        { path: 'src/utils.js', content: 'export function helper() { return 1; }\n' },
      ]),
    );
    await writeFile(miniappPkgPath, buildMinimalMiniappPkg());

    report.platform.electronFuses = await callTool(
      client,
      'electron_check_fuses',
      { exePath: electronExePath },
      15000,
    );
    report.platform.electronUserdata = await callTool(
      client,
      'electron_scan_userdata',
      { dirPath: electronUserdataDir, maxFiles: 10, maxFileSizeKB: 32 },
      15000,
    );
    report.platform.asarExtract = await callTool(
      client,
      'asar_extract',
      { inputPath: asarPath, listOnly: true },
      15000,
    );
    report.platform.asarSearch = await callTool(
      client,
      'asar_search',
      { inputPath: asarPath, pattern: 'isPro|marker', fileGlob: '*.js', maxResults: 10 },
      15000,
    );
    report.platform.miniappScan = await callTool(
      client,
      'miniapp_pkg_scan',
      { searchPath: miniappDir },
      15000,
    );
    const pcapPath = join(platformProbeDir, 'runtime-audit.pcap');
    report.protocol.payloadTemplate = await callTool(
      client,
      'payload_template_build',
      {
        fields: [
          { name: 'magic', type: 'u16', value: 0x1234 },
          { name: 'tag', type: 'string', value: 'OK', encoding: 'ascii', length: 4, padByte: 0x20 },
          { name: 'tail', type: 'bytes', value: 'aabb', encoding: 'hex' },
        ],
        endian: 'big',
      },
      15000,
    );
    report.protocol.payloadMutate = await callTool(
      client,
      'payload_mutate',
      {
        hexPayload: '001020',
        mutations: [
          { strategy: 'set_byte', offset: 1, value: 255 },
          { strategy: 'flip_bit', offset: 2, bit: 0 },
          { strategy: 'append_bytes', data: 'aa', encoding: 'hex' },
        ],
      },
      15000,
    );
    report.protocol.ethernet = await callTool(
      client,
      'ethernet_frame_build',
      {
        destinationMac: 'aa:bb:cc:dd:ee:ff',
        sourceMac: '11:22:33:44:55:66',
        etherType: 'ipv4',
        payloadHex: '4500',
      },
      15000,
    );
    report.protocol.arp = await callTool(
      client,
      'arp_build',
      {
        operation: 'request',
        senderMac: '11:22:33:44:55:66',
        senderIp: '192.0.2.10',
        targetIp: '192.0.2.1',
      },
      15000,
    );
    report.protocol.rawIp = await callTool(
      client,
      'raw_ip_packet_build',
      {
        version: 'ipv4',
        sourceIp: '192.0.2.1',
        destinationIp: '198.51.100.2',
        protocol: 'icmp',
        identification: 1,
        dontFragment: true,
        ttl: 64,
        payloadHex: '08000000',
      },
      15000,
    );
    report.protocol.icmpEcho = await callTool(
      client,
      'icmp_echo_build',
      {
        operation: 'request',
        identifier: 1,
        sequenceNumber: 2,
        payloadHex: 'aabb',
      },
      15000,
    );
    report.protocol.checksum = await callTool(
      client,
      'checksum_apply',
      {
        hexPayload: '0800000000010002aabb',
        zeroOffset: 2,
        zeroLength: 2,
        writeOffset: 2,
      },
      15000,
    );
    report.protocol.pcapWrite = await callTool(
      client,
      'pcap_write',
      {
        path: pcapPath,
        packets: [
          {
            dataHex: '001122334455aabbccddeeff08000102',
            timestampSeconds: 1700000000,
            timestampFraction: 1234,
          },
          {
            dataHex: '08004d4100010002aabb',
            timestampSeconds: 1700000001,
            timestampFraction: 5678,
            originalLength: 10,
          },
        ],
        linkType: 'ethernet',
      },
      15000,
    );
    report.protocol.pcapRead = await callTool(
      client,
      'pcap_read',
      { path: pcapPath, maxPackets: 2 },
      15000,
    );
    report.maintenance.tokenStats = await callTool(client, 'get_token_budget_stats', {}, 15000);
    report.maintenance.cacheStats = await callTool(client, 'get_cache_stats', {}, 15000);
    report.maintenance.doctor = await callTool(
      client,
      'doctor_environment',
      { includeBridgeHealth: false },
      45000,
    );
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
    report.mojo.liveCaptureAvailable = isCapabilityAvailable(
      report.mojo.capabilities,
      'mojo_live_capture',
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
    const auditHost = new URL(server.baseUrl).hostname;
    const screenshotPath = join(runtimeArtifactDir, 'runtime-audit-element.png');
    const performanceTracePath = join(runtimeArtifactDir, 'runtime-performance-trace.json');
    const cpuProfilePath = join(runtimeArtifactDir, 'runtime-audit.cpuprofile');
    const heapSamplingPath = join(runtimeArtifactDir, 'runtime-heap-sampling.json');
    report.browser.waitForSelector = await callTool(
      client,
      'page_wait_for_selector',
      { selector: '#click-target', timeout: 5000 },
      15000,
    );
    report.browser.setViewport = await callTool(
      client,
      'page_set_viewport',
      { width: 1024, height: 768 },
      15000,
    );
    report.browser.injectScript = await callTool(
      client,
      'page_inject_script',
      {
        script:
          "window.__auditInjectedScript = 'injected'; const output = document.getElementById('inject-output'); if (output) output.textContent = window.__auditInjectedScript;",
      },
      15000,
    );
    report.browser.type = await callTool(
      client,
      'page_type',
      { selector: '#name-input', text: 'AuditName' },
      15000,
    );
    report.browser.pressKey = await callTool(client, 'page_press_key', { key: 'Enter' }, 15000);
    report.browser.select = await callTool(
      client,
      'page_select',
      { selector: '#color-select', values: ['blue'] },
      15000,
    );
    report.browser.hover = await callTool(
      client,
      'page_hover',
      { selector: '#hover-target' },
      15000,
    );
    report.browser.click = await callTool(
      client,
      'page_click',
      { selector: '#click-target' },
      15000,
    );
    report.browser.screenshot = await callTool(
      client,
      'page_screenshot',
      { selector: '#click-target', path: screenshotPath, type: 'png' },
      30000,
    );
    try {
      report.browser.screenshotBytes = (await readFile(screenshotPath)).length;
    } catch {}
    report.browser.scroll = await callTool(client, 'page_scroll', { x: 0, y: 1200 }, 15000);
    report.browser.interactionState = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => ({
          typedValue: window.__auditTypedValue ?? null,
          lastKey: window.__auditLastKey ?? null,
          selectedValue: window.__auditSelectedValue ?? null,
          hoverCount: window.__auditHoverCount ?? 0,
          clickCount: window.__auditClickCount ?? 0,
          injected: window.__auditInjectedScript ?? null,
          scrollY: window.scrollY,
          innerWidth: window.innerWidth
        }))()`,
      },
      15000,
    );
    report.browser.cookiesSet = await callTool(
      client,
      'page_cookies',
      {
        action: 'set',
        cookies: [{ name: 'page_probe', value: '1', domain: auditHost, path: '/' }],
      },
      15000,
    );
    report.browser.cookiesGet = await callTool(client, 'page_cookies', { action: 'get' }, 15000);
    if (typeof report.browser.cookiesGet?.count === 'number') {
      report.browser.cookiesClear = await callTool(
        client,
        'page_cookies',
        { action: 'clear', expectedCount: report.browser.cookiesGet.count },
        15000,
      );
    }
    report.browser.localStorageSet = await callTool(
      client,
      'page_local_storage',
      { action: 'set', key: 'page-probe', value: 'storage-ok' },
      15000,
    );
    report.browser.localStorageGet = await callTool(
      client,
      'page_local_storage',
      { action: 'get' },
      15000,
    );
    report.workflow.pageScriptRegister = await callTool(
      client,
      'page_script_register',
      {
        name: 'runtime_probe',
        description: 'Return a doubled runtime probe value.',
        code: '(() => ({ value: __params__.value, doubled: __params__.value * 2 }))()',
      },
      15000,
    );
    report.workflow.pageScriptRun = await callTool(
      client,
      'page_script_run',
      { name: 'runtime_probe', params: { value: 21 } },
      15000,
    );
    report.performance.traceStart = await callTool(
      client,
      'performance_trace',
      { action: 'start', categories: ['devtools.timeline', 'v8.execute'] },
      30000,
    );
    report.browser.reload = await callTool(client, 'page_reload', {}, 30000);
    report.performance.traceStop = await callTool(
      client,
      'performance_trace',
      { action: 'stop', artifactPath: performanceTracePath },
      60000,
    );
    try {
      report.performance.traceBytes = (await readFile(performanceTracePath)).length;
    } catch {}
    report.browser.reloadState = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => ({
          reloadCount: Number(localStorage.getItem(${JSON.stringify(ROOT_RELOAD_KEY)}) || '0'),
          externalLoaded: window.__auditRuntimeProbeExternalLoaded === true,
          inlineLoaded: window.__auditRuntimeProbeInlineLoaded === true
        }))()`,
      },
      15000,
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
    report.performance.cpuStart = await callTool(
      client,
      'profiler_cpu',
      { action: 'start' },
      30000,
    );
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
      extractString(
        getCapability(report.captcha.capabilities, 'captcha_external_service_2captcha'),
        ['configuredProvider'],
      ) ??
      null;
    report.wasm.capabilities = await callTool(client, 'wasm_capabilities', {}, 15000);
    report.wasm.pageCaptureAvailable = isCapabilityAvailable(
      report.wasm.capabilities,
      'wasm_browser_capture_current_page',
    );
    report.wasm.wasm2watAvailable = isCapabilityAvailable(
      report.wasm.capabilities,
      'wabt_wasm2wat',
    );
    report.wasm.offlineRuntimeAvailable = isCapabilityAvailable(
      report.wasm.capabilities,
      'wasm_offline_runtime',
    );
    report.coordination.create = await callTool(
      client,
      'create_task_handoff',
      {
        description: 'Runtime audit coordination probe',
        constraints: ['runtime-audit'],
        targetDomain: 'network',
      },
      15000,
    );
    report.coordination.appendInsight = await callTool(
      client,
      'append_session_insight',
      {
        category: 'audit',
        content: 'Captured runtime coordination fixture state',
        confidence: 1,
      },
      15000,
    );
    report.coordination.context = await callTool(
      client,
      'get_task_context',
      { taskId: report.coordination.create?.taskId },
      15000,
    );
    report.coordination.seedState = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => {
          document.cookie = 'audit_cookie=initial; path=/';
          localStorage.setItem('audit-key', 'snapshot-value');
          sessionStorage.setItem('audit-session', 'snapshot-session');
          return {
            url: location.href,
            cookie: document.cookie,
            localStorage: localStorage.getItem('audit-key'),
            sessionStorage: sessionStorage.getItem('audit-session'),
          };
        })()`,
      },
      15000,
    );
    report.coordination.saveSnapshot = await callTool(
      client,
      'save_page_snapshot',
      { label: 'runtime-audit' },
      15000,
    );
    report.coordination.snapshotList = await callTool(client, 'list_page_snapshots', {}, 15000);
    if (report.coordination.saveSnapshot?.snapshotId) {
      report.coordination.mutateState = await callTool(
        client,
        'page_evaluate',
        {
          code: `(() => {
            document.cookie = 'audit_cookie=mutated; path=/';
            localStorage.setItem('audit-key', 'mutated-value');
            sessionStorage.setItem('audit-session', 'mutated-session');
            return {
              cookie: document.cookie,
              localStorage: localStorage.getItem('audit-key'),
              sessionStorage: sessionStorage.getItem('audit-session'),
            };
          })()`,
        },
        15000,
      );
      report.coordination.restore = await callTool(
        client,
        'restore_page_snapshot',
        { snapshotId: report.coordination.saveSnapshot.snapshotId },
        30000,
      );
      report.coordination.restoreState = await callTool(
        client,
        'page_evaluate',
        {
          code: `(() => ({
            hasCookie: document.cookie.includes('audit_cookie=initial'),
            localStorage: localStorage.getItem('audit-key'),
            sessionStorage: sessionStorage.getItem('audit-session')
          }))()`,
        },
        15000,
      );
    }
    if (report.coordination.create?.taskId) {
      report.coordination.complete = await callTool(
        client,
        'complete_task_handoff',
        {
          taskId: report.coordination.create.taskId,
          summary: 'Runtime audit coordination probe complete',
          keyFindings: ['snapshot saved', 'snapshot restored'],
        },
        15000,
      );
    }
    report.network.rawHttp = await callTool(
      client,
      'http_plain_request',
      {
        host: '127.0.0.1',
        port: Number(new URL(server.baseUrl).port),
        requestText:
          'GET /body?via=raw-http HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      },
      30000,
    );
    report.network.rawBodyHasMarker = flattenStrings(report.network.rawHttp).some((entry) =>
      entry.includes(BODY_MARKER),
    );
    report.network.http2 = await callTool(
      client,
      'http2_probe',
      {
        url: server.http2Url,
        timeoutMs: 15000,
        maxBodyBytes: 16384,
      },
      30000,
    );
    report.network.http2BodyHasMarker = flattenStrings(report.network.http2).some((entry) =>
      entry.includes(HTTP2_MARKER),
    );
    report.network.rtt = await callTool(
      client,
      'network_rtt_measure',
      {
        url: server.baseUrl,
        probeType: 'http',
        iterations: 1,
        timeoutMs: 5000,
      },
      30000,
    );
    report.network.tcpOpen = await callTool(
      client,
      'tcp_open',
      {
        host: '127.0.0.1',
        port: Number(new URL(server.baseUrl).port),
        timeoutMs: 5000,
      },
      30000,
    );
    const tcpSessionId =
      typeof report.network.tcpOpen?.sessionId === 'string'
        ? report.network.tcpOpen.sessionId
        : null;
    if (tcpSessionId) {
      report.network.tcpWrite = await callTool(
        client,
        'tcp_write',
        {
          sessionId: tcpSessionId,
          dataText:
            'GET /body?via=tcp-session HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        },
        30000,
      );
      report.network.tcpRead = await callTool(
        client,
        'tcp_read_until',
        {
          sessionId: tcpSessionId,
          delimiterText: BODY_MARKER,
          includeDelimiter: true,
          timeoutMs: 5000,
        },
        30000,
      );
      report.network.tcpClose = await callTool(
        client,
        'tcp_close',
        { sessionId: tcpSessionId },
        15000,
      );
    }

    report.network.tlsOpen = await callTool(
      client,
      'tls_open',
      {
        host: '127.0.0.1',
        port: server.tlsPort,
        servername: 'localhost',
        caPem: TEST_CERT_PEM,
        alpnProtocols: ['http/1.1'],
        timeoutMs: 5000,
      },
      30000,
    );
    const tlsSessionId =
      typeof report.network.tlsOpen?.sessionId === 'string'
        ? report.network.tlsOpen.sessionId
        : null;
    if (tlsSessionId) {
      report.network.tlsWrite = await callTool(
        client,
        'tls_write',
        {
          sessionId: tlsSessionId,
          dataText: 'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
        },
        30000,
      );
      report.network.tlsRead = await callTool(
        client,
        'tls_read_until',
        {
          sessionId: tlsSessionId,
          delimiterText: BODY_MARKER,
          includeDelimiter: true,
          timeoutMs: 5000,
        },
        30000,
      );
      report.network.tlsClose = await callTool(
        client,
        'tls_close',
        { sessionId: tlsSessionId },
        15000,
      );
    }

    report.network.rawWebSocketOpen = await callTool(
      client,
      'websocket_open',
      { url: server.wsUrl, timeoutMs: 5000 },
      30000,
    );
    const rawWebSocketSessionId =
      typeof report.network.rawWebSocketOpen?.sessionId === 'string'
        ? report.network.rawWebSocketOpen.sessionId
        : null;
    if (rawWebSocketSessionId) {
      report.network.rawWebSocketHello = await callTool(
        client,
        'websocket_read_frame',
        { sessionId: rawWebSocketSessionId, timeoutMs: 5000 },
        30000,
      );
      report.network.rawWebSocketSend = await callTool(
        client,
        'websocket_send_frame',
        {
          sessionId: rawWebSocketSessionId,
          frameType: 'text',
          dataText: 'hello',
          timeoutMs: 5000,
        },
        30000,
      );
      report.network.rawWebSocketReply = await callTool(
        client,
        'websocket_read_frame',
        { sessionId: rawWebSocketSessionId, timeoutMs: 5000 },
        30000,
      );
      report.network.rawWebSocketClose = await callTool(
        client,
        'websocket_close',
        {
          sessionId: rawWebSocketSessionId,
          closeCode: 1000,
          closeReason: 'done',
          timeoutMs: 1000,
        },
        15000,
      );
    }

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
      'console_inject',
      { type: 'xhr' },
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
    report.network.interceptAdd = await callTool(
      client,
      'network_intercept',
      {
        action: 'add',
        urlPattern: `${server.baseUrl}/intercept-target*`,
        urlPatternType: 'glob',
        responseCode: 200,
        responseHeaders: { 'content-type': 'text/plain; charset=utf-8', 'x-audit-intercept': '1' },
        responseBody: INTERCEPT_MARKER,
      },
      30000,
    );
    report.mojo.monitorStart = await callTool(client, 'mojo_monitor', { action: 'start' }, 30000);
    report.browser.seedAuditProbeScript = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => {
          const script = document.createElement('script');
          script.dataset.auditProbe = 'true';
          script.textContent = 'function auditProbeFn(){ return 7; } window.auditProbeFn = auditProbeFn;\\n//# sourceURL=audit-probe.js';
          document.documentElement.appendChild(script);
          return { inserted: true, scriptCount: document.scripts.length };
        })()`,
      },
      15000,
    );
    report.browser.consoleExecute = await callTool(
      client,
      'console_execute',
      { expression: 'window.auditProbeFn()' },
      15000,
    );
    {
      const largeScriptPayload = `window.__auditLargeText = ${JSON.stringify('L'.repeat(70000))};`;
      report.browser.seedLargeAuditScript = await callTool(
        client,
        'page_evaluate',
        {
          code: `(() => {
            const script = document.createElement('script');
            script.dataset.auditLargeProbe = 'true';
            script.textContent = ${JSON.stringify(`${largeScriptPayload}\n//# sourceURL=audit-large.js`)};
            document.documentElement.appendChild(script);
            return {
              inserted: true,
              textLength: script.textContent.length,
              largeTextLength: window.__auditLargeText.length,
            };
          })()`,
        },
        15000,
      );
    }
    report.browser.pageEval = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => new Promise(async (resolve, reject) => {
          const result = {};
          try {
            console.log(${JSON.stringify(CONSOLE_LOG_MARKER)});
            console.warn(${JSON.stringify(`${CONSOLE_LOG_MARKER}-warn`)});
            console.error(${JSON.stringify(`${CONSOLE_LOG_MARKER}-error`)});
            setTimeout(() => {
              throw new Error(${JSON.stringify(CONSOLE_EXCEPTION_MARKER)});
            }, 0);

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

            await new Promise((resume) => setTimeout(resume, 50));
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }))()`,
      },
      45000,
    );
    report.browser.consoleLogs = await callTool(client, 'console_get_logs', { limit: 20 }, 15000);
    {
      const consoleLogStrings = flattenStrings(report.browser.consoleLogs);
      report.browser.consoleHasLogMarker = consoleLogStrings.some((entry) =>
        entry.includes(CONSOLE_LOG_MARKER),
      );
      report.browser.consoleHasWarnMarker = consoleLogStrings.some((entry) =>
        entry.includes(`${CONSOLE_LOG_MARKER}-warn`),
      );
      report.browser.consoleHasErrorMarker = consoleLogStrings.some((entry) =>
        entry.includes(`${CONSOLE_LOG_MARKER}-error`),
      );
    }
    report.network.consoleExceptions = await callTool(
      client,
      'console_get_exceptions',
      { limit: 20 },
      15000,
    );
    {
      const consoleExceptionStrings = flattenStrings(report.network.consoleExceptions);
      report.network.consoleExceptionHasMarker = consoleExceptionStrings.some((entry) =>
        entry.includes(CONSOLE_EXCEPTION_MARKER),
      );
    }
    report.browser.interceptorExercise = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => new Promise(async (resolve, reject) => {
          try {
            const dynamic = document.createElement('script');
            dynamic.textContent = 'window.__auditDynamicScriptSeen = true;';
            document.documentElement.appendChild(dynamic);

            const fetchText = await fetch(${JSON.stringify(`${server.baseUrl}/body?via=inject-fetch`)}).then((resp) => resp.text());

            const xhrText = await new Promise((resolveXhr, rejectXhr) => {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', ${JSON.stringify(`${server.baseUrl}/body?via=inject-xhr`)}, true);
              xhr.onload = () => resolveXhr(xhr.responseText || '');
              xhr.onerror = () => rejectXhr(new Error('xhr error'));
              xhr.send();
            });

            resolve({
              dynamicScriptSeen: window.__auditDynamicScriptSeen === true,
              fetchHasMarker: fetchText.includes(${JSON.stringify(BODY_MARKER)}),
              xhrHasMarker: xhrText.includes(${JSON.stringify(BODY_MARKER)}),
            });
          } catch (error) {
            reject(error);
          }
        }))()`,
      },
      30000,
    );
    report.network.interceptFetch = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => new Promise(async (resolve, reject) => {
          try {
            const response = await fetch(${JSON.stringify(`${server.baseUrl}/intercept-target?via=intercept`)});
            resolve({
              status: response.status,
              header: response.headers.get('x-audit-intercept'),
              body: await response.text(),
            });
          } catch (error) {
            reject(error);
          }
        }))()`,
      },
      30000,
    );
    report.network.interceptList = await callTool(
      client,
      'network_intercept',
      { action: 'list' },
      15000,
    );
    report.network.interceptDisable = await callTool(
      client,
      'network_intercept',
      { action: 'disable', all: true },
      15000,
    );
    report.network.authExercise = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => new Promise(async (resolve, reject) => {
          try {
            const response = await fetch(${JSON.stringify(`${server.baseUrl}/body?via=auth`)}, {
              method: 'POST',
              headers: {
                Authorization: ${JSON.stringify(`Bearer ${AUTH_BEARER_MARKER}`)},
                'X-Api-Key': ${JSON.stringify(AUTH_API_KEY_MARKER)},
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ signature: ${JSON.stringify(AUTH_SIGNATURE_MARKER)} }),
            });
            const body = await response.text();
            resolve({ status: response.status, bodyHasMarker: body.includes(${JSON.stringify(BODY_MARKER)}) });
          } catch (error) {
            reject(error);
          }
        }))()`,
      },
      30000,
    );
    report.network.consoleBuffersClear = await callTool(
      client,
      'console_buffers',
      { action: 'clear' },
      15000,
    );
    report.network.consoleBuffersReset = await callTool(
      client,
      'console_buffers',
      { action: 'reset' },
      15000,
    );
    report.browser.jsdomParse = await callTool(
      client,
      'browser_jsdom_parse',
      {
        html: '<!doctype html><html><head><title>JSDOM Probe</title></head><body><main id="app"><a class="item" href="/docs">Docs</a><div id="output"></div></main></body></html>',
        url: `${server.baseUrl}/jsdom-probe`,
        runScripts: 'outside-only',
      },
      15000,
    );
    report.browser.jsdomSessionId =
      typeof report.browser.jsdomParse?.sessionId === 'string'
        ? report.browser.jsdomParse.sessionId
        : null;
    if (report.browser.jsdomSessionId) {
      report.browser.jsdomQuery = await callTool(
        client,
        'browser_jsdom_query',
        {
          sessionId: report.browser.jsdomSessionId,
          selector: '#app .item',
          includeHtml: true,
          attributes: ['href', 'class'],
        },
        15000,
      );
      report.browser.jsdomExecute = await callTool(
        client,
        'browser_jsdom_execute',
        {
          sessionId: report.browser.jsdomSessionId,
          code: `document.querySelector('#output').textContent = String(3 + 4); console.log('jsdom-probe-log'); ({ output: document.querySelector('#output').textContent, title: document.title });`,
        },
        15000,
      );
      report.browser.jsdomSerialize = await callTool(
        client,
        'browser_jsdom_serialize',
        {
          sessionId: report.browser.jsdomSessionId,
          selector: '#app',
          pretty: true,
        },
        15000,
      );
      report.browser.jsdomCookieSet = await callTool(
        client,
        'browser_jsdom_cookies',
        {
          sessionId: report.browser.jsdomSessionId,
          action: 'set',
          cookie: { name: 'probe', value: 'cookie-ok', path: '/' },
        },
        15000,
      );
      report.browser.jsdomCookieGet = await callTool(
        client,
        'browser_jsdom_cookies',
        {
          sessionId: report.browser.jsdomSessionId,
          action: 'get',
        },
        15000,
      );
      report.browser.jsdomCookieClear = await callTool(
        client,
        'browser_jsdom_cookies',
        {
          sessionId: report.browser.jsdomSessionId,
          action: 'clear',
        },
        15000,
      );
    }
    report.v8.debugger = await callTool(client, 'debugger_lifecycle', { action: 'enable' }, 30000);
    report.v8.version = await callTool(client, 'v8_version_detect', {}, 30000);
    report.v8.scripts = await callTool(client, 'get_all_scripts', { maxScripts: 200 }, 30000);
    const firstScript = pickScriptForV8Inspection(report.v8.scripts?.scripts);
    report.v8.firstScriptId =
      isRecord(firstScript) && typeof firstScript.scriptId === 'string'
        ? firstScript.scriptId
        : null;
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
            typeof detailedSource === 'string' &&
            detailedSource.includes('window.__auditLargeText'),
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
        typeof report.network.responseBody?.body === 'string'
          ? report.network.responseBody.body
          : '';
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
        code: `(() => fetch(${JSON.stringify(`${server.baseUrl}/body?via=trace-alias`)})
          .then((resp) => resp.text())
          .then((text) => ({ hasMarker: text.includes(${JSON.stringify(BODY_MARKER)}) })))()`,
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
    report.browser.historyForward = await callTool(
      client,
      'page_forward',
      { timeout: 5000 },
      15000,
    );
    report.browser.historyForwardState = await callTool(
      client,
      'page_evaluate',
      { code: '(() => ({ href: location.href, title: document.title }))()' },
      15000,
    );
    const crossDomainUrl = `${server.baseUrl}/body?via=cross-domain`;
    report.crossDomain.capabilities = await callTool(
      client,
      'cross_domain_capabilities',
      {},
      15000,
    );
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
          layers: [
            { id: 'layer-1', label: 'readFileBuffer', type: 'picture', heapObjectId: '0x1' },
          ],
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
        cdpEvents: [
          { eventType: 'Network.requestWillBeSent', timestamp: 1010, url: crossDomainUrl },
        ],
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
    report.evidence.exportJson = await callTool(
      client,
      'evidence_export',
      { format: 'json' },
      15000,
    );
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
        code: `(() => ({ ok: true, marker: ${JSON.stringify(BODY_MARKER)}, __scratchpad: { marker: ${JSON.stringify(BODY_MARKER)} } }))()`,
        sessionId: sandboxSessionId,
        timeoutMs: 2000,
      },
      30000,
    );
    report.sandbox.ok = flattenStrings(report.sandbox.run).some((entry) =>
      entry.includes('Success'),
    );
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
    report.network.disable = await callTool(client, 'network_disable', {}, 15000);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    failure = error;
  } finally {
    try {
      report.proxy.stop = await callTool(client, 'proxy_stop', {}, 15000);
    } catch (error) {
      report.proxy.stopError = error instanceof Error ? error.message : String(error);
    }
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
    if (platformProbeDir) {
      try {
        await rm(platformProbeDir, { recursive: true, force: true });
      } catch {}
    }
  }

  report.runtimeCoverage = buildRuntimeCoverage(report.tools);

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
