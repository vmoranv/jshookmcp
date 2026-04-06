import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PageController } from '@server/domains/canvas/dependencies';
import {
  LayaCanvasAdapter,
  buildLayaSceneTreeDumpPayload,
  buildLayaHitTestPayload,
} from '@server/domains/canvas/adapters/laya-adapter';
import type { DumpOpts, PickOpts, CanvasProbeEnv } from '@server/domains/canvas/types';

function createEnv(pageController: PageController): CanvasProbeEnv {
  return {
    pageController,
    cdpSession: null as never,
    tabId: 'tab-1',
    frameId: 'frame-0',
  };
}

describe('LayaCanvasAdapter', () => {
  // ── Helpers ──────────────────────────────────────────────────────────

  function createMockPageController<T = unknown>(
    result: T,
  ): [PageController, ReturnType<typeof vi.fn>] {
    const evaluate = vi.fn().mockResolvedValue(result);
    const pageController = { evaluate } as unknown as PageController;
    return [pageController, evaluate];
  }

  let adapter: LayaCanvasAdapter;

  beforeEach(() => {
    adapter = new LayaCanvasAdapter();
  });

  // ── detect() ────────────────────────────────────────────────────────
  // detect() is async — all tests must await it.

  describe('detect()', () => {
    it('returns CanvasDetection when Laya and stage are present', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasStage: true,
        version: '2.12.0',
        laya2: true,
        laya3: false,
      });
      const env = createEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.engine).toBe('LayaAir');
      expect(result!.version).toBe('2.12.0');
      expect(result!.confidence).toBe(0.95);
      expect(result!.adapterId).toBe('laya');
      expect(result!.evidence).toContain('window.Laya is defined');
      expect(result!.evidence).toContain('Laya.MouseManager detected (LayaAir 2.x)');
    });

    it('returns CanvasDetection for LayaAir 3.x', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasStage: true,
        version: '3.0.0',
        laya2: false,
        laya3: true,
      });
      const env = createEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.evidence).toContain('Laya.InputManager detected (LayaAir 3.x)');
    });

    it('returns null when Laya is not defined', async () => {
      const [pageController] = createMockPageController({
        present: false,
        hasStage: false,
        laya2: false,
        laya3: false,
      });
      const env = createEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns null when Laya exists but stage is absent', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasStage: false,
        laya2: true,
        laya3: false,
      });
      const env = createEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns null when evaluate throws', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('CDP error')),
      } as unknown as PageController;
      const env = createEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('includes Laya.stage evidence when stage is present', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasStage: true,
        version: '2.9.0',
        laya2: true,
        laya3: false,
      });
      const env = createEnv(pageController);

      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(Array.isArray(result!.evidence)).toBe(true);
      expect(result!.evidence).toContain('Laya.stage is present');
    });
  });

  // ── dumpScene() ─────────────────────────────────────────────────────

  describe('dumpScene()', () => {
    it('returns full scene dump from page evaluation', async () => {
      const sceneNode = {
        id: 'root',
        type: 'Stage',
        name: 'GameStage',
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
            id: 'bg',
            type: 'Image',
            name: 'Background',
            visible: true,
            interactive: false,
            alpha: 1,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
            path: 'Laya.stage/bg',
          },
        ],
      };

      const [pageController] = createMockPageController({
        engine: 'LayaAir',
        version: '2.12.0',
        canvas: { width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' },
        sceneTree: sceneNode,
        totalNodes: 2,
        completeness: 'full',
      });
      const env = createEnv(pageController);
      const opts: DumpOpts = { maxDepth: 20, onlyInteractive: false, onlyVisible: false };

      const result = await adapter.dumpScene(env, opts);

      expect(result.engine).toBe('LayaAir');
      expect(result.version).toBe('2.12.0');
      expect(result.canvas.width).toBe(1920);
      expect(result.canvas.contextType).toBe('webgl2');
      expect(result.sceneTree).toBeDefined();
      expect(result.totalNodes).toBe(2);
      expect(result.completeness).toBe('full');
    });

    it('falls back to stub sceneTree when page returns null sceneTree', async () => {
      const [pageController] = createMockPageController({
        engine: 'LayaAir',
        version: '2.9.0',
        canvas: { width: 800, height: 600, dpr: 1, contextType: 'webgl' },
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      const env = createEnv(pageController);
      const opts: DumpOpts = {};

      const result = await adapter.dumpScene(env, opts);

      expect(result.sceneTree).not.toBeNull();
      expect(result.sceneTree!.type).toBe('Stage');
      expect(result.sceneTree!.id).toBe('empty');
      expect(result.sceneTree!.path).toBe('Laya.stage');
    });

    it('calls pageController.evaluate with a Laya scene dump script', async () => {
      const [pageController, evaluate] = createMockPageController({
        engine: 'LayaAir',
        canvas: { width: 640, height: 480, dpr: 1, contextType: '2d' },
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      const env = createEnv(pageController);
      const opts: DumpOpts = { maxDepth: 5, onlyInteractive: true, onlyVisible: true };

      await adapter.dumpScene(env, opts);

      expect(evaluate).toHaveBeenCalled();
      const calledScript = evaluate.mock.calls[0]![0] as string;
      expect(typeof calledScript).toBe('string');
      expect(calledScript.length).toBeGreaterThan(0);
      expect(calledScript).toContain('Laya');
    });
  });

  // ── pickAt() ────────────────────────────────────────────────────────

  describe('pickAt()', () => {
    it('returns successful pick result from page evaluation', async () => {
      const pickedNode = {
        id: 'player-sprite',
        type: 'Sprite',
        name: 'Player',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 100,
        y: 200,
        width: 64,
        height: 64,
        worldBounds: { x: 100, y: 200, width: 64, height: 64 },
        path: 'Laya.stage/player',
      };

      const [pageController] = createMockPageController({
        success: true,
        picked: pickedNode,
        candidates: [{ node: pickedNode, depth: 3 }],
        coordinates: {
          screen: { x: 150, y: 250 },
          canvas: { x: 132, y: 220 },
          stage: { x: 66, y: 110 },
        },
        hitTestMethod: 'engine',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 150, y: 250, canvasId: 'game' };

      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.picked).not.toBeNull();
      expect(result.picked!.id).toBe('player-sprite');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.depth).toBe(3);
      expect(result.hitTestMethod).toBe('engine');
    });

    it('returns failed pick when page finds no hit', async () => {
      const [pageController] = createMockPageController({
        success: false,
        picked: null,
        candidates: [],
        coordinates: {
          screen: { x: 0, y: 0 },
          canvas: { x: 0, y: 0 },
        },
        hitTestMethod: 'none',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 0, y: 0 };

      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
      expect(result.candidates).toEqual([]);
      expect(result.hitTestMethod).toBe('none');
    });

    it('calls pageController.evaluate with a Laya hit-test script', async () => {
      const [pageController, evaluate] = createMockPageController({
        success: false,
        picked: null,
        candidates: [],
        coordinates: { screen: { x: 100, y: 100 }, canvas: { x: 50, y: 50 } },
        hitTestMethod: 'none',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 100, y: 100, canvasId: 'canvas-0' };

      await adapter.pickAt(env, opts);

      expect(evaluate).toHaveBeenCalled();
      const calledScript = evaluate.mock.calls[0]![0] as string;
      expect(typeof calledScript).toBe('string');
      expect(calledScript.length).toBeGreaterThan(0);
      expect(calledScript).toContain('Laya');
    });
  });
});

// ── Payload builders ───────────────────────────────────────────────────────────

describe('buildLayaSceneTreeDumpPayload', () => {
  it('returns a non-empty JavaScript string', () => {
    const payload = buildLayaSceneTreeDumpPayload({});
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('embeds maxDepth option in the script', () => {
    const payload = buildLayaSceneTreeDumpPayload({ maxDepth: 5 });
    expect(payload).toContain('5');
  });

  it('embeds onlyInteractive flag in the script', () => {
    const payload = buildLayaSceneTreeDumpPayload({ onlyInteractive: true });
    expect(payload).toContain('true');
  });

  it('embeds onlyVisible flag in the script', () => {
    const payload = buildLayaSceneTreeDumpPayload({ onlyVisible: true });
    expect(payload).toContain('true');
  });

  it('uses default maxDepth of 20 when not specified', () => {
    const payload = buildLayaSceneTreeDumpPayload({});
    expect(payload).toContain('20');
  });
});

describe('buildLayaHitTestPayload', () => {
  it('returns a non-empty JavaScript string', () => {
    const payload = buildLayaHitTestPayload({ x: 100, y: 200 });
    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('embeds x coordinate in the script', () => {
    const payload = buildLayaHitTestPayload({ x: 123, y: 456 });
    expect(payload).toContain('123');
  });

  it('embeds y coordinate in the script', () => {
    const payload = buildLayaHitTestPayload({ x: 123, y: 456 });
    expect(payload).toContain('456');
  });

  it('embeds canvasId in the script when provided', () => {
    const payload = buildLayaHitTestPayload({ x: 0, y: 0, canvasId: 'my-canvas' });
    expect(payload).toContain('my-canvas');
  });

  it('handles missing canvasId (uses topmost canvas detection)', () => {
    const payload = buildLayaHitTestPayload({ x: 50, y: 50 });
    expect(payload).toBeDefined();
  });
});
