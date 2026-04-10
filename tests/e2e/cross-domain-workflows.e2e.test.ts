import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;
const FIXTURE_URL =
  'data:text/html,<html><body><h1>jshook e2e</h1><script>window.__e2e=true;</script></body></html>';

describe.skipIf(!TARGET_URL)(
  'Cross-Domain Workflows E2E',
  { timeout: 180_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('execute multi-domain workflows, verify evidence graph', async () => {
      const requiredTools = [
        'browser_launch',
        'page_navigate',
        'network_enable',
        'cross_domain_capabilities',
      ];
      const missingTools = requiredTools.filter((name) => !client.getToolMap().has(name));
      if (missingTools.length > 0) {
        client.recordSynthetic(
          'cross-domain-suite',
          'SKIP',
          `Missing tools: ${missingTools.join(', ')}`,
        );
        return;
      }

      const launch = await client.call('browser_launch', { headless: true }, 60_000);
      expect(launch.result.status).not.toBe('FAIL');

      const enableNetwork = await client.call('network_enable', {}, 15_000);
      expect(enableNetwork.result.status).not.toBe('FAIL');

      const navigate = await client.call(
        'page_navigate',
        {
          url: FIXTURE_URL,
          waitUntil: 'load',
          enableNetworkMonitoring: true,
        },
        60_000,
      );
      expect(navigate.result.status).not.toBe('FAIL');

      const capabilities = await client.call('cross_domain_capabilities', {}, 15_000);
      expect(capabilities.result.status).not.toBe('FAIL');

      if (client.getToolMap().has('cross_domain_correlate_all')) {
        const correlate = await client.call('cross_domain_correlate_all', {}, 60_000);
        expect(correlate.result.status).not.toBe('FAIL');
      } else {
        client.recordSynthetic(
          'cross_domain_correlate_all',
          'SKIP',
          'Workflow execution tool not registered',
        );
      }

      if (client.getToolMap().has('cross_domain_evidence_export')) {
        const evidence = await client.call('cross_domain_evidence_export', {}, 30_000);
        expect(evidence.result.status).not.toBe('FAIL');
      } else {
        client.recordSynthetic(
          'cross_domain_evidence_export',
          'SKIP',
          'Evidence export tool not registered',
        );
      }
    });
  },
);
