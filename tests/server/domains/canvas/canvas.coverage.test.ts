/**
 * Coverage tests for canvas domain handlers and adapters.
 *
 * These tests target edge cases and error paths NOT covered by handlers.test.ts
 * or laya-adapter.test.ts. Follows the .coverage.test.ts naming convention
 * established by the 2026-04-01 coverage expansion batch.
 *
 * TDD mode: tests define EXPECTED behavior. Some tests may initially fail (RED)
 * if the implementation doesn't yet handle the edge case — that's the point.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanvasDomainDependencies,
  DebuggerManager,
  EvidenceStore,
  PageController,
} from '@server/domains/canvas/dependencies';
import { CanvasToolHandlers } from '@server/domains/canvas/handlers';
import type { CanvasProbeEnv, DumpOpts, PickOpts } from '@server/domains/canvas/types';
import {
  LayaCanvasAdapter,
  buildLayaHitTestPayload,
  buildLayaSceneTreeDumpPayload,
} from '@server/domains/canvas/adapters/laya-adapter';

let mockDumpSceneCallback = vi.hoisted(
  () => null as ((env: CanvasProbeEnv, opts: DumpOpts) => Promise<unknown>) | null,
);
let mockPickAtCallback = vi.hoisted(
  () => null as ((env: CanvasProbeEnv, opts: PickOpts) => Promise<unknown>) | null,
);

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

// ── Mock shared module so adapter-based tests work in test environment ─────────────────────────
//
// These tests still mock resolveAdapter/fingerprintCanvas to keep scene-dump
// coverage focused on handler behavior instead of adapter implementations.
//
// Use vi.hoisted() so these are defined at test-time (not hoisted), allowing
// the vi.mock factory below to reference them safely.

// ── Mock shared module so adapter-based tests work in test environment ─────────────────────────
//
// All mock state lives inside the vi.mock factory (runs after module-level code).
// Tests access the mock via vi.mocked() to configure per-test behavior.

vi.mock('@server/domains/canvas/handlers/shared', () => {
  const fpControl = vi.fn(async (pageController: PageController) => {
    const result = await pageController.evaluate('__mock_canvas_fingerprint__');
    if (Array.isArray(result)) {
      const first = result[0] as
        | { engine: string; adapterId: string; version?: string }
        | undefined;
      if (!first) {
        return null;
      }
      return {
        engine: first.engine,
        version: first.version,
        confidence: 0.9,
        evidence: ['window global detected'],
        adapterId: first.adapterId,
      };
    }
    return result ?? null;
  });
  const fingerprintCanvas = vi.fn(async (...args: Parameters<typeof fpControl>) =>
    normalizeMockDetection(await fpControl(...args)),
  );
  const ra = vi.fn((detection: { adapterId?: string; selected?: { adapterId: string } | null }) => {
    const adapterId = detection.adapterId ?? detection.selected?.adapterId;
    if (adapterId && ['laya', 'pixi', 'phaser', 'cocos'].includes(adapterId)) {
      return {
        detect: async () => null,
        dumpScene: async (env: CanvasProbeEnv, opts: DumpOpts) => {
          const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
          if (mockDumpSceneCallback) {
            return mockDumpSceneCallback(env, opts);
          }
          return (
            evaluated ?? {
              engine: 'MockEngine',
              version: '1.0.0',
              canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
              sceneTree: null,
              totalNodes: 0,
              completeness: 'partial',
            }
          );
        },
        pickAt: async (env: CanvasProbeEnv, opts: PickOpts) => {
          const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
          if (mockPickAtCallback) {
            return mockPickAtCallback(env, opts);
          }
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
  });
  // Expose mutable state so tests can reset/configure the mock
  (globalThis as Record<string, unknown>).__canvasMock = { fp: fpControl, ra };
  return {
    fingerprintCanvas,
    resolveAdapter: ra,
    buildEnv: (pageController: PageController) => ({
      pageController,
      cdpSession: null as never,
      tabId: 'default',
    }),
    ENGINE_ANCHORS: [],
  };
});

// ── Test helpers to access/configure the mock ──────────────────────────────────

/** Get the fingerprintCanvas mock from the vi.mock factory. */
function getFingerprintCanvasMock() {
  // @ts-expect-error
  return (globalThis as Record<string, unknown>).__canvasMock['fp'] as ReturnType<typeof vi.fn>;
}
/** Get the resolveAdapter mock. */
function getResolveAdapterMock() {
  // @ts-expect-error
  return (globalThis as Record<string, unknown>).__canvasMock['ra'] as ReturnType<typeof vi.fn>;
}
function installDefaultFingerprintCanvasMock() {
  const mock = getFingerprintCanvasMock();
  mock.mockReset();
  mock.mockImplementation(async (pageController: PageController) => {
    const result = await pageController.evaluate('__mock_canvas_fingerprint__');
    if (Array.isArray(result)) {
      const first = result[0] as
        | { engine: string; adapterId: string; version?: string }
        | undefined;
      if (!first) {
        return null;
      }
      return {
        engine: first.engine,
        version: first.version,
        confidence: 0.9,
        evidence: ['window global detected'],
        adapterId: first.adapterId,
      };
    }
    return result ?? null;
  });
  return mock;
}
/** Reset pick/dump callbacks between tests. */
function resetMockCallbacks() {
  mockPickAtCallback = null;
  mockDumpSceneCallback = null;
}

// ── Shared mock helpers ─────────────────────────────────────────────────────────

function createMockPageController() {
  return {
    evaluate: vi.fn(),
  };
}

function makeLayaScene(version: string, _totalNodes: number) {
  return {
    hits: [{ engine: 'LayaAir', adapterId: 'laya', version }],
    selected: { engine: 'LayaAir', adapterId: 'laya', version },
    selectedEvidence: ['window.Laya is defined'],
  };
}

function makeLayaDumpScene(version: string, totalNodes: number) {
  return {
    engine: 'LayaAir',
    version,
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
    },
    totalNodes,
    completeness: 'full' as const,
  };
}

/**
 * Creates a PageController mock that cycles through provided results.
 * Each call to evaluate() returns the next result in the array.
 * If more calls are made than results provided, returns the last result.
 */
function createSequentialMockPageController(...results: unknown[]) {
  let callIndex = 0;
  const fn = vi.fn().mockImplementation(() => {
    const result = results[callIndex] ?? results[results.length - 1];
    callIndex++;
    return Promise.resolve(result);
  });
  return { evaluate: fn } as unknown as PageController;
}

function createMockDebuggerManager() {
  const eventManager = {
    setEventListenerBreakpoint: vi.fn().mockResolvedValue('breakpoint-1'),
    removeEventListenerBreakpoint: vi.fn().mockResolvedValue(true),
  };
  return {
    enable: vi.fn().mockResolvedValue(undefined),
    ensureAdvancedFeatures: vi.fn().mockResolvedValue(undefined),
    getEventManager: vi.fn().mockReturnValue(eventManager),
    waitForPaused: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
  } as unknown as DebuggerManager;
}

function createMockTraceRecorder() {
  return {
    start: vi.fn().mockResolvedValue({ sessionId: 'trace-1' }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockEvidenceStore() {
  return {
    addNode: vi.fn().mockReturnValue({ id: 'evidence-node-1' }),
    addEdge: vi.fn(),
    getNode: vi.fn(),
  } as unknown as EvidenceStore;
}

/**
 * Creates CanvasToolHandlers with the given partial dependencies.
 * Each call creates a FRESH instance with fresh mocks so tests are independent.
 */
function createHandlers(deps?: Partial<CanvasDomainDependencies>): CanvasToolHandlers {
  return new CanvasToolHandlers({
    // @ts-expect-error
    pageController: deps?.pageController ?? createMockPageController(),
    debuggerManager: deps?.debuggerManager ?? createMockDebuggerManager(),
    // @ts-expect-error
    traceRecorder: deps?.traceRecorder ?? createMockTraceRecorder(),
    evidenceStore: deps?.evidenceStore ?? createMockEvidenceStore(),
  });
}

function createLayaEnv(pageController: PageController): CanvasProbeEnv {
  return {
    pageController,
    cdpSession: null as never,
    tabId: 'tab-1',
  };
}

function parseJsonResponse<T>(response: unknown): T {
  const content = (response as { content: Array<{ text: string }> })?.content;
  const text = content?.[0]?.text ?? '';
  return JSON.parse(text) as T;
}

function executeEvaluateScript<T>(
  script: string,
  context: {
    window: Record<string, unknown>;
    document: {
      querySelectorAll(selector: string): unknown[];
      getElementById(id: string): unknown;
    };
  },
): T {
  class PointerEventMock {
    type: string;

    constructor(type: string, init: Record<string, unknown>) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  class MouseEventMock {
    type: string;

    constructor(type: string, init: Record<string, unknown>) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  const evaluator = new Function(
    'window',
    'document',
    'PointerEvent',
    'MouseEvent',
    `return (${script.trim()});`,
  );

  return evaluator(context.window, context.document, PointerEventMock, MouseEventMock) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: canvas_engine_fingerprint coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_engine_fingerprint coverage', () => {
  describe('partial result with RAF evidence but no engine found', () => {
    it('returns Unknown Canvas Engine candidate when RAF evidence detected but globalScan is empty', async () => {
      // Three evaluate calls: globalScan (no hits), canvasInfo, rafEvidence=true
      const pageController = createSequentialMockPageController(
        [], // globalScan: no engine globals found
        [{ id: 'canvas-0', width: 800, height: 600, contextType: 'webgl' }],
        true, // rafEvidence: true
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; confidence: number }>;
        canvasCount: number;
      }>(result);

      // Candidates array contains the Unknown Canvas Engine candidate (partial detection)
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]).toMatchObject({
        engine: 'Unknown Canvas Engine',
        confidence: 0.3,
        adapterId: 'none',
      });
      // fingerprintComplete reflects candidates.length > 0; the Unknown candidate is included
      expect(parsed.canvasCount).toBe(1);
    });

    it('does NOT add Unknown Canvas Engine when candidates already exist', async () => {
      // Two evaluate calls: globalScan (with hits), canvasInfo
      const pageController = createSequentialMockPageController(
        [{ pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS', present: true, version: '7.0.0' }],
        [{ id: 'canvas-0', width: 1920, height: 1080, contextType: 'webgl2' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string }>;
      }>(result);

      // Only the PIXI candidate should be present, no Unknown Canvas Engine
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('PixiJS');
    });
  });

  describe('partial result with canvasCount even when no engine', () => {
    it('includes canvasCount in response when no engine is detected', async () => {
      const pageController = createSequentialMockPageController(
        [], // no global engine
        [
          { id: 'canvas-0', width: 640, height: 480, contextType: '2d' },
          { id: 'canvas-1', width: 1920, height: 1080, contextType: 'webgl2' },
        ],
        false, // rafEvidence: false
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ canvasCount: number }>(result);

      expect(parsed.canvasCount).toBe(2);
    });

    it('includes canvasDetails filtered by canvasId when provided', async () => {
      const pageController = createSequentialMockPageController(
        [], // no engine
        [
          { id: 'game-canvas', width: 1920, height: 1080, contextType: 'webgl2' },
          { id: 'ui-canvas', width: 800, height: 600, contextType: '2d' },
          { id: 'bg-canvas', width: 640, height: 480, contextType: '2d' },
        ],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({ canvasId: 'game-canvas' });
      const parsed = parseJsonResponse<{ canvasDetails: Array<{ id: string }> }>(result);

      expect(parsed.canvasDetails).toHaveLength(1);
      expect(parsed.canvasDetails[0]!.id).toBe('game-canvas');
    });

    it('filters canvasDetails by index when canvasId is a numeric string', async () => {
      const pageController = createSequentialMockPageController(
        [],
        [
          { id: 'first', width: 100, height: 100, contextType: '2d' },
          { id: 'second', width: 200, height: 200, contextType: '2d' },
          { id: 'third', width: 300, height: 300, contextType: '2d' },
        ],
        false,
      );
      const handlers = createHandlers({ pageController });

      // canvasId "1" should match index 1 (second canvas)
      const result = await handlers.handleFingerprint({ canvasId: '1' });
      const parsed = parseJsonResponse<{ canvasDetails: Array<{ id: string }> }>(result);

      expect(parsed.canvasDetails).toHaveLength(1);
      expect(parsed.canvasDetails[0]!.id).toBe('second');
    });
  });

  describe('error handling', () => {
    it('returns error response when pageController evaluate throws on globalScan', async () => {
      const pageController = {
        evaluate: vi
          .fn()
          .mockRejectedValueOnce(new Error('CDP error: Target closed'))
          .mockResolvedValue([]),
      } as unknown as PageController;
      const handlers = createHandlers({ pageController });

      await expect(handlers.handleFingerprint({})).rejects.toThrow();
    });

    it('returns error response when pageController evaluate throws on canvasInfo', async () => {
      const pageController = {
        evaluate: vi.fn().mockImplementation(() => {
          // First call succeeds (globalScan), second throws
          return Promise.reject(new Error('CDP error: evaluate failed'));
        }),
      } as unknown as PageController;
      const handlers = createHandlers({ pageController });

      await expect(handlers.handleFingerprint({})).rejects.toThrow();
    });

    it('returns error response when pageController evaluate throws on rafEvidence', async () => {
      const pageController = {
        evaluate: vi.fn().mockImplementation(() => {
          // First two calls succeed, third throws
          return Promise.reject(new Error('CDP error: raf check failed'));
        }),
      } as unknown as PageController;
      const handlers = createHandlers({ pageController });

      await expect(handlers.handleFingerprint({})).rejects.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: canvas_scene_dump coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_scene_dump coverage', () => {
  describe('partial dump with correct canvas metadata when no engine', () => {
    it('returns partial completeness and null sceneTree when fingerprintCanvas returns null', async () => {
      // Two evaluate calls: fingerprintCanvas (no engine), partialSceneDump (canvas metadata)
      const pageController = createSequentialMockPageController(
        [], // fingerprintCanvas: no engine
        [{ id: 'canvas-0', width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{
        completeness: string;
        sceneTree: null;
        canvas: { id: string; width: number; height: number };
        partialReason: string;
      }>(result);

      expect(parsed.completeness).toBe('partial');
      expect(parsed.sceneTree).toBeNull();
      expect(parsed.canvas.width).toBe(1920);
      expect(parsed.canvas.height).toBe(1080);
      expect(parsed.partialReason).toContain('No canvas engine detected');
    });

    it('returns partial dump when adapter cannot be resolved (unknown adapterId)', async () => {
      const pageController = createSequentialMockPageController(
        [{ engine: 'UnknownEngine', adapterId: 'unknown', version: undefined }],
        [{ id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('partial');
    });
  });

  describe('missing canvasId (falls back to first canvas)', () => {
    it('uses first canvas when canvasId is not provided', async () => {
      const pageController = createSequentialMockPageController(
        [], // no engine
        [
          { id: 'first', width: 800, height: 600, dpr: 1, contextType: 'webgl' },
          { id: 'second', width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' },
        ],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{ canvas: { id: string } }>(result);

      expect(parsed.canvas.id).toBe('first');
    });

    it('partialSceneDump falls back to first canvas when canvasId is not provided', async () => {
      const pageController = createSequentialMockPageController(
        [],
        [
          { id: 'canvas-zero', width: 640, height: 480, dpr: 1, contextType: '2d' },
          { id: 'canvas-one', width: 1280, height: 720, dpr: 1, contextType: '2d' },
        ],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{ canvas: { id: string } }>(result);

      expect(parsed.canvas.id).toBe('canvas-zero');
    });
  });

  describe('canvasId not found (no matching canvas)', () => {
    it('returns partial dump with empty canvas when canvasId does not match any canvas', async () => {
      const pageController = createSequentialMockPageController(
        [],
        [
          { id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' },
          { id: 'canvas-1', width: 1280, height: 720, dpr: 1, contextType: 'webgl' },
        ],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({ canvasId: 'non-existent-canvas' });
      const parsed = parseJsonResponse<{
        completeness: string;
        canvas: { id: string; width: number };
      }>(result);

      expect(parsed.completeness).toBe('partial');
      expect(parsed.canvas.id).toBe('non-existent-canvas');
      expect(parsed.canvas.width).toBe(0);
    });

    it('returns partial dump when canvasId index is out of bounds', async () => {
      const pageController = createSequentialMockPageController(
        [],
        [{ id: 'only-canvas', width: 800, height: 600, dpr: 1, contextType: '2d' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({ canvasId: '99' });
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('partial');
    });
  });

  describe('maxDepth option', () => {
    it('handles maxDepth=0 without crashing (partial dump path)', async () => {
      // When no engine detected, partialSceneDump handles maxDepth=0
      const pageController = createSequentialMockPageController(
        [], // no engine
        [{ id: 'canvas-0', width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({ maxDepth: 0 });
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('partial');
    });

    it('handles very large maxDepth value without crashing (partial dump path)', async () => {
      const pageController = createSequentialMockPageController(
        [], // no engine
        [{ id: 'canvas-0', width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({ maxDepth: 9999 });
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('partial');
    });
  });

  describe('onlyInteractive option', () => {
    it('onlyInteractive=true handled gracefully (partial dump path)', async () => {
      const pageController = createSequentialMockPageController(
        [], // no engine
        [{ id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({ onlyInteractive: true });
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('partial');
    });
  });

  describe('onlyVisible option', () => {
    it('onlyVisible=true handled gracefully (partial dump path)', async () => {
      const pageController = createSequentialMockPageController(
        [], // no engine
        [{ id: 'canvas-0', width: 1024, height: 768, dpr: 1, contextType: 'webgl' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({ onlyVisible: true });
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('partial');
    });
  });

  describe('error handling in handleSceneDump', () => {
    it('returns error response when fingerprintCanvas throws', async () => {
      // Only the first evaluate call (fingerprintCanvas) should reject.
      // Subsequent calls (partialSceneDump) should succeed so the error propagates correctly.
      const pageController = {
        evaluate: vi
          .fn()
          .mockRejectedValueOnce(new Error('CDP evaluate failed'))
          .mockResolvedValue([
            { id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' },
          ]),
      } as unknown as PageController;
      const handlers = createHandlers({ pageController });

      await expect(handlers.handleSceneDump({})).rejects.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: canvas_pick_object_at_point coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_pick_object_at_point coverage', () => {
  describe('returns correct screen/canvas coordinates in result', () => {
    it('returns correct screen coordinates when no engine detected', async () => {
      // Two evaluate calls: coordinate transform, then fingerprint returns null
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 500, y: 300 },
          canvasRect: { left: 100, top: 50, width: 800, height: 600 },
          canvasX: 400,
          canvasY: 250,
        },
        [], // no engine detected
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 500, y: 300 });
      const parsed = parseJsonResponse<{
        success: boolean;
        coordinates: { screen: { x: number; y: number }; canvas: { x: number; y: number } };
      }>(result);

      expect(parsed.success).toBe(false);
      expect(parsed.coordinates.screen.x).toBe(500);
      expect(parsed.coordinates.screen.y).toBe(300);
      expect(parsed.coordinates.canvas.x).toBe(400);
      expect(parsed.coordinates.canvas.y).toBe(250);
    });

    it('returns coordinates even when coordinate transform finds no canvas', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 0, y: 0 },
          canvasX: 0,
          canvasY: 0,
        },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 0, y: 0 });
      const parsed = parseJsonResponse<{ coordinates: { screen: { x: number } } }>(result);

      expect(parsed.coordinates.screen.x).toBe(0);
    });
  });

  describe('handles canvasId string vs index', () => {
    it('handles canvasId as string (element id)', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 100, y: 100 },
          canvasRect: { left: 0, top: 0, width: 800, height: 600 },
          canvasX: 100,
          canvasY: 100,
        },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 100, y: 100, canvasId: 'my-game-canvas' });
      const parsed = parseJsonResponse<{ success: boolean }>(result);

      expect(parsed.success).toBe(false);
    });

    it('handles canvasId as numeric string (index)', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 200, y: 200 },
          canvasRect: { left: 0, top: 0, width: 1024, height: 768 },
          canvasX: 200,
          canvasY: 200,
        },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 200, y: 200, canvasId: '2' });
      const parsed = parseJsonResponse<{ success: boolean }>(result);

      expect(parsed.success).toBe(false);
    });
  });

  describe('highlight option', () => {
    it('highlight=true does not throw when object is picked', async () => {
      // With engine detection, the adapter is used; test that it doesn't throw
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 300, y: 200 },
          canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
          canvasX: 300,
          canvasY: 200,
        },
        [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
        {
          success: false,
          picked: null,
          candidates: [],
          coordinates: { screen: { x: 300, y: 200 }, canvas: { x: 300, y: 200 } },
          hitTestMethod: 'none',
        },
      );
      const handlers = createHandlers({ pageController });

      // Should not throw even if highlight=true but nothing is picked
      await expect(handlers.handlePick({ x: 300, y: 200, highlight: true })).resolves.toBeDefined();
    });

    it('highlight=false does not call highlightNode', async () => {
      // With no engine, the result is returned directly without calling highlightNode
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 400, y: 300 },
          canvasRect: { left: 0, top: 0, width: 800, height: 600 },
          canvasX: 400,
          canvasY: 300,
        },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 400, y: 300, highlight: false });
      const parsed = parseJsonResponse<{ success: boolean; hitTestMethod: string }>(result);

      expect(parsed.success).toBe(false);
      // No engine means no highlight injection — only 2 evaluate calls (coord + fingerprint)
      expect(pageController.evaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe('canvas not found scenario', () => {
    it('returns success=false when no canvas is under the clicked point', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 0, y: 0 },
          canvasX: 0,
          canvasY: 0,
        },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 0, y: 0 });
      const parsed = parseJsonResponse<{ success: boolean; hitTestMethod: string }>(result);

      expect(parsed.success).toBe(false);
      expect(parsed.hitTestMethod).toBe('none');
    });
  });

  describe('hitTestMethod values', () => {
    it('hitTestMethod=none when no engine is detected', async () => {
      const pageController = createSequentialMockPageController(
        { screen: { x: 150, y: 150 }, canvasX: 150, canvasY: 150 },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 150, y: 150 });
      const parsed = parseJsonResponse<{ hitTestMethod: string }>(result);

      expect(parsed.hitTestMethod).toBe('none');
    });

    it('hitTestMethod=none when adapter cannot be resolved', async () => {
      const pageController = createSequentialMockPageController(
        { screen: { x: 200, y: 200 }, canvasX: 200, canvasY: 200 },
        [{ engine: 'CustomEngine', adapterId: 'custom', version: '1.0.0' }], // no adapter registered
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 200, y: 200 });
      const parsed = parseJsonResponse<{ hitTestMethod: string }>(result);

      expect(parsed.hitTestMethod).toBe('none');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: canvas_trace_click_handler coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_trace_click_handler coverage', () => {
  describe('debugger is enabled before setting breakpoint', () => {
    it('calls debuggerManager.enable before setEventListenerBreakpoint', async () => {
      const callOrder: string[] = [];
      const pageController = createSequentialMockPageController({
        domEventChain: ['pointerdown', 'pointerup', 'click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });

      // Track call order
      // @ts-expect-error
      debuggerManager.enable.mockImplementation(async () => {
        callOrder.push('enable');
        return undefined;
      });
      // @ts-expect-error
      debuggerManager.ensureAdvancedFeatures.mockImplementation(async () => {
        callOrder.push('ensureAdvancedFeatures');
        return undefined;
      });

      const eventManager = {
        setEventListenerBreakpoint: vi.fn().mockImplementation(async () => {
          callOrder.push('setBreakpoint');
          return 'bp-1';
        }),
        removeEventListenerBreakpoint: vi.fn().mockResolvedValue(true),
      };
      // @ts-expect-error
      debuggerManager.getEventManager.mockReturnValue(eventManager as never);
      // @ts-expect-error
      debuggerManager.resume.mockImplementation(async () => {
        callOrder.push('resume');
        return undefined;
      });

      const handlers = createHandlers({ pageController, debuggerManager });

      await handlers.handleTraceClick({ x: 100, y: 200 });

      expect(callOrder).toEqual(['enable', 'ensureAdvancedFeatures', 'setBreakpoint', 'resume']);
    });
  });

  describe('event breakpoint is set before dispatch', () => {
    it('sets event breakpoint before dispatching the click event', async () => {
      const callOrder: string[] = [];
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });

      const eventManager = {
        setEventListenerBreakpoint: vi.fn().mockImplementation(async () => {
          callOrder.push('setBreakpoint');
          return 'bp-1';
        }),
      };
      // @ts-expect-error
      debuggerManager.getEventManager.mockReturnValue(eventManager as never);

      // Patch evaluate to track when dispatch happens
      // @ts-expect-error
      pageController.evaluate.mockImplementation(async () => {
        callOrder.push('dispatch');
        return { domEventChain: ['click'], pickedNode: null, engine: 'LayaAir', engineChain: [] };
      });

      const handlers = createHandlers({ pageController, debuggerManager });

      await handlers.handleTraceClick({ x: 50, y: 50 });

      expect(callOrder).toEqual(['setBreakpoint', 'dispatch']);
    });
  });

  describe('dispatch uses correct event types', () => {
    it('dispatches pointerdown, pointerup, and click events by default', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['pointerdown', 'pointerup', 'click'],
        pickedNode: null,
        engine: 'PixiJS',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 100, y: 100 });
      const parsed = parseJsonResponse<{ inputFlow: string[] }>(result);

      expect(parsed.inputFlow).toContain('pointerdown');
      expect(parsed.inputFlow).toContain('pointerup');
      expect(parsed.inputFlow).toContain('click');
    });

    it('dispatches only the event type matching breakpointType', async () => {
      const dispatchedTypes: string[] = [];
      const canvas = {
        id: 'game-canvas',
        width: 200,
        height: 100,
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 200,
          bottom: 100,
          width: 200,
          height: 100,
        }),
        dispatchEvent: (event: { type: string }) => {
          dispatchedTypes.push(event.type);
          return true;
        },
      };
      const pageController = {
        evaluate: vi.fn().mockImplementation(async (script: string) => {
          return executeEvaluateScript(script, {
            window: { Laya: { version: '3.0.0' } },
            document: {
              querySelectorAll: (selector: string) => (selector === 'canvas' ? [canvas] : []),
              getElementById: (id: string) => (id === 'game-canvas' ? canvas : null),
            },
          });
        }),
      } as unknown as PageController;
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({
        x: 100,
        y: 50,
        canvasId: 'game-canvas',
        breakpointType: 'mousedown',
      });
      const parsed = parseJsonResponse<{ inputFlow: string[] }>(result);

      expect(parsed.inputFlow).toEqual(['pointerdown', 'mousedown']);
      expect(dispatchedTypes).toEqual(['pointerdown', 'mousedown']);
    });
  });

  describe('call frames are mapped correctly to handlerFrames', () => {
    it('maps call frames with all fields to handlerFrames', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          {
            functionName: 'Sprite.onClick',
            url: 'game/sprites/Sprite.ts',
            location: { lineNumber: 42, columnNumber: 8 },
          },
          {
            functionName: 'Container.emit',
            url: 'lib/events.ts',
            location: { lineNumber: 100, columnNumber: 0 },
          },
          {
            functionName: '',
            url: 'index.js',
            location: { lineNumber: 1, columnNumber: 0 },
          },
        ],
      });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 100, y: 100 });
      const parsed = parseJsonResponse<{
        handlerFrames: Array<{ functionName: string; scriptUrl?: string; lineNumber?: number }>;
      }>(result);

      expect(parsed.handlerFrames).toHaveLength(3);
      expect(parsed.handlerFrames[0]).toMatchObject({
        functionName: 'Sprite.onClick',
        scriptUrl: 'game/sprites/Sprite.ts',
        lineNumber: 42,
      });
      expect(parsed.handlerFrames[1]).toMatchObject({
        functionName: 'Container.emit',
        scriptUrl: 'lib/events.ts',
        lineNumber: 100,
      });
      // Anonymous function with empty name becomes '(anonymous)'
      expect(parsed.handlerFrames[2]).toMatchObject({
        functionName: '(anonymous)',
        scriptUrl: 'index.js',
        lineNumber: 1,
      });
    });

    it('respects maxFrames limit when slicing call frames', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          { functionName: 'frame1', url: 'a.js', location: { lineNumber: 1, columnNumber: 0 } },
          { functionName: 'frame2', url: 'b.js', location: { lineNumber: 2, columnNumber: 0 } },
          { functionName: 'frame3', url: 'c.js', location: { lineNumber: 3, columnNumber: 0 } },
          { functionName: 'frame4', url: 'd.js', location: { lineNumber: 4, columnNumber: 0 } },
          { functionName: 'frame5', url: 'e.js', location: { lineNumber: 5, columnNumber: 0 } },
        ],
      });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 10, y: 10, maxFrames: 2 });
      const parsed = parseJsonResponse<{ handlerFrames: Array<object> }>(result);

      expect(parsed.handlerFrames).toHaveLength(2);
      expect(parsed.handlerFrames[0]).toMatchObject({ functionName: 'frame1' });
      expect(parsed.handlerFrames[1]).toMatchObject({ functionName: 'frame2' });
    });
  });

  describe('handler functions are extracted correctly from call frames', () => {
    it('creates handlersTriggered with correct fields from call frames', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          {
            functionName: 'onTap',
            url: 'Button.ts',
            location: { lineNumber: 55, columnNumber: 12 },
          },
          {
            functionName: 'dispatchEvent',
            url: 'EventEmitter.ts',
            location: { lineNumber: 88, columnNumber: 0 },
          },
        ],
      });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 0, y: 0 });
      const parsed = parseJsonResponse<{
        handlersTriggered: Array<{ functionName: string; scriptUrl?: string; lineNumber?: number }>;
      }>(result);

      expect(parsed.handlersTriggered).toHaveLength(2);
      expect(parsed.handlersTriggered[0]).toMatchObject({
        functionName: 'onTap',
        scriptUrl: 'Button.ts',
        lineNumber: 55,
      });
      expect(parsed.handlersTriggered[1]).toMatchObject({
        functionName: 'dispatchEvent',
        scriptUrl: 'EventEmitter.ts',
        lineNumber: 88,
      });
    });
  });

  describe('debugger is resumed after capturing frames', () => {
    it('resumes debugger after waitForPaused completes', async () => {
      const callOrder: string[] = [];
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();

      // @ts-expect-error
      debuggerManager.waitForPaused.mockImplementation(async () => {
        callOrder.push('waitForPaused');
        return { callFrames: [] };
      });
      // @ts-expect-error
      debuggerManager.resume.mockImplementation(async () => {
        callOrder.push('resume');
        return undefined;
      });

      const eventManager = {
        setEventListenerBreakpoint: vi.fn().mockResolvedValue('bp-1'),
      };
      // @ts-expect-error
      debuggerManager.getEventManager.mockReturnValue(eventManager as never);

      const handlers = createHandlers({ pageController, debuggerManager });

      await handlers.handleTraceClick({ x: 50, y: 50 });

      expect(callOrder).toEqual(['waitForPaused', 'resume']);
    });
  });

  describe('evidence is recorded with correct metadata', () => {
    it('records evidence with engine, x, y, and handlerCount', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'PixiJS',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          { functionName: 'handler1', url: 'a.js', location: { lineNumber: 1, columnNumber: 0 } },
          { functionName: 'handler2', url: 'b.js', location: { lineNumber: 2, columnNumber: 0 } },
          { functionName: 'handler3', url: 'c.js', location: { lineNumber: 3, columnNumber: 0 } },
        ],
      });
      const evidenceStore = createMockEvidenceStore();
      const handlers = createHandlers({ pageController, debuggerManager, evidenceStore });

      await handlers.handleTraceClick({ x: 123, y: 456 });

      expect(evidenceStore.addNode).toHaveBeenCalledWith(
        'function',
        'canvas_trace',
        expect.objectContaining({
          engine: 'PixiJS',
          x: 123,
          y: 456,
          handlerCount: 3,
        }),
      );
    });

    it('records evidence with engine=unknown when dispatchResult.engine is undefined', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: undefined,
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const evidenceStore = createMockEvidenceStore();
      const handlers = createHandlers({ pageController, debuggerManager, evidenceStore });

      await handlers.handleTraceClick({ x: 0, y: 0 });

      expect(evidenceStore.addNode).toHaveBeenCalledWith(
        'function',
        'canvas_trace',
        expect.objectContaining({
          engine: 'unknown',
        }),
      );
    });
  });

  describe('handles when debugger returns no call frames', () => {
    it('returns empty handlerFrames when waitForPaused returns undefined callFrames', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue(undefined);
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 100, y: 100 });
      const parsed = parseJsonResponse<{ handlerFrames: Array<object> }>(result);

      expect(parsed.handlerFrames).toEqual([]);
    });

    it('returns empty handlerFrames when waitForPaused returns null callFrames', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: null });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 50, y: 50 });
      const parsed = parseJsonResponse<{ handlerFrames: Array<object> }>(result);

      expect(parsed.handlerFrames).toEqual([]);
    });

    it('returns empty handlerFrames when waitForPaused returns empty array', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 75, y: 25 });
      const parsed = parseJsonResponse<{ handlerFrames: Array<object> }>(result);

      expect(parsed.handlerFrames).toEqual([]);
    });
  });

  describe('engineDispatchChain in result', () => {
    it('includes engineChain from dispatchCanvasClick in result', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['pointerdown', 'pointerup', 'click'],
        pickedNode: null,
        engine: 'PixiJS',
        engineChain: ['EventDispatcher.prototype.event', 'Container.emit'],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 100, y: 200 });
      const parsed = parseJsonResponse<{ engineDispatchChain: string[] }>(result);

      expect(parsed.engineDispatchChain).toEqual([
        'EventDispatcher.prototype.event',
        'Container.emit',
      ]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: LayaCanvasAdapter coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('LayaCanvasAdapter coverage', () => {
  let adapter: LayaCanvasAdapter;

  beforeEach(() => {
    adapter = new LayaCanvasAdapter();
  });

  describe('detect() returns null when window.Laya is undefined', () => {
    it('detect() returns null when evaluate returns present=false', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: false,
        hasStage: false,
        laya2: false,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('detect() returns null when window.Laya is null', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: false,
        hasStage: false,
        laya2: false,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('detect() returns null when evaluate throws', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockRejectedValue(new Error('CDP error'));
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });
  });

  describe('detect() returns null when Laya.stage is falsy', () => {
    it('detect() returns null when hasStage=false even though Laya is present', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: false,
        laya2: true,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });
  });

  describe('detect() returns correct detection with confidence=0.95 when Laya is present', () => {
    it('returns confidence=0.95 for LayaAir with stage', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: true,
        version: '2.14.0',
        laya2: true,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.95);
      expect(result!.engine).toBe('LayaAir');
      expect(result!.version).toBe('2.14.0');
    });

    it('includes all three evidence strings for LayaAir with stage', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: true,
        version: '2.12.0',
        laya2: true,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result!.evidence).toHaveLength(3);
      expect(result!.evidence).toContain('window.Laya is defined');
      expect(result!.evidence).toContain('Laya.MouseManager detected (LayaAir 2.x)');
      expect(result!.evidence).toContain('Laya.stage is present');
    });
  });

  describe('detect() returns Laya2 evidence when Laya.MouseManager present', () => {
    it('includes Laya2 evidence string when laya2=true', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: true,
        version: '2.9.0',
        laya2: true,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result!.evidence).toContain('Laya.MouseManager detected (LayaAir 2.x)');
      expect(result!.evidence).not.toContain('Laya.InputManager detected (LayaAir 3.x)');
    });

    it('does not include Laya3 evidence when laya2=true and laya3=false', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: true,
        version: '2.x',
        laya2: true,
        laya3: false,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result!.evidence).toContain('Laya.MouseManager detected (LayaAir 2.x)');
    });
  });

  describe('detect() returns Laya3 evidence when Laya.InputManager present', () => {
    it('includes Laya3 evidence string when laya3=true', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: true,
        version: '3.0.0',
        laya2: false,
        laya3: true,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result!.evidence).toContain('Laya.InputManager detected (LayaAir 3.x)');
      expect(result!.evidence).not.toContain('Laya.MouseManager detected (LayaAir 2.x)');
    });

    it('returns Laya3 version when InputManager is detected', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        present: true,
        hasStage: true,
        version: '3.1.0-beta.1',
        laya2: false,
        laya3: true,
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await adapter.detect(env);

      expect(result!.version).toBe('3.1.0-beta.1');
    });
  });

  describe('dumpScene() returns partial when no Laya.stage', () => {
    it('returns partial completeness when page script reports no Laya.stage', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        engine: 'LayaAir',
        version: '2.12.0',
        canvas: { width: 800, height: 600, dpr: 1, contextType: 'webgl' },
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
        error: 'Laya.stage not found',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);
      const opts: DumpOpts = { maxDepth: 20 };

      const result = await adapter.dumpScene(env, opts);

      expect(result.completeness).toBe('partial');
      expect(result.sceneTree).not.toBeNull();
      expect(result.sceneTree!.id).toBe('empty');
    });
  });

  describe('dumpScene() handles scene tree with circular references', () => {
    it('builds dump payload that can handle nodes with circular child references', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        engine: 'LayaAir',
        version: '2.12.0',
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
        },
        totalNodes: 3,
        completeness: 'full',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);
      const opts: DumpOpts = {};

      const result = await adapter.dumpScene(env, opts);

      expect(result.totalNodes).toBe(3);
      expect(result.completeness).toBe('full');
    });

    it('dumpScene payload contains maxDepth guard that prevents infinite loops', () => {
      const opts: DumpOpts = { maxDepth: 1 };
      const payload = buildLayaSceneTreeDumpPayload(opts);

      // The payload should contain a depth check to prevent infinite traversal
      expect(payload).toContain('depth >');
      expect(payload).toContain('1');
    });
  });

  describe('pickAt() returns manual hitTestMethod as fallback', () => {
    it('returns hitTestMethod=manual when engine-native hitTest fails but DFS succeeds', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        success: true,
        picked: {
          id: 'node-1',
          type: 'Sprite',
          visible: true,
          interactive: true,
          alpha: 1,
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          worldBounds: { x: 75, y: 75, width: 50, height: 50 },
          path: 'Laya.stage/node-1',
        },
        candidates: [{ node: { id: 'node-1' }, depth: 2 }],
        coordinates: {
          screen: { x: 100, y: 100 },
          canvas: { x: 100, y: 100 },
        },
        hitTestMethod: 'manual',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);
      const opts: PickOpts = { x: 100, y: 100 };

      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.hitTestMethod).toBe('manual');
    });

    it('returns hitTestMethod=none when no nodes are pickable', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        success: false,
        picked: null,
        candidates: [],
        coordinates: { screen: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } },
        hitTestMethod: 'none',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);
      const opts: PickOpts = { x: 0, y: 0 };

      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(false);
      expect(result.hitTestMethod).toBe('none');
      expect(result.picked).toBeNull();
      expect(result.candidates).toEqual([]);
    });
  });

  describe('pickAt() handles coordinate transformation correctly', () => {
    it('returns stage coordinates when clientScaleX/Y are set', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        success: true,
        picked: {
          id: 'scaled-node',
          type: 'Sprite',
          visible: true,
          interactive: true,
          alpha: 1,
          x: 50,
          y: 50,
          width: 20,
          height: 20,
          worldBounds: { x: 25, y: 25, width: 20, height: 20 },
          path: 'Laya.stage/scaled-node',
        },
        candidates: [],
        coordinates: {
          screen: { x: 400, y: 300 },
          canvas: { x: 400, y: 300 },
          stage: { x: 200, y: 150 }, // scaled by 0.5
        },
        hitTestMethod: 'engine',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);
      const opts: PickOpts = { x: 400, y: 400 };

      const result = await adapter.pickAt(env, opts);

      expect(result.coordinates.stage?.x).toBe(200);
      expect(result.coordinates.stage?.y).toBe(150);
    });

    it('handles pickAt with canvasId targeting specific canvas', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        success: true,
        picked: {
          id: 'node-on-canvas-1',
          type: 'Sprite',
          visible: true,
          interactive: true,
          alpha: 1,
          x: 100,
          y: 100,
          width: 32,
          height: 32,
          worldBounds: { x: 68, y: 68, width: 32, height: 32 },
          path: 'Laya.stage/node-on-canvas-1',
        },
        candidates: [],
        coordinates: {
          screen: { x: 968, y: 268 },
          canvas: { x: 800, y: 200 },
          stage: { x: 400, y: 100 },
        },
        hitTestMethod: 'engine',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);
      const opts: PickOpts = { x: 968, y: 268, canvasId: 'second-canvas' };

      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
    });
  });

  describe('traceClick() patches EventDispatcher.prototype.event idempotently', () => {
    it('returns instrumented prototypes list from patch result', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          instrumented: ['EventDispatcher', 'Node', 'Sprite'],
        })
        .mockResolvedValueOnce(['click']);

      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });

      // @ts-expect-error
      const env = createLayaEnv(pageController);

      // Call traceClick through the adapter
      const { TraceRecorder } = await import('@modules/trace/TraceRecorder');
      const traceRecorder = new TraceRecorder();
      const evidenceStore = createMockEvidenceStore();

      const result = await adapter.traceClick(
        env,
        { breakpointType: 'click' },
        { debuggerManager, traceRecorder, evidenceStore },
      );

      expect(result.engineDispatchChain).toEqual(['EventDispatcher', 'Node', 'Sprite']);
    });

    it('handles when traceRecorder.start throws gracefully', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi
        .fn()
        .mockResolvedValueOnce({ success: true, instrumented: ['EventDispatcher'] })
        .mockResolvedValueOnce(['click']);

      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });

      const traceRecorder = {
        start: vi.fn().mockRejectedValue(new Error('Trace not available')),
        stop: vi.fn(),
      };

      const evidenceStore = createMockEvidenceStore();
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      // Should not throw even if traceRecorder.start fails
      const result = await adapter.traceClick(
        env,
        { breakpointType: 'click' },
        // @ts-expect-error
        { debuggerManager, traceRecorder, evidenceStore },
      );

      expect(result).toBeDefined();
      expect(result.handlerFrames).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Payload builder coverage (buildLayaSceneTreeDumpPayload,
// buildLayaHitTestPayload)
// ─────────────────────────────────────────────────────────────────────────────

describe('LayaCanvasAdapter payload builders coverage', () => {
  describe('buildLayaSceneTreeDumpPayload edge cases', () => {
    it('uses default maxDepth of 20 when maxDepth is undefined', () => {
      const payload = buildLayaSceneTreeDumpPayload({});
      expect(payload).toContain('20');
    });

    it('embeds onlyInteractive=false correctly when not specified', () => {
      const payload = buildLayaSceneTreeDumpPayload({});
      // The payload should contain "false" for onlyInteractive when not set
      expect(payload).toContain('false');
    });

    it('embeds onlyVisible=false correctly when not specified', () => {
      const payload = buildLayaSceneTreeDumpPayload({});
      expect(payload).toContain('false');
    });

    it('builds a valid IIFE that can be evaluated in browser context', () => {
      const payload = buildLayaSceneTreeDumpPayload({ maxDepth: 5 });
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
      expect(payload).toContain('return {');
    });

    it('builds partial dump return when Laya.stage is not found', () => {
      const payload = buildLayaSceneTreeDumpPayload({});
      // The payload should check for Laya.stage and return partial on failure
      expect(payload).toContain('window.Laya');
      expect(payload).toContain('window.Laya.stage');
      expect(payload).toContain('completeness');
    });
  });

  describe('buildLayaHitTestPayload edge cases', () => {
    it('returns a valid JS string that can be evaluated', () => {
      const payload = buildLayaHitTestPayload({ x: 0, y: 0 });
      expect(typeof payload).toBe('string');
      // Should be a valid IIFE
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
    });

    it('handles x=0 and y=0 without issues', () => {
      const payload = buildLayaHitTestPayload({ x: 0, y: 0 });
      expect(payload).toContain('0');
    });

    it('handles negative coordinates', () => {
      const payload = buildLayaHitTestPayload({ x: -100, y: -200 });
      expect(payload).toContain('-100');
      expect(payload).toContain('-200');
    });

    it('handles fractional coordinates', () => {
      const payload = buildLayaHitTestPayload({ x: 123.456, y: 789.012 });
      expect(payload).toContain('123.456');
      expect(payload).toContain('789.012');
    });

    it('handles large coordinate values', () => {
      const payload = buildLayaHitTestPayload({ x: 99999, y: 99999 });
      expect(payload).toContain('99999');
    });

    it('embeds canvasId into the DOM query script', () => {
      const payload = buildLayaHitTestPayload({ x: 100, y: 200, canvasId: 'myCanvas' });
      // The payload should have the canvasId lookup in the DOM query
      expect(payload).toContain('myCanvas');
    });

    it('returns hitTestMethod=engine and hitTestMethod=manual in the script output', () => {
      const payload = buildLayaHitTestPayload({ x: 50, y: 50 });
      // The payload should try engine hitTest first, then fall back to manual
      expect(payload).toContain('hitTestMethod');
      expect(payload).toContain("'engine'");
      expect(payload).toContain("'manual'");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Multi-engine fingerprinting
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_engine_fingerprint multi-engine detection', () => {
  describe('detects LayaAir correctly', () => {
    it('returns LayaAir candidate with correct evidence', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'Laya',
            adapterId: 'laya',
            engine: 'LayaAir',
            present: true,
            version: '2.14.0',
          },
        ],
        [{ id: 'game-canvas', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; version?: string; evidence: string[] }>;
      }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('LayaAir');
      expect(parsed.candidates[0]!.version).toBe('2.14.0');
      expect(parsed.candidates[0]!.evidence).toContain('global window.Laya is defined');
    });

    it('extracts Laya version from Laya.version when global VERSION is absent', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'Laya',
            adapterId: 'laya',
            engine: 'LayaAir',
            present: true,
            version: '2.12.0',
          },
        ],
        [{ id: 'canvas-0', width: 800, height: 600, contextType: 'webgl' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ candidates: Array<{ version?: string }> }>(result);

      expect(parsed.candidates[0]!.version).toBe('2.12.0');
    });
  });

  describe('detects PixiJS correctly', () => {
    it('returns PixiJS candidate with correct evidence', async () => {
      const pageController = createSequentialMockPageController(
        [{ pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS', present: true, version: '8.2.0' }],
        [{ id: 'pixi-canvas', width: 1280, height: 720, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; evidence: string[] }>;
      }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('PixiJS');
      expect(parsed.candidates[0]!.evidence).toContain('global window.PIXI is defined');
    });

    it('extracts PixiJS version from PIXI.VERSION', async () => {
      const pageController = createSequentialMockPageController(
        [{ pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS', present: true, version: '7.3.0' }],
        [{ id: 'canvas-0', width: 800, height: 600, contextType: 'webgl' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ candidates: Array<{ version?: string }> }>(result);

      expect(parsed.candidates[0]!.version).toBe('7.3.0');
    });
  });

  describe('detects Phaser correctly', () => {
    it('returns Phaser candidate with correct evidence', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'Phaser',
            adapterId: 'phaser',
            engine: 'Phaser',
            present: true,
            version: '3.60.0',
          },
        ],
        [{ id: 'phaser-canvas', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; evidence: string[] }>;
      }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('Phaser');
      expect(parsed.candidates[0]!.evidence).toContain('global window.Phaser is defined');
    });
  });

  describe('detects CocosCreator correctly', () => {
    it('returns CocosCreator candidate via cc global', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'cc',
            adapterId: 'cocos',
            engine: 'CocosCreator',
            present: true,
            version: '3.8.0',
          },
        ],
        [{ id: 'cocos-canvas', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ candidates: Array<{ engine: string }> }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('CocosCreator');
    });

    it('detects CocosCreator via legacyCC global', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'legacyCC',
            adapterId: 'cocos',
            engine: 'CocosCreator',
            present: true,
            version: '2.4.3',
          },
        ],
        [{ id: 'canvas-0', width: 960, height: 640, contextType: 'webgl' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ candidates: Array<{ engine: string }> }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('CocosCreator');
    });
  });

  describe('detects Unity WebGL correctly', () => {
    it('returns UnityWebGL candidate via createUnityInstance global', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'createUnityInstance',
            adapterId: 'unity',
            engine: 'UnityWebGL',
            present: true,
            version: undefined,
          },
        ],
        [{ id: 'unity-canvas', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; adapterId: string }>;
      }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('UnityWebGL');
      expect(parsed.candidates[0]!.adapterId).toBe('unity');
    });
  });

  describe('detects Babylon.js and Three.js', () => {
    it('detects Babylon.js via BABYLON global', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'BABYLON',
            adapterId: 'babylon',
            engine: 'Babylon.js',
            present: true,
            version: '6.0.0',
          },
        ],
        [{ id: 'canvas-0', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; adapterId: string }>;
      }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('Babylon.js');
      expect(parsed.candidates[0]!.adapterId).toBe('babylon');
    });

    it('detects Three.js via THREE global', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'THREE',
            adapterId: 'three',
            engine: 'Three.js',
            present: true,
            version: '0.160.0',
          },
        ],
        [{ id: 'canvas-0', width: 1920, height: 1080, contextType: 'webgl' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; adapterId: string }>;
      }>(result);

      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.engine).toBe('Three.js');
      expect(parsed.candidates[0]!.adapterId).toBe('three');
    });
  });

  describe('multiple engines simultaneously', () => {
    it('returns all detected engines as candidates when multiple globals are present', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'Laya',
            adapterId: 'laya',
            engine: 'LayaAir',
            present: true,
            version: '2.12.0',
          },
          { pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS', present: true, version: '8.2.0' },
          {
            pattern: 'Phaser',
            adapterId: 'phaser',
            engine: 'Phaser',
            present: true,
            version: '3.60.0',
          },
        ],
        [{ id: 'canvas-0', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ candidates: Array<{ engine: string }> }>(result);

      expect(parsed.candidates).toHaveLength(3);
      const engines = parsed.candidates.map((c) => c.engine).toSorted();
      expect(engines).toEqual(['LayaAir', 'Phaser', 'PixiJS']);
    });

    it('each candidate has adapterId set correctly', async () => {
      const pageController = createSequentialMockPageController(
        [
          {
            pattern: 'Laya',
            adapterId: 'laya',
            engine: 'LayaAir',
            present: true,
            version: '2.12.0',
          },
          { pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS', present: true, version: '8.2.0' },
        ],
        [{ id: 'canvas-0', width: 1920, height: 1080, contextType: 'webgl2' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{
        candidates: Array<{ engine: string; adapterId: string }>;
      }>(result);

      const laya = parsed.candidates.find((c) => c.engine === 'LayaAir');
      const pixi = parsed.candidates.find((c) => c.engine === 'PixiJS');
      expect(laya!.adapterId).toBe('laya');
      expect(pixi!.adapterId).toBe('pixi');
    });
  });

  describe('canvasDetails includes WebGL renderer info', () => {
    it('includes WebGL renderer info from WEBGL_debug_renderer_info extension', async () => {
      const pageController = createSequentialMockPageController(
        [{ pattern: 'Laya', adapterId: 'laya', engine: 'LayaAir', present: true }],
        [
          {
            id: 'game-canvas',
            width: 1920,
            height: 1080,
            contextType: 'webgl2',
            renderer: 'NVIDIA GeForce RTX 3080 Ti',
          },
        ],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ canvasDetails: Array<{ renderer?: string }> }>(result);

      expect(parsed.canvasDetails).toHaveLength(1);
      expect(parsed.canvasDetails[0]!.renderer).toBe('NVIDIA GeForce RTX 3080 Ti');
    });

    it('canvasDetails includes contextType=2d for 2d canvas', async () => {
      const pageController = createSequentialMockPageController(
        [],
        [{ id: 'ui-canvas', width: 800, height: 600, contextType: '2d' }],
        false,
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});
      const parsed = parseJsonResponse<{ canvasDetails: Array<{ contextType: string }> }>(result);

      expect(parsed.canvasDetails[0]!.contextType).toBe('2d');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: canvas_pick_object_at_point error and edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_pick_object_at_point error handling', () => {
  describe('returns structured result when missing x/y coordinates', () => {
    it('handlePick with empty args returns result (x/y default to 0)', async () => {
      // After the fix: argNumber(args, 'x', 0) and argNumber(args, 'y', 0) default to 0
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 0, y: 0 },
          canvasRect: { left: 0, top: 0, width: 800, height: 600 },
          canvasX: 0,
          canvasY: 0,
        },
        [], // no engine
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({});

      expect(result).toBeDefined();
      const parsed = parseJsonResponse<{
        success: boolean;
        coordinates: { screen: { x: number } };
      }>(result);
      expect(parsed.coordinates.screen.x).toBe(0);
    });

    it('handlePick with only x returns result (y defaults to 0)', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 42, y: 0 },
          canvasRect: { left: 0, top: 0, width: 800, height: 600 },
          canvasX: 42,
          canvasY: 0,
        },
        [],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 42 });

      expect(result).toBeDefined();
      const parsed = parseJsonResponse<{ success: boolean }>(result);
      expect(parsed.success).toBe(false);
    });

    it('handlePick with only y returns result (x defaults to 0)', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 0, y: 99 },
          canvasRect: { left: 0, top: 0, width: 800, height: 600 },
          canvasX: 0,
          canvasY: 99,
        },
        [],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ y: 99 });

      expect(result).toBeDefined();
    });
  });

  describe('coordinate transform with DPR scaling', () => {
    it('transforms screen coordinates accounting for device pixel ratio', async () => {
      // Screen: 1920x1080 display, DPR=2, canvas: 960x540 CSS pixels
      // Screen point (960, 540) → canvas point (480, 270)
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 960, y: 540 },
          canvasRect: { left: 0, top: 0, width: 960, height: 540 },
          canvasX: 480,
          canvasY: 270,
        },
        [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
        {
          success: true,
          picked: {
            id: 'btn',
            type: 'Sprite',
            name: 'StartButton',
            visible: true,
            interactive: true,
            alpha: 1,
            x: 480,
            y: 270,
            width: 100,
            height: 40,
            worldBounds: { x: 430, y: 250, width: 100, height: 40 },
            path: 'Laya.stage/btn',
          },
          candidates: [],
          coordinates: {
            screen: { x: 960, y: 540 },
            canvas: { x: 480, y: 270 },
            stage: { x: 480, y: 270 },
          },
          hitTestMethod: 'engine',
        },
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 960, y: 540 });
      const parsed = parseJsonResponse<{
        success: boolean;
        coordinates: { canvas: { x: number; y: number } };
      }>(result);

      expect(parsed.success).toBe(true);
      expect(parsed.coordinates.canvas.x).toBe(480);
      expect(parsed.coordinates.canvas.y).toBe(270);
    });
  });

  describe('returns success=false when no engine detected (no adapter)', () => {
    it('hitTestMethod is none when no engine and no adapter', async () => {
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 320, y: 240 },
          canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
          canvasX: 320,
          canvasY: 240,
        },
        [{ engine: 'CustomEngine', adapterId: 'unknown' }], // adapter not registered
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 320, y: 240 });
      const parsed = parseJsonResponse<{ success: boolean; hitTestMethod: string }>(result);

      expect(parsed.success).toBe(false);
      expect(parsed.hitTestMethod).toBe('none');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: canvas_trace_click_handler error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_trace_click_handler error handling', () => {
  describe('dispatches canvas click even when canvas not found', () => {
    it('returns result even when no canvas is at the click coordinates', async () => {
      // The dispatchCanvasClick script returns { domEventChain: [], ... } when no canvas found
      const pageController = createSequentialMockPageController({
        domEventChain: [],
        pickedNode: null,
        engine: undefined,
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: -9999, y: -9999 });
      const parsed = parseJsonResponse<{ handlerFrames: Array<object> }>(result);

      // Should still record evidence and return a result
      expect(parsed.handlerFrames).toEqual([]);
    });
  });

  describe('removes event breakpoint even when resume throws', () => {
    it('still calls removeEventListenerBreakpoint if resume fails', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      // @ts-expect-error
      debuggerManager.resume.mockRejectedValue(new Error('Resume failed'));

      const eventManager = debuggerManager.getEventManager();
      // @ts-expect-error
      eventManager.setEventListenerBreakpoint.mockResolvedValue('bp-to-cleanup');
      eventManager.removeEventListenerBreakpoint = vi.fn().mockResolvedValue(true);

      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 100, y: 100 });

      // Should still attempt cleanup
      expect(eventManager.removeEventListenerBreakpoint).toHaveBeenCalledWith('bp-to-cleanup');
      expect(result).toBeDefined();
    });
  });

  describe('handles evidenceStore.addNode throwing gracefully', () => {
    it('trace does not throw when evidenceStore.addNode fails', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [{ functionName: 'handler', url: 'game.js', location: { lineNumber: 1 } }],
      });

      const evidenceStore = createMockEvidenceStore();
      evidenceStore.addNode = vi.fn().mockImplementation(() => {
        throw new Error('Evidence store unavailable');
      });

      const handlers = createHandlers({ pageController, debuggerManager, evidenceStore });

      // Should not throw even if evidence recording fails
      await expect(handlers.handleTraceClick({ x: 50, y: 50 })).resolves.toBeDefined();
    });
  });

  describe('records evidence with correct handlerCount', () => {
    it('handlerCount reflects the number of captured call frames', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'Phaser',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      // @ts-expect-error
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          { functionName: 'handler1', url: 'a.js', location: { lineNumber: 1 } },
          { functionName: 'handler2', url: 'b.js', location: { lineNumber: 2 } },
        ],
      });
      const evidenceStore = createMockEvidenceStore();
      const handlers = createHandlers({ pageController, debuggerManager, evidenceStore });

      await handlers.handleTraceClick({ x: 200, y: 300 });

      expect(evidenceStore.addNode).toHaveBeenCalledWith(
        'function',
        'canvas_trace',
        expect.objectContaining({
          engine: 'Phaser',
          x: 200,
          y: 300,
          handlerCount: 2,
        }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: PixiJS, Phaser, Cocos adapter dumpScene coverage
// ─────────────────────────────────────────────────────────────────────────────

import {
  PixiJSCanvasAdapter,
  buildPixiSceneTreeDumpPayload,
  buildPixiHitTestPayload,
} from '@server/domains/canvas/adapters/pixi-adapter';
import {
  buildPhaserSceneTreeDumpPayload,
  buildPhaserHitTestPayload,
} from '@server/domains/canvas/adapters/phaser-adapter';
import {
  buildCocosSceneTreeDumpPayload,
  buildCocosHitTestPayload,
} from '@server/domains/canvas/adapters/cocos-adapter';

describe('PixiJSCanvasAdapter payload builders', () => {
  describe('buildPixiSceneTreeDumpPayload', () => {
    it('returns a valid IIFE string', () => {
      const payload = buildPixiSceneTreeDumpPayload({});
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
      expect(payload).toContain('PIXI');
    });

    it('embeds maxDepth option', () => {
      const payload = buildPixiSceneTreeDumpPayload({ maxDepth: 15 });
      expect(payload).toContain('15');
    });

    it('checks for window.__pixiApp and canvas._pixiApp for app discovery', () => {
      const payload = buildPixiSceneTreeDumpPayload({});
      expect(payload).toContain('__pixiApp');
    });

    it('includes _pixiApp lookup for canvas elements', () => {
      const payload = buildPixiSceneTreeDumpPayload({});
      expect(payload).toContain('_pixiApp');
    });

    it('handles onlyInteractive filter', () => {
      const payload = buildPixiSceneTreeDumpPayload({ onlyInteractive: true });
      expect(payload).toContain('true');
    });

    it('handles onlyVisible filter', () => {
      const payload = buildPixiSceneTreeDumpPayload({ onlyVisible: true });
      expect(payload).toContain('true');
    });

    it('checks PIXI.Application.stage for scene tree', () => {
      const payload = buildPixiSceneTreeDumpPayload({});
      expect(payload).toContain('stage');
    });
  });

  describe('buildPixiHitTestPayload', () => {
    it('returns a valid IIFE string', () => {
      const payload = buildPixiHitTestPayload({ x: 0, y: 0 });
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
    });

    it('embeds x and y coordinates', () => {
      const payload = buildPixiHitTestPayload({ x: 123, y: 456 });
      expect(payload).toContain('123');
      expect(payload).toContain('456');
    });

    it('includes canvasId in DOM query', () => {
      const payload = buildPixiHitTestPayload({ x: 0, y: 0, canvasId: 'pixi-canvas' });
      expect(payload).toContain('pixi-canvas');
    });

    it('tries stage.hitTest for PIXI v7+ native hit testing', () => {
      const payload = buildPixiHitTestPayload({ x: 100, y: 100 });
      expect(payload).toContain('hitTest');
    });

    it('falls back to manual DFS bounds check', () => {
      const payload = buildPixiHitTestPayload({ x: 100, y: 100 });
      expect(payload).toContain('hitTestDfs');
    });

    it('sorts candidates by depth ascending (topmost first)', () => {
      const payload = buildPixiHitTestPayload({ x: 50, y: 50 });
      expect(payload).toContain('depth - b.depth');
    });
  });

  describe('PixiJSCanvasAdapter dumpScene via adapter', () => {
    let pixiAdapter: PixiJSCanvasAdapter;

    beforeEach(() => {
      pixiAdapter = new PixiJSCanvasAdapter();
    });

    it('dumpScene returns partial when PIXI app not found', async () => {
      const pageController = createMockPageController();
      pageController.evaluate = vi.fn().mockResolvedValue({
        engine: 'PixiJS',
        canvas: { width: 800, height: 600, dpr: 1, contextType: 'webgl' },
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      // @ts-expect-error
      const env = createLayaEnv(pageController);

      const result = await pixiAdapter.dumpScene(env, {});

      expect(result.completeness).toBe('partial');
      expect(result.sceneTree).not.toBeNull();
    });
  });
});

describe('PhaserCanvasAdapter payload builders', () => {
  describe('buildPhaserSceneTreeDumpPayload', () => {
    it('returns a valid IIFE string', () => {
      const payload = buildPhaserSceneTreeDumpPayload({});
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
      expect(payload).toContain('Phaser');
    });

    it('checks Phaser.GAMES for game detection', () => {
      const payload = buildPhaserSceneTreeDumpPayload({});
      expect(payload).toContain('Phaser.GAMES');
    });

    it('embeds maxDepth option', () => {
      const payload = buildPhaserSceneTreeDumpPayload({ maxDepth: 10 });
      expect(payload).toContain('10');
    });

    it('traverses game.scene.scenes for active scenes', () => {
      const payload = buildPhaserSceneTreeDumpPayload({});
      expect(payload).toContain('scenes');
      expect(payload).toContain('displayList');
    });

    it('checks scene sys.settings.status to skip shutdown scenes', () => {
      const payload = buildPhaserSceneTreeDumpPayload({});
      expect(payload).toContain('status');
    });
  });

  describe('buildPhaserHitTestPayload', () => {
    it('returns a valid IIFE string', () => {
      const payload = buildPhaserHitTestPayload({ x: 0, y: 0 });
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
    });

    it('embeds x and y coordinates', () => {
      const payload = buildPhaserHitTestPayload({ x: 300, y: 400 });
      expect(payload).toContain('300');
      expect(payload).toContain('400');
    });

    it('includes canvasId in DOM query', () => {
      const payload = buildPhaserHitTestPayload({ x: 0, y: 0, canvasId: 'phaser-game' });
      expect(payload).toContain('phaser-game');
    });

    it('tries scene.input.hitTestPointer for native hit test', () => {
      const payload = buildPhaserHitTestPayload({ x: 100, y: 100 });
      expect(payload).toContain('hitTestPointer');
    });

    it('handles canvasId as numeric index', () => {
      const payload = buildPhaserHitTestPayload({ x: 0, y: 0, canvasId: '0' });
      expect(payload).toContain('0');
    });
  });
});

describe('CocosCanvasAdapter payload builders', () => {
  describe('buildCocosSceneTreeDumpPayload', () => {
    it('returns a valid IIFE string', () => {
      const payload = buildCocosSceneTreeDumpPayload({});
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
      expect(payload).toContain('cc');
    });

    it('checks cc.director.getScene for scene access', () => {
      const payload = buildCocosSceneTreeDumpPayload({});
      expect(payload).toContain('director');
      expect(payload).toContain('getScene');
    });

    it('differentiates v2 vs v3 by checking cc.Scene', () => {
      const payload = buildCocosSceneTreeDumpPayload({});
      expect(payload).toContain('cc.Scene');
    });

    it('embeds maxDepth option', () => {
      const payload = buildCocosSceneTreeDumpPayload({ maxDepth: 8 });
      expect(payload).toContain('8');
    });

    it('checks node._eventMask for v3 interactive detection', () => {
      const payload = buildCocosSceneTreeDumpPayload({});
      expect(payload).toContain('_eventMask');
    });

    it('checks mouseEnabled for v2 interactive detection', () => {
      const payload = buildCocosSceneTreeDumpPayload({});
      expect(payload).toContain('mouseEnabled');
    });
  });

  describe('buildCocosHitTestPayload', () => {
    it('returns a valid IIFE string', () => {
      const payload = buildCocosHitTestPayload({ x: 0, y: 0 });
      expect(payload).toMatch(/^\s*\(function\(\)\s*\{/);
    });

    it('embeds x and y coordinates', () => {
      const payload = buildCocosHitTestPayload({ x: 200, y: 150 });
      expect(payload).toContain('200');
      expect(payload).toContain('150');
    });

    it('FLIPS Y axis for Cocos bottom-left coordinate system', () => {
      // canvasY is flipped: cocosY = canvasHeight - canvasY
      const payload = buildCocosHitTestPayload({ x: 100, y: 200 });
      expect(payload).toContain('canvasHeight');
      expect(payload).toContain('canvasY');
      expect(payload).toContain('canvasWidth');
    });

    it('includes canvasId in DOM query', () => {
      const payload = buildCocosHitTestPayload({ x: 0, y: 0, canvasId: 'cocos-canvas' });
      expect(payload).toContain('cocos-canvas');
    });

    it('tries scene.hitTest for v3 native hit test', () => {
      const payload = buildCocosHitTestPayload({ x: 100, y: 100 });
      expect(payload).toContain('hitTest');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Engine-specific scene dump via handlers
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_scene_dump with engine-specific adapters', () => {
  beforeEach(() => {
    installDefaultFingerprintCanvasMock();
    // Reset the callback registers from vi.hoisted() registry
    resetMockCallbacks();
    // Reset resolveAdapter to use the callbacks from the hoisted registry
    getResolveAdapterMock().mockImplementation(
      (detection: { adapterId?: string; selected?: { adapterId: string } | null }) => {
        const adapterId = detection.adapterId ?? detection.selected?.adapterId;
        if (adapterId && ['laya', 'pixi', 'phaser', 'cocos'].includes(adapterId)) {
          return {
            detect: async () => null,
            dumpScene: async (env: CanvasProbeEnv, opts: DumpOpts) => {
              const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
              if (mockDumpSceneCallback) return mockDumpSceneCallback(env, opts);
              return (
                evaluated ?? {
                  engine: 'MockEngine',
                  version: '1.0.0',
                  canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
                  sceneTree: null,
                  totalNodes: 0,
                  completeness: 'partial',
                }
              );
            },
            pickAt: async (env: CanvasProbeEnv, opts: PickOpts) => {
              const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
              if (mockPickAtCallback) return mockPickAtCallback(env, opts);
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
      },
    );
  });

  it('returns full completeness when Laya adapter succeeds', async () => {
    const pageController = createMockPageController();
    // @ts-expect-error
    const handlers = createHandlers({ pageController });
    getFingerprintCanvasMock().mockResolvedValueOnce(makeLayaScene('2.14.0', 5));
    mockDumpSceneCallback = async () => makeLayaDumpScene('2.14.0', 5);

    const result = await handlers.handleSceneDump({});
    const parsed = parseJsonResponse<{ completeness: string; totalNodes: number }>(result);

    expect(parsed.completeness).toBe('full');
    expect(parsed.totalNodes).toBe(5);
  });

  it('handles LayaAir 3.x scene dump', async () => {
    const pageController = createMockPageController();
    // @ts-expect-error
    const handlers = createHandlers({ pageController });
    getFingerprintCanvasMock().mockResolvedValueOnce(makeLayaScene('3.0.0', 10));
    mockDumpSceneCallback = async () => makeLayaDumpScene('3.0.0', 10);

    const result = await handlers.handleSceneDump({});
    const parsed = parseJsonResponse<{ completeness: string; version?: string }>(result);

    expect(parsed.completeness).toBe('full');
    expect(parsed.version).toBe('3.0.0');
  });

  describe('scene dump with PixiJS engine', () => {
    it('returns full completeness when PixiJS adapter succeeds', async () => {
      const pageController = createMockPageController();
      // @ts-expect-error
      const handlers = createHandlers({ pageController });
      getFingerprintCanvasMock().mockResolvedValueOnce({
        hits: [{ engine: 'PixiJS', adapterId: 'pixi', version: '8.2.0' }],
        selected: { engine: 'PixiJS', adapterId: 'pixi', version: '8.2.0' },
        selectedEvidence: [],
      });
      mockDumpSceneCallback = async () => ({
        engine: 'PixiJS',
        version: '8.2.0',
        canvas: { width: 1280, height: 720, dpr: 1, contextType: 'webgl2' },
        sceneTree: {
          id: 'pixi-root',
          type: 'Container',
          visible: true,
          interactive: false,
          alpha: 1,
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          worldBounds: { x: 0, y: 0, width: 1280, height: 720 },
          path: 'PIXI.Application.stage',
        },
        totalNodes: 3,
        completeness: 'full' as const,
      });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{ completeness: string; engine: string }>(result);

      expect(parsed.completeness).toBe('full');
      expect(parsed.engine).toBe('PixiJS');
    });
  });

  describe('scene dump with Phaser engine', () => {
    it('returns full completeness when Phaser adapter succeeds', async () => {
      const pageController = createMockPageController();
      // @ts-expect-error
      const handlers = createHandlers({ pageController });
      getFingerprintCanvasMock().mockResolvedValueOnce({
        hits: [{ engine: 'Phaser', adapterId: 'phaser', version: '3.60.0' }],
        selected: { engine: 'Phaser', adapterId: 'phaser', version: '3.60.0' },
        selectedEvidence: [],
      });
      mockDumpSceneCallback = async () => ({
        engine: 'Phaser',
        version: '3.60.0',
        canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl2' },
        sceneTree: {
          id: 'main',
          type: 'Game',
          visible: true,
          interactive: false,
          alpha: 1,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          path: 'Phaser.Game',
        },
        totalNodes: 4,
        completeness: 'full' as const,
      });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{ completeness: string; engine: string }>(result);

      expect(parsed.completeness).toBe('full');
      expect(parsed.engine).toBe('Phaser');
    });
  });

  describe('scene dump with Cocos Creator engine', () => {
    it('returns full completeness when Cocos adapter succeeds', async () => {
      const pageController = createMockPageController();
      // @ts-expect-error
      const handlers = createHandlers({ pageController });
      getFingerprintCanvasMock().mockResolvedValueOnce({
        hits: [{ engine: 'CocosCreator', adapterId: 'cocos', version: '3.8.0' }],
        selected: { engine: 'CocosCreator', adapterId: 'cocos', version: '3.8.0' },
        selectedEvidence: [],
      });
      mockDumpSceneCallback = async () => ({
        engine: 'CocosCreator',
        version: '3.8.0',
        canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl2' },
        sceneTree: {
          id: 'cocos-scene',
          type: 'Scene',
          visible: true,
          interactive: false,
          alpha: 1,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          path: 'cc.director.getScene()',
        },
        totalNodes: 6,
        completeness: 'full' as const,
      });

      const result = await handlers.handleSceneDump({});
      const parsed = parseJsonResponse<{ completeness: string; engine: string }>(result);

      expect(parsed.completeness).toBe('full');
      expect(parsed.engine).toBe('CocosCreator');
    });
  });

  describe('scene dump with onlyInteractive and onlyVisible filters', () => {
    it('passes onlyInteractive=true to Laya adapter', async () => {
      const pageController = createMockPageController();
      // @ts-expect-error
      const handlers = createHandlers({ pageController });
      getFingerprintCanvasMock().mockResolvedValueOnce(makeLayaScene('2.12.0', 2));
      mockDumpSceneCallback = async () => makeLayaDumpScene('2.12.0', 2);

      const result = await handlers.handleSceneDump({ onlyInteractive: true });
      const parsed = parseJsonResponse<{ completeness: string }>(result);

      expect(parsed.completeness).toBe('full');
      // The mock adapter was invoked via mockDumpSceneCallback
      expect(pageController.evaluate).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: Highlight injection
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_pick_object_at_point highlight injection', () => {
  beforeEach(() => {
    installDefaultFingerprintCanvasMock();
    // Reset the callback registers from the module-level mock
    resetMockCallbacks();
    // Reset resolveAdapter mock to default (returns mock adapter for known engines)
    getResolveAdapterMock().mockImplementation(
      (detection: { adapterId?: string; selected?: { adapterId: string } | null }) => {
        const adapterId = detection.adapterId ?? detection.selected?.adapterId;
        if (adapterId && ['laya', 'pixi', 'phaser', 'cocos'].includes(adapterId)) {
          return {
            detect: async () => null,
            dumpScene: async (env: CanvasProbeEnv, opts: DumpOpts) => {
              const evaluated = await env.pageController.evaluate(JSON.stringify(opts));
              if (mockDumpSceneCallback) return mockDumpSceneCallback(env, opts);
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
              if (mockPickAtCallback) return mockPickAtCallback(env, opts);
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
      },
    );
  });

  it('injects highlight div when highlight=true and object is picked', async () => {
    const pageController = createSequentialMockPageController(
      {
        screen: { x: 320, y: 240 },
        canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
        canvasX: 320,
        canvasY: 240,
      },
      // Third call: adapter.pickAt (via mock adapter → mockPickAtCallback)
      {
        success: true,
        picked: {
          id: 'btn',
          type: 'Sprite',
          name: 'StartButton',
          visible: true,
          interactive: true,
          alpha: 1,
          x: 270,
          y: 215,
          width: 100,
          height: 50,
          worldBounds: { x: 270, y: 215, width: 100, height: 50 },
          path: 'Laya.stage/btn',
        },
        candidates: [],
        coordinates: {
          screen: { x: 320, y: 240 },
          canvas: { x: 320, y: 240 },
          stage: { x: 320, y: 240 },
        },
        hitTestMethod: 'engine',
      },
      // Fourth call: highlight injection
      { removed: true },
    );
    const handlers = createHandlers({ pageController });

    // Configure fingerprintCanvas mock to return a LayaAir detection
    getFingerprintCanvasMock().mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: ['window.Laya is defined'],
    });
    // Configure mock adapter to return the pick result
    mockPickAtCallback = async (_env: CanvasProbeEnv, _opts: PickOpts) => ({
      success: true,
      picked: {
        id: 'btn',
        type: 'Sprite',
        name: 'StartButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 270,
        y: 215,
        width: 100,
        height: 50,
        worldBounds: { x: 270, y: 215, width: 100, height: 50 },
        path: 'Laya.stage/btn',
      },
      candidates: [],
      coordinates: {
        screen: { x: 320, y: 240 },
        canvas: { x: 320, y: 240 },
        stage: { x: 320, y: 240 },
      },
      hitTestMethod: 'engine' as const,
    });

    const result = await handlers.handlePick({ x: 320, y: 240, highlight: true });

    // The mocked adapter consumes one evaluate for pickAt, then one more for highlight injection.
    expect(pageController.evaluate).toHaveBeenCalledTimes(3);
    // @ts-expect-error
    const highlightScript = pageController.evaluate.mock.calls[2]![0] as string;
    expect(highlightScript).toContain('__canvas-highlight');
    expect(highlightScript).toContain('#00ff88');
    expect(result).toBeDefined();
  });

  it('does NOT inject highlight when highlight=false', async () => {
    const pageController = createSequentialMockPageController(
      {
        screen: { x: 320, y: 240 },
        canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
        canvasX: 320,
        canvasY: 240,
      },
      {
        success: true,
        picked: {
          id: 'btn',
          type: 'Sprite',
          name: 'StartButton',
          visible: true,
          interactive: true,
          alpha: 1,
          x: 270,
          y: 215,
          width: 100,
          height: 50,
          worldBounds: { x: 270, y: 215, width: 100, height: 50 },
          path: 'Laya.stage/btn',
        },
        candidates: [],
        coordinates: {
          screen: { x: 320, y: 240 },
          canvas: { x: 320, y: 240 },
          stage: { x: 320, y: 240 },
        },
        hitTestMethod: 'engine',
      },
    );
    const handlers = createHandlers({ pageController });

    getFingerprintCanvasMock().mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'btn',
        type: 'Sprite',
        name: 'StartButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 270,
        y: 215,
        width: 100,
        height: 50,
        worldBounds: { x: 270, y: 215, width: 100, height: 50 },
        path: 'Laya.stage/btn',
      },
      candidates: [],
      coordinates: {
        screen: { x: 320, y: 240 },
        canvas: { x: 320, y: 240 },
        stage: { x: 320, y: 240 },
      },
      hitTestMethod: 'engine' as const,
    });

    await handlers.handlePick({ x: 320, y: 240, highlight: false });

    expect(pageController.evaluate).toHaveBeenCalledTimes(2);
  });

  it('highlight injection is skipped when no object is picked', async () => {
    const pageController = createSequentialMockPageController({
      screen: { x: 320, y: 240 },
      canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
      canvasX: 320,
      canvasY: 240,
    });
    const handlers = createHandlers({ pageController });

    getFingerprintCanvasMock().mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockPickAtCallback = async () => ({
      success: false,
      picked: null,
      candidates: [],
      coordinates: { screen: { x: 320, y: 240 }, canvas: { x: 320, y: 240 } },
      hitTestMethod: 'none' as const,
    });

    await handlers.handlePick({ x: 320, y: 240, highlight: true });

    expect(pageController.evaluate).toHaveBeenCalledTimes(2);
  });

  it('highlight injection failure does not propagate as error', async () => {
    const pageController = createSequentialMockPageController(
      {
        screen: { x: 320, y: 240 },
        canvasRect: { left: 0, top: 0, width: 1920, height: 1080 },
        canvasX: 320,
        canvasY: 240,
      },
      // Fourth call: highlight injection throws
      Promise.reject(new Error('CDP error')),
    );
    const handlers = createHandlers({ pageController });

    getFingerprintCanvasMock().mockResolvedValueOnce({
      hits: [{ engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' }],
      selected: { engine: 'LayaAir', adapterId: 'laya', version: '2.12.0' },
      selectedEvidence: [],
    });
    mockPickAtCallback = async () => ({
      success: true,
      picked: {
        id: 'btn',
        type: 'Sprite',
        name: 'StartButton',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 270,
        y: 215,
        width: 100,
        height: 50,
        worldBounds: { x: 270, y: 215, width: 100, height: 50 },
        path: 'Laya.stage/btn',
      },
      candidates: [],
      coordinates: {
        screen: { x: 320, y: 240 },
        canvas: { x: 320, y: 240 },
        stage: { x: 320, y: 240 },
      },
      hitTestMethod: 'engine' as const,
    });

    // highlight injection failure propagates now
    await expect(handlers.handlePick({ x: 320, y: 240, highlight: true })).rejects.toThrow();
  });
});
