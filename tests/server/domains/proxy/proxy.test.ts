import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as child_process from 'child_process';
import { ProxyHandlers } from '@server/domains/proxy/index';

vi.mock('child_process', () => {
  return {
    exec: vi.fn((_cmd: any, cb: any) => {
      // simulate success
      cb(null, { stdout: 'success', stderr: '' });
    }),
  };
});

function parseResponse(res: any) {
  if (res.isError) throw new Error('Response is an error: ' + JSON.stringify(res, null, 2));
  return JSON.parse(res.content[0].text);
}

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
    const port = testPort + 1;
    const startRes: any = await handlers.handleProxyStart({ port, useHttps: true });
    const startData = parseResponse(startRes);
    expect(startData.success).toBe(true);
    expect(startData.caCertPath).toBeTruthy();

    const exportRes: any = await handlers.handleProxyExportCa({});
    expect(parseResponse(exportRes).content).toContain('BEGIN CERTIFICATE');
  });

  it('should generate an error if exporting CA without HTTPS enabled', async () => {
    // Fresh proxy handler without HTTPS
    const tempHandler = new ProxyHandlers();
    await tempHandler.handleProxyStart({ port: testPort + 5, useHttps: false });
    const exportRes: any = await tempHandler.handleProxyExportCa({});
    expect(exportRes.isError).toBe(true);
    expect(exportRes.content[0].text).toContain('CA certificate not found');
    await tempHandler.handleProxyStop({});
  });

  it('should buffer requests properly', async () => {
    await handlers.handleProxyStart({ port: testPort + 2, useHttps: false });

    // Test trying to add rule without server (will fail in unit test if handlers not started, but here it is started)
    const ruleRes: any = await handlers.handleProxyAddRule({
      action: 'mock_response',
      method: 'GET',
      urlPattern: 'http://example.com/api',
      mockStatus: 201,
      mockBody: '{"mocked": true}',
    });

    const ruleData = parseResponse(ruleRes);
    expect(ruleData.success).toBe(true);
    expect(ruleData.endpointId).toBeDefined();

    const logsRes: any = await handlers.handleProxyGetRequests({});
    expect(Array.isArray(parseResponse(logsRes).logs)).toBe(true);
  });

  it('should clear cached request logs', async () => {
    const res = await handlers.handleProxyClearLogs({});
    expect(parseResponse(res).success).toBe(true);
  });

  it('should successfully fully execute adb device configuration with mocked execution', async () => {
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

  it('should correctly handle adb device configuration failures', async () => {
    vi.mocked(child_process.exec as any).mockImplementationOnce((_cmd: any, cb: any) => {
      if (typeof cb === 'function') {
        cb(new Error('adb command failed'), { stdout: '', stderr: 'error' });
      }
      return {} as any;
    });

    await handlers.handleProxyStart({ port: testPort + 4, useHttps: true });

    const res: any = await handlers.handleProxySetupAdbDevice({ deviceSerial: 'test-device' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Failed to configure ADB device:');

    await handlers.handleProxyStop({});
  });
});
