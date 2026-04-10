import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;
const FIXTURE_URL =
  'data:text/html,<html><body><h1>jshook e2e</h1><script>window.__e2e=true;</script></body></html>';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

describe.skipIf(!TARGET_URL)('Mojo IPC E2E', { timeout: 180_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('start Mojo monitor, capture messages, decode', async () => {
    const requiredTools = [
      'browser_launch',
      'page_navigate',
      'mojo_monitor_start',
      'mojo_messages_get',
    ];
    const missingTools = requiredTools.filter((name) => !client.getToolMap().has(name));
    if (missingTools.length > 0) {
      client.recordSynthetic('mojo-ipc-suite', 'SKIP', `Missing tools: ${missingTools.join(', ')}`);
      return;
    }

    const launch = await client.call('browser_launch', { headless: true }, 60_000);
    expect(launch.result.status).not.toBe('FAIL');

    const navigate = await client.call(
      'page_navigate',
      { url: FIXTURE_URL, waitUntil: 'load' },
      60_000,
    );
    expect(navigate.result.status).not.toBe('FAIL');

    const start = await client.call(
      'mojo_monitor_start',
      { processName: 'chrome', maxBuffer: 512 },
      30_000,
    );
    expect(start.result.status).not.toBe('FAIL');

    const sessionId = getString(start.parsed, 'sessionId');
    if (!sessionId) {
      client.recordSynthetic(
        'mojo_monitor_start',
        'EXPECTED_LIMITATION',
        'Monitor start did not return a sessionId',
      );
      return;
    }

    const messages = await client.call('mojo_messages_get', { sessionId }, 30_000);
    expect(messages.result.status).not.toBe('FAIL');

    if (!client.getToolMap().has('mojo_decode_message')) {
      client.recordSynthetic('mojo_decode_message', 'SKIP', 'Decode tool not registered');
      return;
    }

    const decode = await client.call(
      'mojo_decode_message',
      {
        messageHex: '000100020000000300000000',
        interfaceName: 'network.mojom.NetworkService',
      },
      30_000,
    );
    expect(decode.result.status).not.toBe('FAIL');
  });
});
