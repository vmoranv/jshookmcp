import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

interface ToolBody {
  success?: boolean;
  running?: boolean;
  port?: number;
  caCertPath?: string | null;
  content?: string;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

describe('Proxy CA runtime E2E', { timeout: 120_000 }, () => {
  const tempHome = join(process.cwd(), `.tmp-proxy-ca-e2e-${Date.now()}`);
  const client = new MCPTestClient({
    envOverrides: {
      HOME: tempHome,
      USERPROFILE: tempHome,
    },
  });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    try {
      await client.call('proxy_stop', {}, 10_000);
    } catch {
      // best effort
    }
    await client.cleanup();
  });

  test('proxy_start generates a CA certificate and proxy_export_ca returns the certificate over MCP', async () => {
    if (!client.getToolMap().has('activate_domain')) {
      client.recordSynthetic('proxy-ca-runtime', 'SKIP', 'Missing activate_domain tool');
      return;
    }

    const activate = await client.call('activate_domain', { domain: 'proxy' }, 30_000);
    expect(activate.result.status).not.toBe('FAIL');

    const port = await getFreePort();
    const start = await client.call('proxy_start', { port, useHttps: true }, 60_000);
    expect(start.result.status).not.toBe('FAIL');
    const startBody = start.parsed as ToolBody;
    expect(startBody.success).toBe(true);
    expect(startBody.port).toBe(port);
    expect(typeof startBody.caCertPath).toBe('string');
    expect((startBody.caCertPath ?? '').length).toBeGreaterThan(0);

    const status = await client.call('proxy_status', {}, 20_000);
    expect(status.result.status).not.toBe('FAIL');
    const statusBody = status.parsed as ToolBody;
    expect(statusBody.success).toBe(true);
    expect(statusBody.running).toBe(true);
    expect(statusBody.port).toBe(port);

    const exported = await client.call('proxy_export_ca', {}, 20_000);
    expect(exported.result.status).not.toBe('FAIL');
    const exportBody = exported.parsed as ToolBody;
    expect(exportBody.success).toBe(true);
    expect(exportBody.content).toContain('BEGIN CERTIFICATE');

    const stop = await client.call('proxy_stop', {}, 20_000);
    expect(stop.result.status).not.toBe('FAIL');
    const stoppedStatus = await client.call('proxy_status', {}, 20_000);
    const stoppedBody = stoppedStatus.parsed as ToolBody;
    expect(stoppedBody.running).toBe(false);
  });
});
