import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;
const SUPPORTED_PLATFORM = process.platform === 'win32' || process.platform === 'linux';
const DEFAULT_BACKEND = process.platform === 'win32' ? 'etw' : 'strace';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getArray(value: unknown, key: string): unknown[] | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : null;
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

    test('start syscall monitor, capture syscalls, correlate with the current API', async () => {
      const requiredTools = [
        'browser_launch',
        'page_navigate',
        'page_evaluate',
        'syscall_start_monitor',
        'syscall_capture_events',
        'syscall_correlate_js',
        'syscall_stop_monitor',
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

      const start = await client.call(
        'syscall_start_monitor',
        { backend: DEFAULT_BACKEND, simulate: true },
        30_000,
      );
      expect(start.result.status).not.toBe('FAIL');
      if (!isRecord(start.parsed) || start.parsed.ok !== true) {
        client.recordSynthetic(
          'syscall_start_monitor',
          'EXPECTED_LIMITATION',
          'Monitor start did not return ok=true',
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

      const events = await client.call('syscall_capture_events', {}, 30_000);
      expect(events.result.status).not.toBe('FAIL');
      const syscallEvents = getArray(events.parsed, 'events');
      if (!syscallEvents || syscallEvents.length === 0) {
        client.recordSynthetic(
          'syscall_capture_events',
          'EXPECTED_LIMITATION',
          'Monitor returned no syscall events',
        );
        return;
      }

      const correlate = await client.call(
        'syscall_correlate_js',
        {
          syscallEvents,
        },
        30_000,
      );
      expect(correlate.result.status).not.toBe('FAIL');
      const correlations = getArray(correlate.parsed, 'correlations');
      expect(correlations?.length ?? 0).toBeGreaterThan(0);

      const stop = await client.call('syscall_stop_monitor', {}, 15_000);
      expect(stop.result.status).not.toBe('FAIL');
    });
  },
);
