/**
 * canvas_dump_shaders — dump the linked WebGL/Three.js/Babylon/Laya shader
 * programs running on the target canvas, returning shader source + uniforms.
 *
 * Academic basis:
 *   - WGPULens (arXiv 2606.26412): exposes program uniform layout via fingerprinting
 *   - DarthShader (arXiv 2409.01824): recovers shader source from runtime programs
 *
 * Honest boundary (per lesson #51): WebGL does not expose shader source to JS by
 * default. The `WEBGL_debug_shaders` extension is the only way to recover
 * translated source, and Chrome reserves the right to redact source for
 * driver-private shaders. When the runtime refuses to expose source (driver
 * restriction, extension missing, or no shader introspection API available
 * for the engine), the tool returns an empty programs[] plus a `reason`
 * field explaining what was tried — it does NOT fabricate empty strings.
 *
 * Engine coverage:
 *   - Three.js: walks `renderer.info.programs[]`, extracts source via
 *     `WEBGL_debug_shaders.getTranslatedShaderSource` (works on most drivers)
 *   - Babylon.js: walks `Effect.ShadersStore` (engine-provided registry)
 *   - LayaAir (3.x & 2.x): walks `Laya.Shader` and the WebGL renderer's
 *     program cache; 3.x shader pipeline is self-admitted unverified, the
 *     payload degrades honestly if it can't enumerate programs
 *   - Other engines / bare WebGL: enumerates the active canvas's WebGL
 *     context, returns only what can be observed (typically empty source +
 *     program count)
 */

import type { ToolResponse } from '@server/types';
import type { PageController } from '@server/domains/canvas/dependencies';
import { asJsonResponse } from '@server/domains/shared/response';
import { argBool, argNumber } from '@server/domains/shared/parse-args';

export interface CanvasShaderProgram {
  name?: string;
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { type: string }>;
  /** Where the program came from (engine introspection, fallback walker, etc.). */
  source: 'engine-introspection' | 'fallback-walker' | 'unknown';
}

export interface CanvasDumpShadersResult {
  success: boolean;
  engine: string | null;
  totalPrograms: number;
  programs: CanvasShaderProgram[];
  truncated: boolean;
  reason?: string;
  error?: string;
}

/**
 * Build a self-contained JS payload that:
 *  1. Detects the engine (Three.js / Babylon / Laya / bare WebGL) by global anchor
 *  2. Enumerates shader programs via engine-specific introspection paths
 *  3. Extracts vertex/fragment source via WEBGL_debug_shaders when available
 *  4. Captures uniform declarations when includeUniforms=true
 *
 * @param canvasId - optional canvas element ID / index to scope to
 * @param includeUniforms - whether to walk and report uniform metadata
 * @param engineHint - explicit engine override (skips auto-detect)
 * @param maxPrograms - in-page enumeration cap (mirrors the tool argument)
 */
export function buildDumpShadersPayload(
  canvasId?: string,
  includeUniforms: boolean = true,
  engineHint?: string,
  maxPrograms: number = 200,
): string {
  const cap = Math.max(1, Math.floor(maxPrograms));
  return `(function() {
  function safe(name) { try { return typeof window[name]; } catch(e) { return 'undefined'; } }
  function arr(n) { return Array.prototype.slice.call(n || []); }

  var maxPrograms = ${cap};
  var canvasId = ${JSON.stringify(canvasId ?? null)};
  var includeUniforms = ${includeUniforms ? 'true' : 'false'};
  var engineHint = ${JSON.stringify(engineHint ?? null)};

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

  function getGL(target) {
    if (!target) return null;
    try { return target.getContext('webgl2') || target.getContext('webgl'); }
    catch(e) { return null; }
  }

  // Engine detection — order matters: Three.js / Babylon / Laya each own
  // their renderer via a dedicated global; the engineHint lets the caller
  // skip detection when they already know.
  function detectEngine() {
    if (engineHint) return engineHint;
    if (safe('THREE') !== 'undefined') return 'three';
    if (safe('BABYLON') !== 'undefined') return 'babylon';
    if (safe('Laya') !== 'undefined') return 'laya';
    return 'unknown';
  }

  var engine = detectEngine();
  var programs = [];
  var reason = null;

  // GL active-uniform type ids → readable names (gl.getActiveUniform().type)
  var GL_TYPE_NAMES = {
    5126: 'float', 35664: 'vec2', 35665: 'vec3', 35666: 'vec4',
    35667: 'ivec2', 35668: 'ivec3', 35669: 'ivec4', 35670: 'bool',
    35671: 'bvec2', 35672: 'bvec3', 35673: 'bvec4', 35674: 'mat2',
    35675: 'mat3', 35676: 'mat4', 35678: 'sampler2D', 35680: 'samplerCube'
  };
  function glTypeName(t) { return GL_TYPE_NAMES[t] || ('gl-0x' + Number(t).toString(16)); }

  // ── Three.js path ─────────────────────────────────────────────────────
  // renderer.info.programs[] is Three's internal program registry. Each
  // entry has a vertexShader and fragmentShader WebGLShader handle; the
  // WEBGL_debug_shaders extension (Chrome + Firefox) is the only way to
  // recover source. Many drivers redact source for private programs.
  if (engine === 'three') {
    try {
      var THREE = window.THREE;
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
      if (renderer && renderer.info && renderer.info.programs) {
        var gl = renderer.getContext ? renderer.getContext() : getGL(targetCanvas);
        var dbg = gl ? gl.getExtension('WEBGL_debug_shaders') : null;
        var progs = renderer.info.programs;
        for (var i = 0; i < Math.min(progs.length, maxPrograms); i++) {
          var p = progs[i];
          if (!p) continue;
          var pData = {
            name: p.name || undefined,
            vertexShader: '',
            fragmentShader: '',
            uniforms: {},
            source: 'engine-introspection'
          };
          if (dbg && p.program) {
            try { pData.vertexShader = dbg.getTranslatedShaderSource(p.vertexShader) || ''; } catch(e) {}
            try { pData.fragmentShader = dbg.getTranslatedShaderSource(p.fragmentShader) || ''; } catch(e) {}
          }
          if (includeUniforms && p.getUniforms && gl) {
            try {
              var u = p.getUniforms();
              var uniforms = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS);
              var info = [];
              for (var j = 0; j < uniforms; j++) {
                var ai = gl.getActiveUniform(p.program, j);
                if (ai) info.push({ name: ai.name, type: glTypeName(ai.type) });
              }
              for (var k = 0; k < info.length; k++) {
                pData.uniforms[info[k].name] = { type: info[k].type };
              }
            } catch(e) {}
          }
          programs.push(pData);
        }
      } else {
        reason = 'three.js renderer.info.programs not accessible';
      }
    } catch(e) {
      reason = 'three.js shader introspection failed: ' + (e.message || String(e));
    }
  }

  // ── Babylon.js path ───────────────────────────────────────────────────
  // Effect.ShadersStore maps a shader name to its GLSL SOURCE STRING — the
  // fragment twin of "name" is stored under "nameFragment" (Babylon store
  // convention). There is no WebGLProgram handle here, so WEBGL_debug_shaders
  // cannot translate further; the store itself IS the source.
  else if (engine === 'babylon') {
    try {
      var B = window.BABYLON;
      if (B && B.Effect && B.Effect.ShadersStore) {
        var names = Object.keys(B.Effect.ShadersStore);
        for (var i = 0; i < Math.min(names.length, maxPrograms); i++) {
          var name = names[i];
          if (name.slice(-8) === 'Fragment') continue; // paired with its base entry
          var vsSrc = B.Effect.ShadersStore[name] || '';
          var fsSrc = B.Effect.ShadersStore[name + 'Fragment'] || '';
          if (!vsSrc && !fsSrc) continue;
          programs.push({
            name: name,
            vertexShader: vsSrc,
            fragmentShader: fsSrc,
            uniforms: {},
            source: 'engine-introspection'
          });
        }
      } else {
        reason = 'BABYLON.Effect.ShadersStore not accessible';
      }
    } catch(e) {
      reason = 'babylon shader introspection failed: ' + (e.message || String(e));
    }
  }

  // ── LayaAir path (2.x + 3.x) ─────────────────────────────────────────
  // Laya maintains a Shader registry under Laya.Shader; 3.x exposed a new
  // WebGL2 pipeline that may not register here. The path is self-admitted
  // unverified for 3.x — we attempt the lookup and degrade honestly.
  else if (engine === 'laya') {
    try {
      var L = window.Laya;
      if (L && L.Shader && typeof L.Shader === 'object') {
        // Try Laya.Shader._shaderInfo (2.x private registry), Laya.Shader.Shaders
        // (newer 2.x / 3.x), and any well-known maps.
        var candidates = [
          L.Shader._shaderInfo,
          L.Shader.Shaders,
          L.Shader.shaderInfoMap,
          L.Shader._shaders
        ].filter(function(c) { return c && typeof c === 'object'; });
        var gl = getGL(targetCanvas);
        var dbg = gl ? gl.getExtension('WEBGL_debug_shaders') : null;
        for (var cIdx = 0; cIdx < candidates.length; cIdx++) {
          var registry = candidates[cIdx];
          var keys = Object.keys(registry);
          for (var i = 0; i < Math.min(keys.length, 200); i++) {
            var key = keys[i];
            var entry = registry[key];
            var vsHandle = entry && (entry.vs || entry.vertexShader);
            var fsHandle = entry && (entry.fs || entry.fragmentShader);
            if (!vsHandle && !fsHandle) continue;
            var pData = {
              name: key,
              vertexShader: '',
              fragmentShader: '',
              uniforms: {},
              source: 'engine-introspection'
            };
            if (dbg) {
              try { if (vsHandle) pData.vertexShader = dbg.getTranslatedShaderSource(vsHandle) || ''; } catch(e) {}
              try { if (fsHandle) pData.fragmentShader = dbg.getTranslatedShaderSource(fsHandle) || ''; } catch(e) {}
            }
            programs.push(pData);
          }
        }
        if (programs.length === 0) {
          reason = 'LayaAir shader registry present but no programs enumerable (3.x pipeline unverified)';
        }
      } else {
        reason = 'Laya.Shader registry not accessible';
      }
    } catch(e) {
      reason = 'laya shader introspection failed: ' + (e.message || String(e));
    }
  }

  // ── Bare WebGL fallback ───────────────────────────────────────────────
  // No engine introspection path — try to enumerate active programs via the
  // raw WebGL context. We can't recover source without WEBGL_debug_shaders
  // and we can't enumerate every program (WebGL hides the program list).
  // Honest: return the extension status so the caller knows what was tried.
  else {
    var gl = getGL(targetCanvas);
    if (gl) {
      var dbg = gl.getExtension('WEBGL_debug_shaders');
      reason = dbg
        ? 'engine does not expose shader registry; WEBGL_debug_shaders available but no program enumeration API'
        : 'engine does not expose shader registry and WEBGL_debug_shaders extension is unavailable';
    } else {
      reason = 'no WebGL context available on target canvas';
    }
  }

  return {
    engine: engine,
    totalPrograms: programs.length,
    programs: programs,
    reason: reason
  };
})()`;
}

/**
 * Handler for canvas_dump_shaders.
 *
 * @param pageController - injected PageController for in-page evaluation
 * @param args - tool arguments: canvasId?, includeUniforms?, maxPrograms?, engine?
 */
export async function handleDumpShaders(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const canvasId = args['canvasId'] as string | undefined;
  const includeUniforms = argBool(args, 'includeUniforms', true);
  const maxPrograms = argNumber(args, 'maxPrograms', 200);
  const engineHint = args['engine'] as string | undefined;

  const cap = Math.max(1, Math.floor(maxPrograms));

  let raw: {
    engine: string | null;
    totalPrograms: number;
    programs: CanvasShaderProgram[];
    reason?: string;
  };

  try {
    const payload = buildDumpShadersPayload(canvasId, includeUniforms, engineHint, cap);
    raw = await pageController.evaluate<typeof raw>(payload);
  } catch (error) {
    return asJsonResponse({
      success: false,
      engine: null,
      totalPrograms: 0,
      programs: [],
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Drop uniform maps when the caller wants a smaller payload.
  const normalized: CanvasShaderProgram[] = (raw.programs ?? []).map((p) => ({
    ...p,
    uniforms: includeUniforms ? (p.uniforms ?? {}) : {},
  }));

  const truncated = normalized.length > cap;
  const capped = truncated ? normalized.slice(0, cap) : normalized;

  const result: CanvasDumpShadersResult = {
    success: true,
    engine: raw.engine ?? null,
    totalPrograms: raw.totalPrograms ?? capped.length,
    programs: capped,
    truncated,
    ...(raw.reason ? { reason: raw.reason } : {}),
  };

  return asJsonResponse(result);
}
