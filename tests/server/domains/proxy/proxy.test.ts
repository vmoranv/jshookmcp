import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProxyHandlers } from '@server/domains/proxy/index';

function parseResponse(res: any) {
  if (res.isError) throw new Error('Response is an error: ' + JSON.stringify(res, null, 2));
  return JSON.parse(res.content[0].text);
}

describe('ProxyHandlers (Integration)', () => {
  let handlers: ProxyHandlers;
  const testPort = 18081;

  beforeEach(() => {
    handlers = new ProxyHandlers();
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

  it('should buffer requests properly', async () => {
    await handlers.handleProxyStart({ port: testPort + 2, useHttps: false });

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
});
