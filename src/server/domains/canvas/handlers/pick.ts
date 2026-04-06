/**
 * canvas_pick_object_at_point tool handler.
 *
 * Screen → canvas coordinate transform, then delegates to engine adapter hit-test.
 */
import type { PageController } from '@server/domains/canvas/dependencies';
import type { CanvasPickResult, PickOpts } from '@server/domains/canvas/types';
import { fingerprintCanvas, resolveAdapter, buildEnv } from './shared';

interface CoordInfo {
  screen: { x: number; y: number };
  canvasRect?: { left: number; top: number; width: number; height: number };
  canvasX: number;
  canvasY: number;
}

export async function handlePick(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<CanvasPickResult> {
  const x = args['x'] as number;
  const y = args['y'] as number;
  const canvasId = args['canvasId'] as string | undefined;
  const highlight = (args['highlight'] as boolean | undefined) ?? false;

  const opts: PickOpts = { x, y, canvasId };

  // Screen → canvas coordinate transform
  const coordInfo = await pageController.evaluate<CoordInfo>(`
    (function() {
      var sx = ${x}, sy = ${y};
      var canvases = Array.from(document.querySelectorAll('canvas'));
      var target = null;
      ${
        canvasId
          ? `target = document.getElementById(${JSON.stringify(canvasId)}) || canvases[parseInt(${JSON.stringify(canvasId)})];`
          : `
        for (var i = canvases.length - 1; i >= 0; i--) {
          var r = canvases[i].getBoundingClientRect();
          if (sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) {
            target = canvases[i];
            break;
          }
        }
      `
      }
      if (!target) return { screen: { x: sx, y: sy }, canvasX: sx, canvasY: sy };
      var rect = target.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      return {
        screen: { x: sx, y: sy },
        canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        canvasX: (sx - rect.left) * (target.width / rect.width),
        canvasY: (sy - rect.top) * (target.height / rect.height)
      };
    })()
  `);

  const detection = await fingerprintCanvas(pageController, canvasId);
  if (!detection) {
    return {
      success: false,
      picked: null,
      candidates: [],
      coordinates: {
        screen: coordInfo.screen,
        canvas: { x: coordInfo.canvasX, y: coordInfo.canvasY },
      },
      hitTestMethod: 'none',
    };
  }

  const adapter = resolveAdapter(detection);
  if (!adapter) {
    return {
      success: false,
      picked: null,
      candidates: [],
      coordinates: {
        screen: coordInfo.screen,
        canvas: { x: coordInfo.canvasX, y: coordInfo.canvasY },
      },
      hitTestMethod: 'none',
    };
  }

  const result = await adapter.pickAt(buildEnv(pageController), opts);

  // Optionally highlight the picked element in the page
  if (highlight && result.picked) {
    await highlightNode(pageController, result.picked.worldBounds).catch(() => {});
  }

  return result as CanvasPickResult & { hitTestMethod: string };
}

async function highlightNode(
  pageController: PageController,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await pageController.evaluate(
    `
    (function() {
      var existing = document.getElementById('__canvas-highlight');
      if (existing) existing.remove();
      var div = document.createElement('div');
      div.id = '__canvas-highlight';
      Object.assign(div.style, {
        position: 'fixed', left: ${bounds.x} + 'px', top: ${bounds.y} + 'px',
        width: ${bounds.width} + 'px', height: ${bounds.height} + 'px',
        border: '2px solid #00ff88', pointerEvents: 'none', zIndex: 2147483647,
        background: 'rgba(0,255,136,0.15)', boxSizing: 'border-box'
      });
      document.body.appendChild(div);
      setTimeout(function() { div.remove(); }, 3000);
    })()
  `,
  );
}
