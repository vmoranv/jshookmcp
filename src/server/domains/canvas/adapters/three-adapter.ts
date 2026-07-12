/**
 * Three.js canvas engine adapter for JSHookMCP's canvas domain.
 *
 * Supports any Three.js version that exposes window.THREE. The dump and pick payloads
 * are self-contained JavaScript strings executed in the page context via
 * pageController.evaluate().
 *
 * Scene discovery: Three.js apps do not register their scene on a global registry.
 * This adapter shallow-scans `window` for any value whose `isScene === true` or whose
 * constructor name is `Scene`, and also honors the `__threeScene` / `__THREE_DEVTOOLS__`
 * dev conventions. Apps that scope their scene to a module closure (not reachable from
 * window) cannot be discovered — in that case dumpScene returns `completeness: 'partial'`
 * with an honest message.
 *
 * World transforms: each Object3D's `matrixWorld` (THREE.Matrix4) is decomposed into
 * translation / rotation / scale using THREE's own Vector3 / Quaternion / Euler math.
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
 * Generates a self-contained JS string that:
 *  1. Locates window.THREE
 *  2. Finds a THREE.Scene by shallow-scanning window (isScene / constructor name)
 *  3. DFS over scene.children[] recursively, decomposing matrixWorld per node
 *  4. Returns a serialisable scene tree
 *
 * @param opts - Dump options (maxDepth, onlyInteractive, onlyVisible)
 */
export function buildThreeSceneTreeDumpPayload(opts: DumpOpts): string {
  const maxDepth = opts.maxDepth ?? 20;
  const onlyInteractive = opts.onlyInteractive ?? false;
  const onlyVisible = opts.onlyVisible ?? false;

  return `(function() {
  var THREE = window.THREE;

  function safeProp(obj, key, fallback) {
    try { var v = obj[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function nodeId(obj, idx) {
    try {
      if (obj.uuid !== undefined && obj.uuid !== null && obj.uuid !== '') return 'three_' + obj.uuid;
    } catch(e) {}
    try {
      if (obj.id !== undefined && obj.id !== null) return 'three_id_' + obj.id;
    } catch(e) {}
    var t = obj.type || (obj.constructor ? obj.constructor.name : 'Object3D');
    return t + '_' + idx;
  }

  function getType(obj) {
    try {
      if (obj.type && typeof obj.type === 'string' && obj.type !== '') return obj.type;
    } catch(e) {}
    return obj.constructor ? obj.constructor.name : 'Object3D';
  }

  function decomposeMatrix(matrix) {
    var r = { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
    try {
      if (THREE && THREE.Vector3 && THREE.Quaternion && THREE.Euler && typeof matrix.decompose === 'function') {
        var pos = new THREE.Vector3();
        var quat = new THREE.Quaternion();
        var scale = new THREE.Vector3();
        matrix.decompose(pos, quat, scale);
        var euler = new THREE.Euler();
        euler.setFromQuaternion(quat);
        r.posX = pos.x; r.posY = pos.y; r.posZ = pos.z;
        r.rotX = euler.x; r.rotY = euler.y; r.rotZ = euler.z;
        r.scaleX = scale.x; r.scaleY = scale.y; r.scaleZ = scale.z;
        return r;
      }
    } catch(e) {}
    // Fallback: read local transform properties
    r.posX = safeProp(matrix, 'elements', null) ? 0 : safeProp(matrix, 'posX', 0);
    return r;
  }

  function getTransform(obj) {
    var mw = safeProp(obj, 'matrixWorld', null);
    if (mw && typeof mw.decompose === 'function') {
      return decomposeMatrix(mw);
    }
    // Fallback to local transform props
    return {
      posX: safeProp(obj, 'posX', 0) || (obj.position ? safeProp(obj.position, 'x', 0) : 0),
      posY: safeProp(obj, 'posY', 0) || (obj.position ? safeProp(obj.position, 'y', 0) : 0),
      posZ: safeProp(obj, 'posZ', 0) || (obj.position ? safeProp(obj.position, 'z', 0) : 0),
      rotX: obj.rotation ? safeProp(obj.rotation, 'x', 0) : 0,
      rotY: obj.rotation ? safeProp(obj.rotation, 'y', 0) : 0,
      rotZ: obj.rotation ? safeProp(obj.rotation, 'z', 0) : 0,
      scaleX: obj.scale ? safeProp(obj.scale, 'x', 1) : 1,
      scaleY: obj.scale ? safeProp(obj.scale, 'y', 1) : 1,
      scaleZ: obj.scale ? safeProp(obj.scale, 'z', 1) : 1,
    };
  }

  function getWorldBounds(obj, t) {
    try {
      var geom = obj.geometry;
      if (geom) {
        if (!geom.boundingBox) {
          try { geom.computeBoundingBox(); } catch(e) {}
        }
        if (geom.boundingBox) {
          var bb = geom.boundingBox;
          var minX = bb.min.x * t.scaleX + t.posX;
          var minY = bb.min.y * t.scaleY + t.posY;
          var w = Math.abs((bb.max.x - bb.min.x) * t.scaleX);
          var h = Math.abs((bb.max.y - bb.min.y) * t.scaleY);
          if (w > 0 || h > 0) {
            return { x: minX, y: minY, width: w, height: h };
          }
        }
      }
    } catch(e) {}
    return {
      x: t.posX,
      y: t.posY,
      width: Math.max(1, Math.abs(t.scaleX)),
      height: Math.max(1, Math.abs(t.scaleY))
    };
  }

  function getMaterialInfo(obj) {
    try {
      var mat = obj.material;
      if (!mat) return undefined;
      if (Array.isArray(mat)) {
        return mat.map(function(m) {
          return m && m.type ? m.type : (m && m.constructor ? m.constructor.name : 'Material');
        });
      }
      return mat.type || (mat.constructor ? mat.constructor.name : 'Material');
    } catch(e) { return undefined; }
  }

  function getVertexCount(obj) {
    try {
      var geom = obj.geometry;
      if (geom && geom.attributes && geom.attributes.position) {
        return geom.attributes.position.count;
      }
    } catch(e) {}
    return undefined;
  }

  function isSceneLike(value) {
    if (!value || typeof value !== 'object') return false;
    try {
      if (value.isScene === true) return true;
    } catch(e) {}
    try {
      if (value.constructor && value.constructor.name === 'Scene') return true;
    } catch(e) {}
    return false;
  }

  function findScene() {
    // 1. Dev-tool conventions
    try {
      if (window.__threeScene && isSceneLike(window.__threeScene)) return window.__threeScene;
    } catch(e) {}
    try {
      var reg = window.__THREE_DEVTOOLS__;
      if (reg && reg.scenes && reg.scenes.length > 0 && isSceneLike(reg.scenes[0])) {
        return reg.scenes[0];
      }
    } catch(e) {}
    // 2. Shallow scan window for a scene-like value (skip DOM nodes / window itself)
    var seen = new Set();
    try {
      var keys = Object.keys(window);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        try {
          var v = window[k];
          if (!v || v === window || v.nodeType || seen.has(v)) continue;
          seen.add(v);
          if (isSceneLike(v)) return v;
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }

  var totalNodes = 0;

  function traverse(obj, depth, path) {
    if (!obj || depth > ${maxDepth}) return null;
    totalNodes++;

    var visible = !!(safeProp(obj, 'visible', true));
    var interactive = !!(
      obj.userData && (obj.userData.interactive || obj.userData.clickable || obj.userData.pickable)
    );

    if (${onlyVisible} && !visible) return null;
    if (${onlyInteractive} && !interactive) return null;

    var childrenArr = safeProp(obj, 'children', []);
    if (!Array.isArray(childrenArr)) childrenArr = [];
    var children = null;

    if (childrenArr.length > 0) {
      children = [];
      for (var i = 0; i < childrenArr.length; i++) {
        var cn = childrenArr[i];
        if (!cn) continue;
        var childPath = path ? path + '/' + nodeId(cn, i) : nodeId(cn, i);
        var sub = traverse(cn, depth + 1, childPath);
        if (sub) children.push(sub);
      }
    }

    var t = getTransform(obj);
    var wb = getWorldBounds(obj, t);
    var result = {
      id: nodeId(obj, 0),
      type: getType(obj),
      name: safeProp(obj, 'name', undefined) || undefined,
      visible: visible,
      interactive: interactive,
      alpha: 1,
      x: t.posX,
      y: t.posY,
      width: wb.width,
      height: wb.height,
      worldBounds: wb,
      path: path || nodeId(obj, 0),
      customData: {
        posX: t.posX, posY: t.posY, posZ: t.posZ,
        rotX: t.rotX, rotY: t.rotY, rotZ: t.rotZ,
        scaleX: t.scaleX, scaleY: t.scaleY, scaleZ: t.scaleZ,
        uuid: safeProp(obj, 'uuid', undefined) || undefined,
        materialType: getMaterialInfo(obj),
        vertexCount: getVertexCount(obj),
      }
    };

    if (result.name === undefined) delete result.name;
    if (children && children.length > 0) result.children = children;
    return result;
  }

  if (!THREE) {
    return {
      engine: 'Three.js',
      version: undefined,
      canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
      error: 'window.THREE is undefined'
    };
  }

  var threeVersion = THREE.REVISION ? ('r' + THREE.REVISION) : (THREE.VERSION || undefined);
  var scene = findScene();

  var canvasEl = document.querySelector('canvas');
  var canvasInfo = {
    width: canvasEl ? canvasEl.width : 0,
    height: canvasEl ? canvasEl.height : 0,
    dpr: window.devicePixelRatio || 1,
    contextType: 'unknown'
  };
  if (canvasEl) {
    var gl = canvasEl.getContext('webgl2') || canvasEl.getContext('webgl');
    canvasInfo.contextType = gl ? (gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : '2d';
  }

  if (!scene) {
    return {
      engine: 'Three.js',
      version: threeVersion,
      canvas: canvasInfo,
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
      error: 'THREE.Scene not reachable from window — app likely scopes scene to a module closure'
    };
  }

  var sceneTree = traverse(scene, 0, 'THREE.Scene');

  return {
    engine: 'Three.js',
    version: threeVersion,
    canvas: canvasInfo,
    sceneTree: sceneTree,
    totalNodes: totalNodes,
    completeness: sceneTree ? 'full' : 'partial'
  };
})()`;
}

/**
 * Generates a self-contained JS string that:
 *  1. Transforms screen coordinates → canvas coordinates
 *  2. Walks the scene graph (using raycaster when THREE is available; falls back to
 *     DFS world-bounds check)
 *  3. Returns all candidates sorted by depth (topmost first)
 *
 * @param opts - Pick options (x, y, canvasId)
 */
export function buildThreeHitTestPayload(opts: PickOpts): string {
  const x = opts.x;
  const y = opts.y;
  const canvasId = opts.canvasId;

  return `(function() {
  var THREE = window.THREE;

  function safeProp(obj, key, fallback) {
    try { var v = obj[key]; return v === undefined || v === null ? fallback : v; } catch(e) { return fallback; }
  }

  function nodeId(obj, idx) {
    try {
      if (obj.uuid !== undefined && obj.uuid !== null && obj.uuid !== '') return 'three_' + obj.uuid;
    } catch(e) {}
    try {
      if (obj.id !== undefined && obj.id !== null) return 'three_id_' + obj.id;
    } catch(e) {}
    var t = obj.type || (obj.constructor ? obj.constructor.name : 'Object3D');
    return t + '_' + idx;
  }

  function getType(obj) {
    try {
      if (obj.type && typeof obj.type === 'string' && obj.type !== '') return obj.type;
    } catch(e) {}
    return obj.constructor ? obj.constructor.name : 'Object3D';
  }

  function isSceneLike(value) {
    if (!value || typeof value !== 'object') return false;
    try { if (value.isScene === true) return true; } catch(e) {}
    try { if (value.constructor && value.constructor.name === 'Scene') return true; } catch(e) {}
    return false;
  }

  function findScene() {
    try { if (window.__threeScene && isSceneLike(window.__threeScene)) return window.__threeScene; } catch(e) {}
    try {
      var reg = window.__THREE_DEVTOOLS__;
      if (reg && reg.scenes && reg.scenes.length > 0 && isSceneLike(reg.scenes[0])) return reg.scenes[0];
    } catch(e) {}
    var seen = new Set();
    try {
      var keys = Object.keys(window);
      for (var i = 0; i < keys.length; i++) {
        try {
          var v = window[keys[i]];
          if (!v || v === window || v.nodeType || seen.has(v)) continue;
          seen.add(v);
          if (isSceneLike(v)) return v;
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }

  var sx = ${x}, sy = ${y};

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

  if (!THREE) {
    return { success: false, picked: null, candidates: [], coordinates: {
      screen: { x: sx, y: sy }, canvas: { x: sx, y: sy } }, hitTestMethod: 'none' };
  }

  var scene = findScene();
  if (!scene) {
    return { success: false, picked: null, candidates: [], coordinates: {
      screen: { x: sx, y: sy }, canvas: { x: sx, y: sy } }, hitTestMethod: 'none' };
  }

  var canvasX = sx, canvasY = sy;
  if (targetCanvas) {
    var rect = targetCanvas.getBoundingClientRect();
    canvasX = (sx - rect.left) * (targetCanvas.width / rect.width);
    canvasY = (sy - rect.top) * (targetCanvas.height / rect.height);
  }

  var candidates = [];
  var hitTestMethod = 'none';
  var enginePicked = null;

  // Try THREE.Raycaster (native) — most accurate
  try {
    if (THREE.Vector3 && THREE.Raycaster) {
      var cam = scene.children.find(function(c) { return c && c.isCamera; }) || null;
      // Also check cameras stored elsewhere on the scene
      if (!cam) {
        for (var ci2 = 0; ci2 < scene.children.length; ci2++) {
          if (scene.children[ci2] && scene.children[ci2].isCamera) { cam = scene.children[ci2]; break; }
        }
      }
      if (cam) {
        var ndcX = (canvasX / (targetCanvas ? targetCanvas.width : window.innerWidth)) * 2 - 1;
        var ndcY = -(canvasY / (targetCanvas ? targetCanvas.height : window.innerHeight)) * 2 + 1;
        var ray = new THREE.Raycaster();
        ray.setFromCamera({ x: ndcX, y: ndcY }, cam);
        var hits = ray.intersectObjects(scene.children, true);
        if (hits && hits.length > 0 && hits[0].object) {
          enginePicked = hits[0].object;
          hitTestMethod = 'engine';
        }
      }
    }
  } catch(e) {}

  // DFS fallback: world-bounds check
  function decomposeMatrix(matrix) {
    var r = { posX: 0, posY: 0, scaleX: 1, scaleY: 1 };
    try {
      if (THREE.Vector3 && THREE.Quaternion && typeof matrix.decompose === 'function') {
        var pos = new THREE.Vector3();
        var quat = new THREE.Quaternion();
        var scale = new THREE.Vector3();
        matrix.decompose(pos, quat, scale);
        r.posX = pos.x; r.posY = pos.y; r.scaleX = scale.x; r.scaleY = scale.y;
      }
    } catch(e) {}
    return r;
  }

  function nodeBounds(obj) {
    var mw = safeProp(obj, 'matrixWorld', null);
    var t = (mw && typeof mw.decompose === 'function') ? decomposeMatrix(mw) :
      { posX: obj.position ? safeProp(obj.position, 'x', 0) : 0,
        posY: obj.position ? safeProp(obj.position, 'y', 0) : 0,
        scaleX: obj.scale ? safeProp(obj.scale, 'x', 1) : 1,
        scaleY: obj.scale ? safeProp(obj.scale, 'y', 1) : 1 };
    try {
      var geom = obj.geometry;
      if (geom) {
        if (!geom.boundingBox) { try { geom.computeBoundingBox(); } catch(e) {} }
        if (geom.boundingBox) {
          var bb = geom.boundingBox;
          return {
            x: bb.min.x * t.scaleX + t.posX,
            y: bb.min.y * t.scaleY + t.posY,
            width: Math.abs((bb.max.x - bb.min.x) * t.scaleX),
            height: Math.abs((bb.max.y - bb.min.y) * t.scaleY)
          };
        }
      }
    } catch(e) {}
    return { x: t.posX, y: t.posY, width: Math.abs(t.scaleX), height: Math.abs(t.scaleY) };
  }

  function hitTestDfs(obj, depth, accPath) {
    if (!obj) return;
    var visible = safeProp(obj, 'visible', true);
    if (!visible) return;

    var wb = nodeBounds(obj);
    if (wb.width > 0 && wb.height > 0) {
      var inBounds = canvasX >= wb.x && canvasX <= wb.x + wb.width &&
                     canvasY >= wb.y && canvasY <= wb.y + wb.height;
      var interactive = !!(
        obj.userData && (obj.userData.interactive || obj.userData.clickable || obj.userData.pickable)
      );
      if (inBounds && interactive) {
        candidates.push({
          node: {
            id: nodeId(obj, 0),
            type: getType(obj),
            name: safeProp(obj, 'name', undefined) || undefined,
            visible: true,
            interactive: true,
            alpha: 1,
            x: wb.x, y: wb.y,
            width: wb.width, height: wb.height,
            worldBounds: wb,
            path: accPath || nodeId(obj, 0)
          },
          depth: depth
        });
      }
    }

    var childrenArr = safeProp(obj, 'children', []);
    if (Array.isArray(childrenArr)) {
      for (var i = 0; i < childrenArr.length; i++) {
        var cn = childrenArr[i];
        if (!cn) continue;
        var childPath = accPath ? accPath + '/' + nodeId(cn, i) : nodeId(cn, i);
        hitTestDfs(cn, depth + 1, childPath);
      }
    }
  }

  hitTestDfs(scene, 0, 'THREE.Scene');

  var picked = enginePicked ? {
    id: nodeId(enginePicked, 0),
    type: getType(enginePicked),
    name: safeProp(enginePicked, 'name', undefined) || undefined,
    visible: !!(safeProp(enginePicked, 'visible', true)),
    interactive: !!(enginePicked.userData &&
      (enginePicked.userData.interactive || enginePicked.userData.clickable)),
    alpha: 1,
    x: nodeBounds(enginePicked).x,
    y: nodeBounds(enginePicked).y,
    width: nodeBounds(enginePicked).width,
    height: nodeBounds(enginePicked).height,
    worldBounds: nodeBounds(enginePicked),
    path: 'THREE.Scene/raycast/' + nodeId(enginePicked, 0)
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
      canvas: { x: canvasX, y: canvasY }
    },
    hitTestMethod: hitTestMethod
  };
})()`;
}

// ── Adapter class ─────────────────────────────────────────────────────────────

/**
 * Three.js canvas engine adapter.
 *
 * Detection checks window.THREE and confirms a THREE.Scene is discoverable.
 * dumpScene() locates the scene via shallow window scan and traverses children.
 * pickAt() uses THREE.Raycaster with DFS fallback.
 */
export class ThreeJsCanvasAdapter implements CanvasEngineAdapter {
  readonly id = 'three';
  readonly engine = 'Three.js';
  readonly version: string | undefined;

  constructor() {
    this.version = undefined;
  }

  async detect(env: CanvasProbeEnv): Promise<CanvasDetection | null> {
    try {
      const result = await env.pageController.evaluate<{
        present: boolean;
        version?: string;
        hasScene: boolean;
      }>(`
        (function() {
          var THREE = window.THREE;
          if (!THREE) return { present: false, hasScene: false };
          var version = THREE.REVISION ? ('r' + THREE.REVISION) : (THREE.VERSION || undefined);
          function isSceneLike(v) {
            if (!v || typeof v !== 'object') return false;
            try { if (v.isScene === true) return true; } catch(e) {}
            try { if (v.constructor && v.constructor.name === 'Scene') return true; } catch(e) {}
            return false;
          }
          var hasScene = false;
          try { if (window.__threeScene && isSceneLike(window.__threeScene)) hasScene = true; } catch(e) {}
          if (!hasScene) {
            try {
              var reg = window.__THREE_DEVTOOLS__;
              if (reg && reg.scenes && reg.scenes.length > 0 && isSceneLike(reg.scenes[0])) hasScene = true;
            } catch(e) {}
          }
          if (!hasScene) {
            var keys = Object.keys(window);
            for (var i = 0; i < keys.length; i++) {
              try {
                var v = window[keys[i]];
                if (!v || v === window || v.nodeType) continue;
                if (isSceneLike(v)) { hasScene = true; break; }
              } catch(e) {}
            }
          }
          return { present: true, version: version, hasScene: hasScene };
        })()
      `);

      if (!result.present) return null;

      const evidence: string[] = ['window.THREE detected'];
      if (result.version) evidence.push('THREE.REVISION: ' + result.version);
      if (result.hasScene) {
        evidence.push('THREE.Scene reachable from window');
      } else {
        evidence.push('THREE.Scene not reachable from window (scene may be in module closure)');
      }

      return {
        engine: this.engine,
        version: result.version,
        confidence: result.hasScene ? 0.95 : 0.9,
        evidence,
        adapterId: this.id,
      };
    } catch {
      return null;
    }
  }

  async dumpScene(env: CanvasProbeEnv, opts: DumpOpts): Promise<CanvasSceneDump> {
    const payload = buildThreeSceneTreeDumpPayload(opts);
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
        path: 'THREE.Scene',
      },
      totalNodes: raw.totalNodes,
      completeness: raw.completeness === 'full' ? 'full' : 'partial',
    } as CanvasSceneDump;
  }

  async pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult> {
    const payload = buildThreeHitTestPayload(opts);
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

  async dumpGpuResources(
    env: CanvasProbeEnv,
    _opts: DumpOpts,
  ): Promise<{
    textures: Array<{ name?: string; width: number; height: number; format: string; type: string }>;
    programs: Array<{
      name?: string;
      vertexShader: string;
      fragmentShader: string;
      uniforms: Record<string, { type: string }>;
    }>;
    geometries: Array<{
      name?: string;
      vertexCount: number;
      triangleCount: number;
      attributes: string[];
    }>;
  } | null> {
    const payload = buildThreeGpuResourcesPayload();
    const result = await env.pageController.evaluate<{
      textures: Array<{
        name?: string;
        width: number;
        height: number;
        format: string;
        type: string;
      }>;
      programs: Array<{
        name?: string;
        vertexShader: string;
        fragmentShader: string;
        uniforms: Record<string, { type: string }>;
      }>;
      geometries: Array<{
        name?: string;
        vertexCount: number;
        triangleCount: number;
        attributes: string[];
      }>;
    } | null>(payload);
    return result;
  }
}

/** In-page script: walk THREE.WebGLRenderer for programs/textures + scene for geometry attributes. */
function buildThreeGpuResourcesPayload(): string {
  return `(function(){
  var THREE=window.THREE; if(!THREE) return null;

  function findScene(){
    try{ if(window.__threeScene&&window.__threeScene.isScene===true) return window.__threeScene; }catch(e){}
    try{ var dev=window.__THREE_DEVTOOLS__; if(dev&&dev.scenes&&dev.scenes.length>0&&dev.scenes[0].isScene===true) return dev.scenes[0]; }catch(e){}
    var keys=Object.keys(window);
    for(var i=0;i<keys.length;i++){
      try{ var v=window[keys[i]]; if(v&&v.isScene===true) return v; }catch(e){}
    }
    return null;
  }

  function findRenderer(){
    try{ if(window.__threeRenderer&&window.__threeRenderer.isWebGLRenderer===true) return window.__threeRenderer; }catch(e){}
    var keys=Object.keys(window);
    for(var i=0;i<keys.length;i++){
      try{ var v=window[keys[i]]; if(v&&v.isWebGLRenderer===true) return v; }catch(e){}
    }
    return null;
  }

  var textures=[],programs=[],geometries=[];
  var renderer=findRenderer();

  if(renderer&&renderer.info&&renderer.info.programs){
    var progs=renderer.info.programs;
    for(var i=0;i<Math.min(progs.length,200);i++){
      var p=progs[i];
      var pData={ name: p.name||undefined, vertexShader:'', fragmentShader:'', uniforms:{} };
      try{
        var gl=renderer.getContext();
        var dbg=gl.getExtension('WEBGL_debug_shaders');
        if(dbg&&p.program){
          try{ pData.vertexShader=dbg.getTranslatedShaderSource(p.vertexShader)||''; }catch(e){}
          try{ pData.fragmentShader=dbg.getTranslatedShaderSource(p.fragmentShader)||''; }catch(e){}
        }
      } catch(e){}
      programs.push(pData);
    }
  }

  if(renderer&&renderer.info&&renderer.info.textures){
    var texs=renderer.info.textures;
    for(var i=0;i<Math.min(texs.length,200);i++){
      var t=texs[i];
      textures.push({ name:t.name||undefined, width:t.width||0, height:t.height||0, format:'rgba', type:'unsigned_byte' });
    }
  }

  var scene=findScene();
  if(scene){
    (function walk(obj){
      if(!obj) return;
      if(obj.isMesh&&obj.geometry){
        var g=obj.geometry, attrs=[];
        if(g.attributes){
          if(g.attributes.position) attrs.push('position');
          if(g.attributes.normal) attrs.push('normal');
          if(g.attributes.uv) attrs.push('uv');
        }
        var vc=g.attributes&&g.attributes.position?g.attributes.position.count:0;
        var tc=g.index?Math.floor(g.index.count/3):Math.floor(vc/3);
        geometries.push({ name:obj.name||undefined, vertexCount:vc, triangleCount:tc, attributes:attrs });
      }
      if(obj.children) for(var j=0;j<obj.children.length;j++) walk(obj.children[j]);
    })(scene);
  }

  return { textures:textures, programs:programs, geometries:geometries };
})()`;
}
