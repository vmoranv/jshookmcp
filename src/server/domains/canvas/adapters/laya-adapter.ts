/**
 * LayaAir canvas engine adapter for JSHookMCP's canvas domain.
 *
 * Supports LayaAir 2.x and 3.x. Detection differentiates versions by presence of
 * Laya.MouseManager (2.x) vs Laya.InputManager (3.x). The dump and pick payloads are
 * self-contained JavaScript strings executed in the page context via pageController.evaluate().
 *
 * ── LayaAir 3.x verification status (B-segment audit, 2026-08-30) ─────────────
 * This adapter deliberately distinguishes paths verified against public docs
 * from paths verified only against a real LayaAir 2.8 runtime. The full table
 * lives in tests/server/domains/canvas/laya-3x-verify.test.ts (treated as a
 * living manifest); the summary is:
 *
 *   VERIFIED (docs):
 *     - detect via Laya.InputManager (3.x) / Laya.MouseManager (2.x)
 *     - clientScaleX / clientScaleY on Stage
 *     - children / _children / numChildren fallback chain
 *
 *   UNVERIFIED (real 3.x runtime required):
 *     - stage.hitTest plain {x,y} literal branch (lines below)
 *     - localToGlobal / globalToLocal argument shape on 3.x
 *     - shader pipeline / Shader registry for 3.x (relevant to canvas_dump_shaders)
 *
 *   Per lesson #51 (honest-boundary): DO NOT promote UNVERIFIED → VERIFIED
 *   without first running a real LayaAir 3.x engine test fixture.
 * ─────────────────────────────────────────────────────────────────────────────
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
 * Generates a self-contained JS string that traverses Laya.stage via DFS and
 * returns a serialisable scene tree with worldBounds computed via localToGlobal().
 *
 * @param opts - Dump options (maxDepth, onlyInteractive, onlyVisible)
 */
export function buildLayaSceneTreeDumpPayload(opts: DumpOpts): string {
  const maxDepth = opts.maxDepth ?? 20;
  const onlyInteractive = opts.onlyInteractive ?? false;
  const onlyVisible = opts.onlyVisible ?? false;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.children && node.numChildren !== undefined) return node.children;
    if (node._children) return node._children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.numChildren !== undefined) return node.numChildren;
    if (node._children) return node._children.length;
    if (node.children) return Array.isArray(node.children) ? node.children.length : 0;
    return 0;
  }

  function nodeId(node, idx) {
    if (node.id !== undefined && node.id !== null && node.id !== '') return String(node.id);
    return (node.constructor ? node.constructor.name : 'Node') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function toPt(p) {
    // LayaAir 2.8's minified transform nodes call t.setTo(x, y) on the point
    // passed to localToGlobal/globalToLocal, which throws "t.setTo is not a
    // function" for a plain {x,y} literal. Wrap in a real Laya.Point when the
    // engine exposes one; otherwise pass the literal through unchanged.
    return (window.Laya && typeof window.Laya.Point === 'function')
      ? new window.Laya.Point(p.x, p.y)
      : p;
  }

  function localToGlobalRect(node) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      var w = safeProp(node, 'width', 0);
      var h = safeProp(node, 'height', 0);
      if (node.localToGlobal) {
        // Map all four corners and take the axis-aligned bounding box. The old
        // two-corner span (0,0)→(w,h) only measured the diagonal, which collapses
        // to zero width/height for rotated nodes (e.g. a 45° square).
        var c0 = node.localToGlobal(toPt({ x: 0, y: 0 }));
        var c1 = node.localToGlobal(toPt({ x: w, y: 0 }));
        var c2 = node.localToGlobal(toPt({ x: 0, y: h }));
        var c3 = node.localToGlobal(toPt({ x: w, y: h }));
        var minX = Math.min(c0.x, c1.x, c2.x, c3.x);
        var maxX = Math.max(c0.x, c1.x, c2.x, c3.x);
        var minY = Math.min(c0.y, c1.y, c2.y, c3.y);
        var maxY = Math.max(c0.y, c1.y, c2.y, c3.y);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0), width: w, height: h };
    } catch(e) {
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0),
               width: safeProp(node, 'width', 0), height: safeProp(node, 'height', 0) };
    }
  }

  var totalNodes = 0;

  function traverse(node, depth, path) {
    if (!node || depth > ${maxDepth}) return null;
    totalNodes++;

    var interactive = !!(safeProp(node, 'mouseEnabled', true));
    var visible = !!(safeProp(node, 'visible', true));

    if (${onlyVisible} && !visible) return null;
    if (${onlyInteractive} && !interactive) return null;

    var wb = localToGlobalRect(node);
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

    var result = {
      id: nodeId(node, 0),
      type: node.constructor ? node.constructor.name : 'Node',
      name: safeProp(node, 'name', undefined),
      visible: visible,
      interactive: interactive,
      mouseEnabled: safeProp(node, 'mouseEnabled', undefined),
      alpha: safeProp(node, 'alpha', 1),
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0),
      height: safeProp(node, 'height', 0),
      worldBounds: wb,
      path: path || nodeId(node, 0),
      customData: {
        scaleX: safeProp(node, 'scaleX', 1),
        scaleY: safeProp(node, 'scaleY', 1),
        rotation: safeProp(node, 'rotation', 0),
        pivotX: safeProp(node, 'pivotX', 0),
        pivotY: safeProp(node, 'pivotY', 0),
        mouseThrough: safeProp(node, 'mouseThrough', false),
        hitArea: !!node.hitArea,
        hitTestPrior: safeProp(node, 'hitTestPrior', undefined),
      }
    };

    if (children && children.length > 0) result.children = children;
    return result;
  }

  if (!window.Laya || !window.Laya.stage) {
    return { engine: 'LayaAir', version: window.Laya ? window.Laya.version : undefined,
             canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
             sceneTree: null, totalNodes: 0, completeness: 'partial',
             error: 'Laya.stage not found' };
  }

  var stage = window.Laya.stage;
  var layaVersion = window.Laya.version || '2.x';
  var isLaya3 = !!(window.Laya.InputManager);
  var scaleX = stage.clientScaleX !== undefined ? stage.clientScaleX : 1;
  var scaleY = stage.clientScaleY !== undefined ? stage.clientScaleY : 1;

  var canvasEl = document.querySelector('canvas');
  var canvasInfo = { width: canvasEl ? canvasEl.width : safeProp(stage, 'width', 0),
                     height: canvasEl ? canvasEl.height : safeProp(stage, 'height', 0),
                     dpr: window.devicePixelRatio || 1,
                     contextType: 'unknown' };
  if (canvasEl) {
    var gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
    canvasInfo.contextType = gl ? (gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : '2d';
  }

  var sceneTree = traverse(stage, 0, 'Laya.stage');

  return {
    engine: 'LayaAir',
    version: layaVersion,
    canvas: canvasInfo,
    sceneTree: sceneTree,
    totalNodes: totalNodes,
    completeness: 'full',
    _meta: { isLaya3: isLaya3, scaleX: scaleX, scaleY: scaleY }
  };
})()`;
}

/**
 * Generates a self-contained JS string that:
 *  1. Transforms screen coordinates → stage coordinates using clientScaleX/Y
 *  2. Runs hit test via Stage.hitTest (3.x) or recursive DFS bounds check (2.x)
 *  3. Returns all candidates sorted by depth (topmost first)
 *
 * @param opts - Pick options (x, y, canvasId)
 */
export function buildLayaHitTestPayload(opts: PickOpts): string {
  const x = opts.x;
  const y = opts.y;
  const canvasId = opts.canvasId;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.children && node.numChildren !== undefined) return node.children;
    if (node._children) return node._children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.numChildren !== undefined) return node.numChildren;
    if (node._children) return node._children.length;
    if (node.children) return Array.isArray(node.children) ? node.children.length : 0;
    return 0;
  }

  function nodeId(node, idx) {
    if (node.id !== undefined && node.id !== null && node.id !== '') return String(node.id);
    return (node.constructor ? node.constructor.name : 'Node') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function toPt(p) {
    // LayaAir 2.8's minified transform nodes call t.setTo(x, y) on the point
    // passed to localToGlobal/globalToLocal, which throws "t.setTo is not a
    // function" for a plain {x,y} literal. Wrap in a real Laya.Point when the
    // engine exposes one; otherwise pass the literal through unchanged.
    return (window.Laya && typeof window.Laya.Point === 'function')
      ? new window.Laya.Point(p.x, p.y)
      : p;
  }

  function localToGlobalRect(node) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      var w = safeProp(node, 'width', 0);
      var h = safeProp(node, 'height', 0);
      if (node.localToGlobal) {
        // Map all four corners and take the axis-aligned bounding box. The old
        // two-corner span (0,0)→(w,h) only measured the diagonal, which collapses
        // to zero width/height for rotated nodes (e.g. a 45° square).
        var c0 = node.localToGlobal(toPt({ x: 0, y: 0 }));
        var c1 = node.localToGlobal(toPt({ x: w, y: 0 }));
        var c2 = node.localToGlobal(toPt({ x: 0, y: h }));
        var c3 = node.localToGlobal(toPt({ x: w, y: h }));
        var minX = Math.min(c0.x, c1.x, c2.x, c3.x);
        var maxX = Math.max(c0.x, c1.x, c2.x, c3.x);
        var minY = Math.min(c0.y, c1.y, c2.y, c3.y);
        var maxY = Math.max(c0.y, c1.y, c2.y, c3.y);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0), width: w, height: h };
    } catch(e) {
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0),
               width: safeProp(node, 'width', 0), height: safeProp(node, 'height', 0) };
    }
  }

  function nodePath(node) {
    var parts = [];
    var cur = node;
    // A malicious page can create a parent cycle (node.parent === node, or a
    // longer loop); the visited set bounds the walk so nodePath can never hang.
    var visited = new Set();
    while (cur && cur !== window.Laya.stage && !visited.has(cur)) {
      visited.add(cur);
      var name = cur.name || nodeId(cur, 0);
      parts.unshift(name);
      cur = cur.parent;
    }
    parts.unshift('Laya.stage');
    return parts.join('/');
  }

  var sx = ${x}, sy = ${y};

  // Find the target canvas
  var canvases = Array.from(document.querySelectorAll('canvas'));
  var targetCanvas = null;
  ${
    canvasId
      ? `targetCanvas = document.getElementById(${JSON.stringify(canvasId)}) || canvases[parseInt(` +
        `${JSON.stringify(canvasId)})] || null;`
      : `
  for (var ci = canvases.length - 1; ci >= 0; ci--) {
    var r = canvases[ci].getBoundingClientRect();
    if (sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) {
      targetCanvas = canvases[ci];
      break;
    }
  }`
  }

  if (!window.Laya || !window.Laya.stage) {
    return { success: false, picked: null, candidates: [], coordinates: {
               screen: { x: sx, y: sy }, canvas: { x: 0, y: 0 } }, hitTestMethod: 'none' };
  }

  var stage = window.Laya.stage;
  var isLaya3 = !!(window.Laya.InputManager);
  var scaleX = stage.clientScaleX !== undefined ? stage.clientScaleX : 1;
  var scaleY = stage.clientScaleY !== undefined ? stage.clientScaleY : 1;

  // Screen → canvas
  var canvasX = sx, canvasY = sy;
  if (targetCanvas) {
    var rect = targetCanvas.getBoundingClientRect();
    canvasX = (sx - rect.left) * (targetCanvas.width / rect.width);
    canvasY = (sy - rect.top) * (targetCanvas.height / rect.height);
  }

  // Canvas → stage. Laya's stage.mouseX/mouseY stay 0 under CDP-driven mouse
  // moves (the engine's own event system never fires), so compute the stage
  // coordinate directly from the canvas coordinate and the client scale factor
  // instead of trusting the stale mouseX/mouseY.
  // Honest boundary: this assumes clientScaleX/Y scale the whole canvas
  // uniformly. A game that letterboxes (black bars) or pillars its stage inside
  // a differently-aspect canvas shifts the origin, so a pick that lands in a bar
  // maps to an out-of-bounds stage coordinate.
  var stageX = canvasX / (scaleX || 1);
  var stageY = canvasY / (scaleY || 1);

  var candidates = [];

  // Try engine-native hitTest first (3.x)
  var hitTestMethod = 'none';
  var enginePicked = null;

  if (isLaya3 && typeof stage.hitTest === 'function') {
    try {
      // LayaAir 3.x's stage.hitTest is called with a plain {x,y} literal, not
      // wrapped via toPt. The only real engine the harness verified is 2.8,
      // whose localToGlobal/globalToLocal need a Laya.Point; whether 3.x's
      // hitTest likewise expects a Point is unverified, so this engine path
      // deliberately skips toPt and relies on the plain literal.
      //
      // VERIFY STATUS (per lesson #51 honest-boundary): UNVERIFIED.
      // Codified in tests/server/domains/canvas/laya-3x-verify.test.ts —
      // do NOT promote to "verified" without a real LayaAir 3.x runtime
      // test that asserts the in-page payload still returns the picked node.
      // See that test's fixture suggestion for how to add the runtime test.
      var nativeHit = stage.hitTest({ x: stageX, y: stageY });
      if (nativeHit) {
        // Map the raw Laya node into a CanvasSceneNode so downstream consumers
        // (highlight, scene search) get the full contract, not a bare engine node.
        // nodeId(nativeHit, 0) pins the sibling index to 0, so two id-less nodes
        // of the same type share this id — acceptable here since path (via
        // nodePath) stays unique and id is only a hint, not a stable key.
        enginePicked = {
          id: nodeId(nativeHit, 0),
          type: nativeHit.constructor ? nativeHit.constructor.name : 'Node',
          name: safeProp(nativeHit, 'name', undefined),
          visible: !!(safeProp(nativeHit, 'visible', true)),
          interactive: !!(safeProp(nativeHit, 'mouseEnabled', true)),
          mouseEnabled: safeProp(nativeHit, 'mouseEnabled', undefined),
          alpha: safeProp(nativeHit, 'alpha', 1),
          x: safeProp(nativeHit, 'x', 0),
          y: safeProp(nativeHit, 'y', 0),
          width: safeProp(nativeHit, 'width', 0),
          height: safeProp(nativeHit, 'height', 0),
          worldBounds: localToGlobalRect(nativeHit),
          path: nodePath(nativeHit)
        };
        hitTestMethod = 'engine';
      }
    } catch(e) {}
  }

  // Recursive DFS hit test (always available; 2.x fallback for 3.x too).
  // Bounded by a depth cap (aligned with the scene-dump maxDepth default) plus
  // a visited set, so a malicious/cyclic scene graph (e.g. a node listing
  // itself in _children) can neither overflow the stack nor hang the pick.
  var hitTestMaxDepth = 20;
  var hitTestVisited = new Set();
  function hitTestDfs(node, depth, accPath) {
    if (!node || depth > hitTestMaxDepth || hitTestVisited.has(node)) return;
    hitTestVisited.add(node);
    if (!safeProp(node, 'visible', true)) return;

    var wb = localToGlobalRect(node);

    // Convert stage → node local with a single full inverse chain. Applying
    // globalToLocal at each ancestor would transform the same point repeatedly.
    // A page can override globalToLocal to throw; fall back to stage coords so
    // one bad node cannot abort the entire pick.
    var localPt = { x: stageX, y: stageY };
    if (node.globalToLocal) {
      try {
        localPt = node.globalToLocal(toPt({ x: stageX, y: stageY }));
      } catch (e) {
        localPt = { x: stageX, y: stageY };
      }
    }
    var lx = localPt.x, ly = localPt.y;

    // Bounds check in the node's own local frame (top-left origin, width ×
    // height) — never the parent-relative x/y.
    var nw = safeProp(node, 'width', 0) || (wb.width / (safeProp(node, 'scaleX', 1) || 1));
    var nh = safeProp(node, 'height', 0) || (wb.height / (safeProp(node, 'scaleY', 1) || 1));

    var inBounds = lx >= 0 && lx <= nw && ly >= 0 && ly <= nh;

    var interactive = !!(safeProp(node, 'mouseEnabled', true));

    if (inBounds && interactive) {
      var path = accPath ? accPath + '/' + nodeId(node, 0) : nodeId(node, 0);
      candidates.push({
        node: {
          id: nodeId(node, 0),
          type: node.constructor ? node.constructor.name : 'Node',
          name: safeProp(node, 'name', undefined),
          visible: !!(safeProp(node, 'visible', true)),
          interactive: interactive,
          mouseEnabled: safeProp(node, 'mouseEnabled', undefined),
          alpha: safeProp(node, 'alpha', 1),
          x: safeProp(node, 'x', 0),
          y: safeProp(node, 'y', 0),
          width: nw, height: nh,
          worldBounds: wb,
          path: path
        },
        depth: depth
      });
    }

    var nodeChildren = getChildren(node);
    // Reverse child order: the last child is drawn last and therefore topmost
    // among siblings (Laya render order = children array order). The stable
    // depth sort below preserves this reverse order within the same depth.
    for (var i = nodeChildren.length - 1; i >= 0; i--) {
      var cn = nodeChildren[i];
      if (!cn) continue;
      var childPath = accPath ? accPath + '/' + nodeId(cn, i) : nodeId(cn, i);
      hitTestDfs(cn, depth + 1, childPath);
    }
  }

  hitTestDfs(stage, 0, 'Laya.stage');

  // Use engine pick if available, otherwise topmost DFS candidate
  var picked = enginePicked;
  var finalMethod = hitTestMethod;

  if (!picked && candidates.length > 0) {
    // Sort by depth descending: deepest node first (a child always renders
    // above its parent). Same-depth siblings keep the reverse child order from
    // the DFS above because Array.sort is stable.
    candidates.sort(function(a, b) { return b.depth - a.depth; });
    picked = candidates[0].node;
    finalMethod = 'manual';
  }

  return {
    success: !!picked,
    picked: picked,
    candidates: candidates,
    coordinates: {
      screen: { x: sx, y: sy },
      canvas: { x: canvasX, y: canvasY },
      stage: { x: stageX, y: stageY }
    },
    hitTestMethod: finalMethod
  };
})()`;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

/**
 * LayaAir canvas engine adapter.
 *
 * Handles both LayaAir 2.x and 3.x. Version is resolved lazily from window.Laya.version
 * at first detect() call.
 */
export class LayaCanvasAdapter implements CanvasEngineAdapter {
  readonly id = 'laya';
  readonly engine = 'LayaAir';
  readonly version: string | undefined;

  constructor() {
    // Version is read lazily from the page at detect() time.
    this.version = undefined;
  }

  async detect(env: CanvasProbeEnv): Promise<CanvasDetection | null> {
    try {
      const result = await env.pageController.evaluate<{
        present: boolean;
        hasStage: boolean;
        version?: string;
        laya2: boolean;
        laya3: boolean;
      }>(`
        (function() {
          if (typeof window.Laya === 'undefined' || window.Laya === null) {
            return { present: false, hasStage: false, laya2: false, laya3: false };
          }
          var laya = window.Laya;
          var hasStage = !!(laya.stage);
          var laya2 = !!(laya.MouseManager);
          var laya3 = !!(laya.InputManager);
          var version = laya.version || (laya2 ? '2.x' : laya3 ? '3.x' : undefined);
          return { present: true, hasStage: hasStage, version: version,
                   laya2: laya2, laya3: laya3 };
        })()
      `);

      if (!result.present || !result.hasStage) return null;

      const evidence: string[] = ['window.Laya is defined'];
      if (result.laya2) evidence.push('Laya.MouseManager detected (LayaAir 2.x)');
      if (result.laya3) evidence.push('Laya.InputManager detected (LayaAir 3.x)');
      evidence.push('Laya.stage is present');

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
    const payload = buildLayaSceneTreeDumpPayload(opts);
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
        type: 'Stage',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: raw.canvas?.width ?? 0,
        height: raw.canvas?.height ?? 0,
        worldBounds: { x: 0, y: 0, width: raw.canvas?.width ?? 0, height: raw.canvas?.height ?? 0 },
        path: 'Laya.stage',
      },
      totalNodes: raw.totalNodes,
      completeness: raw.completeness === 'full' ? 'full' : 'partial',
    } as CanvasSceneDump;
  }

  async pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult> {
    const payload = buildLayaHitTestPayload(opts);
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
