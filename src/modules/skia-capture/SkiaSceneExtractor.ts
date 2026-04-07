/**
 * Skia scene extractor — detects Skia rendering pipeline and extracts scene trees.
 *
 * Fulfills SKIA-01 (renderer fingerprinting) and SKIA-02 (scene tree extraction).
 * Uses JS injection to detect Skia-backed canvases and extract rendering state.
 */
import type { PageController } from '@server/domains/shared/modules';
import type { SkiaRendererInfo, SkiaSceneTree, SkiaLayer, SkiaDrawCommand } from './types';

/**
 * Known Skia backend renderer signatures detectable via WebGL.
 */
/**
 * Detect Skia renderer on the page.
 *
 * Strategy:
 * 1. Check WebGL debug renderer info for Skia backends
 * 2. Check canvas 2D context for Skia-specific artifacts
 * 3. Cross-reference detected game engines with known Skia users
 */
export async function detectSkiaRenderer(
  pageController: PageController,
  canvasId?: string,
): Promise<SkiaRendererInfo> {
  const evidence: string[] = [];
  const features: string[] = [];
  const rendererStrings: string[] = [];

  // Layer 1: WebGL renderer/vendor detection
  const webglInfo = await pageController.evaluate<
    Array<{
      vendor: string | null;
      renderer: string | null;
      unmaskedRenderer: string | null;
      unmaskedVendor: string | null;
      hasSkiaBackend: boolean;
    }>
  >(`
      (function() {
        var canvases = document.querySelectorAll('canvas');
        if (${typeof canvasId === 'string'}) {
          var target = document.getElementById(${JSON.stringify(canvasId ?? '')});
          if (target) canvases = [target];
        }
        var results = [];
        for (var i = 0; i < canvases.length; i++) {
          var c = canvases[i];
          var ctx = c.getContext('webgl') || c.getContext('webgl2') || c.getContext('experimental-webgl');
          if (!ctx) { results.push(null); continue; }
          var vendor = ctx.getParameter(ctx.VENDOR);
          var renderer = ctx.getParameter(ctx.RENDERER);
          var debugInfo = ctx.getExtension('WEBGL_debug_renderer_info');
          var unmaskedVendor = null;
          var unmaskedRenderer = null;
          var hasSkiaBackend = false;
          if (debugInfo) {
            unmaskedVendor = ctx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            unmaskedRenderer = ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            var skiaBackends = ['SwiftShader', 'ANGLE', 'Mesa', 'llvmpipe', 'D3D11', 'Vulkan', 'Metal'];
            hasSkiaBackend = skiaBackends.some(function(b) {
              return (unmaskedRenderer || '').indexOf(b) !== -1 ||
                     (unmaskedVendor || '').indexOf(b) !== -1 ||
                     (renderer || '').indexOf(b) !== -1;
            });
          }
          results.push({
            vendor: vendor,
            renderer: renderer,
            unmaskedVendor: unmaskedVendor,
            unmaskedRenderer: unmaskedRenderer,
            hasSkiaBackend: hasSkiaBackend
          });
        }
        return results;
      })()
    `);

  let hasSkiaBackend = false;
  for (const info of webglInfo) {
    if (!info) continue;
    if (info.unmaskedRenderer) rendererStrings.push(info.unmaskedRenderer);
    if (info.renderer) rendererStrings.push(info.renderer);
    if (info.hasSkiaBackend) {
      hasSkiaBackend = true;
      evidence.push(`WebGL unmasked renderer: ${info.unmaskedRenderer}`);
    }
  }

  // Layer 2: Canvas 2D font rendering signatures
  const fontInfo = await pageController.evaluate<{
    hasSkiaFontSignatures: boolean;
    textMetrics: Record<string, unknown> | null;
  }>(`
      (function() {
        var c = document.createElement('canvas');
        c.width = 200; c.height = 50;
        var ctx = c.getContext('2d');
        if (!ctx) return { hasSkiaFontSignatures: false, textMetrics: null };
        ctx.font = '14px Arial';
        var metrics = ctx.measureText('Hello');
        return {
          hasSkiaFontSignatures: typeof metrics.fontBoundingBoxAscent === 'number' ||
                                 typeof metrics.fontBoundingBoxDescent === 'number',
          textMetrics: {
            width: metrics.width,
            actualBoundingBoxLeft: metrics.actualBoundingBoxLeft || null,
            actualBoundingBoxRight: metrics.actualBoundingBoxRight || null,
            actualBoundingBoxAscent: metrics.actualBoundingBoxAscent || null,
            actualBoundingBoxDescent: metrics.actualBoundingBoxDescent || null,
            fontBoundingBoxAscent: metrics.fontBoundingBoxAscent || null,
            fontBoundingBoxDescent: metrics.fontBoundingBoxDescent || null
          }
        };
      })()
    `);

  if (fontInfo.hasSkiaFontSignatures) {
    features.push('fontBoundingBoxAscent/Descent available');
    evidence.push('Canvas 2D text metrics include font bounding boxes');
  }

  // Layer 3: Check if known Skia-backed engines are present
  const engineCheck = await pageController.evaluate<{
    engines: string[];
    isSkiaEngine: boolean;
  }>(`
      (function() {
        var engines = [];
        // Cocos Creator uses Skia
        if (window.cc || window.legacyCC) { engines.push('CocosCreator'); }
        // LayaAir can use Skia
        if (window.Laya) { engines.push('LayaAir'); }
        return {
          engines: engines,
          isSkiaEngine: engines.length > 0
        };
      })()
    `);

  if (engineCheck.isSkiaEngine) {
    for (const eng of engineCheck.engines) {
      evidence.push(`Engine ${eng} detected (known Skia user)`);
      features.push(`engine:${eng}`);
    }
  }

  // Determine backend (use priority-based matching; more specific keywords first)
  const BACKEND_PRIORITY = [
    { keyword: 'Vulkan', backend: 'gl' as const, pipeline: 'Vulkan' as const },
    { keyword: 'Metal', backend: 'metal' as const, pipeline: 'Metal' as const },
    { keyword: 'D3D11', backend: 'gl' as const, pipeline: 'OpenGL' as const },
    { keyword: 'Mesa', backend: 'gl' as const, pipeline: 'OpenGL' as const },
    { keyword: 'SwiftShader', backend: 'software' as const, pipeline: 'Raster' as const },
    { keyword: 'Google SwiftShader', backend: 'software' as const, pipeline: 'Raster' as const },
    { keyword: 'llvmpipe', backend: 'software' as const, pipeline: 'Raster' as const },
    { keyword: 'ANGLE', backend: 'gl' as const, pipeline: 'OpenGL' as const },
  ];

  let gpuBackend: SkiaRendererInfo['gpuBackend'] = 'software';
  let shaderPipeline: SkiaRendererInfo['shaderPipeline'] = 'Raster';
  let version: string | null = null;

  if (hasSkiaBackend) {
    outer: for (const sig of rendererStrings) {
      for (const { keyword, backend, pipeline } of BACKEND_PRIORITY) {
        if (sig.includes(keyword)) {
          gpuBackend = backend;
          shaderPipeline = pipeline;
          break outer;
        }
      }
    }
    version = version ?? extractVersionFromRenderer(rendererStrings);
  }

  const isSkiaBacked = hasSkiaBackend || engineCheck.isSkiaEngine || fontInfo.hasSkiaFontSignatures;
  const confidence = calculateSkiaConfidence(
    hasSkiaBackend,
    engineCheck.isSkiaEngine,
    fontInfo.hasSkiaFontSignatures,
  );

  return {
    isSkiaBacked,
    version,
    gpuBackend,
    shaderPipeline,
    rendererStrings,
    features,
    confidence,
    evidence,
  };
}

/**
 * Extract Skia scene tree from canvas context.
 *
 * Strategy:
 * 1. Traverse canvas 2D state (transform matrix, clip, path stack)
 * 2. Extract layer information from offscreen canvases
 * 3. Reconstruct draw commands from canvas state and engine-specific APIs
 */
export async function extractSceneTree(
  pageController: PageController,
  canvasId?: string,
  includeDrawCommands = true,
): Promise<SkiaSceneTree> {
  const sceneData = await pageController.evaluate<{
    canvas: { id?: string; width: number; height: number; dpr: number; contextType: string };
    layers: Array<{
      id: string;
      name: string;
      bounds: { x: number; y: number; width: number; height: number };
      transform: number[];
      opacity: number;
      visible: boolean;
      parentId: string | null;
      customData: Record<string, unknown>;
    }>;
    drawCommands: Array<{
      type: string;
      bounds: { x: number; y: number; width: number; height: number };
      paintInfo: Record<string, unknown>;
      layerId?: string;
    }>;
  }>(`
      (function() {
        var layers = [];
        var drawCommands = [];
        var canvasMeta = { id: null, width: 0, height: 0, dpr: 1, contextType: 'unknown' };

        var canvases = Array.from(document.querySelectorAll('canvas'));
        if (${typeof canvasId === 'string'}) {
          var target = document.getElementById(${JSON.stringify(canvasId ?? '')});
          if (target) canvases = [target];
        }

        var layerId = 0;

        // Collect offscreen canvases as layers
        function collectCanvases(parent, depth) {
          if (depth > 10) return;
          if (!parent || !parent.querySelectorAll) return;
          var childCanvases = parent.querySelectorAll('canvas, [data-canvas]');
          for (var i = 0; i < childCanvases.length; i++) {
            var c = childCanvases[i];
            if (c.tagName && c.tagName.toLowerCase() === 'canvas') {
              var rect = c.getBoundingClientRect();
              layers.push({
                id: 'layer_' + (layerId++),
                name: c.id || 'canvas_' + canvases.indexOf(c),
                bounds: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                },
                transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                opacity: parseFloat(c.style.opacity || '1'),
                visible: c.style.display !== 'none' && c.style.visibility !== 'hidden',
                parentId: null,
                customData: {
                  elementId: c.id || null,
                  cssClass: c.className || '',
                  dataAttributes: getDataAttrs(c)
                }
              });
            }
          }
        }

        function getDataAttrs(el) {
          var attrs = {};
          for (var i = 0; i < el.attributes.length; i++) {
            var a = el.attributes[i];
            if (a.name.indexOf('data-') === 0) {
              attrs[a.name] = a.value;
            }
          }
          return attrs;
        }

        // Main canvas
        var mainCanvas = canvases[0] || null;
        if (mainCanvas) {
          var mainRect = mainCanvas.getBoundingClientRect();
          canvasMeta = {
            id: mainCanvas.id || null,
            width: mainCanvas.width,
            height: mainCanvas.height,
            dpr: window.devicePixelRatio || 1,
            contextType: detectContextType(mainCanvas)
          };

          layers.push({
            id: 'layer_root',
            name: 'root_canvas',
            bounds: {
              x: Math.round(mainRect.x),
              y: Math.round(mainRect.y),
              width: mainCanvas.width,
              height: mainCanvas.height
            },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            parentId: null,
            customData: {
              elementId: mainCanvas.id || null,
              pixelWidth: mainCanvas.width,
              pixelHeight: mainCanvas.height
            }
          });

          // Extract draw commands from canvas state
          if (${String(includeDrawCommands)}) {
            try {
              var ctx = mainCanvas.getContext('2d');
              if (ctx) {
                // Check for recorded commands (some frameworks store draw history)
                if (ctx.__drawCommands) {
                  drawCommands = ctx.__drawCommands;
                }
                // Extract current state as implicit draw info
                drawCommands.push({
                  type: 'drawRect',
                  bounds: { x: 0, y: 0, width: mainCanvas.width, height: mainCanvas.height },
                  paintInfo: {
                    fillStyle: ctx.fillStyle || 'transparent',
                    strokeStyle: ctx.strokeStyle || 'transparent',
                    globalAlpha: ctx.globalAlpha,
                    globalCompositeOperation: ctx.globalCompositeOperation
                  }
                });
              }
            } catch(e) {}
          }

          collectCanvases(mainCanvas.parentElement, 1);
        }

        // Engine-specific layer extraction
        if (window.cc || window.legacyCC) {
          var cocos = window.cc || window.legacyCC;
          if (cocos.game && cocos.game.scene) {
            try {
              extractCocosScene(cocos.game.scene);
            } catch(e) {}
          }
        }

        function extractCocosScene(node) {
          if (!node) return;
          try {
            var pos = node.position;
            var size = node.contentSize || { width: 0, height: 0 };
            layers.push({
              id: 'layer_' + (layerId++),
              name: node.name || 'cocos_node',
              bounds: {
                x: pos ? Math.round(pos.x) : 0,
                y: pos ? Math.round(pos.y) : 0,
                width: size.width || 0,
                height: size.height || 0
              },
              transform: getTransformMatrix(node),
              opacity: node.opacity !== undefined ? node.opacity / 255 : 1,
              visible: node.active !== false,
              parentId: null,
              customData: {
                engineNode: true,
                className: node.constructor ? node.constructor.name : 'unknown'
              }
            });

            var children = node.children;
            if (children) {
              for (var i = 0; i < children.length; i++) {
                extractCocosScene(children[i]);
              }
            }
          } catch(e) {}
        }

        function getTransformMatrix(node) {
          try {
            var angle = node.angle || 0;
            var scale = node.scale || { x: 1, y: 1 };
            var cos = Math.cos(angle * Math.PI / 180);
            var sin = Math.sin(angle * Math.PI / 180);
            return [
              cos * scale.x, sin * scale.x, 0,
              -sin * scale.y, cos * scale.y, 0,
              0, 0, 1
            ];
          } catch(e) {
            return [1, 0, 0, 0, 1, 0, 0, 0, 1];
          }
        }

        function detectContextType(canvas) {
          if (canvas.getContext('webgl2')) return 'webgl2';
          if (canvas.getContext('webgl')) return 'webgl';
          if (canvas.getContext('2d')) return '2d';
          return 'unknown';
        }

        return { canvas: canvasMeta, layers: layers, drawCommands: drawCommands };
      })()
    `);

  // Build tree from flat layer list
  const layers = sceneData.layers.map(
    (l): SkiaLayer => ({
      id: l.id,
      name: l.name,
      bounds: l.bounds,
      transform: l.transform,
      opacity: l.opacity,
      visible: l.visible,
      children: [],
      customData: l.customData,
    }),
  );

  // Simple parent-child assignment based on bounds containment
  const rootLayer = layers[0] ?? null;
  if (rootLayer) {
    for (let i = 1; i < layers.length; i++) {
      const layer = layers[i];
      if (layer && isContainedIn(layer.bounds, rootLayer.bounds)) {
        rootLayer.children.push(layer);
      }
    }
  }

  const drawCommands = sceneData.drawCommands.map(
    (dc): SkiaDrawCommand => ({
      type: normalizeDrawType(dc.type),
      bounds: dc.bounds,
      paintInfo: dc.paintInfo,
      layerId: dc.layerId,
    }),
  );

  return {
    rootLayer,
    layers,
    drawCommands,
    totalLayers: layers.length,
    totalDrawCommands: drawCommands.length,
    canvas: sceneData.canvas,
  };
}

/**
 * Check if bounds A is contained within bounds B.
 */
function isContainedIn(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height
  );
}

/**
 * Normalize draw command type string to known enum values.
 */
function normalizeDrawType(type: string): SkiaDrawCommand['type'] {
  const lower = type.toLowerCase();
  if (lower.includes('rrect') || lower.includes('round')) return 'drawRRect';
  if (lower.includes('rect')) return 'drawRect';
  if (lower.includes('text')) return 'drawText';
  if (lower.includes('image') || lower.includes('sprite')) return 'drawImage';
  if (lower.includes('path')) return 'drawPath';
  if (lower.includes('circle') || lower.includes('arc')) return 'drawCircle';
  if (lower.includes('line')) return 'drawLine';
  return 'unknown';
}

/**
 * Extract version from renderer string.
 */
function extractVersionFromRenderer(rendererStrings: string[]): string | null {
  for (const str of rendererStrings) {
    const match = str.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (match) return match[1] ?? null;
  }
  return null;
}

/**
 * Calculate confidence score for Skia detection.
 */
function calculateSkiaConfidence(
  hasWebGLBackend: boolean,
  hasSkiaEngine: boolean,
  hasFontSignatures: boolean,
): number {
  let score = 0.1; // baseline
  if (hasWebGLBackend) score += 0.5;
  if (hasSkiaEngine) score += 0.3;
  if (hasFontSignatures) score += 0.1;
  return Math.min(score, 1.0);
}
