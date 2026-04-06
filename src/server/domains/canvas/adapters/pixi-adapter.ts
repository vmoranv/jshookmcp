/**
 * PixiJS canvas engine adapter for JSHookMCP's canvas domain.
 *
 * Supports PixiJS v7 and v8. Detection checks for window.PIXI and PIXI.Application.
 * The dump and pick payloads are self-contained JavaScript strings executed in the
 * page context via pageController.evaluate().
 */
import type {
  CanvasDetection,
  CanvasEngineAdapter,
  CanvasHitTestMethod,
  CanvasPickResult,
  CanvasProbeEnv,
  CanvasSceneDump,
  CanvasSceneNode,
  DumpOpts,
  PickOpts,
} from '../types';

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Generates a self-contained JS string that traverses the PIXI scene graph via DFS
 * and returns a serialisable scene tree with worldBounds computed via getBounds().
 *
 * Handles both PIXI v7 (interactive property) and v8 (eventMode property).
 *
 * @param opts - Dump options (maxDepth, onlyInteractive, onlyVisible)
 */
export function buildPixiSceneTreeDumpPayload(opts: DumpOpts): string {
  const maxDepth = opts.maxDepth ?? 20;
  const onlyInteractive = opts.onlyInteractive ?? false;
  const onlyVisible = opts.onlyVisible ?? false;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.children && node.numChildren !== undefined) return node.children;
    if (Array.isArray(node.children)) return node.children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.numChildren !== undefined) return node.numChildren;
    if (node.children && Array.isArray(node.children)) return node.children.length;
    return 0;
  }

  function nodeId(node, idx) {
    if (node.uid !== undefined && node.uid !== null) return 'uid_' + node.uid;
    if (node._uid !== undefined && node._uid !== null) return 'uid_' + node._uid;
    if (node.id !== undefined && node.id !== null && node.id !== '') return String(node.id);
    return (node.constructor ? node.constructor.name : 'DisplayObject') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function getWorldBounds(node, stage) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      if (typeof node.getBounds === 'function') {
        var b = node.getBounds(stage);
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch(e) {}
    return {
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0) || safeProp(node, 'getBounds', { width: 0 }).width,
      height: safeProp(node, 'height', 0) || safeProp(node, 'getBounds', { height: 0 }).height
    };
  }

  var totalNodes = 0;

  function traverse(node, depth, path) {
    if (!node || depth > ${maxDepth}) return null;
    totalNodes++;

    var visible = !!(safeProp(node, 'visible', true));
    // PIXI v7 uses 'interactive', v8 uses 'eventMode'
    var interactive = !!(safeProp(node, 'interactive', false)) || !!(safeProp(node, 'eventMode', 'none') !== 'none');

    if (${onlyVisible} && !visible) return null;
    if (${onlyInteractive} && !interactive) return null;

    var numC = getNumChildren(node);
    var children = null;

    if (numC > 0) {
      children = [];
      var nodeChildren = getChildren(node);
      for (var i = 0; i < nodeChildren.length; i++) {
        var cn = nodeChildren[i];
        if (!cn) continue;
        var childPath = path ? path + '/' + nodeId(cn, i) : nodeId(cn, i);
        var sub = traverse(cn, depth + 1, childPath);
        if (sub) children.push(sub);
      }
    }

    var eventMode = safeProp(node, 'eventMode', null);
    var result = {
      id: nodeId(node, 0),
      type: node.constructor ? node.constructor.name : 'DisplayObject',
      name: safeProp(node, 'name', undefined),
      visible: visible,
      interactive: interactive,
      alpha: safeProp(node, 'alpha', 1),
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0),
      height: safeProp(node, 'height', 0),
      worldBounds: getWorldBounds(node, null),
      path: path || nodeId(node, 0),
      customData: {
        eventMode: eventMode,
        rotation: safeProp(node, 'rotation', 0),
        scaleX: safeProp(node, 'scaleX', 1),
        scaleY: safeProp(node, 'scaleY', 1),
        pivotX: safeProp(node, 'pivotX', 0),
        pivotY: safeProp(node, 'pivotY', 0),
        sortDirty: !!(node.sortDirty),
      }
    };

    if (children && children.length > 0) result.children = children;
    return result;
  }

  // Find PIXI app: scan canvas elements for _pixiApp property, or check window.__pixiApp
  var app = null;
  if (window.__pixiApp) {
    app = window.__pixiApp;
  } else {
    var canvases = document.querySelectorAll('canvas');
    for (var ci = 0; ci < canvases.length; ci++) {
      if (canvases[ci]._pixiApp) { app = canvases[ci]._pixiApp; break; }
    }
  }

  if (!app || !app.stage) {
    var pixiVersion = window.PIXI ? (window.PIXI.VERSION || window.PIXI.version) : undefined;
    return {
      engine: 'PixiJS',
      version: pixiVersion,
      canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
      error: 'PIXI.Application or stage not found'
    };
  }

  var stage = app.stage;
  var pixiVersion = window.PIXI ? (window.PIXI.VERSION || window.PIXI.version) : undefined;
  var canvasEl = app.view || null;
  var canvasInfo = {
    width: canvasEl ? (canvasEl.width || 0) : 0,
    height: canvasEl ? (canvasEl.height || 0) : 0,
    dpr: window.devicePixelRatio || 1,
    contextType: 'webgl2'
  };

  if (canvasEl) {
    var gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
    if (!gl) {
      var ctx = canvasEl.getContext('2d');
      canvasInfo.contextType = ctx ? '2d' : 'webgl';
    }
  }

  var sceneTree = traverse(stage, 0, 'PIXI.Application.stage');

  return {
    engine: 'PixiJS',
    version: pixiVersion,
    canvas: canvasInfo,
    sceneTree: sceneTree,
    totalNodes: totalNodes,
    completeness: 'full'
  };
})()`;
}

/**
 * Generates a self-contained JS string that:
 *  1. Transforms screen coordinates → canvas coordinates
 *  2. Runs hit test via Stage.hitTest() if available (PIXI v7+), or DFS with getBounds()
 *  3. Returns all candidates sorted by depth (topmost first)
 *
 * @param opts - Pick options (x, y, canvasId)
 */
export function buildPixiHitTestPayload(opts: PickOpts): string {
  const x = opts.x;
  const y = opts.y;
  const canvasId = opts.canvasId;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.children && node.numChildren !== undefined) return node.children;
    if (Array.isArray(node.children)) return node.children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.numChildren !== undefined) return node.numChildren;
    if (node.children && Array.isArray(node.children)) return node.children.length;
    return 0;
  }

  function nodeId(node, idx) {
    if (node.uid !== undefined && node.uid !== null) return 'uid_' + node.uid;
    if (node._uid !== undefined && node._uid !== null) return 'uid_' + node._uid;
    if (node.id !== undefined && node.id !== null && node.id !== '') return String(node.id);
    return (node.constructor ? node.constructor.name : 'DisplayObject') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function getWorldBounds(node, stage) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      if (typeof node.getBounds === 'function') {
        var b = node.getBounds(stage || true);
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch(e) {}
    return {
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0),
      height: safeProp(node, 'height', 0)
    };
  }

  function nodePath(node) {
    var parts = [];
    var cur = node;
    while (cur && cur.parent && cur.parent !== cur) {
      var name = cur.name || nodeId(cur, 0);
      parts.unshift(name);
      cur = cur.parent;
      if (!cur) break;
    }
    parts.unshift('PIXI.Application.stage');
    return parts.join('/');
  }

  var sx = ${x}, sy = ${y};

  // Find the target canvas
  var canvases = Array.from(document.querySelectorAll('canvas'));
  var targetCanvas = null;
  ${
    canvasId
      ? `targetCanvas = document.getElementById(${JSON.stringify(canvasId)}) || null;`
      : `
  for (var ci = canvases.length - 1; ci >= 0; ci--) {
    var r = canvases[ci].getBoundingClientRect();
    if (sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) {
      targetCanvas = canvases[ci];
      break;
    }
  }`
  }

  // Find PIXI app
  var app = null;
  if (window.__pixiApp) {
    app = window.__pixiApp;
  } else {
    for (var ci2 = 0; ci2 < canvases.length; ci2++) {
      if (canvases[ci2]._pixiApp) { app = canvases[ci2]._pixiApp; break; }
    }
  }

  if (!app || !app.stage) {
    return {
      success: false,
      picked: null,
      candidates: [],
      coordinates: { screen: { x: sx, y: sy }, canvas: { x: sx, y: sy } },
      hitTestMethod: 'none'
    };
  }

  var stage = app.stage;

  // Screen → canvas
  var canvasX = sx, canvasY = sy;
  if (targetCanvas) {
    var rect = targetCanvas.getBoundingClientRect();
    canvasX = (sx - rect.left) * ((targetCanvas.width || 1) / (rect.width || 1));
    canvasY = (sy - rect.top) * ((targetCanvas.height || 1) / (rect.height || 1));
  }

  var candidates = [];
  var hitTestMethod = 'none';
  var enginePicked = null;

  // Try engine-native hitTest first (PIXI v7+)
  if (typeof stage.hitTest === 'function') {
    try {
      var nativeHit = stage.hitTest(canvasX, canvasY);
      if (nativeHit) {
        enginePicked = nativeHit;
        hitTestMethod = 'engine';
      }
    } catch(e) {}
  }

  // Recursive DFS hit test (always available; fallback for all versions)
  function hitTestDfs(node, depth, accPath) {
    if (!node) return;
    var visible = safeProp(node, 'visible', true);
    if (!visible) return;

    var wb = getWorldBounds(node, stage);
    var lx = canvasX, ly = canvasY;

    // Convert canvas → node local using parent chain
    var cur = node;
    var screenPt = { x: canvasX, y: canvasY };
    while (cur) {
      if (typeof cur.worldTransform !== 'undefined') {
        try {
          var wt = cur.worldTransform;
          var det = wt.a * wt.d - wt.b * wt.c;
          if (Math.abs(det) > 1e-10) {
            var invX = (wt.d * screenPt.x - wt.b * screenPt.y + wt.c * wt.ty - wt.d * wt.tx) / det;
            var invY = (-wt.b * screenPt.x + wt.a * screenPt.y - wt.a * wt.ty + wt.c * wt.tx) / det;
            screenPt = { x: invX, y: invY };
          }
        } catch(e) { break; }
      }
      cur = cur.parent;
    }
    lx = screenPt.x;
    ly = screenPt.y;

    var nw = safeProp(node, 'width', 0) || wb.width;
    var nh = safeProp(node, 'height', 0) || wb.height;
    var nx = safeProp(node, 'x', 0), ny = safeProp(node, 'y', 0);
    var pivotX = safeProp(node, 'pivotX', 0), pivotY = safeProp(node, 'pivotY', 0);
    var scaleX = safeProp(node, 'scaleX', 1), scaleY = safeProp(node, 'scaleY', 1);
    var rotation = safeProp(node, 'rotation', 0);

    // Simple AABB bounds check in node local space
    var halfW = (nw * Math.abs(scaleX)) / 2;
    var halfH = (nh * Math.abs(scaleY)) / 2;
    var centerX = nx + pivotX * scaleX;
    var centerY = ny + pivotY * scaleY;

    // Apply rotation
    var cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    var rotLx = (lx - centerX) * cosR + (ly - centerY) * sinR;
    var rotLy = -(lx - centerX) * sinR + (ly - centerY) * cosR;

    var inBounds = Math.abs(rotLx) <= halfW && Math.abs(rotLy) <= halfH;

    // PIXI v7 uses 'interactive', v8 uses 'eventMode'
    var interactive = !!(safeProp(node, 'interactive', false)) ||
                      !!(safeProp(node, 'eventMode', 'none') !== 'none');

    if (inBounds && interactive) {
      var path = accPath || nodeId(node, 0);
      candidates.push({
        node: {
          id: nodeId(node, 0),
          type: node.constructor ? node.constructor.name : 'DisplayObject',
          name: safeProp(node, 'name', undefined),
          visible: visible,
          interactive: interactive,
          alpha: safeProp(node, 'alpha', 1),
          x: nx, y: ny,
          width: nw, height: nh,
          worldBounds: wb,
          path: path
        },
        depth: depth
      });
    }

    var nodeChildren = getChildren(node);
    for (var i = 0; i < nodeChildren.length; i++) {
      var cn = nodeChildren[i];
      if (!cn) continue;
      var childPath = accPath ? accPath + '/' + nodeId(cn, i) : nodeId(cn, i);
      hitTestDfs(cn, depth + 1, childPath);
    }
  }

  hitTestDfs(stage, 0, 'PIXI.Application.stage');

  // Use engine pick if available, otherwise topmost DFS candidate
  var picked = enginePicked;
  var finalMethod = hitTestMethod;

  if (!picked && candidates.length > 0) {
    candidates.sort(function(a, b) { return a.depth - b.depth; });
    picked = candidates[0].node;
    finalMethod = 'manual';
  }

  return {
    success: !!picked,
    picked: picked,
    candidates: candidates,
    coordinates: {
      screen: { x: sx, y: sy },
      canvas: { x: canvasX, y: canvasY }
    },
    hitTestMethod: finalMethod
  };
})()`;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

/**
 * PixiJS canvas engine adapter.
 *
 * Handles both PixiJS v7 (interactive) and v8 (eventMode). Version is resolved
 * lazily from window.PIXI.VERSION at detect() time.
 */
export class PixiJSCanvasAdapter implements CanvasEngineAdapter {
  readonly id = 'pixi';
  readonly engine = 'PixiJS';
  readonly version: string | undefined;

  constructor() {
    this.version = undefined;
  }

  async detect(env: CanvasProbeEnv): Promise<CanvasDetection | null> {
    try {
      const result = await env.pageController.evaluate<{
        present: boolean;
        hasApp: boolean;
        version?: string;
      }>(`
        (function() {
          if (typeof window.PIXI === 'undefined' || window.PIXI === null) {
            return { present: false, hasApp: false };
          }
          var pixi = window.PIXI;
          var hasApp = !!(pixi.Application);
          var version = pixi.VERSION || pixi.version;
          return { present: true, hasApp: hasApp, version: version };
        })()
      `);

      if (!result.present || !result.hasApp) return null;

      const evidence: string[] = ['window.PIXI detected'];
      if (result.version) evidence.push('PIXI.VERSION: ' + result.version);
      evidence.push('PIXI.Application detected');

      return {
        engine: this.engine,
        version: result.version,
        confidence: 0.95,
        evidence,
        adapterId: this.id,
      };
    } catch {
      return null;
    }
  }

  async dumpScene(env: CanvasProbeEnv, opts: DumpOpts): Promise<CanvasSceneDump> {
    const payload = buildPixiSceneTreeDumpPayload(opts);
    const raw = await env.pageController.evaluate<{
      engine: string;
      version?: string;
      canvas: { width: number; height: number; dpr: number; contextType: string };
      sceneTree: CanvasSceneNode | null;
      totalNodes: number;
      completeness: string;
      error?: string;
    }>(payload);

    return {
      engine: raw.engine,
      version: raw.version,
      canvas: raw.canvas,
      sceneTree: raw.sceneTree ?? {
        id: 'empty',
        type: 'Container',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: raw.canvas?.width ?? 0,
        height: raw.canvas?.height ?? 0,
        worldBounds: { x: 0, y: 0, width: raw.canvas?.width ?? 0, height: raw.canvas?.height ?? 0 },
        path: 'PIXI.Application.stage',
      },
      totalNodes: raw.totalNodes,
      completeness: raw.completeness === 'full' ? 'full' : 'partial',
    } as CanvasSceneDump;
  }

  async pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult> {
    const payload = buildPixiHitTestPayload(opts);
    const result = await env.pageController.evaluate<{
      success: boolean;
      picked: CanvasSceneNode | null;
      candidates: Array<{ node: CanvasSceneNode; depth: number }>;
      coordinates: {
        screen: { x: number; y: number };
        canvas: { x: number; y: number };
        stage?: { x: number; y: number };
      };
      hitTestMethod: CanvasHitTestMethod;
    }>(payload);

    return {
      success: result.success,
      picked: result.picked,
      candidates: result.candidates,
      coordinates: result.coordinates,
      hitTestMethod: result.hitTestMethod,
    } as CanvasPickResult;
  }
}
