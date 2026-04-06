/**
 * canvas_scene_dump tool handler.
 *
 * Delegates to engine-specific adapter after fingerprinting.
 */
import type { PageController } from '@server/domains/canvas/dependencies';
import type { CanvasSceneDump, DumpOpts } from '@server/domains/canvas/types';
import { fingerprintCanvas, resolveAdapter, buildEnv } from './shared';

export async function handleSceneDump(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<CanvasSceneDump> {
  const canvasId = args['canvasId'] as string | undefined;
  const maxDepth = (args['maxDepth'] as number | undefined) ?? 20;
  const onlyInteractive = (args['onlyInteractive'] as boolean | undefined) ?? false;
  const onlyVisible = (args['onlyVisible'] as boolean | undefined) ?? false;

  const opts: DumpOpts = { canvasId, maxDepth, onlyInteractive, onlyVisible };

  const detection = await fingerprintCanvas(pageController, canvasId);
  if (!detection) {
    return partialSceneDump(pageController, canvasId);
  }

  const adapter = resolveAdapter(detection);
  if (!adapter) {
    return partialSceneDump(pageController, canvasId);
  }

  return adapter.dumpScene(buildEnv(pageController), opts);
}

async function partialSceneDump(
  pageController: PageController,
  canvasId?: string,
): Promise<CanvasSceneDump> {
  const canvases = await pageController.evaluate<
    Array<{
      id: string;
      width: number;
      height: number;
      dpr: number;
      contextType: string;
    }>
  >(`
    (function() {
      return Array.from(document.querySelectorAll('canvas')).map(function(c, i) {
        var ctx2d = c.getContext('2d');
        var ctxWebgl = c.getContext('webgl') || c.getContext('webgl2');
        return {
          id: c.id || String(i),
          width: c.width,
          height: c.height,
          dpr: window.devicePixelRatio || 1,
          contextType: ctx2d ? '2d' : (ctxWebgl ? 'webgl' : 'unknown')
        };
      });
    })()
  `);

  const filtered = canvasId
    ? canvases.filter((c) => c.id === canvasId || canvases.indexOf(c).toString() === canvasId)
    : canvases;

  return {
    engine: 'unknown',
    version: undefined,
    canvas: (filtered[0] ?? {
      id: canvasId ?? '',
      width: 0,
      height: 0,
      dpr: 1,
      contextType: 'unknown',
    }) as CanvasSceneDump['canvas'],
    sceneTree: null,
    totalNodes: 0,
    completeness: 'partial' as const,
    partialReason: 'No canvas engine detected — only DOM canvas metadata returned',
  };
}
