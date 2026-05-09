import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';
import { E2E_DEFAULT_TARGET_URL } from '@tests/shared/test-urls';

const TARGET_URL = process.env.E2E_TARGET_URL || E2E_DEFAULT_TARGET_URL;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('CDP attach routing', { timeout: 120_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
    await client.call('browser_launch', { headless: true }, 60_000);
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('page_* tools follow an attached page target', async () => {
    const requiredTools = [
      'page_navigate',
      'page_evaluate',
      'browser_list_cdp_targets',
      'browser_attach_cdp_target',
      'browser_evaluate_cdp_target',
    ];
    const missing = requiredTools.filter((tool) => !client.getToolMap().has(tool));
    if (missing.length > 0) {
      client.recordSynthetic('cdp-attach-routing', 'SKIP', `Missing: ${missing.join(', ')}`);
      return;
    }

    const nav = await client.call(
      'page_navigate',
      { url: TARGET_URL, waitUntil: 'networkidle', timeout: 15_000 },
      30_000,
    );
    expect(nav.result.status).not.toBe('FAIL');

    const setMarker = await client.call(
      'page_evaluate',
      {
        code: '(() => { window.__cdpAttachMarker = "same-page"; return window.__cdpAttachMarker; })()',
      },
      10_000,
    );
    expect(setMarker.result.status).not.toBe('FAIL');

    const targets = await client.call('browser_list_cdp_targets', { discoverOOPIF: true }, 15_000);
    expect(targets.result.status).not.toBe('FAIL');

    const parsedTargets = targets.parsed;
    const targetList =
      isRecord(parsedTargets) && Array.isArray(parsedTargets.targets) ? parsedTargets.targets : [];
    const pageTarget = targetList.find(
      (target): target is Record<string, unknown> =>
        isRecord(target) &&
        target.type === 'page' &&
        typeof target.url === 'string' &&
        target.url.startsWith(TARGET_URL) &&
        typeof target.targetId === 'string',
    );

    expect(pageTarget).toBeDefined();

    const attach = await client.call(
      'browser_attach_cdp_target',
      { targetId: pageTarget!.targetId as string },
      15_000,
    );
    expect(attach.result.status).not.toBe('FAIL');
    const attachParsed = attach.parsed;
    expect(isRecord(attachParsed) && attachParsed.contextSwitched === true).toBe(true);

    const evalCdp = await client.call(
      'browser_evaluate_cdp_target',
      { expression: 'window.__cdpAttachMarker' },
      10_000,
    );
    expect(evalCdp.result.status).not.toBe('FAIL');
    const cdpParsed = evalCdp.parsed;
    expect(isRecord(cdpParsed) ? cdpParsed.result : undefined).toBe('same-page');

    const evalPage = await client.call(
      'page_evaluate',
      { expression: 'window.__cdpAttachMarker' },
      10_000,
    );
    expect(evalPage.result.status).not.toBe('FAIL');
    const pageParsed = evalPage.parsed;
    expect(isRecord(pageParsed) ? pageParsed.result : undefined).toBe('same-page');
  });
});
