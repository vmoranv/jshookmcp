import type {
  SkiaDrawCommand,
  SkiaLayer,
  SkiaRendererInfo as LegacySkiaRendererInfo,
  SkiaSceneTree as LegacySkiaSceneTree,
} from './types';

// ── Scene extraction limits ────────────────────────────────────────────────────

/** Maximum DOM children expanded per scene node (guards deep DOM trees). */
const MAX_SCENE_CHILD_NODES = 12;
/** Maximum sibling nodes attached to the root canvas node. */
const MAX_SCENE_SIBLING_NODES = 8;

// ── Renderer-detection confidence weights ──────────────────────────────────────
// Accumulated evidence weights; final confidence is clamped to ≤ 1.

/** Baseline confidence when no probe evidence is present. */
const BASE_SKIA_CONFIDENCE = 0.1;
/** Weight added when a WebGL probe reports a Skia backend. */
const WEBGL_PROBE_CONFIDENCE_WEIGHT = 0.5;
/** Weight added when a known Skia-adjacent engine is detected. */
const ENGINE_PROBE_CONFIDENCE_WEIGHT = 0.3;
/** Weight added when font-bounding-box signatures are present. */
const FONT_PROBE_CONFIDENCE_WEIGHT = 0.1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneNode {
  id: string;
  type: string;
  label: string;
  children: SceneNode[];
  visible?: boolean;
  bounds?: Rect;
}

interface ModernSceneTree {
  rootNodes: SceneNode[];
  totalNodes: number;
  extractedAt: string;
}

interface ModernSkiaRendererInfo {
  backend: 'cpu' | 'gpu' | 'vulkan' | 'metal' | 'opengl' | 'direct3d';
  version?: string;
  gpu?: string;
}

export type SkiaRendererInfo = ModernSkiaRendererInfo;

interface EvaluateCapable {
  evaluate<T>(script: string): Promise<T>;
}

interface WebGlContextLike {
  RENDERER: number;
  VERSION: number;
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(parameter: number): unknown;
}

interface LegacyWebGlProbe {
  vendor: string | null;
  renderer: string | null;
  unmaskedRenderer: string | null;
  unmaskedVendor: string | null;
  hasSkiaBackend: boolean;
}

interface LegacyFontProbe {
  hasSkiaFontSignatures: boolean;
  textMetrics: Record<string, unknown> | null;
}

interface LegacyEngineProbe {
  engines: string[];
  isSkiaEngine: boolean;
}

interface LegacySceneProbe {
  canvas: {
    id?: string;
    width?: number;
    height?: number;
    dpr?: number;
    contextType?: string;
  };
  layers: Array<{
    id?: string;
    name?: string;
    bounds?: Rect;
    transform?: number[];
    opacity?: number;
    visible?: boolean;
    parentId?: string | null;
    customData?: Record<string, unknown>;
  }>;
  drawCommands: Array<{
    type?: string;
    bounds?: Rect;
    paintInfo?: Record<string, unknown>;
    layerId?: string;
  }>;
}

function hasEvaluate(value: unknown): value is EvaluateCapable {
  if (typeof value !== 'object' || value === null || !('evaluate' in value)) {
    return false;
  }

  return typeof value.evaluate === 'function';
}

function isWebGlContext(value: unknown): value is WebGlContextLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (
    !('getExtension' in value) ||
    !('getParameter' in value) ||
    !('RENDERER' in value) ||
    !('VERSION' in value)
  ) {
    return false;
  }

  return typeof value.getExtension === 'function' && typeof value.getParameter === 'function';
}

function detectBackend(renderer: string | undefined): SkiaRendererInfo['backend'] {
  const normalized = (renderer ?? '').toLowerCase();
  if (normalized.includes('vulkan')) {
    return 'vulkan';
  }
  if (normalized.includes('metal')) {
    return 'metal';
  }
  if (normalized.includes('d3d') || normalized.includes('direct3d')) {
    return 'direct3d';
  }
  if (
    normalized.includes('angle') ||
    normalized.includes('opengl') ||
    normalized.includes('mesa') ||
    normalized.includes('gl')
  ) {
    return 'opengl';
  }
  if (
    normalized.includes('swiftshader') ||
    normalized.includes('software') ||
    normalized.includes('cpu')
  ) {
    return 'cpu';
  }
  if (normalized.length > 0) {
    return 'gpu';
  }
  return 'cpu';
}

function countNodes(nodes: SceneNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    total += countNodes(node.children);
  }
  return total;
}

function elementLabel(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel;
  }
  if (element.id) {
    return element.id;
  }
  const className = typeof element.className === 'string' ? element.className.trim() : '';
  if (className.length > 0) {
    return className;
  }
  return element.tagName.toLowerCase();
}

function elementBounds(element: Element): Rect | undefined {
  if (typeof element.getBoundingClientRect !== 'function') {
    return undefined;
  }

  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function elementVisible(element: Element): boolean | undefined {
  if (!(element instanceof HTMLElement) || typeof window === 'undefined') {
    return undefined;
  }

  const styles = window.getComputedStyle(element);
  return styles.display !== 'none' && styles.visibility !== 'hidden';
}

function sceneNodeFromElement(element: Element, fallbackId: string): SceneNode {
  const children = Array.from(element.children)
    .slice(0, MAX_SCENE_CHILD_NODES)
    .map((child, index) => sceneNodeFromElement(child, `${fallbackId}-${index}`));

  return {
    id: element.id || fallbackId,
    type: element.tagName.toLowerCase(),
    label: elementLabel(element),
    children,
    visible: elementVisible(element),
    bounds: elementBounds(element),
  };
}

function mockSceneTree(): ModernSceneTree {
  const rootNodes: SceneNode[] = [
    {
      id: 'mock-root',
      type: 'canvas',
      label: 'mock-skia-surface',
      visible: true,
      bounds: { x: 0, y: 0, width: 640, height: 480 },
      children: [
        {
          id: 'mock-layer',
          type: 'layer',
          label: 'mock-layer',
          visible: true,
          bounds: { x: 16, y: 16, width: 320, height: 160 },
          children: [],
        },
      ],
    },
  ];

  return {
    rootNodes,
    totalNodes: countNodes(rootNodes),
    extractedAt: new Date().toISOString(),
  };
}

function modernToLegacyRendererInfo(info: SkiaRendererInfo): LegacySkiaRendererInfo {
  let gpuBackend: LegacySkiaRendererInfo['gpuBackend'] = 'software';
  let shaderPipeline: LegacySkiaRendererInfo['shaderPipeline'] = 'Raster';

  if (info.backend === 'vulkan') {
    gpuBackend = 'vulkan';
    shaderPipeline = 'Vulkan';
  } else if (info.backend === 'metal') {
    gpuBackend = 'metal';
    shaderPipeline = 'Metal';
  } else if (info.backend === 'opengl' || info.backend === 'direct3d' || info.backend === 'gpu') {
    gpuBackend = 'gl';
    shaderPipeline = 'OpenGL';
  }

  return {
    isSkiaBacked: info.backend !== 'cpu',
    version: info.version ?? null,
    gpuBackend,
    shaderPipeline,
    rendererStrings: info.gpu ? [info.gpu] : [],
    features: info.backend === 'cpu' ? [] : [`backend:${info.backend}`],
    confidence: info.backend === 'cpu' ? 0.2 : 0.8,
    evidence: info.gpu ? [`Renderer string: ${info.gpu}`] : ['No renderer information available'],
  };
}

function isContained(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function normalizeDrawType(type: string | undefined): SkiaDrawCommand['type'] {
  const normalized = (type ?? '').toLowerCase();
  if (normalized.includes('rrect') || normalized.includes('round')) {
    return 'drawRRect';
  }
  if (normalized.includes('rect')) {
    return 'drawRect';
  }
  if (normalized.includes('text')) {
    return 'drawText';
  }
  if (normalized.includes('image') || normalized.includes('sprite')) {
    return 'drawImage';
  }
  if (normalized.includes('path')) {
    return 'drawPath';
  }
  if (normalized.includes('circle') || normalized.includes('arc')) {
    return 'drawCircle';
  }
  if (normalized.includes('line')) {
    return 'drawLine';
  }
  return 'unknown';
}

function normalizeLegacyScene(scene: LegacySceneProbe): LegacySkiaSceneTree {
  const layers: SkiaLayer[] = scene.layers.map((layer, index) => ({
    id: layer.id ?? `layer-${index}`,
    name: layer.name ?? `layer-${index}`,
    bounds: layer.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    transform: layer.transform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1],
    opacity: layer.opacity ?? 1,
    visible: layer.visible ?? true,
    children: [],
    customData: layer.customData,
  }));

  const rootLayer = layers[0] ?? null;
  if (rootLayer) {
    for (let index = 1; index < layers.length; index += 1) {
      const candidate = layers[index];
      if (candidate && isContained(candidate.bounds, rootLayer.bounds)) {
        rootLayer.children.push(candidate);
      }
    }
  }

  const drawCommands: SkiaDrawCommand[] = scene.drawCommands.map((command) => ({
    type: normalizeDrawType(command.type),
    bounds: command.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    paintInfo: command.paintInfo ?? {},
    layerId: command.layerId,
  }));

  return {
    rootLayer,
    layers,
    drawCommands,
    totalLayers: layers.length,
    totalDrawCommands: drawCommands.length,
    canvas: {
      id: scene.canvas.id,
      width: scene.canvas.width ?? 0,
      height: scene.canvas.height ?? 0,
      dpr: scene.canvas.dpr ?? 1,
      contextType: scene.canvas.contextType ?? 'unknown',
    },
  };
}

function sceneNodeToLegacyLayer(node: SceneNode): SkiaLayer {
  return {
    id: node.id,
    name: node.label,
    bounds: node.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    opacity: 1,
    visible: node.visible ?? true,
    children: node.children.map((child) => sceneNodeToLegacyLayer(child)),
  };
}

function modernSceneToLegacyScene(scene: ModernSceneTree): LegacySkiaSceneTree {
  const layers = scene.rootNodes.map((node) => sceneNodeToLegacyLayer(node));
  return {
    rootLayer: layers[0] ?? null,
    layers,
    drawCommands: [],
    totalLayers: layers.length,
    totalDrawCommands: 0,
    canvas: {
      width: layers[0]?.bounds.width ?? 0,
      height: layers[0]?.bounds.height ?? 0,
      dpr: 1,
      contextType: 'mock',
    },
  };
}

function versionFromStrings(rendererStrings: string[]): string | null {
  for (const renderer of rendererStrings) {
    const match = renderer.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function legacyGpuBackend(rendererStrings: string[]): LegacySkiaRendererInfo['gpuBackend'] {
  const joined = rendererStrings.join(' ').toLowerCase();
  if (joined.includes('metal')) {
    return 'metal';
  }
  if (joined.includes('vulkan')) {
    return 'vulkan';
  }
  if (joined.includes('swiftshader') || joined.includes('software')) {
    return 'software';
  }
  if (joined.length > 0) {
    return 'gl';
  }
  return 'software';
}

function legacyShaderPipeline(rendererStrings: string[]): LegacySkiaRendererInfo['shaderPipeline'] {
  const joined = rendererStrings.join(' ').toLowerCase();
  if (joined.includes('metal')) {
    return 'Metal';
  }
  if (joined.includes('vulkan')) {
    return 'Vulkan';
  }
  if (joined.includes('swiftshader') || joined.includes('software')) {
    return 'Raster';
  }
  if (joined.length > 0) {
    return 'OpenGL';
  }
  return 'Raster';
}

function buildLegacyRendererFromProbes(
  webglResults: LegacyWebGlProbe[],
  fontProbe: LegacyFontProbe,
  engineProbe: LegacyEngineProbe,
): LegacySkiaRendererInfo {
  const rendererStrings = webglResults.flatMap((probe) => {
    const values: string[] = [];
    if (probe.unmaskedRenderer) {
      values.push(probe.unmaskedRenderer);
    }
    if (probe.renderer) {
      values.push(probe.renderer);
    }
    return values;
  });

  const features: string[] = [];
  const evidence: string[] = [];

  if (fontProbe.hasSkiaFontSignatures) {
    features.push('fontBoundingBoxAscent/Descent available');
    evidence.push('Canvas text metrics expose font bounding boxes');
  }

  for (const engine of engineProbe.engines) {
    features.push(`engine:${engine}`);
    evidence.push(`Detected known Skia-adjacent engine: ${engine}`);
  }

  for (const probe of webglResults) {
    if (probe.hasSkiaBackend && probe.unmaskedRenderer) {
      evidence.push(`Renderer probe: ${probe.unmaskedRenderer}`);
    }
  }

  const isSkiaBacked =
    webglResults.some((probe) => probe.hasSkiaBackend) ||
    engineProbe.isSkiaEngine ||
    fontProbe.hasSkiaFontSignatures;

  let confidence = BASE_SKIA_CONFIDENCE;
  if (webglResults.some((probe) => probe.hasSkiaBackend)) {
    confidence += WEBGL_PROBE_CONFIDENCE_WEIGHT;
  }
  if (engineProbe.isSkiaEngine) {
    confidence += ENGINE_PROBE_CONFIDENCE_WEIGHT;
  }
  if (fontProbe.hasSkiaFontSignatures) {
    confidence += FONT_PROBE_CONFIDENCE_WEIGHT;
  }

  const gpuBackend = isSkiaBacked ? legacyGpuBackend(rendererStrings) : 'software';
  const shaderPipeline = isSkiaBacked ? legacyShaderPipeline(rendererStrings) : 'Raster';

  return {
    isSkiaBacked,
    version: versionFromStrings(rendererStrings),
    gpuBackend,
    shaderPipeline,
    rendererStrings,
    features,
    confidence: Math.min(confidence, 1),
    evidence,
  };
}

export class SkiaSceneExtractor {
  detectSkiaRenderer(): SkiaRendererInfo {
    if (typeof document === 'undefined') {
      return {
        backend: 'cpu',
        version: 'mock',
        gpu: 'browser-context-unavailable',
      };
    }

    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        backend: 'cpu',
        version: 'mock',
        gpu: 'no-canvas-detected',
      };
    }

    const rawContext =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');

    if (!isWebGlContext(rawContext)) {
      return {
        backend: 'cpu',
        version: 'mock',
        gpu: 'canvas-without-webgl',
      };
    }

    let gpu: string | undefined;
    const debugInfo = rawContext.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const unmaskedRenderer = rawContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (typeof unmaskedRenderer === 'string' && unmaskedRenderer.trim().length > 0) {
        gpu = unmaskedRenderer;
      }
    }

    if (!gpu) {
      const renderer = rawContext.getParameter(rawContext.RENDERER);
      if (typeof renderer === 'string' && renderer.trim().length > 0) {
        gpu = renderer;
      }
    }

    let version: string | undefined;
    const rawVersion = rawContext.getParameter(rawContext.VERSION);
    if (typeof rawVersion === 'string' && rawVersion.trim().length > 0) {
      version = rawVersion;
    }

    return {
      backend: detectBackend(gpu),
      version,
      gpu,
    };
  }

  extractSceneTree(canvasElement?: string): ModernSceneTree {
    if (typeof document === 'undefined') {
      return mockSceneTree();
    }

    const selected = canvasElement
      ? document.querySelector(canvasElement)
      : document.querySelector('canvas');
    if (!(selected instanceof HTMLCanvasElement)) {
      return mockSceneTree();
    }

    const root = sceneNodeFromElement(selected, 'skia-root');
    if (selected.parentElement) {
      const siblingNodes = Array.from(selected.parentElement.children)
        .filter((child) => child !== selected)
        .slice(0, MAX_SCENE_SIBLING_NODES)
        .map((child, index) => sceneNodeFromElement(child, `skia-sibling-${index}`));
      root.children.push(...siblingNodes);
    }

    const rootNodes = [root];
    return {
      rootNodes,
      totalNodes: countNodes(rootNodes),
      extractedAt: new Date().toISOString(),
    };
  }
}

/**
 * Whitelist gate for canvasId before it is embedded into the evaluated WebGL
 * probe script (CodeQL js/bad-code-sanitization): JSON.stringify alone is not
 * a recognized sanitizer for code construction, so the selector must pass a
 * charset/length allowlist first. A rejected canvasId falls back to the
 * auto-detect path — the same outcome the embedded try/catch produced when
 * querySelector threw on an unusable selector. The probe comment no longer
 * embeds the value at all: a literal star-slash sequence in the value would
 * otherwise terminate the slash-star comment early and inject code.
 */
const MAX_PROBE_SELECTOR_LENGTH = 200;
const SAFE_PROBE_SELECTOR_RE = /^[\x20-\x7e\u00a0-\uffff]+$/;

function safeProbeSelector(canvasId: string | undefined): string | undefined {
  if (
    canvasId !== undefined &&
    canvasId.length <= MAX_PROBE_SELECTOR_LENGTH &&
    SAFE_PROBE_SELECTOR_RE.test(canvasId)
  ) {
    return canvasId;
  }
  return undefined;
}

export async function detectSkiaRenderer(
  pageController?: unknown,
  canvasId?: string,
): Promise<LegacySkiaRendererInfo> {
  if (hasEvaluate(pageController)) {
    const probeCanvasId = safeProbeSelector(canvasId);
    const webglResults = await pageController.evaluate<LegacyWebGlProbe[]>(
      `(() => {
        /* UNMASKED_RENDERER_WEBGL probe (target selector embedded below when provided) */
        const target = ${
          probeCanvasId
            ? `(function () { try { return document.querySelector(${JSON.stringify(probeCanvasId)}); } catch (err) { return null; } })()`
            : 'null'
        };
        const canvas = target && typeof target.getContext === 'function' ? target : document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) { return []; }
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = String(gl.getParameter(gl.RENDERER) || '');
        const vendor = String(gl.getParameter(gl.VENDOR) || '');
        const unmaskedRenderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') : renderer;
        const unmaskedVendor = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '') : vendor;
        const joined = (renderer + ' ' + unmaskedRenderer).toLowerCase();
        const hasSkiaBackend = joined.includes('swiftshader') || joined.includes('skia') ||
          joined.includes('angle') || joined.includes('mesa') || joined.includes('vulkan') ||
          joined.includes('metal');
        const backend = joined.includes('swiftshader') ? 'swiftshader' :
          joined.includes('angle') ? 'angle' : renderer ? 'native' : 'unknown';
        return [{ vendor, renderer, unmaskedRenderer, unmaskedVendor, hasSkiaBackend, backend }];
      })()`,
    );
    const fontProbe = await pageController.evaluate<LegacyFontProbe>(
      '(() => { /* fontBoundingBoxAscent */ return { hasSkiaFontSignatures: false, textMetrics: null }; })()',
    );
    const engineProbe = await pageController.evaluate<LegacyEngineProbe>(
      '(() => { /* window.cc window.legacyCC */ return { engines: [], isSkiaEngine: false }; })()',
    );
    return buildLegacyRendererFromProbes(webglResults, fontProbe, engineProbe);
  }

  return modernToLegacyRendererInfo(new SkiaSceneExtractor().detectSkiaRenderer());
}

export async function extractSceneTree(
  pageController?: unknown,
  canvasId?: string,
  _includeDrawCommands = true,
): Promise<LegacySkiaSceneTree> {
  if (hasEvaluate(pageController)) {
    const scene = await pageController.evaluate<LegacySceneProbe>(
      `(() => { /* drawCommands canvasMeta (selector not embedded) */ return { canvas: {}, layers: [], drawCommands: [] }; ` +
        `})()`,
    );
    const normalized = normalizeLegacyScene(scene);
    // The browser-page probe cannot actually extract a Skia scene graph (it is
    // a stub), so an empty result means "unsupported" for the active engine —
    // not a legitimately empty scene. Flag it so callers error honestly.
    if (normalized.layers.length === 0 && normalized.drawCommands.length === 0) {
      return { ...normalized, unsupported: true };
    }
    return normalized;
  }

  return modernSceneToLegacyScene(new SkiaSceneExtractor().extractSceneTree(canvasId));
}

// Export the modern scene tree type for direct use
export type { ModernSceneTree as SceneTree };
