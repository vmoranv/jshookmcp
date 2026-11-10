import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function encodeDataHtml(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function buildNestedIframeFixtureUrl(): string {
  const innerHtml = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>inner-frame</title>
  </head>
  <body>
    <div id="inner-status">inner-ready</div>
    <script>
      window.__innerFrameReady = true;
    </script>
  </body>
</html>`;

  const innerUrl = encodeDataHtml(innerHtml);
  const outerHtml = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>outer-frame</title>
  </head>
  <body>
    <iframe id="inner-frame" src="${innerUrl}"></iframe>
  </body>
</html>`;
  const outerUrl = encodeDataHtml(outerHtml);

  const topHtml = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>top-page</title>
  </head>
  <body>
    <h1>attached target preload test</h1>
    <iframe id="outer-frame" src="${outerUrl}"></iframe>
  </body>
</html>`;

  return encodeDataHtml(topHtml);
}

describe(
  'AI hook persistent preload across nested iframe reload',
  {
    timeout: 180_000,
  },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();
      await client.call('browser_launch', { headless: true }, 60_000);
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('attached target evaluateOnNewDocument survives reload in inner iframe', async () => {
      const requiredTools = [
        'page_navigate',
        'page_reload',
        'page_evaluate',
        'browser_list_cdp_targets',
        'browser_attach_cdp_target',
        'ai_hook',
      ];
      const missing = requiredTools.filter((tool) => !client.getToolMap().has(tool));
      if (missing.length > 0) {
        client.recordSynthetic(
          'ai-hook-persistent-iframe',
          'SKIP',
          `Missing: ${missing.join(', ')}`,
        );
        return;
      }

      const fixtureUrl = buildNestedIframeFixtureUrl();
      const navigate = await client.call(
        'page_navigate',
        { url: fixtureUrl, waitUntil: 'load', timeout: 15_000 },
        30_000,
      );
      expect(navigate.result.status).not.toBe('FAIL');

      const beforeReload = await client.call(
        'page_evaluate',
        {
          code: 'globalThis.__iframeProbe ?? null',
          frameUrl: 'inner-frame',
        },
        15_000,
      );
      expect(beforeReload.result.status).not.toBe('FAIL');
      expect((beforeReload.parsed as { result?: unknown }).result).toBeNull();

      const targets = await client.call(
        'browser_list_cdp_targets',
        { discoverOOPIF: true },
        15_000,
      );
      expect(targets.result.status).not.toBe('FAIL');

      const targetList =
        isRecord(targets.parsed) && Array.isArray(targets.parsed.targets)
          ? targets.parsed.targets
          : [];
      const pageTarget = targetList.find(
        (target): target is Record<string, unknown> =>
          isRecord(target) &&
          target.type === 'page' &&
          typeof target.targetId === 'string' &&
          typeof target.url === 'string' &&
          target.url.startsWith('data:text/html'),
      );
      expect(pageTarget).toBeDefined();

      const attach = await client.call(
        'browser_attach_cdp_target',
        { targetId: pageTarget!.targetId as string },
        15_000,
      );
      expect(attach.result.status).not.toBe('FAIL');

      const hookCode = String.raw`(() => {
      globalThis.__iframeProbe = {
        stamp: 'probe-fixed',
        href: location.href,
        persistent: true
      };
    })()`;

      const inject = await client.call(
        'ai_hook',
        {
          action: 'inject',
          hookId: 'iframe-persistent-probe',
          code: hookCode,
          method: 'evaluateOnNewDocument',
        },
        20_000,
      );
      expect(inject.result.status).not.toBe('FAIL');

      const reload = await client.call('page_reload', {}, 30_000);
      expect(reload.result.status).not.toBe('FAIL');

      const afterReload = await client.call(
        'page_evaluate',
        {
          code: 'globalThis.__iframeProbe ?? null',
          frameUrl: 'inner-frame',
        },
        15_000,
      );
      expect(afterReload.result.status).not.toBe('FAIL');

      const result = (afterReload.parsed as { result?: unknown }).result;
      expect(result).toEqual(
        expect.objectContaining({
          stamp: 'probe-fixed',
          persistent: true,
        }),
      );
      expect(isRecord(result) && typeof result.href === 'string' ? result.href : '').toContain(
        'inner-frame',
      );
    });
  },
);
