/**
 * Canvas domain benchmark — pure host-side logic across all 11 canvas tools.
 *
 * Two case classes:
 *  1. `canvas_scene_search` — pure compute over a synthetic scene tree.
 *  2. Scripted page substrate — the other 10 tools split work between an
 *     in-page probe and host-side logic (invariant evaluation, uniform
 *     stripping/capping, renderer-backend classification, honest no-engine
 *     degradation). We feed the probe's *fixed* return value and assert the
 *     host half, which is the code under test. Nothing is fabricated: the
 *     page payloads mirror exactly what the in-page snippets return.
 *
 * Homemade fixture: a 3-node synthetic scene-dump tree shaped like CanvasSceneNode
 * (Stage > Player, Enemy). Ground truth = exact walk-order match sets plus the
 * handler's path/depth/scan/cap invariants (handlers/scene-search.ts).
 */
import { CanvasToolHandlers } from '@server/domains/canvas/handlers.impl';
import { SkiaCaptureHandlers } from '@server/domains/canvas/skia';
import { body, type BenchSuite } from '../harness';

type Scripted = unknown;

/** A PageController whose `evaluate` replays a fixed script of page results in order. */
function scriptedHandlers(
  pages: Scripted[],
  extra: Record<string, unknown> = {},
): CanvasToolHandlers {
  const queue = [...pages];
  const pageController = {
    evaluate: async () => {
      if (queue.length === 0) throw new Error('scripted evaluate exhausted');
      return queue.shift();
    },
  };
  const debuggerManager = {
    enable: async () => undefined,
    ensureAdvancedFeatures: async () => undefined,
    getEventManager: () => ({
      setEventListenerBreakpoint: async () => 'bench-bp-1',
      removeEventListenerBreakpoint: async () => undefined,
    }),
    waitForPaused: async () => null,
    resume: async () => undefined,
  };
  const evidenceStore = { addNode: () => ({ id: 'evidence-bench-1' }) };
  return new CanvasToolHandlers({
    pageController,
    debuggerManager,
    traceRecorder: {},
    evidenceStore,
    ...extra,
  } as never);
}

const handlers = new CanvasToolHandlers({
  pageController: { getActivePage: async () => null },
  debuggerManager: {},
  traceRecorder: {},
  evidenceStore: {},
} as never);

/** Skia tool handlers over the same scripted page substrate. */
function skiaHandlers(pages: Scripted[]): SkiaCaptureHandlers {
  const queue = [...pages];
  return new SkiaCaptureHandlers({
    pageController: {
      evaluate: async () => {
        if (queue.length === 0) throw new Error('scripted evaluate exhausted');
        return queue.shift();
      },
    } as never,
  });
}

// Walk order (depth-first, root first): Stage, Player, Enemy → nodesScanned 3.
const SCENE_TREE = {
  id: 'root',
  name: 'Stage',
  type: 'Container',
  visible: true,
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  children: [
    {
      id: 'n1',
      name: 'Player',
      type: 'Sprite',
      visible: true,
      x: 100,
      y: 50,
      width: 64,
      height: 64,
      texture: 'hero.png',
      hp: 100,
    },
    {
      id: 'n2',
      name: 'Enemy',
      type: 'Sprite',
      visible: true,
      x: 300,
      y: 50,
      width: 64,
      height: 64,
      texture: 'enemy.png',
      hp: 50,
    },
  ],
};

type Match = Record<string, unknown>;

export const canvasSuite: BenchSuite = {
  name: 'canvas',
  domain: 'canvas',
  description:
    'canvas_scene_search pure-compute: name/property match sets, path-depth & whole-tree scan, maxResults cap and empty-result invariants (10 browser-bound canvas tools omitted)',
  cases: [
    {
      name: 'canvas_scene_search/match-by-name',
      tool: 'canvas_scene_search',
      origin: 'homemade',
      reference:
        "case-insensitive name regex 'player' selects exactly {Player}; match must carry path ['Stage','Player'] at depth 1 and expose properties.texture === 'hero.png'",
      run: () => handlers.handleSceneSearchTool({ sceneTree: SCENE_TREE, namePattern: 'player' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `success !== true: ${JSON.stringify(b).slice(0, 120)}`;
        if (b.matchedCount !== 1 || b.nodesScanned !== 3)
          return `bad count: matchedCount=${b.matchedCount} nodesScanned=${b.nodesScanned}`;
        const m = (Array.isArray(b.matches) ? b.matches : [])[0] as Match | undefined;
        if (!m || m.name !== 'Player') return `wrong match: ${JSON.stringify(b.matches)}`;
        if (m.depth !== 1 || JSON.stringify(m.path) !== JSON.stringify(['Stage', 'Player']))
          return `bad path/depth: ${JSON.stringify(m)}`;
        const p = m.properties as Match | undefined;
        if (!p || p.texture !== 'hero.png' || p.hp !== 100)
          return `bad properties: ${JSON.stringify(p)}`;
        return true;
      },
    },
    {
      name: 'canvas_scene_search/property-match-and-cap',
      tool: 'canvas_scene_search',
      origin: 'homemade',
      reference:
        "propertyFilter {texture contains '.png'} matches {Player, Enemy} (Container has no texture); maxResults:1 → matchedCount 2, truncated true, capped to walk-order-first [Player], nodesScanned still 3",
      run: () =>
        handlers.handleSceneSearchTool({
          sceneTree: SCENE_TREE,
          propertyFilter: { key: 'texture', op: 'contains', value: '.png' },
          maxResults: 1,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `success !== true: ${JSON.stringify(b).slice(0, 120)}`;
        if (b.matchedCount !== 2 || b.truncated !== true || b.nodesScanned !== 3)
          return `cap invariant broken: ${JSON.stringify(b)}`;
        const names = (Array.isArray(b.matches) ? b.matches : []).map((m) =>
          String((m as Match).name),
        );
        if (names.length !== 1 || names[0] !== 'Player')
          return `capped matches wrong: ${JSON.stringify(names)}`;
        return true;
      },
    },
    {
      name: 'canvas_scene_search/no-match-empty',
      tool: 'canvas_scene_search',
      origin: 'homemade',
      reference:
        "namePattern '^ZzzNoSuchNode$' matches nothing → matchedCount 0, empty matches, truncated false, whole tree still walked (nodesScanned 3)",
      run: () =>
        handlers.handleSceneSearchTool({ sceneTree: SCENE_TREE, namePattern: '^ZzzNoSuchNode$' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `success !== true: ${JSON.stringify(b).slice(0, 120)}`;
        const matches = Array.isArray(b.matches) ? b.matches : [];
        if (b.matchedCount !== 0 || matches.length !== 0 || b.truncated !== false)
          return `empty invariant broken: ${JSON.stringify(b)}`;
        if (b.nodesScanned !== 3) return `nodesScanned ${b.nodesScanned} != 3`;
        return true;
      },
    },

    // ── Host-side batch 2026-11-12 (autoresearch) ──────────────────────────
    // Probe payloads mirror exactly what each in-page snippet returns, so the
    // assertions cover the host half of each tool (classification, invariants,
    // normalization/capping, honest degradation) with no live browser.
    {
      name: 'canvas_engine_fingerprint/global-anchor-hit',
      tool: 'canvas_engine_fingerprint',
      origin: 'homemade',
      reference:
        'engine anchor scan: a defined window.THREE global must surface as a Three.js candidate with its version and 0.9 confidence; canvas metadata is reported alongside',
      run: () =>
        scriptedHandlers([
          [
            {
              pattern: 'THREE',
              adapterId: 'three',
              engine: 'Three.js',
              present: true,
              version: 'r150',
            },
          ],
          [{ id: 'game', width: 800, height: 600, contextType: 'WebGLRenderingContext' }],
          false,
        ]).handleFingerprintTool({}),
      validate: (v) => {
        const b = body(v);
        const candidates = (b.candidates ?? []) as Array<Record<string, unknown>>;
        if (candidates.length !== 1) return `expected 1 candidate, got ${JSON.stringify(b)}`;
        const c = candidates[0]!;
        if (c['engine'] !== 'Three.js' || c['adapterId'] !== 'three')
          return `wrong engine identification: ${JSON.stringify(c)}`;
        if (c['version'] !== 'r150') return `version not propagated: ${JSON.stringify(c)}`;
        if (c['confidence'] !== 0.9)
          return `confidence should be 0.9 for a global hit: ${JSON.stringify(c)}`;
        if (b['canvasCount'] !== 1) return `canvasCount ${String(b['canvasCount'])} != 1`;
        if (b['fingerprintComplete'] !== true) return `fingerprintComplete not set`;
        return true;
      },
    },
    {
      name: 'canvas_scene_dump/no-engine-honest-partial',
      tool: 'canvas_scene_dump',
      origin: 'homemade',
      reference:
        'honest degradation: no engine anchor present → stubType "partial", sceneTree null, totalNodes 0, and a named reason (never a fabricated empty tree)',
      run: () =>
        scriptedHandlers([
          { hits: [], selected: null, selectedEvidence: [] },
          [{ id: 'game', width: 800, height: 600, dpr: 1, contextType: 'webgl' }],
        ]).handleSceneDumpTool({}),
      validate: (v) => {
        const b = body(v);
        if (b['stubType'] !== 'partial')
          return `stubType should be partial: ${JSON.stringify(b).slice(0, 220)}`;
        if (b['sceneTree'] !== null) return `sceneTree must stay null without an engine`;
        if (b['totalNodes'] !== 0) return `totalNodes ${String(b['totalNodes'])} != 0`;
        if (
          typeof b['reason'] !== 'string' ||
          !/No canvas engine detected/.test(String(b['reason']))
        )
          return `expected the no-engine reason, got "${String(b['reason'])}"`;
        const canvas = b['canvas'] as Record<string, unknown> | undefined;
        if (!canvas || canvas['width'] !== 800 || canvas['height'] !== 600)
          return `DOM canvas metadata not reported: ${JSON.stringify(canvas)}`;
        return true;
      },
    },
    {
      name: 'canvas_pick_object_at_point/no-engine-honest-miss',
      tool: 'canvas_pick_object_at_point',
      origin: 'homemade',
      reference:
        'hit testing needs an engine adapter: with no anchor detected the tool must report success=false / picked=null plus the transformed coordinates instead of guessing a node',
      run: () =>
        scriptedHandlers([
          { screen: { x: 10, y: 20 }, canvasX: 10, canvasY: 20 },
          { hits: [], selected: null, selectedEvidence: [] },
        ]).handlePickTool({ x: 10, y: 20 }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false)
          return `expected success=false, got ${JSON.stringify(b).slice(0, 200)}`;
        if (b['picked'] !== null) return `picked must be null without an adapter`;
        const candidates = (b['candidates'] ?? []) as unknown[];
        if (candidates.length !== 0) return `candidates must be empty`;
        if (b['hitTestMethod'] !== 'none') return `hitTestMethod should be "none"`;
        const coords = b['coordinates'] as Record<string, unknown> | undefined;
        if (!coords || (coords['canvas'] as Record<string, unknown>)?.['x'] !== 10)
          return `coordinates not echoed: ${JSON.stringify(coords)}`;
        return true;
      },
    },
    {
      name: 'canvas_trace_click_handler/synthetic-dispatch-chain',
      tool: 'canvas_trace_click_handler',
      origin: 'homemade',
      reference:
        'synthetic dispatch: without a real click() the handler must emit the full pointer/mouse/click sequence and report zero handler frames when the debugger never pauses (no invented stack)',
      run: () =>
        scriptedHandlers([
          {
            domEventChain: ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
            pickedNode: { id: 'game' },
            engine: 'LayaAir',
            engineChain: [],
          },
        ]).handleTraceClickTool({ x: 5, y: 5 }),
      validate: (v) => {
        const b = body(v);
        const flow = (b['inputFlow'] ?? []) as unknown[];
        if (flow.length !== 5 || flow[0] !== 'pointerdown' || flow[4] !== 'click')
          return `event chain wrong: ${JSON.stringify(flow)}`;
        const handlerFrames = (b['handlerFrames'] ?? []) as unknown[];
        if (handlerFrames.length !== 0)
          return `handler frames must be empty when the debugger never pauses: ${JSON.stringify(handlerFrames)}`;
        const networkEmitted = (b['networkEmitted'] ?? []) as unknown[];
        if (networkEmitted.length !== 0) return `no network events were dispatched`;
        return true;
      },
    },
    {
      name: 'canvas_inject_draw_hook/install-then-read-count',
      tool: 'canvas_inject_draw_hook',
      origin: 'homemade',
      reference:
        'draw-hook lifecycle: install reports installed:true; a subsequent read returns the recorded entries with a count that matches the log length',
      run: async () => {
        const h = scriptedHandlers([
          { installed: true, timing: false, reinstalled: false },
          {
            entries: [
              { kind: 'fillText', args: ['hi'], t: 1.5 },
              { kind: 'drawImage', args: ['[object Object]'], t: 3 },
            ],
            count: 2,
            installed: true,
          },
        ]);
        const install = body(await h.handleDrawHookTool({ action: 'install' }));
        const read = body(await h.handleDrawHookTool({ action: 'read' }));
        return { install, read };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const install = r['install'] ?? {};
        if (install['action'] !== 'install' || install['installed'] !== true)
          return `install result wrong: ${JSON.stringify(install)}`;
        const read = r['read'] ?? {};
        if (read['action'] !== 'read' || read['count'] !== 2 || read['installed'] !== true)
          return `read result wrong: ${JSON.stringify(read)}`;
        if ((read['entries'] as unknown[]).length !== 2) return `entries length != count`;
        return true;
      },
    },
    {
      name: 'canvas_dump_shaders/cap-and-strip-uniforms',
      tool: 'canvas_dump_shaders',
      origin: 'homemade',
      reference:
        'host-side normalization: maxPrograms caps the returned program list (truncated:true when the page reported more) and includeUniforms=false strips every uniforms map',
      run: () =>
        scriptedHandlers([
          {
            engine: 'three',
            totalPrograms: 3,
            programs: [
              {
                name: 'p0',
                vertexShader: 'v0',
                fragmentShader: 'f0',
                uniforms: { uA: { type: 'float' } },
                source: 'engine-introspection',
              },
              {
                name: 'p1',
                vertexShader: 'v1',
                fragmentShader: 'f1',
                uniforms: { uB: { type: 'vec3' } },
                source: 'engine-introspection',
              },
              {
                name: 'p2',
                vertexShader: 'v2',
                fragmentShader: 'f2',
                uniforms: { uC: { type: 'mat4' } },
                source: 'engine-introspection',
              },
            ],
          },
        ]).handleDumpShadersTool({ maxPrograms: 2, includeUniforms: false }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true) return `success !== true: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['totalPrograms'] !== 3) return `totalPrograms should stay 3 (page value)`;
        if (b['truncated'] !== true) return `truncated must be true when the cap clips`;
        const programs = (b['programs'] ?? []) as Array<Record<string, unknown>>;
        if (programs.length !== 2) return `expected 2 capped programs, got ${programs.length}`;
        for (const p of programs) {
          const uniforms = p['uniforms'] as Record<string, unknown>;
          if (!uniforms || Object.keys(uniforms).length !== 0)
            return `includeUniforms=false must strip uniforms: ${JSON.stringify(p)}`;
        }
        return true;
      },
    },
    {
      name: 'canvas_memory_invariants/orphan-context-violation',
      tool: 'canvas_memory_invariants',
      origin: 'homemade',
      reference:
        'INV-1 (JSidentify-V2 arXiv 2508.01655): 3 live WebGL contexts over 1 canvas element = 2 orphaned contexts → high-severity violation + a force-context-release recommendation; a scene-synced baseline yields zero violations',
      run: async () => {
        const violating = await scriptedHandlers([
          {
            engine: 'three',
            canvases: 1,
            webglContexts: 3,
            textures: 4,
            programs: 2,
            drawCalls: 10,
            sceneNodes: 5,
            engineInfo: { programCount: 2, geometryCount: 5 },
            contextLossEvents: 0,
          },
        ]).handleMemoryInvariantsTool({});
        const clean = await scriptedHandlers([
          {
            engine: 'three',
            canvases: 1,
            webglContexts: 1,
            textures: 4,
            programs: 2,
            drawCalls: 10,
            sceneNodes: 5,
            engineInfo: { programCount: 2, geometryCount: 5 },
            contextLossEvents: 0,
          },
        ]).handleMemoryInvariantsTool({});
        return { violating: body(violating), clean: body(clean) };
      },
      validate: (v) => {
        const r = v as Record<string, Record<string, unknown>>;
        const bad = r['violating'] ?? {};
        const violations = (bad['violations'] ?? []) as Array<Record<string, unknown>>;
        const orphan = violations.find((x) => x['id'] === 'webgl-context-orphan');
        if (!orphan)
          return `expected the orphan-context violation: ${JSON.stringify(bad).slice(0, 220)}`;
        if (orphan['severity'] !== 'high')
          return `severity should be high for 2 orphans: ${JSON.stringify(orphan)}`;
        if (bad['violationCount'] !== violations.length || violations.length !== 1)
          return `violationCount inconsistent: ${JSON.stringify({ count: bad['violationCount'], len: violations.length })}`;
        const checks = (bad['checks'] ?? []) as Array<Record<string, unknown>>;
        const failed = checks.filter((c) => c['passed'] === false);
        if (failed.length !== 1 || failed[0]?.['id'] !== 'webgl-context-orphan')
          return `only INV-1 should fail: ${JSON.stringify(failed)}`;
        const recs = (bad['recommendations'] ?? []) as Array<Record<string, unknown>>;
        if (!recs.some((x) => x['kind'] === 'force-context-release'))
          return `expected a force-context-release recommendation`;
        const clean = r['clean'] ?? {};
        const cleanChecks = (clean['checks'] ?? []) as unknown[];
        if (clean['violationCount'] !== 0 || cleanChecks.length !== 4)
          return `clean metrics must pass all 4 invariants: ${JSON.stringify(clean).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'skia_detect_renderer/swiftshader-backend-classification',
      tool: 'skia_detect_renderer',
      origin: 'homemade',
      reference:
        'renderer probe classification: a SwiftShader unmasked renderer marks the target Skia-backed with the software backend / Raster pipeline, extracts the version, and accumulates 0.7 confidence (0.1 base + 0.5 webgl + 0.1 font)',
      run: () =>
        skiaHandlers([
          [
            {
              vendor: 'Google Inc.',
              renderer: 'WebKit WebGL',
              unmaskedRenderer: 'SwiftShader Device (1.2.3)',
              unmaskedVendor: 'Google',
              hasSkiaBackend: true,
              backend: 'swiftshader',
            },
          ],
          { hasSkiaFontSignatures: true, textMetrics: null },
          { engines: [], isSkiaEngine: false },
        ]).handleSkiaDetectRendererTool({}),
      validate: (v) => {
        const b = body(v);
        const info = b['rendererInfo'] as Record<string, unknown> | undefined;
        if (!info) return `rendererInfo missing: ${JSON.stringify(b).slice(0, 200)}`;
        if (info['isSkiaBacked'] !== true) return `isSkiaBacked should be true`;
        if (info['gpuBackend'] !== 'software')
          return `gpuBackend ${String(info['gpuBackend'])} != software`;
        if (info['shaderPipeline'] !== 'Raster')
          return `shaderPipeline ${String(info['shaderPipeline'])} != Raster`;
        if (info['version'] !== '1.2.3') return `version ${String(info['version'])} != 1.2.3`;
        if (info['confidence'] !== 0.7) return `confidence ${String(info['confidence'])} != 0.7`;
        if (b['detectionComplete'] !== true) return `detectionComplete not set`;
        return true;
      },
    },
    {
      name: 'skia_extract_scene/no-scene-graph-honest-error',
      tool: 'skia_extract_scene',
      origin: 'homemade',
      reference:
        'honest unsupported: the DOM exposes no Skia scene graph, so extraction must fail with a named NOT_FOUND reason rather than return an empty tree as success',
      run: () =>
        skiaHandlers([{ canvas: {}, layers: [], drawCommands: [] }]).handleSkiaExtractSceneTool({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false)
          return `expected success=false, got ${JSON.stringify(b).slice(0, 200)}`;
        if (!/Skia scene extraction is not supported/.test(String(b['error'])))
          return `expected the NOT_FOUND extraction reason, got "${String(b['error'])}"`;
        if (b['sceneTree'] !== undefined) return `must not return a sceneTree on failure`;
        return true;
      },
    },
    {
      name: 'skia_correlate_objects/no-scene-graph-honest-error',
      tool: 'skia_correlate_objects',
      origin: 'homemade',
      reference:
        'honest unsupported: correlation needs an extracted Skia scene, so with no scene graph it must fail with a named reason instead of reporting zero correlations as success',
      run: () =>
        skiaHandlers([{ canvas: {}, layers: [], drawCommands: [] }]).handleSkiaCorrelateObjectsTool(
          {},
        ),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false)
          return `expected success=false, got ${JSON.stringify(b).slice(0, 200)}`;
        if (!/Skia object correlation is not supported/.test(String(b['error'])))
          return `expected the NOT_FOUND correlation reason, got "${String(b['error'])}"`;
        if (b['correlations'] !== undefined) return `must not return correlations on failure`;
        return true;
      },
    },
  ],
};
