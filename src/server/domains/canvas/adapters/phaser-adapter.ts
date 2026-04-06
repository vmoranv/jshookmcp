/**
 * Phaser canvas engine adapter for JSHookMCP's canvas domain.
 *
 * Supports Phaser 3.x. Detection checks window.Phaser and Phaser.GAMES.length.
 * The dump and pick payloads are self-contained JavaScript strings executed in
 * the page context via pageController.evaluate().
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
 * Generates a self-contained JS string that traverses Phaser scenes via DFS and
 * returns a serialisable scene tree with worldBounds computed via getBounds().
 *
 * @param opts - Dump options (maxDepth, onlyInteractive, onlyVisible)
 */
export function buildPhaserSceneTreeDumpPayload(opts: DumpOpts): string {
  const maxDepth = opts.maxDepth ?? 20;
  const onlyInteractive = opts.onlyInteractive ?? false;
  const onlyVisible = opts.onlyVisible ?? false;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.list && Array.isArray(node.list)) return node.list;
    if (node.children && Array.isArray(node.children)) return node.children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.list) return node.list.length;
    if (node.numChildren !== undefined) return node.numChildren;
    if (node.children && Array.isArray(node.children)) return node.children.length;
    return 0;
  }

  function nodeId(node, idx) {
    if (node.id !== undefined && node.id !== null && node.id !== '') return String(node.id);
    return (node.constructor ? node.constructor.name : 'DisplayObject') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function nodeBounds(node) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      if (typeof node.getBounds === 'function') {
        var b = node.getBounds();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch(e) {}
    return {
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0) || safeProp(node, 'displayWidth', 0),
      height: safeProp(node, 'height', 0) || safeProp(node, 'displayHeight', 0),
    };
  }

  var totalNodes = 0;

  function traverse(node, depth, path) {
    if (!node || depth > ${maxDepth}) return null;
    totalNodes++;

    var interactive = !!(node.input && node.input.enabled);
    var visible = !!(safeProp(node, 'visible', true));

    if (${onlyVisible} && !visible) return null;
    if (${onlyInteractive} && !interactive) return null;

    var wb = nodeBounds(node);
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
      type: node.constructor ? node.constructor.name : 'DisplayObject',
      name: safeProp(node, 'name', undefined),
      visible: visible,
      interactive: interactive,
      alpha: safeProp(node, 'alpha', 1),
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0) || safeProp(node, 'displayWidth', 0),
      height: safeProp(node, 'height', 0) || safeProp(node, 'displayHeight', 0),
      worldBounds: wb,
      path: path || nodeId(node, 0),
    };

    if (children && children.length > 0) result.children = children;
    return result;
  }

  if (typeof window.Phaser === 'undefined' || !window.Phaser.GAMES || window.Phaser.GAMES.length === 0) {
    return { engine: 'Phaser',
             version: typeof window.Phaser !== 'undefined' ? window.Phaser.VERSION : undefined,
             canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
             sceneTree: null, totalNodes: 0, completeness: 'partial',
             error: 'Phaser.GAMES has no entries' };
  }

  var game = window.Phaser.GAMES[0];
  if (!game || !game.scene || !game.canvas) {
    return { engine: 'Phaser',
             version: window.Phaser.VERSION || undefined,
             canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
             sceneTree: null, totalNodes: 0, completeness: 'partial',
             error: 'Game or canvas not accessible' };
  }

  var canvasEl = game.canvas;
  var dpr = window.devicePixelRatio || 1;
  var gl = null;
  try { gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl'); } catch(e) {}
  var contextType = '2d';
  if (gl) contextType = gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl';

  var canvasInfo = {
    width: canvasEl.width || safeProp(game.scale, 'width', 0),
    height: canvasEl.height || safeProp(game.scale, 'height', 0),
    dpr: dpr,
    contextType: contextType,
  };

  var sceneTree = null;
  var scenes = game.scene ? game.scene.scenes : [];

  if (scenes && scenes.length > 0) {
    for (var si = 0; si < scenes.length; si++) {
      var sc = scenes[si];
      if (!sc || !sc.sys) continue;
      var status = safeProp(sc.sys, 'settings', {}).status;
      // Only process active scenes (Phaser 3.x status: 0=init,1=start,2=loading,3=created,4=shutdown)
      if (status !== undefined && status !== 4) {
        var displayList = sc.sys && sc.sys.displayList;
        if (displayList) {
          var scenePath = 'Phaser.Game.scenes[' + si + ']';
          sceneTree = traverse(displayList, 0, scenePath);
        }
        break;
      }
    }
  }

  return {
    engine: 'Phaser',
    version: window.Phaser.VERSION || undefined,
    canvas: canvasInfo,
    sceneTree: sceneTree,
    totalNodes: totalNodes,
    completeness: sceneTree ? 'full' : 'partial',
  };
})()`;
}

/**
 * Generates a self-contained JS string that:
 *  1. Transforms screen coordinates to canvas coordinates
 *  2. Runs hit test via scene.input.hitTestPointer() (Phaser's native method)
 *  3. Falls back to recursive bounds check using getBounds() / getTopLeft/getBottomRight
 *  4. Returns all candidates sorted by depth (topmost first)
 *
 * @param opts - Pick options (x, y, canvasId)
 */
export function buildPhaserHitTestPayload(opts: PickOpts): string {
  const x = opts.x;
  const y = opts.y;
  const canvasId = opts.canvasId;

  return `(function() {
  function getChildren(node) {
    if (!node) return [];
    if (node.list && Array.isArray(node.list)) return node.list;
    if (node.children && Array.isArray(node.children)) return node.children;
    return [];
  }

  function getNumChildren(node) {
    if (!node) return 0;
    if (node.list) return node.list.length;
    if (node.numChildren !== undefined) return node.numChildren;
    if (node.children && Array.isArray(node.children)) return node.children.length;
    return 0;
  }

  function nodeId(node, idx) {
    if (node.id !== undefined && node.id !== null && node.id !== '') return String(node.id);
    return (node.constructor ? node.constructor.name : 'DisplayObject') + '_' + idx;
  }

  function safeProp(node, key, fallback) {
    try { var v = node[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function nodeBounds(node) {
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    try {
      if (typeof node.getBounds === 'function') {
        var b = node.getBounds();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch(e) {}
    return {
      x: safeProp(node, 'x', 0),
      y: safeProp(node, 'y', 0),
      width: safeProp(node, 'width', 0) || safeProp(node, 'displayWidth', 0),
      height: safeProp(node, 'height', 0) || safeProp(node, 'displayHeight', 0),
    };
  }

  function nodePath(node, sceneIdx) {
    var parts = [];
    var cur = node;
    while (cur) {
      var name = cur.name || nodeId(cur, 0);
      parts.unshift(name);
      cur = cur.parent;
    }
    return 'Phaser.Game.scenes[' + sceneIdx + ']/' + parts.join('/');
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

  if (typeof window.Phaser === 'undefined' || !window.Phaser.GAMES || window.Phaser.GAMES.length === 0) {
    return { success: false, picked: null, candidates: [], coordinates: {
               screen: { x: sx, y: sy }, canvas: { x: 0, y: 0 } }, hitTestMethod: 'none' };
  }

  var game = window.Phaser.GAMES[0];
  var canvasX = sx, canvasY = sy;
  if (targetCanvas) {
    var rect = targetCanvas.getBoundingClientRect();
    canvasX = (sx - rect.left) * (targetCanvas.width / rect.width);
    canvasY = (sy - rect.top) * (targetCanvas.height / rect.height);
  }

  var candidates = [];
  var hitTestMethod = 'none';
  var enginePicked = null;
  var sceneIdx = 0;

  // Try engine-native hit test via scene.input.hitTestPointer
  if (game && game.scene && game.scene.scenes) {
    var scenes = game.scene.scenes;
    for (var si = 0; si < scenes.length; si++) {
      var sc = scenes[si];
      if (!sc || !sc.sys) continue;
      var status = safeProp(sc.sys, 'settings', {}).status;
      if (status !== undefined && status !== 4) {
        // Scene is active
        if (sc.input && typeof sc.input.hitTestPointer === 'function') {
          try {
            var nativeHit = sc.input.hitTestPointer({ x: canvasX, y: canvasY });
            if (nativeHit && nativeHit.length > 0) {
              enginePicked = nativeHit[0];
              hitTestMethod = 'engine';
              sceneIdx = si;
            }
          } catch(e) {}
        }
        break;
      }
    }
  }

  // Recursive DFS fallback bounds check
  function hitTestDfs(node, depth, accPath) {
    if (!node || !safeProp(node, 'visible', true)) return;

    var wb = nodeBounds(node);

    // Convert screen → node local using parent chain
    var cur = node;
    var screenPt = { x: sx, y: sy };
    while (cur) {
      if (cur.globalToLocal) {
        try { screenPt = cur.globalToLocal(screenPt); } catch(e) { break; }
      }
      cur = cur.parent;
    }
    var lx = screenPt.x, ly = screenPt.y;

    var nw = safeProp(node, 'width', 0) || safeProp(node, 'displayWidth', 0) || wb.width;
    var nh = safeProp(node, 'height', 0) || safeProp(node, 'displayHeight', 0) || wb.height;
    var nx = safeProp(node, 'x', 0), ny = safeProp(node, 'y', 0);
    var pivotX = safeProp(node, 'pivotX', 0), pivotY = safeProp(node, 'pivotY', 0);

    var inBounds = lx >= nx - pivotX && lx <= nx - pivotX + nw &&
                   ly >= ny - pivotY && ly <= ny - pivotY + nh;

    var interactive = !!(node.input && node.input.enabled);

    if (inBounds && interactive) {
      var path = accPath || nodePath(node, sceneIdx);
      candidates.push({
        node: {
          id: nodeId(node, 0),
          type: node.constructor ? node.constructor.name : 'DisplayObject',
          name: safeProp(node, 'name', undefined),
          visible: !!(safeProp(node, 'visible', true)),
          interactive: interactive,
          alpha: safeProp(node, 'alpha', 1),
          x: nx, y: ny,
          width: nw, height: nh,
          worldBounds: wb,
          path: path,
        },
        depth: depth
      });
    }

    var nodeChildren = getChildren(node);
    for (var i = 0; i < nodeChildren.length; i++) {
      var cn = nodeChildren[i];
      if (!cn) continue;
      var childPath = accPath ? accPath + '/' + nodeId(cn, i) : nodePath(cn, sceneIdx);
      hitTestDfs(cn, depth + 1, childPath);
    }
  }

  // Traverse displayList for manual hit test
  if (game && game.scene && game.scene.scenes) {
    var scenes2 = game.scene.scenes;
    for (var sj = 0; sj < scenes2.length; sj++) {
      var scj = scenes2[sj];
      if (!scj || !scj.sys) continue;
      var statusj = safeProp(scj.sys, 'settings', {}).status;
      if (statusj !== undefined && statusj !== 4) {
        sceneIdx = sj;
        var displayList = scj.sys && scj.sys.displayList;
        if (displayList) {
          hitTestDfs(displayList, 0, 'Phaser.Game.scenes[' + sj + ']');
        }
        break;
      }
    }
  }

  // Use engine pick if available, otherwise topmost DFS candidate
  var picked = enginePicked ? {
    id: enginePicked.id !== undefined ? String(enginePicked.id) : nodeId(enginePicked, 0),
    type: enginePicked.constructor ? enginePicked.constructor.name : 'DisplayObject',
    name: safeProp(enginePicked, 'name', undefined),
    visible: !!(safeProp(enginePicked, 'visible', true)),
    interactive: !!(enginePicked.input && enginePicked.input.enabled),
    alpha: safeProp(enginePicked, 'alpha', 1),
    x: safeProp(enginePicked, 'x', 0),
    y: safeProp(enginePicked, 'y', 0),
    width: safeProp(enginePicked, 'width', 0) || safeProp(enginePicked, 'displayWidth', 0),
    height: safeProp(enginePicked, 'height', 0) || safeProp(enginePicked, 'displayHeight', 0),
    worldBounds: nodeBounds(enginePicked),
    path: 'Phaser.Game.scenes[' + sceneIdx + ']/hit',
  } : null;

  if (!picked && candidates.length > 0) {
    candidates.sort(function(a, b) { return a.depth - b.depth; });
    picked = candidates[0].node;
    hitTestMethod = 'manual';
  }

  return {
    success: !!picked,
    picked: picked,
    candidates: candidates,
    coordinates: {
      screen: { x: sx, y: sy },
      canvas: { x: canvasX, y: canvasY },
    },
    hitTestMethod: hitTestMethod
  };
})()`;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

/**
 * Phaser 3.x canvas engine adapter.
 *
 * Detection checks window.Phaser and Phaser.GAMES.length > 0.
 * dumpScene() traverses Phaser.GAMES[0].scene.scenes active scenes.
 * pickAt() uses scene.input.hitTestPointer() with recursive DFS fallback.
 */
export class PhaserCanvasAdapter implements CanvasEngineAdapter {
  readonly id = 'phaser';
  readonly engine = 'Phaser';
  readonly version: string | undefined;

  constructor() {
    this.version = undefined;
  }

  async detect(env: CanvasProbeEnv): Promise<CanvasDetection | null> {
    try {
      const result = await env.pageController.evaluate<{
        present: boolean;
        hasGames: boolean;
        version?: string;
      }>(`
        (function() {
          if (typeof window.Phaser === 'undefined' || window.Phaser === null) {
            return { present: false, hasGames: false };
          }
          var hasGames = !!(window.Phaser.GAMES && window.Phaser.GAMES.length > 0);
          return {
            present: true,
            hasGames: hasGames,
            version: window.Phaser.VERSION || undefined,
          };
        })()
      `);

      if (!result.present || !result.hasGames) return null;

      const evidence: string[] = ['window.Phaser detected'];
      evidence.push('Phaser.GAMES has entries');

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
    const payload = buildPhaserSceneTreeDumpPayload(opts);
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
        type: 'Game',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: raw.canvas?.width ?? 0,
        height: raw.canvas?.height ?? 0,
        worldBounds: { x: 0, y: 0, width: raw.canvas?.width ?? 0, height: raw.canvas?.height ?? 0 },
        path: 'Phaser.Game',
      },
      totalNodes: raw.totalNodes,
      completeness: raw.completeness === 'full' ? 'full' : 'partial',
    } as CanvasSceneDump;
  }

  async pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult> {
    const payload = buildPhaserHitTestPayload(opts);
    const result = await env.pageController.evaluate<{
      success: boolean;
      picked: CanvasSceneNode | null;
      candidates: Array<{ node: CanvasSceneNode; depth: number }>;
      coordinates: {
        screen: { x: number; y: number };
        canvas: { x: number; y: number };
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
