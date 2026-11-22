import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as child_process from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import { once } from 'node:events';
import { buildTestHost } from '@tests/shared/test-urls';
import { ProxyHandlers } from '@server/domains/proxy/index';
import { readBodyPreview } from '@server/domains/proxy/handlers.impl';
import { PROXY_CAPTURE_BODY_SKIP_BYTES } from '@src/constants/proxy';
import { TEST_HTTP_URLS, withPath } from '@tests/shared/test-urls';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';

vi.mock('child_process', () => {
  return {
    execFile: vi.fn((_cmd: any, _args: any, _opts: any, cb: any) => {
      // simulate success
      cb(null, 'success', '');
    }),
  };
});

function parseResponse(res: any) {
  if (res.isError) throw new Error('Response is an error: ' + JSON.stringify(res, null, 2));
  return JSON.parse(res.content[0].text);
}

function parseAnyResponse(res: any) {
  return JSON.parse(res.content[0].text);
}

async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }
  return address.port;
}

async function sendRawHttpRequest(port: number, requestText: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(requestText);
    });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

async function waitForCapturedLogs(
  handlers: ProxyHandlers,
  urlFilter: string,
  predicate: (logs: Array<Record<string, any>>) => boolean,
): Promise<Array<Record<string, any>>> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const logsData = parseResponse(await handlers.handleProxyGetRequests({ urlFilter }));
    const logs = logsData.logs as Array<Record<string, any>>;
    if (predicate(logs)) {
      return logs;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const finalData = parseResponse(await handlers.handleProxyGetRequests({ urlFilter }));
  throw new Error(`Timed out waiting for captured logs: ${JSON.stringify(finalData.logs)}`);
}

type FakeBuilder = {
  delay: ReturnType<typeof vi.fn>;
  thenPassThrough: ReturnType<typeof vi.fn>;
  thenForwardTo: ReturnType<typeof vi.fn>;
  thenCloseConnection: ReturnType<typeof vi.fn>;
  thenReply: ReturnType<typeof vi.fn>;
};

let fakeEndpointSeq = 0;
function installFakeRuleServer(handlers: ProxyHandlers) {
  const endpoint = () => ({
    id: `fake-endpoint-${++fakeEndpointSeq}`,
    dispose: vi.fn(async () => undefined),
  });
  const builder: FakeBuilder = {
    delay: vi.fn((): FakeBuilder => builder),
    thenPassThrough: vi.fn(async () => endpoint()),
    thenForwardTo: vi.fn(async () => endpoint()),
    thenCloseConnection: vi.fn(async () => endpoint()),
    thenReply: vi.fn(async () => endpoint()),
  };
  const server = {
    forGet: vi.fn(() => builder),
    forPost: vi.fn(() => builder),
    forPut: vi.fn(() => builder),
    forDelete: vi.fn(() => builder),
    forMethod: vi.fn(() => builder),
    forAnyRequest: vi.fn(() => builder),
    reset: vi.fn(() => undefined),
    stop: vi.fn(async () => undefined),
  };
  (handlers as any).server = server;
  return { builder, server };
}

// mockttp 4.4.x has an asn1.js dependency resolution issue on some Linux CI
// environments that prevents HTTPS proxy startup. Probe once and skip HTTPS
// tests when the TLS key parser is broken.
let httpsAvailable = true;
beforeAll(async () => {
  const probe = new ProxyHandlers();
  const res: any = await probe.handleProxyStart({ port: 19999, useHttps: true });
  if (res.isError) {
    httpsAvailable = false;
  } else {
    await probe.handleProxyStop({});
  }
});

describe('ProxyHandlers (Integration)', () => {
  let handlers: ProxyHandlers;
  const testPort = 18081;

  beforeEach(() => {
    handlers = new ProxyHandlers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Attempt cleanup
    await handlers.handleProxyStop({});
  });

  it('should start and stop the proxy smoothly (HTTP only)', async () => {
    const startRes = await handlers.handleProxyStart({ port: testPort, useHttps: false });
    const startData = parseResponse(startRes);
    expect(startData.success).toBe(true);
    expect(startData.port).toBe(testPort);

    const statusRes = await handlers.handleProxyStatus({});
    const statusData = parseResponse(statusRes);
    expect(statusData.success).toBe(true);
    expect(statusData.running).toBe(true);

    const stopRes = await handlers.handleProxyStop({});
    expect(parseResponse(stopRes).success).toBe(true);

    const endStatusRes = await handlers.handleProxyStatus({});
    expect(parseResponse(endStatusRes).running).toBe(false);
  });

  it('should generate CA and start with HTTPS enabled', async () => {
    if (!httpsAvailable) return;
    const port = testPort + 1;
    const startRes: any = await handlers.handleProxyStart({ port, useHttps: true });
    const startData = parseResponse(startRes);
    expect(startData.success).toBe(true);
    expect(startData.caCertPath).toBeTruthy();

    const exportRes: any = await handlers.handleProxyExportCa({});
    expect(parseResponse(exportRes).content).toContain('BEGIN CERTIFICATE');
  });

  it('should generate an error if exporting CA without HTTPS enabled', async () => {
    // Remove CA cert so the handler can't find it
    const fs = await import('node:fs');
    const path = await import('node:path');
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    const certPath = path.join(home, '.jshookmcp', 'ca', 'ca.pem');
    const certExisted = fs.existsSync(certPath);
    let backup: string | null = null;
    if (certExisted) {
      backup = fs.readFileSync(certPath, 'utf8');
      fs.unlinkSync(certPath);
    }
    try {
      const tempHandler = new ProxyHandlers();
      await tempHandler.handleProxyStart({ port: testPort + 5, useHttps: false });
      const exportRes: any = await tempHandler.handleProxyExportCa({});
      expect(exportRes.isError).toBe(true);
      expect(exportRes.content[0].text).toContain('CA certificate not found');
      await tempHandler.handleProxyStop({});
    } finally {
      if (backup) fs.writeFileSync(certPath, backup);
    }
  });

  it('should buffer requests properly', async () => {
    await handlers.handleProxyStart({ port: testPort + 2, useHttps: false });

    // Test trying to add rule without server (will fail in unit test if handlers not started, but here it is started)
    const ruleRes: any = await handlers.handleProxyAddRule({
      action: 'mock_response',
      method: 'GET',
      urlPattern: withPath(TEST_HTTP_URLS.root, 'api'),
      mockStatus: 201,
      mockBody: '{"mocked": true}',
    });

    const ruleData = parseResponse(ruleRes);
    expect(ruleData.success).toBe(true);
    expect(ruleData.endpointId).toBeDefined();
    expect(ruleData.rule).toMatchObject({
      endpointId: ruleData.endpointId,
      action: 'mock_response',
      method: 'GET',
      urlPattern: withPath(TEST_HTTP_URLS.root, 'api'),
      mockStatus: 201,
    });

    const logsRes: any = await handlers.handleProxyGetRequests({});
    expect(Array.isArray(parseResponse(logsRes).logs)).toBe(true);
  });

  it('lists and clears active proxy rules without stopping the server', async () => {
    await handlers.handleProxyStart({ port: testPort + 9, useHttps: false });

    const ruleRes = await handlers.handleProxyAddRule({
      action: 'mock_response',
      method: 'GET',
      urlPattern: '/rules-test/',
      mockStatus: 204,
      mockBody: '',
    });
    const ruleData = parseResponse(ruleRes);
    expect(ruleData.success).toBe(true);

    const listData = parseResponse(await handlers.handleProxyListRules({}));
    expect(listData.count).toBe(1);
    expect(listData.rules[0]).toMatchObject({
      endpointId: ruleData.endpointId,
      action: 'mock_response',
      method: 'GET',
      urlPattern: '/rules-test/',
      mockStatus: 204,
    });

    const statusData = parseResponse(await handlers.handleProxyStatus({}));
    expect(statusData.running).toBe(true);
    expect(statusData.ruleCount).toBe(1);

    const clearData = parseResponse(await handlers.handleProxyClearRules({}));
    expect(clearData).toMatchObject({
      success: true,
      cleared: 1,
    });

    const afterList = parseResponse(await handlers.handleProxyListRules({}));
    expect(afterList.count).toBe(0);
    expect(afterList.rules).toEqual([]);
    expect(parseResponse(await handlers.handleProxyStatus({})).running).toBe(true);
  });

  it('uses exact method matching for non-canonical HTTP verbs', async () => {
    const builder = {
      thenPassThrough: vi.fn(async () => ({ id: 'patch-endpoint' })),
      thenCloseConnection: vi.fn(async () => ({ id: 'patch-endpoint' })),
      thenReply: vi.fn(async () => ({ id: 'patch-endpoint' })),
    };
    const server = {
      forGet: vi.fn(() => builder),
      forPost: vi.fn(() => builder),
      forPut: vi.fn(() => builder),
      forDelete: vi.fn(() => builder),
      forMethod: vi.fn(() => builder),
      forAnyRequest: vi.fn(() => builder),
      stop: vi.fn(async () => undefined),
    };
    (handlers as any).server = server;

    const data = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'block',
        method: 'PATCH',
        urlPattern: '/patch-only/',
      }),
    );

    expect(data.success).toBe(true);
    expect(server.forMethod).toHaveBeenCalledWith('PATCH', /patch-only/);
    expect(server.forAnyRequest).not.toHaveBeenCalled();
    expect(builder.thenCloseConnection).toHaveBeenCalledOnce();
    expect(data.rule).toMatchObject({
      endpointId: 'patch-endpoint',
      action: 'block',
      method: 'PATCH',
      urlPattern: '/patch-only/',
    });
  });

  it('rejects invalid rule actions before creating a matcher', async () => {
    const { builder, server } = installFakeRuleServer(handlers);

    const result = await handlers.handleProxyAddRule({
      action: 'drop',
      method: 'GET',
      urlPattern: '/drop/',
    });
    const data = parseAnyResponse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain('action must be one of');
    expect(server.forGet).not.toHaveBeenCalled();
    expect(builder.thenPassThrough).not.toHaveBeenCalled();
    expect(builder.thenCloseConnection).not.toHaveBeenCalled();
    expect(builder.thenReply).not.toHaveBeenCalled();
  });

  it('rejects non-string rule methods instead of defaulting to GET', async () => {
    const { builder, server } = installFakeRuleServer(handlers);

    const result = await handlers.handleProxyAddRule({
      action: 'block',
      method: 42,
      urlPattern: '/invalid-method/',
    });
    const data = parseAnyResponse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain('method must be a string');
    expect(server.forGet).not.toHaveBeenCalled();
    expect(builder.thenCloseConnection).not.toHaveBeenCalled();
  });

  it('rejects invalid mock response statuses before registering a reply', async () => {
    const { builder, server } = installFakeRuleServer(handlers);

    const result = await handlers.handleProxyAddRule({
      action: 'mock_response',
      method: 'GET',
      urlPattern: '/bad-status/',
      mockStatus: 700,
    });
    const data = parseAnyResponse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain('mockStatus must be an integer between 100 and 599');
    expect(server.forGet).not.toHaveBeenCalled();
    expect(builder.thenReply).not.toHaveBeenCalled();
  });

  it('requires a running proxy to clear rules', async () => {
    const result = await handlers.handleProxyClearRules({});
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('Proxy must be running to clear rules');
  });

  it('forwards proxied requests with the upstream response body', async () => {
    const upstreamBody = 'proxy-forward-marker-20260425';
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(upstreamBody);
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 6, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/forward-test/',
      });
      const ruleData = parseResponse(ruleRes);
      expect(ruleData.success).toBe(true);

      const response = await sendRawHttpRequest(
        testPort + 6,
        [
          `GET http://127.0.0.1:${upstreamPort}/forward-test HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(response).toContain(upstreamBody);
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('applies forwardOptions.transformRequest header rewrites to the upstream request', async () => {
    let receivedAuth: string | undefined;
    const upstream = http.createServer((req, res) => {
      receivedAuth = req.headers['authorization'];
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('upstream-ok');
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 10, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/rewrite-req-headers',
        forwardOptions: {
          transformRequest: {
            updateHeaders: { authorization: 'Bearer swapped-token' },
          },
        },
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const response = await sendRawHttpRequest(
        testPort + 10,
        [
          `GET http://127.0.0.1:${upstreamPort}/rewrite-req-headers HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Authorization: Bearer original-token',
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(receivedAuth).toBe('Bearer swapped-token');
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('applies forwardOptions.transformResponse status and header rewrites', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('upstream-body');
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 11, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/rewrite-res-status',
        forwardOptions: {
          transformResponse: {
            replaceStatus: 418,
            updateHeaders: { 'x-rewritten': 'by-proxy' },
          },
        },
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const response = await sendRawHttpRequest(
        testPort + 11,
        [
          `GET http://127.0.0.1:${upstreamPort}/rewrite-res-status HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );

      expect(response).toMatch(/^HTTP\/1\.1 418\b/);
      expect(response).toMatch(/x-rewritten:\s*by-proxy/i);
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('applies forwardOptions.transformRequest.replaceBody to the upstream request', async () => {
    let receivedBody = '';
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('upstream-ok');
      });
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 12, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'POST',
        urlPattern: '/rewrite-req-body',
        forwardOptions: {
          transformRequest: { replaceBody: 'replaced-payload' },
        },
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const originalBody = 'original-payload';
      const response = await sendRawHttpRequest(
        testPort + 12,
        [
          `POST http://127.0.0.1:${upstreamPort}/rewrite-req-body HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Content-Type: text/plain',
          `Content-Length: ${Buffer.byteLength(originalBody)}`,
          'Connection: close',
          '',
          originalBody,
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(receivedBody).toBe('replaced-payload');
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('records forwardOptions on the rule and lists them back', async () => {
    await handlers.handleProxyStart({ port: testPort + 13, useHttps: false });
    const ruleRes = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/recorded-forward',
      forwardOptions: {
        transformResponse: { replaceStatus: 503 },
      },
    });
    const ruleData = parseResponse(ruleRes);
    expect(ruleData.success).toBe(true);
    expect(ruleData.rule.forwardOptions).toMatchObject({
      transformResponse: { replaceStatus: 503 },
    });

    const listData = parseResponse(await handlers.handleProxyListRules({}));
    expect(listData.rules[0].forwardOptions).toMatchObject({
      transformResponse: { replaceStatus: 503 },
    });
  });

  it('omits forwardOptions from the rule record when none are supplied', async () => {
    await handlers.handleProxyStart({ port: testPort + 14, useHttps: false });
    const ruleRes = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/plain-forward',
    });
    const ruleData = parseResponse(ruleRes);
    expect(ruleData.success).toBe(true);
    expect(ruleData.rule.forwardOptions).toBeUndefined();

    const listData = parseResponse(await handlers.handleProxyListRules({}));
    expect(listData.rules[0].forwardOptions).toBeUndefined();
  });

  it('applies forwardOptions.transformRequest.matchReplaceBody (string and regex literal)', async () => {
    let receivedBody = '';
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 15, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'POST',
        urlPattern: '/match-replace-req',
        forwardOptions: {
          transformRequest: {
            matchReplaceBody: [
              ['secret', 'REDACTED'],
              ['/token-v[0-9]+/g', 'token-x'],
            ],
          },
        },
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const originalBody = 'user=alice&secret=abc&token=token-v12345&sig=xyz';
      const response = await sendRawHttpRequest(
        testPort + 15,
        [
          `POST http://127.0.0.1:${upstreamPort}/match-replace-req HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Content-Type: text/plain',
          `Content-Length: ${Buffer.byteLength(originalBody)}`,
          'Connection: close',
          '',
          originalBody,
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(receivedBody).toBe('user=alice&REDACTED=abc&token=token-x&sig=xyz');
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('applies forwardOptions.transformResponse.matchReplaceBody', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('status=ok token=token-v999 debug=on');
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 16, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/match-replace-res',
        forwardOptions: {
          transformResponse: {
            matchReplaceBody: [['/token-v[0-9]+/g', 'REDACTED-TOKEN']],
          },
        },
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const response = await sendRawHttpRequest(
        testPort + 16,
        [
          `GET http://127.0.0.1:${upstreamPort}/match-replace-res HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(response).toContain('REDACTED-TOKEN');
      expect(response).not.toMatch(/token-v999/);
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('applies forwardOptions.transformRequest.updateJsonBody merge', async () => {
    let receivedBody = '';
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    const upstreamPort = await listen(upstream);

    try {
      await handlers.handleProxyStart({ port: testPort + 17, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'POST',
        urlPattern: '/update-json-req',
        forwardOptions: {
          transformRequest: {
            updateJsonBody: { injected: true, role: 'admin' },
          },
        },
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const originalBody = JSON.stringify({ user: 'alice', role: 'guest' });
      const response = await sendRawHttpRequest(
        testPort + 17,
        [
          `POST http://127.0.0.1:${upstreamPort}/update-json-req HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(originalBody)}`,
          'Connection: close',
          '',
          originalBody,
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(JSON.parse(receivedBody)).toEqual({
        user: 'alice',
        role: 'admin',
        injected: true,
      });
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('forwards requests to a different upstream via action=redirect', async () => {
    const upstreamB = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`redirected-to-B:${req.url}`);
    });
    const portB = await listen(upstreamB);
    const unusedPortA = testPort + 19; // nothing listens here; redirect bypasses A

    try {
      await handlers.handleProxyStart({ port: testPort + 18, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'redirect',
        method: 'GET',
        urlPattern: '/redirect-test',
        targetUrl: `http://127.0.0.1:${portB}`,
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const response = await sendRawHttpRequest(
        testPort + 18,
        [
          `GET http://127.0.0.1:${unusedPortA}/redirect-test HTTP/1.1`,
          `Host: 127.0.0.1:${unusedPortA}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');
      expect(response).toContain('redirected-to-B:/redirect-test');
    } finally {
      await new Promise((resolve, reject) => {
        upstreamB.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('registers redirect rules via thenForwardTo and records targetUrl', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const data = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'redirect',
        method: 'GET',
        urlPattern: '/redirect-mock/',
        targetUrl: 'http://127.0.0.1:9090',
        forwardOptions: { transformResponse: { replaceStatus: 201 } },
      }),
    );
    expect(data.success).toBe(true);
    expect(builder.thenForwardTo).toHaveBeenCalledOnce();
    expect(builder.thenForwardTo.mock.calls[0]![0]).toBe('http://127.0.0.1:9090');
    expect(builder.thenForwardTo.mock.calls[0]![1]).toMatchObject({
      transformResponse: { replaceStatus: 201 },
    });
    expect(data.rule).toMatchObject({
      action: 'redirect',
      targetUrl: 'http://127.0.0.1:9090',
    });
    expect(data.rule.delayMs).toBeUndefined();
  });

  it('rejects redirect without a targetUrl', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'redirect',
      method: 'GET',
      urlPattern: '/no-target/',
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('targetUrl is required');
    expect(builder.thenForwardTo).not.toHaveBeenCalled();
  });

  it('rejects redirect targetUrl that includes a path or query', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'redirect',
      method: 'GET',
      urlPattern: '/target-path/',
      targetUrl: 'http://127.0.0.1:9999/with-path',
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('root URL with no path');
    expect(builder.thenForwardTo).not.toHaveBeenCalled();
  });

  it('applies delayMs before the terminal rule step and records it', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const data = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/delayed/',
        delayMs: 250,
      }),
    );
    expect(data.success).toBe(true);
    expect(builder.delay).toHaveBeenCalledWith(250);
    expect(builder.thenPassThrough).toHaveBeenCalledOnce();
    expect(data.rule.delayMs).toBe(250);
  });

  it('omits delay entirely when delayMs is zero', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const data = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/no-delay/',
      }),
    );
    expect(data.success).toBe(true);
    expect(builder.delay).not.toHaveBeenCalled();
    expect(data.rule.delayMs).toBeUndefined();
  });

  it('compiles matchReplaceBody regex literal to RegExp and keeps plain strings', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const data = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'POST',
        urlPattern: '/regex-compile/',
        forwardOptions: {
          transformRequest: {
            matchReplaceBody: [
              ['plain-string', 'lit'],
              ['/pattern-[0-9]+/gi', 'num'],
            ],
          },
        },
      }),
    );
    expect(data.success).toBe(true);
    expect(builder.thenPassThrough).toHaveBeenCalledOnce();
    const opts = builder.thenPassThrough.mock.calls[0]![0] as {
      transformRequest: { matchReplaceBody: Array<[string | RegExp, string]> };
    };
    const pairs = opts.transformRequest.matchReplaceBody;
    expect(pairs[0]![0]).toBe('plain-string');
    expect(pairs[1]![0]).toBeInstanceOf(RegExp);
    expect((pairs[1]![0] as RegExp).source).toBe('pattern-[0-9]+');
    expect((pairs[1]![0] as RegExp).flags).toBe('gi');
  });

  it('rejects an invalid matchReplaceBody regex literal before registering', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'POST',
      urlPattern: '/bad-regex/',
      forwardOptions: {
        transformRequest: {
          matchReplaceBody: [['/(unterminated/g', 'x']],
        },
      },
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('not a valid regex literal');
    expect(builder.thenPassThrough).not.toHaveBeenCalled();
  });

  it('captures request and response body previews with timing metadata', async () => {
    const requestBody = JSON.stringify({ token: 'abc123', action: 'capture' });
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: body, path: req.url }));
      });
    });
    const upstreamPort = await listen(upstream);
    const proxyPort = testPort + 8;

    try {
      await handlers.handleProxyStart({ port: proxyPort, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'POST',
        urlPattern: '/capture-body/',
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const response = await sendRawHttpRequest(
        proxyPort,
        [
          `POST http://127.0.0.1:${upstreamPort}/capture-body HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(requestBody)}`,
          'Connection: close',
          '',
          requestBody,
        ].join('\r\n'),
      );

      expect(response).toContain('202 Accepted');

      const logs = await waitForCapturedLogs(
        handlers,
        'capture-body',
        (entries) =>
          entries.some(
            (entry) => entry.type === 'request' && entry.bodyTextPreview === requestBody,
          ) &&
          entries.some(
            (entry) =>
              entry.type === 'response' &&
              typeof entry.bodyTextPreview === 'string' &&
              entry.bodyTextPreview.includes('"received"'),
          ),
      );

      const requestLog = logs.find((entry) => entry.type === 'request')!;
      const responseLog = logs.find((entry) => entry.type === 'response')!;

      expect(requestLog).toMatchObject({
        method: 'POST',
        url: `http://127.0.0.1:${upstreamPort}/capture-body`,
        bodyTextPreview: requestBody,
        bodyEncoding: 'utf8',
        bodyTruncated: false,
      });
      expect(requestLog.bodyBytes).toBe(Buffer.byteLength(requestBody));
      expect(requestLog.bodyPreviewBytes).toBe(Buffer.byteLength(requestBody));
      expect(requestLog.timing).toEqual(expect.objectContaining({ startedAt: expect.any(String) }));

      expect(responseLog.status).toBe(202);
      expect(responseLog.url).toBe(`http://127.0.0.1:${upstreamPort}/capture-body`);
      expect(responseLog.bodyTextPreview).toContain('"received"');
      expect(responseLog.timing).toEqual(
        expect.objectContaining({
          startedAt: expect.any(String),
          durationMs: expect.any(Number),
        }),
      );
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('skips body capture for oversized responses (Content-Length precheck)', async () => {
    const bigBody = 'A'.repeat(PROXY_CAPTURE_BODY_SKIP_BYTES + 1024);
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(bigBody);
    });
    const upstreamPort = await listen(upstream);
    const proxyPort = testPort + 21;

    try {
      await handlers.handleProxyStart({ port: proxyPort, useHttps: false });
      const ruleRes = await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/big-body/',
      });
      expect(parseResponse(ruleRes).success).toBe(true);

      const response = await sendRawHttpRequest(
        proxyPort,
        [
          `GET http://127.0.0.1:${upstreamPort}/big-body HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );

      expect(response).toContain('200 OK');

      const logs = await waitForCapturedLogs(handlers, 'big-body', (entries) =>
        entries.some((entry) => entry.type === 'response' && entry.bodySkipped),
      );
      const responseLog = logs.find((entry) => entry.type === 'response')!;
      expect(responseLog.bodySkipped).toMatch(/exceeds/);
      expect(responseLog.bodyBytes).toBe(Buffer.byteLength(bigBody, 'utf8'));
      expect(responseLog.bodyTextPreview).toBeUndefined();
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    }
  });

  it('capture:false disables request/response capture entirely', async () => {
    await handlers.handleProxyStart({ port: testPort + 22, useHttps: false, capture: false });
    const ruleRes = await handlers.handleProxyAddRule({
      action: 'mock_response',
      method: 'GET',
      urlPattern: '/no-capture/',
      mockStatus: 200,
      mockBody: 'ok',
    });
    expect(parseResponse(ruleRes).success).toBe(true);

    const response = await sendRawHttpRequest(
      testPort + 22,
      [
        `GET http://127.0.0.1:${testPort + 22}/no-capture HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
    );

    expect(response).toContain('200');
    const logs = parseResponse(await handlers.handleProxyGetRequests({}));
    expect(logs.logs).toEqual([]);
  });

  it('should clear cached request logs', async () => {
    const res = await handlers.handleProxyClearLogs({});
    expect(parseResponse(res).success).toBe(true);
  });

  it('should successfully fully execute adb device configuration with mocked execution', async () => {
    if (!httpsAvailable) return;
    // Start proxy first so port is assigned and useHttps to generate cert
    await handlers.handleProxyStart({ port: testPort + 3, useHttps: true });

    const res = await handlers.handleProxySetupAdbDevice({ deviceSerial: 'test-device' });

    expect(res.isError).toBeFalsy();
    if (!res.isError) {
      const data = parseResponse(res);
      expect(data.success).toBe(true);
      expect(data.instructions).toContain('Reversed forwarded tcp:');
      expect(data.deviceId).toBe('test-device');
    }

    // Stop proxy to prevent conflict
    await handlers.handleProxyStop({});
  });

  it('returns explicit capability details when adb is unavailable', async () => {
    if (!httpsAvailable) return;
    vi.mocked(child_process.execFile as any).mockImplementationOnce(
      (_cmd: any, _args: any, _opts: any, cb: any) => {
        if (typeof cb === 'function') {
          cb(new Error('adb command failed'), '', 'error');
        }
        return {} as any;
      },
    );

    await handlers.handleProxyStart({ port: testPort + 4, useHttps: true });

    const res = await handlers.handleProxySetupAdbDevice({ deviceSerial: 'test-device' });
    const data = parseAnyResponse(res);
    expect(data.success).toBe(false);
    expect(data.available).toBe(false);
    expect(data.capability).toBe('adb_binary');
    expect(data.status).toBe('unavailable');
    expect(data.error).toContain('ADB binary not available:');
    expect(data.fix).toContain('Android Platform Tools');

    await handlers.handleProxyStop({});
  });

  it('preserves runtime execution failures after adb preflight passes', async () => {
    if (!httpsAvailable) return;
    vi.mocked(child_process.execFile as any)
      .mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
        if (typeof cb === 'function') {
          cb(null, 'Android Debug Bridge version 1.0.41', '');
        }
        return {} as any;
      })
      .mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
        if (typeof cb === 'function') {
          cb(new Error('adb get-state failed'), '', 'error');
        }
        return {} as any;
      });

    await handlers.handleProxyStart({ port: testPort + 7, useHttps: true });

    const res: any = await handlers.handleProxySetupAdbDevice({ deviceSerial: 'test-device' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Failed to configure ADB device: adb get-state failed');

    await handlers.handleProxyStop({});
  });

  it('wraps successful proxy tool calls without changing payload shape', async () => {
    const res = await handlers.handleProxyStatusTool({});
    const data = parseResponse(res);
    expect(data).toMatchObject({
      success: true,
      running: false,
      port: null,
      ruleCount: 0,
    });
  });

  it('turns thrown proxy tool failures into structured errors', async () => {
    (handlers as any).server = {
      stop: vi.fn().mockRejectedValue(new Error('stop failed')),
    };
    try {
      const res = await handlers.handleProxyStopTool({});
      const data = parseAnyResponse(res);
      expect(res.isError).toBe(true);
      expect(data).toMatchObject({
        success: false,
        error: 'stop failed',
        message: 'stop failed',
      });
    } finally {
      (handlers as any).server = null;
    }
  });

  it('removes a single rule by endpointId without resetting listeners', async () => {
    const { server } = installFakeRuleServer(handlers);

    // Add two rules
    const r1 = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'block',
        method: 'GET',
        urlPattern: '/keep/',
      }),
    );
    const r2 = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'mock_response',
        method: 'POST',
        urlPattern: '/remove/',
        mockStatus: 201,
        mockBody: '{}',
      }),
    );

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Remove the second rule
    const removeRes = await handlers.handleProxyRemoveRule({ endpointId: r2.endpointId });
    const removeData = parseResponse(removeRes);
    expect(removeData.success).toBe(true);
    expect(removeData.endpointId).toBe(r2.endpointId);
    expect(removeData.removedRule).toMatchObject({
      action: 'mock_response',
      method: 'POST',
      urlPattern: '/remove/',
    });

    // Verify only the first rule remains (endpointId may change due to re-registration)
    const listData = parseResponse(await handlers.handleProxyListRules({}));
    expect(listData.count).toBe(1);
    expect(listData.rules[0]).toMatchObject({
      action: 'block',
      method: 'GET',
      urlPattern: '/keep/',
    });
    expect(server.reset).not.toHaveBeenCalled();
  });

  it('errors on proxy_remove_rule when proxy is not running', async () => {
    const result = await handlers.handleProxyRemoveRule({ endpointId: 'nonexistent' });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('Proxy must be running');
  });

  it('errors on proxy_remove_rule when endpointId is not found', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyRemoveRule({ endpointId: 'nonexistent' });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('Rule not found');
  });

  it('errors on proxy_remove_rule when endpointId is missing', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyRemoveRule({});
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('endpointId is required');
  });

  it('retains the rule record when endpoint disposal fails', async () => {
    const dispose = vi.fn(async () => {
      throw new Error('dispose explosion');
    });
    const badServer = {
      forGet: vi.fn(() => ({
        thenPassThrough: vi.fn(async () => ({ id: 'rollback-ep' })),
        thenCloseConnection: vi.fn(async () => ({ id: 'rollback-ep', dispose })),
        thenReply: vi.fn(async () => ({ id: 'rollback-ep' })),
        delay: vi.fn(function (this: any) {
          return this;
        }),
      })),
      stop: vi.fn(async () => undefined),
    };
    (handlers as any).server = badServer;

    // Add a rule
    const addRes = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'block',
        method: 'GET',
        urlPattern: '/rollback/',
      }),
    );
    expect(addRes.success).toBe(true);

    const removeResult = await handlers.handleProxyRemoveRule({ endpointId: addRes.endpointId });
    const removeData = parseAnyResponse(removeResult);
    expect(removeResult.isError).toBe(true);
    expect(removeData.error).toContain('Failed to remove rule');
    expect(removeData.error).toContain('dispose explosion');

    // Verify the rule is still in the list (rolled back)
    const listData = parseResponse(await handlers.handleProxyListRules({}));
    expect(listData.count).toBe(1);
  });

  it('validates chainUpstream.proxyUrl is required', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/chain-test/',
      forwardOptions: {
        chainUpstream: { noProxy: ['localhost'] },
      },
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('proxyUrl is required');
  });

  it('validates chainUpstream proxyUrl is a string', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/chain-test/',
      forwardOptions: {
        chainUpstream: { proxyUrl: 123 },
      },
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('proxyUrl must be a string');
  });

  it('parses valid chainUpstream and records it on the rule', async () => {
    const { builder } = installFakeRuleServer(handlers);
    const data = parseResponse(
      await handlers.handleProxyAddRule({
        action: 'forward',
        method: 'GET',
        urlPattern: '/chain-ok/',
        forwardOptions: {
          chainUpstream: {
            proxyUrl: 'http://corp-proxy:3128',
            noProxy: ['localhost', '*.internal'],
          },
        },
      }),
    );
    expect(data.success).toBe(true);
    expect(builder.thenPassThrough).toHaveBeenCalledOnce();
    const opts = builder.thenPassThrough.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts['proxyConfig']).toMatchObject({
      proxyUrl: 'http://corp-proxy:3128',
      noProxy: ['localhost', '*.internal'],
    });
    expect(data.rule.forwardOptions).toMatchObject({
      chainUpstream: {
        proxyUrl: 'http://corp-proxy:3128',
        noProxy: ['localhost', '*.internal'],
      },
    });
  });

  it('validates callbackScript.path is required', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/cb-test/',
      forwardOptions: {
        callbackScript: {} as any,
      },
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('path must be a non-empty string');
  });

  it('rejects callbackScript combined with transformRequest (mutual exclusivity)', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/cb-transform/',
      forwardOptions: {
        transformRequest: { replaceMethod: 'POST' },
        callbackScript: { path: '/scripts/callback.mjs' },
      },
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('mutually exclusive');
  });

  it('rejects callbackScript combined with transformResponse (mutual exclusivity)', async () => {
    installFakeRuleServer(handlers);
    const result = await handlers.handleProxyAddRule({
      action: 'forward',
      method: 'GET',
      urlPattern: '/cb-transform/',
      forwardOptions: {
        transformResponse: { replaceStatus: 500 },
        callbackScript: { path: '/scripts/callback.mjs' },
      },
    });
    const data = parseAnyResponse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toContain('mutually exclusive');
  });

  it('reuses one physical proxy across ten session leases and stops on the last release', async () => {
    const shared = new ProxyHandlers();
    const stop = vi.fn(async () => undefined);
    Object.assign(shared as unknown as Record<string, unknown>, {
      server: { stop },
      currentPort: 18080,
      currentUseHttps: false,
    });
    const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index}`);

    const starts = await Promise.all(
      sessionIds.map(
        async (sessionId) =>
          await runWithToolRequestContext({ sessionId }, async () =>
            parseResponse(await shared.handleProxyStart({ port: 18080, useHttps: false })),
          ),
      ),
    );

    expect(starts.every((result) => result.reused === true)).toBe(true);
    expect(Math.max(...starts.map((result) => Number(result.totalOwners)))).toBe(10);

    for (const sessionId of sessionIds.slice(0, -1)) {
      const result = await runWithToolRequestContext({ sessionId }, async () =>
        parseResponse(await shared.handleProxyStop({})),
      );
      expect(result.stopped).toBe(false);
    }
    expect(stop).not.toHaveBeenCalled();

    const final = await runWithToolRequestContext({ sessionId: sessionIds.at(-1) }, async () =>
      parseResponse(await shared.handleProxyStop({})),
    );
    expect(final.stopped).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('returns empty logs when capture is disabled even with stale buffered entries', async () => {
    // Simulate a previous capture=true session that left sensitive entries behind.
    (handlers as any).captureEnabled = false;
    (handlers as any).captureBuffer = [
      {
        type: 'request',
        id: 'stale',
        url: `http://${buildTestHost('secret')}`,
        timestamp: Date.now(),
      },
    ];

    const data = parseResponse(await handlers.handleProxyGetRequests({}));

    expect(data.captureEnabled).toBe(false);
    expect(data.count).toBe(0);
    expect(data.logs).toEqual([]);
  });

  it('clears stale captured traffic when starting with capture:false', async () => {
    (handlers as any).captureBuffer = [
      {
        type: 'request',
        id: 'stale',
        url: `http://${buildTestHost('secret')}`,
        timestamp: Date.now(),
      },
    ];

    await handlers.handleProxyStart({ port: testPort + 23, useHttps: false, capture: false });

    expect((handlers as any).captureBuffer).toEqual([]);
    const data = parseResponse(await handlers.handleProxyGetRequests({}));
    expect(data.logs).toEqual([]);
    expect(parseResponse(await handlers.handleProxyStatus({})).capture).toBe(false);
  });

  it('rejects a reuse request whose capture flag mismatches the running proxy', async () => {
    installFakeRuleServer(handlers);
    Object.assign(handlers as unknown as Record<string, unknown>, {
      currentPort: 8080,
      currentUseHttps: false,
    });

    const result = await handlers.handleProxyStart({ port: 8080, useHttps: false, capture: false });
    const data = parseAnyResponse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain('capture=');
  });

  it('reports the capture flag in proxy status', async () => {
    const data = parseResponse(await handlers.handleProxyStatus({}));
    expect(data.capture).toBe(true);
  });

  it('prechecks against the actual buffered body size, not just the Content-Length hint', async () => {
    const bigBuffer = Buffer.alloc(PROXY_CAPTURE_BODY_SKIP_BYTES + 1024, 0x61);
    const getText = vi.fn(async () => bigBuffer.toString('utf8'));
    const body = { buffer: bigBuffer, getText };

    // A small (or compressed-transfer) Content-Length hint must not bypass the precheck.
    const result = await readBodyPreview(body, 42);

    expect(result.bodySkipped).toMatch(/exceeds/);
    expect(result.bodyBytes).toBe(bigBuffer.length);
    expect(getText).not.toHaveBeenCalled();
  });
});
