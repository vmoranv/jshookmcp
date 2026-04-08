import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;

describe.skipIf(!TARGET_URL)('SKIA + Canvas E2E', { timeout: 180_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('navigate to WebGL target, fingerprint engine, extract scene', async () => {
    const requiredTools = [
      'browser_launch',
      'page_navigate',
      'page_evaluate',
      'skia_detect_renderer',
      'skia_dump_scene',
    ];
    const missingTools = requiredTools.filter((name) => !client.getToolMap().has(name));
    if (missingTools.length > 0) {
      client.recordSynthetic(
        'skia-canvas-suite',
        'SKIP',
        `Missing tools: ${missingTools.join(', ')}`,
      );
      return;
    }

    const launch = await client.call('browser_launch', { headless: true }, 60_000);
    expect(launch.result.status).not.toBe('FAIL');

    const targetUrl = process.env.E2E_TARGET_URL ?? '';
    const navigate = await client.call(
      'page_navigate',
      { url: targetUrl, waitUntil: 'networkidle' },
      60_000,
    );
    expect(navigate.result.status).not.toBe('FAIL');

    const seedCanvas = await client.call(
      'page_evaluate',
      {
        code: `(() => {
          const existing = document.getElementById('e2e-skia-canvas');
          if (existing instanceof HTMLCanvasElement) {
            return { created: false, id: existing.id };
          }

          const canvas = document.createElement('canvas');
          canvas.id = 'e2e-skia-canvas';
          canvas.width = 320;
          canvas.height = 180;
          document.body.appendChild(canvas);

          const webgl = canvas.getContext('webgl');
          if (webgl) {
            webgl.clearColor(0.1, 0.2, 0.3, 1);
            webgl.clear(webgl.COLOR_BUFFER_BIT);
            return { created: true, id: canvas.id, mode: 'webgl' };
          }

          const ctx2d = canvas.getContext('2d');
          if (ctx2d) {
            ctx2d.fillStyle = '#224466';
            ctx2d.fillRect(0, 0, canvas.width, canvas.height);
            ctx2d.fillStyle = '#ffffff';
            ctx2d.fillText('skia-e2e', 16, 32);
            return { created: true, id: canvas.id, mode: '2d' };
          }

          return { created: true, id: canvas.id, mode: 'none' };
        })()`,
      },
      30_000,
    );
    expect(seedCanvas.result.status).not.toBe('FAIL');

    const detectRenderer = await client.call(
      'skia_detect_renderer',
      { canvasId: 'e2e-skia-canvas' },
      60_000,
    );
    expect(detectRenderer.result.status).not.toBe('FAIL');

    const dumpScene = await client.call(
      'skia_dump_scene',
      { canvasId: 'e2e-skia-canvas', includeDrawCommands: true },
      60_000,
    );
    expect(dumpScene.result.status).not.toBe('FAIL');
  });
});
