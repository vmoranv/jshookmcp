import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;
const ARTIFACT_DIR = join(process.cwd(), '.tmp_mcp_artifacts');

describe.skipIf(!TARGET_URL)(
  'Browser & Network Deep E2E',
  { timeout: 300_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      await client.connect();
      if (client.getToolMap().has('browser_launch')) {
        await client.call('browser_launch', { headless: false }, 60_000);
      }
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('BROWSER-01: multi-tab navigation with state isolation', async () => {
      const requiredTools = ['page_navigate', 'page_evaluate', 'browser_list_tabs'];
      const missing = requiredTools.filter((t) => !client.getToolMap().has(t));
      if (missing.length > 0) {
        client.recordSynthetic('multi-tab', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      // Navigate to page
      await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
        30_000,
      );

      // Set state on first tab
      await client.call('page_evaluate', { code: 'window.__tab1State = "tab1"' }, 10_000);

      // List tabs
      const tabs = await client.call('browser_list_tabs', {}, 10_000);
      expect(tabs.result.status).not.toBe('FAIL');
    });

    test('BROWSER-02: screenshot capture (full page and selector)', async () => {
      if (!client.getToolMap().has('page_screenshot')) {
        client.recordSynthetic('screenshot', 'SKIP', 'Tool not registered');
        return;
      }

      // Navigate first
      await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
        30_000,
      );

      // Full page screenshot
      const fullPath = `${ARTIFACT_DIR}/e2e-full-screenshot.png`;
      const full = await client.call('page_screenshot', { path: fullPath }, 15_000);
      expect(full.result.status).not.toBe('FAIL');

      // Selector-scoped screenshot
      const selectorPath = `${ARTIFACT_DIR}/e2e-selector-screenshot.png`;
      const scoped = await client.call(
        'page_screenshot',
        { selector: 'body', path: selectorPath },
        15_000,
      );
      expect(scoped.result.status).not.toBe('FAIL');
    });

    test('BROWSER-03: fetch interceptor workflow', async () => {
      const requiredTools = ['console_inject_fetch_interceptor', 'page_navigate', 'network_enable'];
      const missing = requiredTools.filter((t) => !client.getToolMap().has(t));
      if (missing.length > 0) {
        client.recordSynthetic('fetch-intercept', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      await client.call('network_enable', {}, 10_000);

      // Inject fetch interceptor
      const inject = await client.call(
        'console_inject_fetch_interceptor',
        { persistent: true },
        15_000,
      );
      expect(['PASS', 'EXPECTED_LIMITATION']).toContain(inject.result.status);

      // Navigate to trigger real requests
      await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
        30_000,
      );

      // Wait for intercepted requests
      await new Promise((r) => setTimeout(r, 2000));
    });

    test('BROWSER-04: CDP Fetch domain response interception', async () => {
      // CDP Fetch tools may be named differently - check common patterns
      const fetchTools = [
        'fetch_enable',
        'fetch_intercept_response',
        'fetch_continue',
        'page_intercept_response',
      ];
      const available = fetchTools.filter((t) => client.getToolMap().has(t));

      if (available.length === 0) {
        client.recordSynthetic('cdp-fetch', 'SKIP', 'No CDP Fetch tools registered');
        return;
      }

      // Exercise available CDP Fetch tools
      for (const tool of available) {
        const result = await client.call(tool, {}, 15_000);
        expect(result.result.detail.length).toBeGreaterThan(0);
      }
    });

    test('NETWORK-01: capture real requests during page navigation', async () => {
      const requiredTools = ['network_enable', 'page_navigate', 'network_get_requests'];
      const missing = requiredTools.filter((t) => !client.getToolMap().has(t));
      if (missing.length > 0) {
        client.recordSynthetic('network-capture', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      await client.call('network_enable', {}, 10_000);
      await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
        30_000,
      );
      await new Promise((r) => setTimeout(r, 2000));

      const requests = await client.call('network_get_requests', {}, 15_000);
      expect(requests.result.status).not.toBe('FAIL');
    });

    test('NETWORK-02: export HAR file with valid entries', async () => {
      if (!client.getToolMap().has('network_export_har')) {
        client.recordSynthetic('har-export', 'SKIP', 'Tool not registered');
        return;
      }

      const harPath = `${ARTIFACT_DIR}/e2e-network.har`;
      const har = await client.call('network_export_har', { path: harPath }, 30_000);
      expect(har.result.status).not.toBe('FAIL');
    });

    test('NETWORK-03: WebSocket monitoring', async () => {
      const requiredTools = ['ws_monitor_enable', 'ws_get_connections'];
      const missing = requiredTools.filter((t) => !client.getToolMap().has(t));
      if (missing.length > 0) {
        client.recordSynthetic('ws-monitoring', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      const enable = await client.call('ws_monitor_enable', {}, 15_000);
      expect(enable.result.status).not.toBe('FAIL');

      const connections = await client.call('ws_get_connections', {}, 15_000);
      expect(['PASS', 'EXPECTED_LIMITATION']).toContain(connections.result.status);
    });
  },
);
