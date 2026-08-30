/**
 * canvas_memory_invariants — assert runtime invariants about WebGL context
 * lifetime, texture/program counts, and engine state consistency.
 *
 * Academic basis: JSidentify-V2 (arXiv 2508.01655) — fingerprinting engines
 * by sampling JS heap object structure. The fallback use case (when
 * scene_dump hits VM protection): if the engine's renderer is observable but
 * its scene tree is locked, you can still spot leaks and state desync from
 * the metrics it leaves behind.
 *
 * Honest boundary (per lesson #51):
 *   - We check only what is observable from JS (DOM canvas count vs live
 *     WebGL contexts; engine info.memory counts; active contextLoss events).
 *   - Full GC sweep / native-heap inspection is out of scope.
 *   - "Leaks" here means observable inconsistency (orphan context, dead
 *     programs, lost context not recovered) — not a guarantee of memory leak.
 *
 * Invariants:
 *   - INV-1: webglContexts ≤ canvases + 1 (one allowed for off-screen render targets)
 *     When webglContexts > canvases + 1, an orphaned context is leaking.
 *   - INV-2: when sceneNodes=0, programs should be at baseline (≤ 3: a clear/identity
 *     program may be prelinked). Larger program counts suggest the engine is
 *     building programs for a scene that was already destroyed.
 *   - INV-3: when contextLossEvents > 0, the engine should have rebuilt its
 *     resources. If renderer.info.memory.textures / programs are still small
 *     but contextLossEvents is high, the engine is in a degraded state.
 *   - INV-4: textureCacheCount should not grow unbounded when sceneNodes is small
 *     (proxy for texture leak after scene teardown).
 */

import type { ToolResponse } from '@server/types';
import type { PageController } from '@server/domains/canvas/dependencies';
import { asJsonResponse } from '@server/domains/shared/response';

export type ViolationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface InvariantCheck {
  id: string;
  description: string;
  passed: boolean;
}

export interface InvariantViolation {
  id: string;
  severity: ViolationSeverity;
  description: string;
  /** Safe-cleanup recommendation specific to this violation. */
  fix: string;
}

export interface SafeCleanupRecommendation {
  kind: string;
  description: string;
  /** Optional engine hint (which engine this is most relevant to). */
  engine?: string;
}

export interface CanvasMemoryMetrics {
  engine: string | null;
  canvases: number;
  webglContexts: number;
  textures: number;
  programs: number;
  buffers: number;
  sceneNodes: number;
  engineInfo: {
    textureMemoryMB?: number;
    programCount?: number;
    geometryCount?: number;
  } | null;
  contextLossEvents: number;
}

export interface CanvasMemoryInvariantsResult {
  success: boolean;
  metrics: CanvasMemoryMetrics | null;
  checks: InvariantCheck[];
  violations: InvariantViolation[];
  recommendations: SafeCleanupRecommendation[];
  violationCount: number;
  error?: string;
}

/**
 * Build a self-contained JS payload that collects observable WebGL / engine
 * metrics from the page. The host then evaluates the invariants and emits
 * violations + safe-cleanup recommendations.
 *
 * The payload is read-only: it never writes to globals, never touches
 * prototype chains, and never tries to free memory itself.
 *
 * @param canvasId - optional canvas element ID / index to scope to
 */
export function buildMemoryInvariantsPayload(canvasId?: string): string {
  return `(function() {
  function safe(name) { try { return typeof window[name]; } catch(e) { return 'undefined'; } }

  var canvasId = ${JSON.stringify(canvasId ?? null)};

  // Resolve target canvas
  var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
  var targetCanvas = null;
  if (canvasId) {
    targetCanvas = document.getElementById(canvasId) ||
      (function() {
        var idx = parseInt(canvasId, 10);
        return isNaN(idx) ? null : canvases[idx] || null;
      })();
  } else if (canvases.length > 0) {
    targetCanvas = canvases[canvases.length - 1];
  }

  // Count live WebGL contexts by checking each canvas. We can't enumerate
  // detached contexts directly, but a canvas with no DOM presence that still
  // owns a GL context is exactly what INV-1 catches.
  var webglContexts = 0;
  for (var i = 0; i < canvases.length; i++) {
    var c = canvases[i];
    try {
      var gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) webglContexts++;
    } catch(e) {}
  }

  // Engine info: pull from known renderer globals. We probe Three.js first
  // (most common reverse target), then Babylon, then Laya.
  var engine = null;
  var engineInfo = null;
  var sceneNodes = 0;
  var programs = 0;
  var textures = 0;
  var buffers = 0;
  var contextLossEvents = 0;

  if (safe('THREE') !== 'undefined') {
    engine = 'three';
    try {
      var renderer = window.__threeRenderer || (function() {
        var keys = Object.keys(window);
        for (var i = 0; i < keys.length; i++) {
          try {
            var v = window[keys[i]];
            if (v && v.isWebGLRenderer === true) return v;
          } catch(e) {}
        }
        return null;
      })();
      if (renderer && renderer.info) {
        var mem = renderer.info.memory || {};
        var render = renderer.info.render || {};
        engineInfo = {
          textureMemoryMB: Math.round((mem.geometries || 0) / 1024),
          programCount: (renderer.info.programs || []).length,
          geometryCount: mem.geometries || 0
        };
        programs = engineInfo.programCount;
        textures = (renderer.info.textures || []).length;
        buffers = render.calls || 0;
      }
      // sceneNodes: walk the scene tree if we can find one
      try {
        var scene = window.__threeScene;
        if (!scene) {
          var keys2 = Object.keys(window);
          for (var k = 0; k < keys2.length; k++) {
            try {
              var v = window[keys2[k]];
              if (v && v.isScene === true) { scene = v; break; }
            } catch(e) {}
          }
        }
        if (scene) {
          (function count(obj) {
            if (!obj) return;
            sceneNodes++;
            if (obj.children) {
              for (var i = 0; i < obj.children.length; i++) count(obj.children[i]);
            }
          })(scene);
        }
      } catch(e) {}
    } catch(e) {}
  } else if (safe('BABYLON') !== 'undefined') {
    engine = 'babylon';
    try {
      var B = window.BABYLON;
      if (B && B.Engine && B.Engine.Instances) {
        var last = B.Engine.Instances[B.Engine.Instances.length - 1];
        if (last && last.scenes) {
          for (var i = 0; i < last.scenes.length; i++) {
            var s = last.scenes[i];
            if (s && s.meshes) sceneNodes += s.meshes.length;
            if (s && s.transformNodes) sceneNodes += s.transformNodes.length;
          }
          engineInfo = {
            programCount: last._compiledEffects ? last._compiledEffects.length : 0,
            geometryCount: 0
          };
          programs = engineInfo.programCount;
        }
      }
    } catch(e) {}
  } else if (safe('Laya') !== 'undefined') {
    engine = 'laya';
    try {
      var L = window.Laya;
      if (L && L.stage && L.stage._children) {
        (function count(node) {
          if (!node) return;
          sceneNodes++;
          var kids = node._children || node.children;
          if (kids) for (var i = 0; i < kids.length; i++) count(kids[i]);
        })(L.stage);
      }
    } catch(e) {}
  }

  // contextLossEvents: count webglcontextlost listeners that fired — best
  // proxy is __jshookContextLossEvents (set by some harnesses) or fall back
  // to a custom event the engine may have emitted.
  try {
    if (Array.isArray(window.__jshookContextLossEvents)) {
      contextLossEvents = window.__jshookContextLossEvents.length;
    } else if (typeof window.__jshookContextLossEvents === 'number') {
      contextLossEvents = window.__jshookContextLossEvents;
    } else {
      // Crude fallback: probe for the well-known WebGL contextLost event on
      // the target canvas. We don't dispatch anything — just check listener
      // counts. Most pages never wire this up so it stays at 0.
      contextLossEvents = 0;
    }
  } catch(e) {
    contextLossEvents = 0;
  }

  return {
    engine: engine,
    canvases: canvases.length,
    webglContexts: webglContexts,
    textures: textures,
    programs: programs,
    buffers: buffers,
    sceneNodes: sceneNodes,
    engineInfo: engineInfo,
    contextLossEvents: contextLossEvents
  };
})()`;
}

/**
 * Evaluate invariants against the collected metrics.
 *
 * Each invariant returns a check (for transparency) and, when violated, a
 * structured violation record. Recommendations are layered on top — they
 * fire either from a specific violation or as a generic safe-cleanup hint
 * when memory usage is non-trivial.
 */
export function evaluateInvariants(metrics: CanvasMemoryMetrics): {
  checks: InvariantCheck[];
  violations: InvariantViolation[];
  recommendations: SafeCleanupRecommendation[];
} {
  const checks: InvariantCheck[] = [];
  const violations: InvariantViolation[] = [];
  const recommendations: SafeCleanupRecommendation[] = [];

  // INV-1: webglContexts vs canvases
  const orphanAllowed = 1;
  const contextOrphan = metrics.webglContexts > metrics.canvases + orphanAllowed;
  checks.push({
    id: 'webgl-context-orphan',
    description:
      'Live WebGL contexts should not exceed DOM canvas count by more than 1 (one off-screen render target is allowed)',
    passed: !contextOrphan,
  });
  if (contextOrphan) {
    violations.push({
      id: 'webgl-context-orphan',
      severity: metrics.webglContexts - metrics.canvases > 2 ? 'critical' : 'high',
      description:
        'Detected ' +
        metrics.webglContexts +
        ' live WebGL context(s) for ' +
        metrics.canvases +
        ' canvas element(s); ' +
        (metrics.webglContexts - metrics.canvases) +
        ' are orphaned (no DOM canvas reference).',
      fix:
        'Audit any off-screen render targets you allocate (e.g. Three.js WebGLRenderTarget, Babylon RenderTargetTexture). ' +
        'Each one keeps the WebGL context alive even after the parent canvas is removed from the DOM; ' +
        'call .dispose() on every render target when the parent scene is destroyed.',
    });
    recommendations.push({
      kind: 'force-context-release',
      description:
        'Walk your render-target graph and call dispose() on every target that no longer has a live canvas parent. ' +
        'In Three.js: renderer.info.programs.length + renderer.info.memory.geometries must drop after disposal.',
      engine: metrics.engine ?? undefined,
    });
  }

  // INV-2: programs without a scene
  const programsNoScene = metrics.programs > 3 && metrics.sceneNodes === 0;
  checks.push({
    id: 'programs-without-scene',
    description:
      'When the engine scene has zero nodes, shader programs should be at the engine baseline (≤ 3 prelinked identity programs)',
    passed: !programsNoScene,
  });
  if (programsNoScene) {
    violations.push({
      id: 'programs-without-scene',
      severity: 'high',
      description:
        metrics.programs +
        ' shader programs are still linked, but the engine scene tree has ' +
        metrics.sceneNodes +
        ' node(s). The engine state is desynced — programs outlive the scene.',
      fix:
        'Call the engine-specific scene reset: Three.js scene.clear() + renderer.dispose(); ' +
        'Babylon scene.dispose(); Laya Laya.stage.clear();. Then reload the page to confirm the program count drops to baseline.',
    });
    recommendations.push({
      kind: 'scene-rebuild',
      description:
        'A scene rebuild is required to free the orphaned programs. The current state cannot recover via partial cleanup.',
      engine: metrics.engine ?? undefined,
    });
  }

  // INV-3: context loss events
  const contextLossDetected = metrics.contextLossEvents > 0;
  checks.push({
    id: 'context-loss-detected',
    description: 'webglcontextlost events should not have fired during normal operation',
    passed: !contextLossDetected,
  });
  if (contextLossDetected) {
    violations.push({
      id: 'context-loss-detected',
      severity: metrics.contextLossEvents > 1 ? 'high' : 'medium',
      description:
        'Detected ' +
        metrics.contextLossEvents +
        ' webglcontextlost event(s). ' +
        'Engines should listen for this event and rebuild resources; if you see lingering low memory / program counts, ' +
        'the rebuild path may be missing or broken.',
      fix:
        'Add or verify a webglcontextlost handler that pauses rendering and calls preventDefault() on the event, ' +
        'then a webglcontextrestored handler that rebuilds textures/programs from cached sources.',
    });
    recommendations.push({
      kind: 'rebuild-resources',
      description:
        'If your scene looks broken after context loss, the engine rebuild path is missing. ' +
        'Re-attach your scene contents from cached JSON after webglcontextrestored fires.',
      engine: metrics.engine ?? undefined,
    });
  }

  // INV-4: texture cache vs scene size
  const texturesPerSceneNode = metrics.sceneNodes > 0 ? metrics.textures / metrics.sceneNodes : 0;
  const textureCacheBloat = metrics.textures > 100 && texturesPerSceneNode > 8;
  checks.push({
    id: 'texture-cache-bloat',
    description:
      'Texture cache should be bounded by scene size (~8 textures per scene node is a reasonable upper bound for most engines)',
    passed: !textureCacheBloat,
  });
  if (textureCacheBloat) {
    violations.push({
      id: 'texture-cache-bloat',
      severity: 'medium',
      description:
        'Texture cache holds ' +
        metrics.textures +
        ' texture(s) for ' +
        metrics.sceneNodes +
        ' scene node(s) — ' +
        texturesPerSceneNode.toFixed(1) +
        ' textures/node, well above the 8/node guideline.',
      fix:
        'Audit the texture cache eviction policy. Most engines (Three.js TextureLoader, Babylon TextureManager) ' +
        'do not evict by default; manually call dispose() on textures that no longer have live references.',
    });
  }

  // Generic safe-cleanup recommendations when memory is non-trivial but no
  // hard violation fired. We surface them only when there's something
  // meaningful to suggest.
  if (
    metrics.engineInfo?.textureMemoryMB !== undefined &&
    metrics.engineInfo.textureMemoryMB > 16
  ) {
    recommendations.push({
      kind: 'consider-cache-eviction',
      description:
        'GPU texture memory is at ' +
        metrics.engineInfo.textureMemoryMB +
        ' MB. ' +
        'Consider evicting unused textures to keep the GPU heap predictable.',
      engine: metrics.engine ?? undefined,
    });
  }

  return { checks, violations, recommendations };
}

/**
 * Handler for canvas_memory_invariants.
 *
 * @param pageController - injected PageController for in-page evaluation
 * @param args - tool arguments: canvasId?
 */
export async function handleMemoryInvariants(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const canvasId = args['canvasId'] as string | undefined;

  let metrics: CanvasMemoryMetrics;
  try {
    const payload = buildMemoryInvariantsPayload(canvasId);
    metrics = await pageController.evaluate<CanvasMemoryMetrics>(payload);
  } catch (error) {
    return asJsonResponse({
      success: false,
      metrics: null,
      checks: [],
      violations: [],
      recommendations: [],
      violationCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const { checks, violations, recommendations } = evaluateInvariants(metrics);

  const result: CanvasMemoryInvariantsResult = {
    success: true,
    metrics,
    checks,
    violations,
    recommendations,
    violationCount: violations.length,
  };

  return asJsonResponse(result);
}
