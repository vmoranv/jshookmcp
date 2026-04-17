import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;

describe.skipIf(!TARGET_URL)('CTF Sandbox OOPIF Integration via MCP', { timeout: 120_000 }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
    // Launch Chrome without headless if possible, or headlessly.
    await client.call('browser_launch', { headless: true, args: ['--site-per-process'] }, 60_000);
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('OOPIF-01: Discovers targets and evaluates in nested iframe', async () => {
    // 1. Navigate to CTF sandbox level 3
    const sandboxUrl = new URL('level/3', TARGET_URL!).toString();
    const nav = await client.call('page_navigate', { url: sandboxUrl }, 30_000);
    expect(nav.result.status).not.toBe('FAIL');

    // 2. Discover OOPIF targets (autoAttach enabled)
    const targetsRes = await client.call(
      'browser_list_cdp_targets',
      { discoverOOPIF: true },
      15_000,
    );
    expect(targetsRes.result.status).not.toBe('FAIL');

    // We expect the nested iframe to be visible as a target or accessible
    // 3. Evaluate in frame-layer1
    const evalRes = await client.call('page_evaluate', {
      code: 'window.__flagPart2',
      frameSelector: 'iframe#frame-layer1',
    });
    console.log('EVAL RES:', JSON.stringify(evalRes, null, 2));
    expect(evalRes.result.status).not.toBe('FAIL');

    // Ensure we actually got the flag part from inside the isolated iframe
    const details = evalRes.parsed as any;
    expect(typeof details.result).toBe('string');
    expect(details.result).toMatch(/^[0-9a-f]{12}$/);
  });
});
