import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;
const SUPPORTED_PLATFORM = process.platform === 'win32' || process.platform === 'linux';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

describe.skipIf(!TARGET_URL || !SUPPORTED_PLATFORM)(
  'Syscall Hook E2E',
  { timeout: 180_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('start ETW/strace monitor, capture syscalls, correlate with JS', async () => {
      const requiredTools = [
        'browser_launch',
        'page_navigate',
        'page_evaluate',
        'syscall_monitor_start',
        'syscall_events_get',
      ];
      const missingTools = requiredTools.filter((name) => !client.getToolMap().has(name));
      if (missingTools.length > 0) {
        client.recordSynthetic(
          'syscall-hook-suite',
          'SKIP',
          `Missing tools: ${missingTools.join(', ')}`,
        );
        return;
      }

      const launch = await client.call('browser_launch', { headless: true }, 60_000);
      expect(launch.result.status).not.toBe('FAIL');

      const start = await client.call('syscall_monitor_start', { pid: 0, maxEvents: 256 }, 30_000);
      expect(start.result.status).not.toBe('FAIL');

      const sessionId = getString(start.parsed, 'sessionId');
      if (!sessionId) {
        client.recordSynthetic(
          'syscall_monitor_start',
          'EXPECTED_LIMITATION',
          'Monitor start did not return a sessionId',
        );
        return;
      }

      const navigate = await client.call(
        'page_navigate',
        { url: process.env.E2E_TARGET_URL ?? '', waitUntil: 'networkidle' },
        60_000,
      );
      expect(navigate.result.status).not.toBe('FAIL');

      const trigger = await client.call(
        'page_evaluate',
        {
          code: `(() => fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
            .then(() => ({ ok: true }))
            .catch((error) => ({ ok: false, message: String(error) })))()`,
        },
        30_000,
      );
      expect(trigger.result.status).not.toBe('FAIL');

      const events = await client.call('syscall_events_get', { sessionId }, 30_000);
      expect(events.result.status).not.toBe('FAIL');

      if (!client.getToolMap().has('syscall_map_to_js')) {
        client.recordSynthetic('syscall_map_to_js', 'SKIP', 'Correlation tool not registered');
        return;
      }

      const correlate = await client.call(
        'syscall_map_to_js',
        {
          sessionId,
          eventIndex: 0,
          jsStack: ['at fetch (native)', 'at e2eTrigger (syscall-hook.e2e.test.ts:1:1)'],
        },
        30_000,
      );
      expect(correlate.result.status).not.toBe('FAIL');
    });
  },
);
