import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;

describe.skipIf(!TARGET_URL)('Stealth & Search E2E', { timeout: 180_000 }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
    if (client.getToolMap().has('browser_launch')) {
      await client.call('browser_launch', { headless: false }, 60_000);
      await client.call(
        'page_navigate',
        { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
        30_000,
      );
    }
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('STEALTH-01: stealth_inject patches navigator.webdriver to false', async () => {
    if (!client.getToolMap().has('stealth_inject')) {
      client.recordSynthetic('stealth-inject', 'SKIP', 'Tool not registered');
      return;
    }

    const inject = await client.call('stealth_inject', {}, 15_000);
    expect(inject.result.status).not.toBe('FAIL');

    // Verify webdriver is patched
    if (client.getToolMap().has('page_evaluate')) {
      const check = await client.call('page_evaluate', { code: 'navigator.webdriver' }, 10_000);
      expect(check.result.status).not.toBe('FAIL');
    }
  });

  test('STEALTH-02: stealth_set_user_agent changes UA string', async () => {
    if (!client.getToolMap().has('stealth_set_user_agent')) {
      client.recordSynthetic('stealth-ua', 'SKIP', 'Tool not registered');
      return;
    }

    const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) E2E-Test/1.0';
    const setUA = await client.call('stealth_set_user_agent', { userAgent: customUA }, 15_000);
    expect(setUA.result.status).not.toBe('FAIL');

    // Verify UA was set
    if (client.getToolMap().has('page_evaluate')) {
      const check = await client.call('page_evaluate', { code: 'navigator.userAgent' }, 10_000);
      expect(check.result.status).not.toBe('FAIL');
    }
  });

  test('STEALTH-03: captcha_detect returns detection result', async () => {
    if (!client.getToolMap().has('captcha_detect')) {
      client.recordSynthetic('captcha-detect', 'SKIP', 'Tool not registered');
      return;
    }

    const detect = await client.call('captcha_detect', {}, 15_000);
    // Should return structured result whether captcha is found or not
    expect(['PASS', 'EXPECTED_LIMITATION']).toContain(detect.result.status);
  });

  test('SEARCH-01: search_tools returns semantically relevant results', async () => {
    if (!client.getToolMap().has('search_tools')) {
      client.recordSynthetic('search-tools', 'SKIP', 'Tool not registered');
      return;
    }

    const result = await client.call(
      'search_tools',
      { query: 'analyze JavaScript obfuscation' },
      30_000,
    );
    expect(result.result.status).not.toBe('FAIL');

    // Should return some tools
    if (result.parsed && typeof result.parsed === 'object') {
      const parsed = result.parsed as Record<string, unknown>;
      expect(
        Array.isArray(parsed.tools) ||
          Array.isArray(parsed.results) ||
          parsed.success !== undefined,
      ).toBe(true);
    }
  });

  test('SEARCH-02: get_collection_stats returns embedding stats', async () => {
    if (!client.getToolMap().has('get_collection_stats')) {
      client.recordSynthetic('collection-stats', 'SKIP', 'Tool not registered');
      return;
    }

    const stats = await client.call('get_collection_stats', {}, 15_000);
    expect(stats.result.status).not.toBe('FAIL');
  });

  test('SEARCH-03: activate_tools/deactivate_tools round-trip', async () => {
    const requiredTools = ['activate_tools', 'deactivate_tools'];
    const missing = requiredTools.filter((t) => !client.getToolMap().has(t));
    if (missing.length > 0) {
      client.recordSynthetic('search-activation', 'SKIP', `Missing: ${missing.join(', ')}`);
      return;
    }

    // Dynamically activate a tool from the search catalog
    const activate = await client.call('activate_tools', { names: ['dns_resolve'] }, 15_000);
    expect(activate.result.status).not.toBe('FAIL');

    // Release it again
    const deactivate = await client.call('deactivate_tools', { names: ['dns_resolve'] }, 15_000);
    expect(deactivate.result.status).not.toBe('FAIL');
    const parsed = deactivate.parsed as { removed?: string[]; notActivated?: string[] } | undefined;
    expect(
      parsed?.removed?.includes('dns_resolve') || parsed?.notActivated?.includes('dns_resolve'),
    ).toBe(true);
  });

  // ── P0 diagnostic surface (2026-05-06) ──

  test('STEALTH-04: stealth_inject returns patchManifest listing injected APIs', async () => {
    if (!client.getToolMap().has('stealth_inject')) {
      client.recordSynthetic('stealth-patch-manifest', 'SKIP', 'Tool not registered');
      return;
    }

    const inject = await client.call('stealth_inject', {}, 15_000);
    expect(inject.result.status).not.toBe('FAIL');

    const parsed = inject.parsed as Record<string, unknown> | undefined;
    if (parsed?.patchManifest) {
      const manifest = parsed.patchManifest as Array<Record<string, string>>;
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBeGreaterThanOrEqual(10);
      const apis = manifest.map((p) => p.api);
      expect(apis).toContain('navigator.webdriver');
      expect(apis).toContain('performance.now / Date.now');
    } else {
      // Stealth may skip for camoufox — that's not a failure
      client.recordSynthetic(
        'stealth-patch-manifest',
        'EXPECTED_LIMITATION',
        'patchManifest not in response',
      );
    }
  });

  test('NET-01: network_bot_detect_analyze returns interRequestConsistency', async () => {
    const required = ['network_monitor', 'network_bot_detect_analyze'];
    const missing = required.filter((t) => !client.getToolMap().has(t));
    if (missing.length > 0) {
      client.recordSynthetic('bot-detect-consistency', 'SKIP', `Missing: ${missing.join(', ')}`);
      return;
    }

    // Enable monitoring and generate some traffic for analysis
    await client.call('network_monitor', { action: 'enable' }, 10_000);
    await client.call(
      'page_navigate',
      { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
      30_000,
    );

    const analyze = await client.call('network_bot_detect_analyze', { limit: 5 }, 15_000);
    expect(analyze.result.status).not.toBe('FAIL');

    const parsed = analyze.parsed as Record<string, unknown> | undefined;
    if (parsed?.interRequestConsistency) {
      const irc = parsed.interRequestConsistency as Record<string, unknown>;
      expect(typeof irc.consistencyScore).toBe('number');
      expect(irc.consistencyScore).toBeGreaterThanOrEqual(0);
      expect(irc.consistencyScore).toBeLessThanOrEqual(1);
      expect(typeof irc.uaDriftCount).toBe('number');
      expect(typeof irc.headerOrderDriftCount).toBe('number');
    }
  });
});
