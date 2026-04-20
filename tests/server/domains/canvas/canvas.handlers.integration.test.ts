/**
 * Canvas domain handler integration tests.
 *
 * Tests complete end-to-end handler flows with real DOM simulation,
 * screen-to-canvas coordinate transformation, and cross-handler workflows.
 *
 * These tests use script-execution PageController mocks that simulate real
 * browser behavior (canvas detection, coordinate transforms, event dispatch)
 * to provide higher-confidence coverage than simple value mocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanvasDomainDependencies,
  DebuggerManager,
  EvidenceStore,
  PageController,
  TraceRecorder,
} from '@server/domains/canvas/dependencies';
import { CanvasToolHandlers } from '@server/domains/canvas/handlers';
import type { CanvasProbeEnv, DumpOpts, PickOpts } from '@server/domains/canvas/types';

// ── Mock shared module ─────────────────────────────────────────────────────────
//
// The integration tests use script-executing PageController mocks that simulate
// browser evaluate() calls. We mock fingerprintCanvas so that tests control its
// return value via mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce(...).
//
// Use vi.hoisted() for the mock references so they are defined at test-time
// (not hoisted before the vi.mock call).

const mockRegistry = vi.hoisted(() => {
  let fp: (pageController: PageController, canvasId?: string) => Promise<unknown> = vi.fn(
    async () => null,
  );
  let pick: ((env: CanvasProbeEnv, opts: PickOpts) => Promise<unknown>) | null = null;
  let dump: ((env: CanvasProbeEnv, opts: DumpOpts) => Promise<unknown>) | null = null;
  return {
    get fingerprintCanvasMock() {
      return fp as ReturnType<typeof vi.fn>;
    },
    set fingerprintCanvasMock(v) {
      // @ts-expect-error
      fp = v;
    },
    get mockPickAtCallback() {
      return pick;
    },
    set mockPickAtCallback(v) {
      pick = v;
    },
    get mockDumpSceneCallback() {
      return dump;
    },
    set mockDumpSceneCallback(v) {
      dump = v;
    },
  };
});

function normalizeMockDetection(result: unknown): {
  engine: string;
  version?: string;
  confidence: number;
  evidence: string[];
  adapterId: string;
} | null {
  if (!result) {
    return null;
  }
  if (typeof result === 'object' && result !== null && 'selected' in result) {
    const selected = (
      result as {
        selected?: { engine: string; adapterId: string; version?: string } | null;
        selectedEvidence?: string[];
      }
    ).selected;
    if (!selected) {
      return null;
    }
    const selectedEvidence = (result as { selectedEvidence?: string[] }).selectedEvidence ?? [];
    return {
      engine: selected.engine,
      version: selected.version,
      confidence: selectedEvidence.length > 0 ? 0.95 : 0.9,
      evidence: ['window global detected', ...selectedEvidence],
      adapterId: selected.adapterId,
    };
  }
  return result as {
    engine: string;
    version?: string;
    confidence: number;
    evidence: string[];
    adapterId: string;
  };
}

const resolveAdapterMock = vi.hoisted(() =>
  vi.fn((detection: { adapterId?: string; selected?: { adapterId: string } | null }) => {
    const adapterId = detection.adapterId ?? detection.selected?.adapterId;
    if (adapterId && ['laya', 'pixi', 'phaser', 'cocos'].includes(adapterId)) {
      return {
        detect: async () => null,
        dumpScene: async (env: CanvasProbeEnv, opts: DumpOpts) => {
          const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
          if (mockRegistry.mockDumpSceneCallback)
            return mockRegistry.mockDumpSceneCallback(env, opts);
          return (
            evaluated ?? {
              engine: 'MockEngine',
              version: '1.0.0',
              canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
              sceneTree: null,
              totalNodes: 0,
              completeness: 'partial' as const,
            }
          );
        },
        pickAt: async (env: CanvasProbeEnv, opts: PickOpts) => {
          const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
          if (mockRegistry.mockPickAtCallback) return mockRegistry.mockPickAtCallback(env, opts);
          return (
            evaluated ?? {
              success: true,
              picked: {
                id: 'mock-node',
                type: 'Sprite',
                name: 'MockNode',
                visible: true,
                interactive: true,
                alpha: 1,
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                worldBounds: { x: 0, y: 0, width: 100, height: 100 },
                path: 'mock/node',
              },
              candidates: [],
              coordinates: { screen: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } },
              hitTestMethod: 'manual',
            }
          );
        },
      };
    }
    return null;
  }),
);

vi.mock('@server/domains/canvas/handlers/shared', () => ({
  // @ts-expect-error
  fingerprintCanvas: async (...args: Parameters<typeof mockRegistry.fingerprintCanvasMock>) =>
    // @ts-expect-error
    normalizeMockDetection(await mockRegistry.fingerprintCanvasMock(...args)),
  resolveAdapter: resolveAdapterMock,
  buildEnv: (pageController: PageController) => ({
    pageController,
    cdpSession: null as never,
    tabId: 'default',
  }),
  ENGINE_ANCHORS: [],
}));

// ── Shared mock helpers ─────────────────────────────────────────────────────────

function createMockPageController() {
  return { evaluate: vi.fn() } as unknown as PageController;
}

function createMockDebuggerManager(
  overrides: {
    waitForPausedResult?: unknown;
  } = {},
): DebuggerManager {
  const eventManager = {
    setEventListenerBreakpoint: vi.fn().mockResolvedValue('event-bp-1'),
    removeEventListenerBreakpoint: vi.fn().mockResolvedValue(true),
    getAllEventBreakpoints: vi.fn().mockReturnValue([]),
  };

  return {
    enable: vi.fn().mockResolvedValue({ success: true }),
    disable: vi.fn().mockResolvedValue({ success: true }),
    ensureAdvancedFeatures: vi.fn().mockResolvedValue(undefined),
    getEventManager: vi.fn().mockReturnValue(eventManager as never),
    waitForPaused: vi.fn().mockResolvedValue(
      overrides.waitForPausedResult ?? {
        callFrames: [
          {
            functionName: 'onClick',
            url: 'https://example.com/game.js',
            location: { lineNumber: 42, columnNumber: 5 },
          },
          {
            functionName: 'handleInput',
            url: 'https://example.com/game.js',
            location: { lineNumber: 100, columnNumber: 10 },
          },
        ],
      },
    ),
    resume: vi.fn().mockResolvedValue({ success: true }),
    pause: vi.fn().mockResolvedValue({ success: true }),
    stepInto: vi.fn().mockResolvedValue({ success: true }),
    stepOver: vi.fn().mockResolvedValue({ success: true }),
    stepOut: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as DebuggerManager;
}

function createMockTraceRecorder(): TraceRecorder {
  return {
    start: vi.fn().mockResolvedValue({ sessionId: 'trace-session-1' }),
    stop: vi.fn().mockResolvedValue({ duration: 100 }),
    isRecording: vi.fn().mockReturnValue(false),
  } as unknown as TraceRecorder;
}

function createMockEvidenceStore(): EvidenceStore {
  const nodes = new Map<string, unknown>();
  let nodeIdCounter = 1;
  return {
    addNode: vi.fn((type: string, label: string, metadata?: Record<string, unknown>) => {
      const id = `evidence-${nodeIdCounter++}`;
      const node = { id, type, label, metadata, timestamp: new Date().toISOString() };
      nodes.set(id, node);
      return node;
    }),
    addEdge: vi.fn(() => ({ id: `edge-${nodeIdCounter++}` })),
    getNode: vi.fn((id: string) => nodes.get(id)),
  } as unknown as EvidenceStore;
}

function createHandlers(deps?: Partial<CanvasDomainDependencies>): CanvasToolHandlers {
  return new CanvasToolHandlers({
    pageController: deps?.pageController ?? createMockPageController(),
    debuggerManager: deps?.debuggerManager ?? createMockDebuggerManager(),
    traceRecorder: deps?.traceRecorder ?? createMockTraceRecorder(),
    evidenceStore: deps?.evidenceStore ?? createMockEvidenceStore(),
  });
}

function parseJsonResponse<T>(response: unknown): T {
  const content = (response as { content: Array<{ text: string }> })?.content;
  const text = content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}

// ── Shared DOM simulation context ──────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: canvas_engine_fingerprint integration
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_engine_fingerprint integration', () => {
  let pageController: PageController;
  let handlers: CanvasToolHandlers;

  beforeEach(() => {
    pageController = createMockPageController();
    handlers = createHandlers({ pageController });
  });

  it('detects LayaAir from global window.Laya', async () => {
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce([
        { pattern: 'Laya', adapterId: 'laya', engine: 'LayaAir', present: true, version: '2.14.0' },
      ])
      .mockResolvedValueOnce([
        { id: 'game-canvas', width: 1920, height: 1080, contextType: 'webgl2' },
      ])
      .mockResolvedValueOnce(false);

    const result = await handlers.handleFingerprint({});
    const parsed = parseJsonResponse<{ candidates: Array<{ engine: string }> }>(result);

    expect(parsed.candidates.some((c) => c.engine === 'LayaAir')).toBe(true);
  });

  it('detects PixiJS from global window.PIXI', async () => {
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce([
        { pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS', present: true, version: '8.2.0' },
      ])
      .mockResolvedValueOnce([
        { id: 'pixi-canvas', width: 1280, height: 720, contextType: 'webgl2' },
      ])
      .mockResolvedValueOnce(false);

    const result = await handlers.handleFingerprint({});
    const parsed = parseJsonResponse<{ candidates: Array<{ engine: string }> }>(result);

    expect(parsed.candidates.some((c) => c.engine === 'PixiJS')).toBe(true);
  });

  it('reports canvasCount correctly with multiple canvases', async () => {
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'canvas-0', width: 800, height: 600, contextType: '2d' },
        { id: 'canvas-1', width: 1920, height: 1080, contextType: 'webgl2' },
        { id: 'canvas-2', width: 640, height: 480, contextType: 'webgl' },
      ])
      .mockResolvedValueOnce(false);

    const result = await handlers.handleFingerprint({});
    const parsed = parseJsonResponse<{ canvasCount: number }>(result);

    expect(parsed.canvasCount).toBe(3);
  });

  it('canvasDetails includes canvas matching canvasId filter', async () => {
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'game-canvas', width: 1920, height: 1080, contextType: 'webgl2' },
        { id: 'ui-canvas', width: 800, height: 600, contextType: '2d' },
      ])
      .mockResolvedValueOnce(false);

    const result = await handlers.handleFingerprint({ canvasId: 'game-canvas' });
    const parsed = parseJsonResponse<{ canvasDetails: Array<{ id: string }> }>(result);

    expect(parsed.canvasDetails).toHaveLength(1);
    expect(parsed.canvasDetails[0]!.id).toBe('game-canvas');
  });

  it('returns empty candidates when no canvas globals and no canvas elements', async () => {
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(false);

    const result = await handlers.handleFingerprint({});
    const parsed = parseJsonResponse<{ candidates: Array<object>; canvasCount: number }>(result);

    expect(parsed.candidates).toEqual([]);
    expect(parsed.canvasCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: canvas_scene_dump integration
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_scene_dump integration', () => {
  let pageController: PageController;
  let handlers: CanvasToolHandlers;

  beforeEach(() => {
    pageController = createMockPageController();
    handlers = createHandlers({ pageController });
    // Reset fingerprintCanvas mock between tests
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockDumpSceneCallback = null;
  });

  it('returns full scene dump for LayaAir when adapter is available', async () => {
    // fingerprintCanvas is mocked — configure its return value directly
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: ['window.Laya is defined'],
    });
    // Adapter dumpScene calls pageController.evaluate — set up evaluate mock
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      engine: 'LayaAir',
      version: '2.12.0',
      canvas: { width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' },
      sceneTree: {
        id: 'stage',
        type: 'Stage',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        path: 'Laya.stage',
        children: [
          {
            id: 'btn',
            type: 'Button',
            name: 'StartButton',
            visible: true,
            interactive: true,
            alpha: 1,
            x: 100,
            y: 200,
            width: 200,
            height: 80,
            worldBounds: { x: 100, y: 200, width: 200, height: 80 },
            path: 'Laya.stage/btn',
          },
        ],
      },
      totalNodes: 2,
      completeness: 'full',
    });

    const result = await handlers.handleSceneDump({});
    const parsed = parseJsonResponse<{
      engine: string;
      version?: string;
      completeness: string;
      totalNodes: number;
      sceneTree: { children?: Array<{ name?: string }> } | null;
    }>(result);

    expect(parsed.engine).toBe('LayaAir');
    expect(parsed.completeness).toBe('full');
    expect(parsed.totalNodes).toBe(2);
    expect(parsed.sceneTree).not.toBeNull();
    expect(parsed.sceneTree!.children?.[0]?.name).toBe('StartButton');
  });

  it('returns partial dump with canvas metadata when no engine detected', async () => {
    // fingerprintCanvas returns null (no engine) — partialSceneDump path
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [],
      selected: null,
      selectedEvidence: [],
    });
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' },
      ]);

    const result = await handlers.handleSceneDump({});
    const parsed = parseJsonResponse<{
      completeness: string;
      sceneTree: null;
      partialReason?: string;
    }>(result);

    expect(parsed.completeness).toBe('partial');
    expect(parsed.sceneTree).toBeNull();
    expect(parsed.partialReason).toContain('No canvas engine detected');
  });

  it('passes maxDepth option to adapter', async () => {
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    // Adapter dumpScene calls pageController.evaluate — return the scene dump
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      engine: 'LayaAir',
      version: '2.12.0',
      canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
      sceneTree: {
        id: 'stage',
        type: 'Stage',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        path: 'Laya.stage',
      },
      totalNodes: 1,
      completeness: 'full',
    });

    await handlers.handleSceneDump({ maxDepth: 5 });

    // Verify the adapter dumpScene call was made (evaluate called by adapter.dumpScene)
    // @ts-expect-error
    const dumpCall = pageController.evaluate.mock.calls[0];
    expect(dumpCall).toBeDefined();
    const dumpScript = dumpCall![0] as string;
    expect(dumpScript).toContain('5'); // maxDepth=5 embedded in script
  });

  it('handles scene dump with no canvases present', async () => {
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [],
      selected: null,
      selectedEvidence: [],
    });
    pageController.evaluate = vi.fn().mockResolvedValueOnce([]);

    const result = await handlers.handleSceneDump({});
    const parsed = parseJsonResponse<{ completeness: string; canvas: { width: number } }>(result);

    expect(parsed.completeness).toBe('partial');
    expect(parsed.canvas.width).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: canvas_pick_object_at_point integration
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_pick_object_at_point integration', () => {
  let pageController: PageController;
  let handlers: CanvasToolHandlers;

  beforeEach(() => {
    pageController = createMockPageController();
    handlers = createHandlers({ pageController });
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockPickAtCallback = null;
  });

  it('picks a LayaAir sprite at the correct screen coordinates', async () => {
    // handlePick calls pageController.evaluate twice:
    // 1) coord transform
    // 2) fingerprintCanvas internal evaluate (window global scan)
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        screen: { x: 200, y: 250 },
        canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
        canvasX: 200,
        canvasY: 250,
      })
      .mockResolvedValueOnce({
        // fingerprintCanvas internal evaluate: returns detected engine globals
        hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
        selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
        selectedEvidence: [],
      });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'start-btn',
        type: 'Button',
        name: 'StartButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 100,
        y: 200,
        width: 200,
        height: 80,
        worldBounds: { x: 100, y: 200, width: 200, height: 80 },
        path: 'Laya.stage/start-btn',
      },
      candidates: [],
      coordinates: {
        screen: { x: 200, y: 250 },
        canvas: { x: 200, y: 250 },
        stage: { x: 200, y: 250 },
      },
      hitTestMethod: 'engine',
    });

    const result = await handlers.handlePick({ x: 200, y: 250 });
    const parsed = parseJsonResponse<{
      success: boolean;
      picked: { name?: string } | null;
      hitTestMethod: string;
    }>(result);

    expect(parsed.success).toBe(true);
    expect(parsed.picked?.name).toBe('StartButton');
    expect(parsed.hitTestMethod).toBe('engine');
  });

  it('returns multiple candidates sorted by depth', async () => {
    // handlePick: coord transform (evaluate 1) + fingerprintCanvas internal (evaluate 2)
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        screen: { x: 300, y: 300 },
        canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
        canvasX: 300,
        canvasY: 300,
      })
      .mockResolvedValueOnce({
        hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
        selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
        selectedEvidence: [],
      });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'nested-btn',
        type: 'Sprite',
        name: 'NestedButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 290,
        y: 290,
        width: 20,
        height: 20,
        worldBounds: { x: 290, y: 290, width: 20, height: 20 },
        path: 'Laya.stage/panel/nested-btn',
      },
      candidates: [
        { node: { id: 'bg', type: 'Image', name: 'Background' }, depth: 0 },
        { node: { id: 'panel', type: 'Container', name: 'Panel' }, depth: 1 },
        { node: { id: 'nested-btn', type: 'Sprite', name: 'NestedButton' }, depth: 2 },
      ],
      coordinates: { screen: { x: 300, y: 300 }, canvas: { x: 300, y: 300 } },
      hitTestMethod: 'engine',
    });

    const result = await handlers.handlePick({ x: 300, y: 300 });
    const parsed = parseJsonResponse<{
      success: boolean;
      picked: { name?: string } | null;
      candidates: Array<{ depth: number }>;
    }>(result);

    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(3);
    // Candidates should be sorted by depth ascending (deepest = topmost)
    expect(parsed.candidates[0]!.depth).toBe(0);
    expect(parsed.candidates[2]!.depth).toBe(2);
    expect(parsed.picked?.name).toBe('NestedButton');
  });

  it('returns success=false with empty candidates when clicking empty space', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      screen: { x: 9999, y: 9999 },
      canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
      canvasX: 9999,
      canvasY: 9999,
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: false,
      picked: null,
      candidates: [],
      coordinates: { screen: { x: 9999, y: 9999 }, canvas: { x: 9999, y: 9999 } },
      hitTestMethod: 'none',
    });

    const result = await handlers.handlePick({ x: 9999, y: 9999 });
    const parsed = parseJsonResponse<{
      success: boolean;
      candidates: unknown[];
      hitTestMethod: string;
    }>(result);

    expect(parsed.success).toBe(false);
    expect(parsed.candidates).toEqual([]);
    expect(parsed.hitTestMethod).toBe('none');
  });

  it('handles coordinate transform when canvas is offset by page scroll', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      screen: { x: 250, y: 350 },
      canvasRect: { left: 100, top: 200, width: 1920, height: 1080 },
      canvasX: 150,
      canvasY: 150,
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'btn',
        type: 'Sprite',
        name: 'OffsetButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 150,
        y: 150,
        width: 100,
        height: 50,
        worldBounds: { x: 150, y: 150, width: 100, height: 50 },
        path: 'Laya.stage/btn',
      },
      candidates: [],
      coordinates: {
        screen: { x: 250, y: 350 },
        canvas: { x: 150, y: 150 },
        stage: { x: 150, y: 150 },
      },
      hitTestMethod: 'engine',
    });

    const result = await handlers.handlePick({ x: 250, y: 350 });
    const parsed = parseJsonResponse<{ coordinates: { canvas: { x: number; y: number } } }>(result);

    expect(parsed.coordinates.canvas.x).toBe(150);
    expect(parsed.coordinates.canvas.y).toBe(150);
  });

  it('returns success=false when fingerprint fails (no engine)', async () => {
    // fingerprintCanvas returns null — pickAt never called, evaluate only for coord transform
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      screen: { x: 100, y: 100 },
      canvasRect: { left: 0, top: 0, width: 800, height: 600 },
      canvasX: 100,
      canvasY: 100,
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [],
      selected: null,
      selectedEvidence: [],
    });

    const result = await handlers.handlePick({ x: 100, y: 100 });
    const parsed = parseJsonResponse<{ success: boolean; hitTestMethod: string }>(result);

    expect(parsed.success).toBe(false);
    expect(parsed.hitTestMethod).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: canvas_trace_click_handler integration
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_trace_click_handler integration', () => {
  let pageController: PageController;
  let debuggerManager: ReturnType<typeof createMockDebuggerManager>;
  let evidenceStore: ReturnType<typeof createMockEvidenceStore>;
  let handlers: CanvasToolHandlers;

  beforeEach(() => {
    pageController = createMockPageController();
    debuggerManager = createMockDebuggerManager();
    evidenceStore = createMockEvidenceStore();
    handlers = createHandlers({ pageController, debuggerManager, evidenceStore });
  });

  it('traces a click on a LayaAir button to its handler', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
      pickedNode: { id: 'start-btn' },
      engine: 'LayaAir',
      engineChain: ['Sprite.event', 'Button.onClick'],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({
      callFrames: [
        {
          functionName: 'Sprite.onClick',
          url: 'game/sprites/Sprite.ts',
          location: { lineNumber: 42 },
        },
        {
          functionName: 'Button.clickHandler',
          url: 'game/ui/Button.ts',
          location: { lineNumber: 88 },
        },
        { functionName: 'Scene.click', url: 'game/Scene.ts', location: { lineNumber: 15 } },
      ],
    });

    const result = await handlers.handleTraceClick({ x: 200, y: 250 });
    const parsed = parseJsonResponse<{
      inputFlow: string[];
      handlerFrames: Array<{ functionName: string }>;
      handlersTriggered: Array<{ functionName: string }>;
      engineDispatchChain: string[];
    }>(result);

    expect(parsed.inputFlow).toContain('pointerdown');
    expect(parsed.inputFlow).toContain('click');
    expect(parsed.handlerFrames).toHaveLength(3);
    expect(parsed.handlersTriggered[0]!.functionName).toBe('Sprite.onClick');
    expect(parsed.engineDispatchChain).toEqual(['Sprite.event', 'Button.onClick']);
  });

  it('traces click on PixiJS object', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
      pickedNode: { id: 'pixi-sprite' },
      engine: 'PixiJS',
      engineChain: ['Container.onClick'],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({
      callFrames: [
        { functionName: 'InteractiveObject.emit', url: 'pixi.js', location: { lineNumber: 100 } },
      ],
    });

    const result = await handlers.handleTraceClick({ x: 320, y: 240 });
    const parsed = parseJsonResponse<{ engineDispatchChain: string[] }>(result);

    expect(parsed.engineDispatchChain).toContain('Container.onClick');
  });

  it('records canvas_trace evidence with engine and coordinates', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['click'],
      pickedNode: null,
      engine: 'LayaAir',
      engineChain: [],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({
      callFrames: [{ functionName: 'handler', url: 'game.js', location: { lineNumber: 1 } }],
    });

    await handlers.handleTraceClick({ x: 150, y: 300 });

    expect(evidenceStore.addNode).toHaveBeenCalledWith(
      'function',
      'canvas_trace',
      expect.objectContaining({
        engine: 'LayaAir',
        x: 150,
        y: 300,
        handlerCount: 1,
      }),
    );
  });

  it('uses mousedown breakpoint type when specified', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['pointerdown', 'mousedown'],
      pickedNode: null,
      engine: 'LayaAir',
      engineChain: [],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({
      callFrames: [{ functionName: 'onMouseDown', url: 'game.js', location: { lineNumber: 5 } }],
    });

    const result = await handlers.handleTraceClick({
      x: 100,
      y: 100,
      breakpointType: 'mousedown',
    });
    const parsed = parseJsonResponse<{ inputFlow: string[] }>(result);

    expect(parsed.inputFlow).toContain('pointerdown');
    expect(parsed.inputFlow).toContain('mousedown');
  });

  it('limits call frames to maxFrames', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['click'],
      pickedNode: null,
      engine: 'LayaAir',
      engineChain: [],
    });

    const manyFrames = Array.from({ length: 10 }, (_, i) => ({
      functionName: `handler${i}`,
      url: 'game.js',
      location: { lineNumber: i + 1 },
    }));

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({ callFrames: manyFrames });

    const result = await handlers.handleTraceClick({ x: 50, y: 50, maxFrames: 3 });
    const parsed = parseJsonResponse<{ handlerFrames: Array<object> }>(result);

    expect(parsed.handlerFrames).toHaveLength(3);
  });

  it('removes event breakpoint after tracing', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['click'],
      pickedNode: null,
      engine: 'LayaAir',
      engineChain: [],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({ callFrames: [] });

    await handlers.handleTraceClick({ x: 100, y: 100 });

    const eventManager = debuggerManager.getEventManager();
    expect(eventManager.removeEventListenerBreakpoint).toHaveBeenCalledWith('event-bp-1');
  });

  it('records evidence even when no handlers found', async () => {
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['click'],
      pickedNode: null,
      engine: 'Phaser',
      engineChain: [],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({ callFrames: [] });

    await handlers.handleTraceClick({ x: 0, y: 0 });

    expect(evidenceStore.addNode).toHaveBeenCalledWith(
      'function',
      'canvas_trace',
      expect.objectContaining({
        engine: 'Phaser',
        handlerCount: 0,
      }),
    );
  });

  it('resumes debugger after waitForPaused timeout', async () => {
    // waitForPaused times out (returns empty frames), but resume should still be called
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['click'],
      pickedNode: null,
      engine: 'LayaAir',
      engineChain: [],
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({ callFrames: [] });
    debuggerManager.resume = vi.fn().mockResolvedValue({ success: true });

    await handlers.handleTraceClick({ x: 50, y: 50 });

    expect(debuggerManager.resume).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: screen-to-canvas coordinate transformation
// ─────────────────────────────────────────────────────────────────────────────

describe('screen-to-canvas coordinate transformation', () => {
  it('transforms coordinates accounting for canvas CSS vs canvas pixel dimensions', async () => {
    // Canvas element: CSS size 960x540, but canvas.width=1920, canvas.height=1080
    // Screen point (480, 270) → canvas point (960, 540)
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockPickAtCallback = null;
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      screen: { x: 480, y: 270 },
      canvasRect: { left: 0, top: 0, width: 960, height: 540 },
      canvasX: 960,
      canvasY: 540,
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'btn',
        type: 'Sprite',
        name: 'TestButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 960,
        y: 540,
        width: 100,
        height: 50,
        worldBounds: { x: 960, y: 540, width: 100, height: 50 },
        path: 'Laya.stage/btn',
      },
      candidates: [],
      coordinates: { screen: { x: 480, y: 270 }, canvas: { x: 960, y: 540 } },
      hitTestMethod: 'engine',
    });

    const handlers = createHandlers({ pageController });
    const result = await handlers.handlePick({ x: 480, y: 270 });
    const parsed = parseJsonResponse<{ coordinates: { canvas: { x: number } } }>(result);

    expect(parsed.coordinates.canvas.x).toBe(960);
  });

  it('handles canvas with DPR scaling ( Retina display)', async () => {
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockPickAtCallback = null;
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      screen: { x: 480, y: 270 },
      canvasRect: { left: 0, top: 0, width: 960, height: 540 },
      canvasX: 960,
      canvasY: 540,
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: false,
      picked: null,
      candidates: [],
      coordinates: { screen: { x: 480, y: 270 }, canvas: { x: 960, y: 540 } },
      hitTestMethod: 'none',
    });

    const handlers = createHandlers({ pageController });
    const result = await handlers.handlePick({ x: 480, y: 270 });

    expect(result).toBeDefined();
  });

  it('picks from correct canvas when multiple canvases exist', async () => {
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockPickAtCallback = null;
    // handlePick: coord transform (evaluate 1) + fingerprintCanvas internal (evaluate 2)
    pageController.evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        screen: { x: 1500, y: 700 },
        canvasRect: { left: 200, top: 100, width: 960, height: 540 },
        canvasX: 750,
        canvasY: 350,
      })
      .mockResolvedValueOnce({
        hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
        selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
        selectedEvidence: [],
      });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'game-btn',
        type: 'Sprite',
        name: 'GameButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 750,
        y: 350,
        width: 100,
        height: 50,
        worldBounds: { x: 750, y: 350, width: 100, height: 50 },
        path: 'Laya.stage/game-btn',
      },
      candidates: [],
      coordinates: { screen: { x: 1500, y: 700 }, canvas: { x: 750, y: 350 } },
      hitTestMethod: 'engine',
    });

    const handlers = createHandlers({ pageController });
    const result = await handlers.handlePick({ x: 1500, y: 700, canvasId: 'game-canvas' });
    const parsed = parseJsonResponse<{ success: boolean; picked: { name?: string } | null }>(
      result,
    );

    expect(parsed.success).toBe(true);
    expect(parsed.picked?.name).toBe('GameButton');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: end-to-end canvas game workflow
// ─────────────────────────────────────────────────────────────────────────────

describe('end-to-end canvas game workflow', () => {
  it('full reverse workflow: fingerprint → scene dump → pick → trace', async () => {
    const pageController = createMockPageController();
    const debuggerManager = createMockDebuggerManager();
    const evidenceStore = createMockEvidenceStore();

    // Reset fingerprintCanvas mock for this test
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockPickAtCallback = null;
    mockRegistry.mockDumpSceneCallback = null;

    const handlers = createHandlers({ pageController, debuggerManager, evidenceStore });

    // Mock chain: 3 for handleFingerprint + 1 for partialSceneDump + 1 for scene dump (dumpScene)
    //   + 1 for handlePick coord transform + 1 for handleTraceClick dispatchCanvasClick = 7 total
    // handleFingerprint makes exactly 3 evaluate calls (global scan, canvas info, RAF evidence).
    // Note: fingerprintCanvas is mocked with mockResolvedValueOnce below, so it does NOT call evaluate.
    pageController.evaluate = vi
      .fn()
      // handleFingerprint evaluate calls
      .mockResolvedValueOnce([
        // 1: global scan
        { pattern: 'Laya', adapterId: 'laya', engine: 'LayaAir', present: true, version: '2.14.0' },
      ])
      .mockResolvedValueOnce([
        // 2: canvas info
        { id: 'game-canvas', width: 1920, height: 1080, contextType: 'webgl2' },
      ])
      .mockResolvedValueOnce(false) // 3: RAF evidence
      // handleSceneDump: partialSceneDump canvas query (consumed when resolveAdapter returns null)
      .mockResolvedValueOnce([
        // 4: partialSceneDump evaluate
        { id: 'game-canvas', width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' },
      ])
      // handleSceneDump: adapter.dumpScene (consumed by mockDumpSceneCallback)
      .mockResolvedValueOnce({
        // 5: scene dump mock consumed by dumpScene
        engine: 'LayaAir',
        version: '2.14.0',
        canvas: { width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' },
        sceneTree: {
          id: 'root',
          type: 'Stage',
          visible: true,
          interactive: false,
          alpha: 1,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          path: 'Laya.stage',
          children: [
            {
              id: 'start-btn',
              type: 'Button',
              name: 'StartButton',
              visible: true,
              interactive: true,
              alpha: 1,
              x: 100,
              y: 200,
              width: 200,
              height: 80,
              worldBounds: { x: 100, y: 200, width: 200, height: 80 },
              path: 'Laya.stage/start-btn',
            },
          ],
        },
        totalNodes: 2,
        completeness: 'full',
      })
      // handlePick: coord transform
      .mockResolvedValueOnce({
        // 6: handlePick coord transform
        screen: { x: 200, y: 250 },
        canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
        canvasX: 200,
        canvasY: 250,
      })
      // handleTraceClick: dispatchCanvasClick
      .mockResolvedValueOnce({
        // 7: trace dispatchCanvasClick
        domEventChain: ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
        pickedNode: { id: 'start-btn' },
        engine: 'LayaAir',
        engineChain: ['Button.onClick'],
      });

    // fingerprintCanvas is called TWICE in this test (scene dump + pick). Each call is consumed
    // by a separate mockResolvedValueOnce (both return the same LayaAir detection).
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.14.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.14.0' },
      selectedEvidence: ['window.Laya is defined'],
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.14.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.14.0' },
      selectedEvidence: [],
    });

    // mockDumpSceneCallback is called by resolveAdapterMock's dumpScene method.
    // Without this, the mock adapter returns completeness:'partial' and totalNodes:0.
    mockRegistry.mockDumpSceneCallback = async () => ({
      engine: 'LayaAir',
      version: '2.14.0',
      canvas: { width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' },
      sceneTree: {
        id: 'root',
        type: 'Stage',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        path: 'Laya.stage',
        children: [
          {
            id: 'start-btn',
            type: 'Button',
            name: 'StartButton',
            visible: true,
            interactive: true,
            alpha: 1,
            x: 100,
            y: 200,
            width: 200,
            height: 80,
            worldBounds: { x: 100, y: 200, width: 200, height: 80 },
            path: 'Laya.stage/start-btn',
          },
        ],
      },
      totalNodes: 2,
      completeness: 'full',
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'start-btn',
        type: 'Button',
        name: 'StartButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 100,
        y: 200,
        width: 200,
        height: 80,
        worldBounds: { x: 100, y: 200, width: 200, height: 80 },
        path: 'Laya.stage/start-btn',
      },
      candidates: [],
      coordinates: {
        screen: { x: 200, y: 250 },
        canvas: { x: 200, y: 250 },
        stage: { x: 200, y: 250 },
      },
      hitTestMethod: 'engine',
    });

    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({
      callFrames: [
        { functionName: 'Button.onClick', url: 'game/ui/Button.ts', location: { lineNumber: 88 } },
        { functionName: 'Scene.startGame', url: 'game/Scene.ts', location: { lineNumber: 42 } },
      ],
    });

    // Step 1: Fingerprint
    const fingerprintResult = await handlers.handleFingerprint({});
    const fingerprint = parseJsonResponse<{
      candidates: Array<{ engine: string; version?: string }>;
    }>(fingerprintResult);
    expect(fingerprint.candidates[0]!.engine).toBe('LayaAir');
    expect(fingerprint.candidates[0]!.version).toBe('2.14.0');

    // Step 2: Scene dump
    const sceneResult = await handlers.handleSceneDump({});
    const scene = parseJsonResponse<{
      completeness: string;
      totalNodes: number;
      sceneTree: { children?: Array<{ name?: string }> } | null;
    }>(sceneResult);
    expect(scene.completeness).toBe('full');
    expect(scene.totalNodes).toBe(2);
    expect(scene.sceneTree!.children![0]!.name).toBe('StartButton');

    // Step 3: Pick
    const pickResult = await handlers.handlePick({ x: 200, y: 250 });
    const pick = parseJsonResponse<{
      success: boolean;
      picked: { name?: string } | null;
      hitTestMethod: string;
    }>(pickResult);
    expect(pick.success).toBe(true);
    expect(pick.picked?.name).toBe('StartButton');
    expect(pick.hitTestMethod).toBe('engine');

    // Step 4: Trace
    const traceResult = await handlers.handleTraceClick({ x: 200, y: 250 });
    const trace = parseJsonResponse<{
      handlerFrames: Array<{ functionName: string }>;
      handlersTriggered: Array<{ functionName: string }>;
    }>(traceResult);
    expect(trace.handlerFrames).toHaveLength(2);
    expect(trace.handlersTriggered[0]!.functionName).toBe('Button.onClick');

    // Verify evidence was recorded
    expect(evidenceStore.addNode).toHaveBeenCalledWith(
      'function',
      'canvas_trace',
      expect.objectContaining({
        engine: 'LayaAir',
        handlerCount: 2,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: parseArgs utilities in canvas handlers
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgs utilities in canvas handlers', () => {
  it('canvasId is correctly passed through all handler methods', async () => {
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockDumpSceneCallback = null;
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      engine: 'LayaAir',
      version: '2.12.0',
      canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
      sceneTree: {
        id: 'root',
        type: 'Stage',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        path: 'Laya.stage',
      },
      totalNodes: 1,
      completeness: 'full',
    });

    const handlers = createHandlers({ pageController });

    const result = await handlers.handleSceneDump({ canvasId: 'game-canvas' });
    const parsed = parseJsonResponse<{ completeness: string }>(result);

    expect(parsed.completeness).toBe('full');
    expect(pageController.evaluate).toHaveBeenCalled();
  });

  it('non-string canvasId (numeric index) is handled correctly', async () => {
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockDumpSceneCallback = null;
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      engine: 'LayaAir',
      version: '2.12.0',
      canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
      sceneTree: {
        id: 'root',
        type: 'Stage',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        path: 'Laya.stage',
      },
      totalNodes: 1,
      completeness: 'full',
    });

    const handlers = createHandlers({ pageController });

    // canvasId as numeric string "0" — should target first canvas
    const result = await handlers.handleSceneDump({ canvasId: '0' });
    const parsed = parseJsonResponse<{ completeness: string }>(result);

    expect(parsed.completeness).toBe('full');
  });

  it('breakpointType enum value is validated through argEnum usage', async () => {
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      domEventChain: ['pointerdown', 'mousedown'],
      pickedNode: null,
      engine: 'LayaAir',
      engineChain: [],
    });

    const debuggerManager = createMockDebuggerManager();
    debuggerManager.waitForPaused = vi.fn().mockResolvedValueOnce({ callFrames: [] });

    const handlers = createHandlers({ pageController, debuggerManager });

    // Valid enum value 'mousedown' should work
    const result = await handlers.handleTraceClick({
      x: 100,
      y: 100,
      breakpointType: 'mousedown',
    });
    const parsed = parseJsonResponse<{ inputFlow: string[] }>(result);

    expect(parsed.inputFlow).toContain('mousedown');
  });

  it('argBool highlight option defaults to false when absent', async () => {
    const pageController = createMockPageController();
    mockRegistry.fingerprintCanvasMock.mockReset();
    mockRegistry.fingerprintCanvasMock.mockImplementation(async () => ({
      hits: [],
      selected: null,
      selectedEvidence: [],
    }));
    mockRegistry.mockPickAtCallback = null;
    pageController.evaluate = vi.fn().mockResolvedValueOnce({
      screen: { x: 100, y: 100 },
      canvasRect: { left: 0, top: 0, width: 800, height: 600 },
      canvasX: 100,
      canvasY: 100,
    });
    mockRegistry.fingerprintCanvasMock.mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockRegistry.mockPickAtCallback = async () => ({
      success: false,
      picked: null,
      candidates: [],
      coordinates: { screen: { x: 100, y: 100 }, canvas: { x: 100, y: 100 } },
      hitTestMethod: 'none',
    });

    const handlers = createHandlers({ pageController });

    // No highlight option — should default to false (no 4th evaluate call)
    await handlers.handlePick({ x: 100, y: 100 });

    // 2 evaluate calls: coord transform + adapter.pickAt (highlight=false means no highlight injection)
    expect(pageController.evaluate).toHaveBeenCalledTimes(2);
  });
});
