import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as child_process from 'child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import { once } from 'node:events';
import { ProxyHandlers } from '@server/domains/proxy/index';
import { TEST_HTTP_URLS, withPath } from '@tests/shared/test-urls';

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

function installFakeRuleServer(handlers: ProxyHandlers) {
  const builder = {
    thenPassThrough: vi.fn(async () => ({ id: 'fake-endpoint' })),
    thenCloseConnection: vi.fn(async () => ({ id: 'fake-endpoint' })),
    thenReply: vi.fn(async () => ({ id: 'fake-endpoint' })),
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
    const fs = await import('fs');
    const path = await import('path');
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
    const data = parseResponse(res);
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
      expect(res.isError).toBeUndefined();
      expect(data).toMatchObject({
        success: false,
        error: 'stop failed',
        message: 'stop failed',
      });
    } finally {
      (handlers as any).server = null;
    }
  });
});
