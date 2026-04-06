/**
 * Cocos Creator canvas engine adapter for JSHookMCP's canvas domain.
 *
 * Supports Cocos Creator 2.x and 3.x. Detection differentiates versions by presence of
 * cc.Scene (3.x) vs cc.Node-based scene graphs (2.x). The dump and pick payloads are
 * self-contained JavaScript strings executed in the page context via pageController.evaluate().
 *
 * Key difference from other engines: Cocos Creator uses a bottom-left origin coordinate
 * system, so pickAt must flip the Y axis (y = canvas.height - y).
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
 * Generates a self-contained JS string that traverses the Cocos Creator scene graph
 * via cc.director.getScene() using DFS and returns a serialisable scene tree.
 *
 * Supports both v2 (cc.Node._children) and v3 (cc.Node.children) APIs.
 * World bounds are computed from worldPosition + contentSize (v3) or getBoundingBox() (v2).
 *
 * @param opts - Dump options (maxDepth, onlyInteractive, onlyVisible)
 */
export function buildCocosSceneTreeDumpPayload(opts: DumpOpts): string {
  const maxDepth = opts.maxDepth ?? 20;
  const onlyInteractive = opts.onlyInteractive ?? false;
  const onlyVisible = opts.onlyVisible ?? false;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    // v3 uses node.children, v2 uses node._children
    if (node.children && Array.isArray(node.children)) return node.children;
    if (node._children && Array.isArray(node._children)) return node._children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.children && typeof node.children.length === 'number') return node.children.length;
    if (node._children && typeof node._children.length === 'number') return node._children.length;
    return 0;
  }

  // Determine if we are on Cocos v3 (has cc.Scene) vs v2
  var isV3 = !!(window.cc && window.cc.Scene);

  // Cocos v3 node properties
  function getNodeId(node, idx) {
    try {
      if (node.uuid !== undefined && node.uuid !== null && node.uuid !== '') return String(node.uuid);
    } catch(e) {}
    try {
      if (node._uuid !== undefined && node._uuid !== null && node._uuid !== '') return String(node._uuid);
    } catch(e) {}
    return (node.constructor ? node.constructor.name : 'Node') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function getWorldBounds(node) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      if (isV3) {
        // v3: use worldPosition + contentSize
        var wp = node.worldPosition;
        var cs = node.contentSize;
        if (wp && cs) {
          return {
            x: wp.x - (cs.width / 2),
            y: wp.y - (cs.height / 2),
            width: cs.width,
            height: cs.height
          };
        }
        // fallback: use position + scale + contentSize
        var pos = node.position;
        var sx = safeProp(node, 'scaleX', 1);
        var sy = safeProp(node, 'scaleY', 1);
        var w = cs ? cs.width : safeProp(node, 'width', 0);
        var h = cs ? cs.height : safeProp(node, 'height', 0);
        return {
          x: pos ? pos.x : safeProp(node, 'x', 0),
          y: pos ? pos.y : safeProp(node, 'y', 0),
          width: Math.abs(w * sx),
          height: Math.abs(h * sy)
        };
      } else {
        // v2: use getBoundingBox()
        if (typeof node.getBoundingBox === 'function') {
          var bb = node.getBoundingBox();
          if (bb) return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
        }
        // v2 fallback
        var px = safeProp(node, 'x', 0) || 0;
        var py = safeProp(node, 'y', 0) || 0;
        var sx2 = safeProp(node, 'scaleX', 1);
        var sy2 = safeProp(node, 'scaleY', 1);
        var w2 = safeProp(node, '_contentSize') && safeProp(node._contentSize, 'width', 0) || safeProp(node, 'width', 0);
        var h2 = safeProp(node, '_contentSize') && safeProp(node._contentSize, 'height', 0) || safeProp(node, 'height', 0);
        return {
          x: px, y: py,
          width: Math.abs(w2 * sx2),
          height: Math.abs(h2 * sy2)
        };
      }
    } catch(e) {
      return {
        x: safeProp(node, 'x', 0),
        y: safeProp(node, 'y', 0),
        width: safeProp(node, 'width', 0) || 0,
        height: safeProp(node, 'height', 0) || 0
      };
    }
  }

  function isInteractive(node) {
    try {
      // v3: check for Button component or _eventMask
      if (isV3) {
        var comps = node.components;
        if (comps && Array.isArray(comps)) {
          for (var ci = 0; ci < comps.length; ci++) {
            var c = comps[ci];
            if (c && c.constructor && (c.constructor.name === 'Button' || c.constructor.name === 'UICanvas' || c.constructor.name === 'Sprite')) {
              return true;
            }
          }
        }
        if (node._eventMask !== undefined) return !!(node._eventMask & 1);
      } else {
        // v2: check mouseEnabled
        return !!(safeProp(node, 'mouseEnabled', true));
      }
    } catch(e) {}
    return !!(safeProp(node, 'mouseEnabled', true));
  }

  function getActive(node) {
    if (isV3) {
      return !!(safeProp(node, 'active', true));
    } else {
      return !!(safeProp(node, '_active', true));
    }
  }

  function getName(node) {
    if (isV3) {
      return safeProp(node, 'name', undefined);
    } else {
      return safeProp(node, '_name', undefined);
    }
  }

  function getPosition(node) {
    if (isV3) {
      var p = node.position;
      if (p && typeof p.x === 'number') return { x: p.x, y: p.y };
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0) };
    } else {
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0) };
    }
  }

  function getScale(node) {
    return {
      x: safeProp(node, 'scaleX', 1),
      y: safeProp(node, 'scaleY', 1)
    };
  }

  function getRotation(node) {
    if (isV3) {
      return {
        x: safeProp(node, 'rotationX', 0),
        y: safeProp(node, 'rotationY', 0),
        z: safeProp(node, 'rotation', 0)
      };
    } else {
      return {
        x: safeProp(node, 'rotationX', 0),
        y: safeProp(node, 'rotationY', 0),
        z: safeProp(node, 'rotation', 0)
      };
    }
  }

  function getType(node) {
    if (isV3) {
      return node.constructor ? node.constructor.name : 'Node';
    } else {
      // v2: use _className if available
      return safeProp(node, '_className', node.constructor ? node.constructor.name : 'Node');
    }
  }

  var totalNodes = 0;

  function traverse(node, depth, path) {
    if (!node || depth > ${maxDepth}) return null;
    totalNodes++;

    var active = getActive(node);
    var interactive = isInteractive(node);
    var visible = active;

    if (${onlyVisible} && !visible) return null;
    if (${onlyInteractive} && !interactive) return null;

    var wb = getWorldBounds(node);
    var pos = getPosition(node);
    var scale = getScale(node);
    var rot = getRotation(node);
    var numC = getNumChildren(node);
    var children = null;

    if (numC > 0) {
      children = [];
      var nodeChildren = getChildren(node);
      for (var i = 0; i < nodeChildren.length; i++) {
        var cn = nodeChildren[i];
        if (!cn) continue;
        var childPath = path ? path + '/' + getNodeId(cn, i) : getNodeId(cn, i);
        var sub = traverse(cn, depth + 1, childPath);
        if (sub) children.push(sub);
      }
    }

    var alpha = safeProp(node, 'opacity', 1);
    if (alpha === undefined || alpha === null) alpha = safeProp(node, 'alpha', 1);

    var width = safeProp(node, 'width', 0) || 0;
    var height = safeProp(node, 'height', 0) || 0;
    if (isV3 && node.contentSize) {
      width = safeProp(node.contentSize, 'width', 0) || width;
      height = safeProp(node.contentSize, 'height', 0) || height;
    } else if (!isV3 && node._contentSize) {
      width = safeProp(node._contentSize, 'width', 0) || width;
      height = safeProp(node._contentSize, 'height', 0) || height;
    }

    var result = {
      id: getNodeId(node, 0),
      type: getType(node),
      name: getName(node),
      visible: visible,
      interactive: interactive,
      alpha: alpha,
      x: pos.x,
      y: pos.y,
      width: width,
      height: height,
      worldBounds: wb,
      path: path || getNodeId(node, 0),
      customData: {
        scaleX: scale.x,
        scaleY: scale.y,
        rotationX: rot.x,
        rotationY: rot.y,
        rotation: rot.z,
        active: active,
        parent: node.parent ? getNodeId(node.parent, -1) : null,
      }
    };

    if (children && children.length > 0) result.children = children;
    return result;
  }

  if (!window.cc || !window.cc.director) {
    return {
      engine: 'CocosCreator',
      version: window.cc && window.cc.ENGINE_VERSION ? window.cc.ENGINE_VERSION : undefined,
      canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
      error: 'cc.director not found'
    };
  }

  var scene = window.cc.director.getScene ? window.cc.director.getScene() : null;

  var canvasEl = document.querySelector('canvas');
  var cocosVersion = window.cc.ENGINE_VERSION || (isV3 ? '3.x' : '2.x');
  var canvasInfo = {
    width: canvasEl ? canvasEl.width : safeProp(scene, 'width', 0) || 0,
    height: canvasEl ? canvasEl.height : safeProp(scene, 'height', 0) || 0,
    dpr: window.devicePixelRatio || 1,
    contextType: 'unknown'
  };
  if (canvasEl) {
    var gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
    canvasInfo.contextType = gl ? (gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : '2d';
  }

  var sceneTree = scene ? traverse(scene, 0, 'cc.director.getScene()') : null;

  return {
    engine: 'CocosCreator',
    version: cocosVersion,
    canvas: canvasInfo,
    sceneTree: sceneTree,
    totalNodes: totalNodes,
    completeness: sceneTree ? 'full' : 'partial',
    _meta: { isV3: isV3 }
  };
})()`;
}

/**
 * Generates a self-contained JS string that:
 *  1. Transforms screen coordinates → canvas coordinates
 *  2. Flips Y axis (Cocos uses bottom-left origin, browser uses top-left)
 *  3. Runs hit test via engine (v3) or recursive DFS bounds check (v2 / fallback)
 *  4. Returns all candidates sorted by depth (topmost first)
 *
 * @param opts - Pick options (x, y, canvasId)
 */
export function buildCocosHitTestPayload(opts: PickOpts): string {
  const x = opts.x;
  const y = opts.y;
  const canvasId = opts.canvasId;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.children && Array.isArray(node.children)) return node.children;
    if (node._children && Array.isArray(node._children)) return node._children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.children && typeof node.children.length === 'number') return node.children.length;
    if (node._children && typeof node._children.length === 'number') return node._children.length;
    return 0;
  }

  function getNodeId(node, idx) {
    try {
      if (node.uuid !== undefined && node.uuid !== null && node.uuid !== '') return String(node.uuid);
    } catch(e) {}
    try {
      if (node._uuid !== undefined && node._uuid !== null && node._uuid !== '') return String(node._uuid);
    } catch(e) {}
    return (node.constructor ? node.constructor.name : 'Node') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function getWorldBounds(node) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      var isV3 = !!(window.cc && window.cc.Scene);
      if (isV3) {
        var wp = node.worldPosition;
        var cs = node.contentSize;
        if (wp && cs) {
          return {
            x: wp.x - (cs.width / 2),
            y: wp.y - (cs.height / 2),
            width: cs.width,
            height: cs.height
          };
        }
        var pos = node.position;
        var sx = safeProp(node, 'scaleX', 1);
        var sy = safeProp(node, 'scaleY', 1);
        var w = cs ? cs.width : safeProp(node, 'width', 0);
        var h = cs ? cs.height : safeProp(node, 'height', 0);
        return {
          x: pos ? pos.x : safeProp(node, 'x', 0),
          y: pos ? pos.y : safeProp(node, 'y', 0),
          width: Math.abs(w * sx),
          height: Math.abs(h * sy)
        };
      } else {
        if (typeof node.getBoundingBox === 'function') {
          var bb = node.getBoundingBox();
          if (bb) return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
        }
        var px = safeProp(node, 'x', 0) || 0;
        var py = safeProp(node, 'y', 0) || 0;
        var sx2 = safeProp(node, 'scaleX', 1);
        var sy2 = safeProp(node, 'scaleY', 1);
        var w2 = safeProp(node, '_contentSize') ? safeProp(node._contentSize, 'width', 0) : safeProp(node, 'width', 0);
        var h2 = safeProp(node, '_contentSize') ? safeProp(node._contentSize, 'height', 0) : safeProp(node, 'height', 0);
        return {
          x: px, y: py,
          width: Math.abs(w2 * sx2),
          height: Math.abs(h2 * sy2)
        };
      }
    } catch(e) {
      return {
        x: safeProp(node, 'x', 0),
        y: safeProp(node, 'y', 0),
        width: safeProp(node, 'width', 0) || 0,
        height: safeProp(node, 'height', 0) || 0
      };
    }
  }

  function isInteractive(node) {
    try {
      var isV3 = !!(window.cc && window.cc.Scene);
      if (isV3) {
        var comps = node.components;
        if (comps && Array.isArray(comps)) {
          for (var ci = 0; ci < comps.length; ci++) {
            var c = comps[ci];
            if (c && c.constructor && (c.constructor.name === 'Button' || c.constructor.name === 'Sprite')) {
              return true;
            }
          }
        }
        if (node._eventMask !== undefined) return !!(node._eventMask & 1);
      } else {
        return !!(safeProp(node, 'mouseEnabled', true));
      }
    } catch(e) {}
    return !!(safeProp(node, 'mouseEnabled', true));
  }

  function getActive(node) {
    var isV3 = !!(window.cc && window.cc.Scene);
    if (isV3) return !!(safeProp(node, 'active', true));
    return !!(safeProp(node, '_active', true));
  }

  function getName(node) {
    var isV3 = !!(window.cc && window.cc.Scene);
    if (isV3) return safeProp(node, 'name', undefined);
    return safeProp(node, '_name', undefined);
  }

  function getPosition(node) {
    var isV3 = !!(window.cc && window.cc.Scene);
    if (isV3) {
      var p = node.position;
      if (p && typeof p.x === 'number') return { x: p.x, y: p.y };
      return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0) };
    }
    return { x: safeProp(node, 'x', 0), y: safeProp(node, 'y', 0) };
  }

  function getType(node) {
    var isV3 = !!(window.cc && window.cc.Scene);
    if (isV3) return node.constructor ? node.constructor.name : 'Node';
    return safeProp(node, '_className', node.constructor ? node.constructor.name : 'Node');
  }

  function nodePath(node) {
    var parts = [];
    var cur = node;
    var scene = window.cc && window.cc.director ? window.cc.director.getScene() : null;
    while (cur && cur !== scene) {
      var name = getName(cur) || getNodeId(cur, 0);
      parts.unshift(name);
      cur = cur.parent;
    }
    parts.unshift('cc.director.getScene()');
    return parts.join('/');
  }

  var sx = ${x}, sy = ${y};

  // Find the target canvas
  var canvases = Array.from(document.querySelectorAll('canvas'));
  var targetCanvas = null;
  ${
    canvasId
      ? `targetCanvas = document.getElementById(${JSON.stringify(canvasId)}) || canvases[parseInt(${JSON.stringify(canvasId)})] || null;`
      : `
  for (var ci = canvases.length - 1; ci >= 0; ci--) {
    var r = canvases[ci].getBoundingClientRect();
    if (sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) {
      targetCanvas = canvases[ci];
      break;
    }
  }`
  }

  if (!window.cc || !window.cc.director) {
    return {
      success: false, picked: null, candidates: [], coordinates: {
        screen: { x: sx, y: sy }, canvas: { x: 0, y: 0 }
      },
      hitTestMethod: 'none'
    };
  }

  var canvasWidth = targetCanvas ? targetCanvas.width : 1920;
  var canvasHeight = targetCanvas ? targetCanvas.height : 1080;

  // Screen → canvas (CSS pixels to canvas pixels)
  var canvasX = sx, canvasY = sy;
  if (targetCanvas) {
    var rect = targetCanvas.getBoundingClientRect();
    canvasX = (sx - rect.left) * (targetCanvas.width / rect.width);
    canvasY = (sy - rect.top) * (targetCanvas.height / rect.height);
  }

  // Canvas → Cocos: FLIP Y because Cocos uses bottom-left origin
  var cocosX = canvasX;
  var cocosY = canvasHeight - canvasY;

  var scene = window.cc.director.getScene ? window.cc.director.getScene() : null;
  var candidates = [];
  var hitTestMethod = 'none';
  var enginePicked = null;

  // Try v3 native hitTest via cc.Node.EventListener.POSITION
  if (scene && typeof scene.hitTest === 'function') {
    try {
      var nativeHit = scene.hitTest({ x: cocosX, y: cocosY });
      if (nativeHit) {
        enginePicked = nativeHit;
        hitTestMethod = 'engine';
      }
    } catch(e) {}
  }

  // Recursive DFS hit test — always available
  function hitTestDfs(node, depth, accPath) {
    if (!node) return;

    var active = getActive(node);
    if (!active) return;

    var wb = getWorldBounds(node);

    // Convert screen coordinates to node local
    var cur = node;
    var screenPt = { x: sx, y: sy };
    while (cur) {
      if (cur.globalToLocal) {
        try { screenPt = cur.globalToLocal(screenPt); } catch(e) { break; }
      }
      cur = cur.parent;
    }
    var lx = screenPt.x, ly = screenPt.y;

    var pos = getPosition(node);
    var nx = pos.x, ny = pos.y;
    var sx2 = safeProp(node, 'scaleX', 1);
    var sy2 = safeProp(node, 'scaleY', 1);
    var w = safeProp(node, 'width', 0) || wb.width;
    var h = safeProp(node, 'height', 0) || wb.height;

    var inBounds = lx >= nx && lx <= nx + w * Math.abs(sx2) &&
                   ly >= ny && ly <= ny + h * Math.abs(sy2);

    var interactive = isInteractive(node);

    if (inBounds && interactive) {
      var path = accPath || getNodeId(node, 0);
      var alpha = safeProp(node, 'opacity', 1);
      if (alpha === undefined) alpha = safeProp(node, 'alpha', 1);

      candidates.push({
        node: {
          id: getNodeId(node, 0),
          type: getType(node),
          name: getName(node),
          visible: active,
          interactive: interactive,
          alpha: alpha,
          x: nx, y: ny,
          width: w * Math.abs(sx2),
          height: h * Math.abs(sy2),
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
      var childPath = accPath ? accPath + '/' + getNodeId(cn, i) : getNodeId(cn, i);
      hitTestDfs(cn, depth + 1, childPath);
    }
  }

  if (scene) hitTestDfs(scene, 0, 'cc.director.getScene()');

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
      canvas: { x: canvasX, y: canvasY },
      stage: { x: cocosX, y: cocosY }
    },
    hitTestMethod: finalMethod
  };
})()`;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

/**
 * Cocos Creator canvas engine adapter.
 *
 * Handles both Cocos Creator 2.x and 3.x. Version is resolved from cc.ENGINE_VERSION
 * at detect() time.
 */
export class CocosCanvasAdapter implements CanvasEngineAdapter {
  readonly id = 'cocos';
  readonly engine = 'CocosCreator';
  readonly version: string | undefined;

  constructor() {
    this.version = undefined;
  }

  async detect(env: CanvasProbeEnv): Promise<CanvasDetection | null> {
    try {
      const result = await env.pageController.evaluate<{
        present: boolean;
        hasDirector: boolean;
        version?: string;
        versionMajor?: number;
      }>(`
        (function() {
          if (typeof window.cc === 'undefined' || window.cc === null) {
            return { present: false, hasDirector: false };
          }
          var cocos = window.cc;
          var hasDirector = !!(cocos.director);
          var isV3 = !!(cocos.Scene);
          var versionStr = cocos.ENGINE_VERSION || (isV3 ? '3.x' : '2.x');
          var major = isV3 ? 3 : 2;
          return {
            present: true,
            hasDirector: hasDirector,
            version: versionStr,
            versionMajor: major
          };
        })()
      `);

      if (!result.present || !result.hasDirector) return null;

      const evidence: string[] = ['window.cc detected', 'cc.director present'];
      if (result.versionMajor === 2) {
        evidence.push('Cocos Creator v2 API');
      } else if (result.versionMajor === 3) {
        evidence.push('Cocos Creator v3 API');
      }

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
    const payload = buildCocosSceneTreeDumpPayload(opts);
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
        type: 'Scene',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: raw.canvas?.width ?? 0,
        height: raw.canvas?.height ?? 0,
        worldBounds: { x: 0, y: 0, width: raw.canvas?.width ?? 0, height: raw.canvas?.height ?? 0 },
        path: 'cc.director.getScene()',
      },
      totalNodes: raw.totalNodes,
      completeness: raw.completeness === 'full' ? 'full' : 'partial',
    } as CanvasSceneDump;
  }

  async pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult> {
    const payload = buildCocosHitTestPayload(opts);
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
