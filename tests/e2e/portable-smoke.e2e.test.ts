import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;

function hasPrerequisites(client: MCPTestClient, tools: string[]): string[] {
  return tools.filter((tool) => !client.getToolMap().has(tool));
}

describe.skipIf(!TARGET_URL)(
  'Portable Cross-Platform Smoke E2E',
  { timeout: 180_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('PORTABLE-01: launch headless browser and evaluate a real page', async () => {
      const missing = hasPrerequisites(client, [
        'browser_launch',
        'page_navigate',
        'page_evaluate',
        'browser_status',
      ]);
      if (missing.length > 0) {
        client.recordSynthetic('portable-browser', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      const launch = await client.call('browser_launch', { headless: true }, 60_000);
      expect(launch.result.status).not.toBe('FAIL');

      const navigate = await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'load', timeout: 15_000 },
        30_000,
      );
      expect(navigate.result.status).not.toBe('FAIL');

      const status = await client.call('browser_status', {}, 15_000);
      expect(status.result.status).not.toBe('FAIL');

      const evaluation = await client.call(
        'page_evaluate',
        {
          code: '(() => ({ href: location.href, title: document.title, readyState: document.readyState }))()',
        },
        15_000,
      );
      expect(evaluation.result.status).not.toBe('FAIL');
    });

    test('PORTABLE-02: capture network metadata during navigation', async () => {
      const missing = hasPrerequisites(client, [
        'network_enable',
        'page_navigate',
        'network_get_requests',
        'network_get_status',
      ]);
      if (missing.length > 0) {
        client.recordSynthetic('portable-network', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      const enable = await client.call('network_enable', {}, 15_000);
      expect(enable.result.status).not.toBe('FAIL');

      const navigate = await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'networkidle', timeout: 20_000 },
        45_000,
      );
      expect(navigate.result.status).not.toBe('FAIL');

      const status = await client.call('network_get_status', {}, 15_000);
      expect(status.result.status).not.toBe('FAIL');

      const requests = await client.call('network_get_requests', {}, 20_000);
      expect(requests.result.status).not.toBe('FAIL');
    });

    test('PORTABLE-03: search routing stays functional without platform-specific probes', async () => {
      const missing = hasPrerequisites(client, ['search_tools', 'describe_tool']);
      if (missing.length > 0) {
        client.recordSynthetic('portable-search', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      const search = await client.call(
        'search_tools',
        { query: 'inspect network requests and trace JavaScript execution' },
        30_000,
      );
      expect(search.result.status).not.toBe('FAIL');

      const describeTool = await client.call('describe_tool', { name: 'browser_launch' }, 15_000);
      expect(describeTool.result.status).not.toBe('FAIL');
    });

    test('PORTABLE-04: trace lifecycle degrades cleanly when optional deps are absent', async () => {
      const missing = hasPrerequisites(client, [
        'start_trace_recording',
        'stop_trace_recording',
        'summarize_trace',
      ]);
      if (missing.length > 0) {
        client.recordSynthetic('portable-trace', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      const start = await client.call('start_trace_recording', {}, 15_000);
      if (start.result.status === 'FAIL' || start.result.status === 'EXPECTED_LIMITATION') {
        expect(start.result.detail).toMatch(/better-sqlite3|sqlite|recording/i);
        client.recordSynthetic('portable-trace', 'SKIP', 'Trace storage unavailable in this env');
        return;
      }

      await client.call('page_evaluate', { code: '(() => document.title)()' }, 10_000);

      const stop = await client.call('stop_trace_recording', {}, 15_000);
      expect(stop.result.status).not.toBe('FAIL');

      const summary = await client.call('summarize_trace', { detail: 'compact' }, 20_000);
      expect(summary.result.status).not.toBe('FAIL');
    });
  },
);
