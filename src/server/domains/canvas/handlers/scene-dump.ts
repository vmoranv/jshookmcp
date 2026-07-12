/**
 * canvas_scene_dump tool handler.
 *
 * Delegates to engine-specific adapter after fingerprinting.
 */
import type { PageController } from '@server/domains/canvas/dependencies';
import type { CanvasDetection, CanvasSceneDump, DumpOpts } from '@server/domains/canvas/types';
import { createStub } from '@server/domains/shared/capabilities';
import { fingerprintCanvas, resolveAdapter, buildEnv } from './shared';

export async function handleSceneDump(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<CanvasSceneDump> {
  const canvasId = args['canvasId'] as string | undefined;
  const maxDepth = (args['maxDepth'] as number | undefined) ?? 20;
  const onlyInteractive = (args['onlyInteractive'] as boolean | undefined) ?? false;
  const onlyVisible = (args['onlyVisible'] as boolean | undefined) ?? false;
  const includeGPUResources = (args['includeGPUResources'] as boolean | undefined) ?? false;

  const opts: DumpOpts = { canvasId, maxDepth, onlyInteractive, onlyVisible, includeGPUResources };

  const detection = await fingerprintCanvas(pageController, canvasId);
  if (!detection) {
    return partialSceneDump(pageController, canvasId, null);
  }

  const adapter = resolveAdapter(detection);
  if (!adapter) {
    return partialSceneDump(pageController, canvasId, detection);
  }

  const dump = await adapter.dumpScene(buildEnv(pageController), opts);

  if (includeGPUResources && adapter.dumpGpuResources) {
    const gpu = await adapter.dumpGpuResources(buildEnv(pageController), opts);
    if (gpu) {
      dump.gpuResources = gpu;
    }
  }

  return dump;
}

/**
 * Build an honest adapter-missing message naming the detected engine.
 *
 * - Unity: scene tree extraction is unsupported; give the page_evaluate SendMessage hint.
 * - Other detected-but-unsupported engines: name them explicitly so the caller knows the
 *   engine was fingerprinted (not silently stubbed as "no engine").
 */
function adapterMissingMessage(detection: CanvasDetection): {
  reason: string;
  fix: string;
} {
  if (detection.adapterId === 'unity') {
    return {
      reason:
        'Unity WebGL adapter not yet available; the engine was detected but scene tree extraction is unsupported.',
      fix: 'Use page_evaluate with unityInstance.SendMessage to inspect the Unity runtime manually.',
    };
  }
  const engineLabel = detection.engine || detection.adapterId || 'unknown engine';
  return {
    reason: `${engineLabel} was fingerprinted but no scene-dump adapter is registered for adapterId "${detection.adapterId}". Only DOM canvas metadata returned.`,
    fix: 'Use page_evaluate to inspect the engine directly, or request an adapter for this engine.',
  };
}

async function partialSceneDump(
  pageController: PageController,
  canvasId?: string,
  detection: CanvasDetection | null = null,
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

  const canvasData = (filtered[0] ?? {
    id: canvasId ?? '',
    width: 0,
    height: 0,
    dpr: 1,
    contextType: 'unknown',
  }) as CanvasSceneDump['canvas'];

  // Two honest paths:
  // 1. No engine detected at all → generic "No canvas engine detected".
  // 2. Engine detected but adapter missing (e.g. Unity, or an unsupported adapterId)
  //    → name the engine explicitly so the caller knows it was fingerprinted.
  const noAdapter = detection !== null;
  const detectedEngine = detection?.engine ?? 'unknown';
  const detectedVersion = detection?.version;
  const detectedAdapterId = detection?.adapterId;

  const reason = noAdapter
    ? adapterMissingMessage(detection!).reason
    : 'No canvas engine detected — only DOM canvas metadata returned';
  const fix = noAdapter
    ? adapterMissingMessage(detection!).fix
    : 'Ensure a supported canvas engine is loaded (Pixi, Phaser, Laya, Cocos, Three.js, Babylon.js)';

  const stubData = createStub({
    tool: 'canvas_scene_dump',
    stubType: 'partial',
    reason,
    fix,
    data: {
      engine: detectedEngine,
      version: detectedVersion,
      adapterId: detectedAdapterId,
      canvas: canvasData,
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial' as const, // Keep for backward compatibility
      partialReason: reason,
    },
  });

  // Return the data portion as CanvasSceneDump (strip stub metadata for type compatibility)
  return {
    engine: stubData.engine as string,
    version: stubData.version as string | undefined,
    adapterId: stubData.adapterId as string | undefined,
    canvas: stubData.canvas as CanvasSceneDump['canvas'],
    sceneTree: stubData.sceneTree as CanvasSceneDump['sceneTree'],
    totalNodes: stubData.totalNodes as number,
    completeness: stubData.completeness as CanvasSceneDump['completeness'],
    partialReason: stubData.partialReason as string | undefined,
    // Attach stub metadata
    stubType: stubData.stubType as string,
    reason: stubData.reason as string,
    fix: stubData.fix as string | undefined,
  } as CanvasSceneDump & { stubType: string; reason: string; fix?: string };
}
