/**
 * TDD tests for multi-engine canvas adapters (PixiJS, Phaser, Cocos Creator).
 *
 * These tests define the EXPECTED behavior for the three adapters BEFORE they
 * are implemented. All imports reference adapter classes that do not yet exist,
 * so the tests will fail at the import/compilation step until each adapter is
 * implemented to match the CanvasEngineAdapter interface.
 *
 * Once an adapter is implemented, its tests should pass if the implementation
 * satisfies the contract defined here.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PageController } from '@server/domains/canvas/dependencies';
import type {
  CanvasEngineAdapter,
  CanvasProbeEnv,
  CanvasSceneNode,
  DumpOpts,
  PickOpts,
} from '@server/domains/canvas/types';

// ── Adapter imports ──────────────────────────────────────────────────────────────

import { PixiJSCanvasAdapter } from '@server/domains/canvas/adapters/pixi-adapter';
import { PhaserCanvasAdapter } from '@server/domains/canvas/adapters/phaser-adapter';
import { CocosCanvasAdapter } from '@server/domains/canvas/adapters/cocos-adapter';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createMockPageController<T = unknown>(
  result: T,
): [PageController, ReturnType<typeof vi.fn>] {
  const evaluate = vi.fn().mockResolvedValue(result);
  const pageController = { evaluate } as unknown as PageController;
  return [pageController, evaluate];
}

function createEnv(pageController: PageController): CanvasProbeEnv {
  return {
    pageController,
    cdpSession: null as never,
    tabId: 'tab-1',
    frameId: 'frame-0',
  };
}

// Reusable canvas metadata for mock results
const CANVAS_1920_1080 = { width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' as const };
const CANVAS_800_600 = { width: 800, height: 600, dpr: 1, contextType: 'webgl' as const };

// Reusable scene node for mock results
function makeSceneNode(overrides: Partial<CanvasSceneNode> = {}): CanvasSceneNode {
  return {
    id: 'root',
    type: 'Container',
    name: 'Stage',
    visible: true,
    interactive: false,
    alpha: 1,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    worldBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    path: 'root',
    ...overrides,
  };
}

// ── Interface conformance shared tests ─────────────────────────────────────────

/**
 * Shared interface conformance tests that every CanvasEngineAdapter must satisfy.
 * Used by each adapter's describe block via a helper below.
 */
function runInterfaceConformanceTests(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createAdapter: () => CanvasEngineAdapter,
  engineName: string,
  adapterId: string,
): void {
  describe('CanvasEngineAdapter interface conformance', () => {
    it('has the expected id', () => {
      const adapter = createAdapter();
      expect(adapter.id).toBe(adapterId);
    });

    it('has the expected engine name', () => {
      const adapter = createAdapter();
      expect(adapter.engine).toBe(engineName);
    });

    it('id is a readonly string', () => {
      const adapter = createAdapter();
      expect(typeof adapter.id).toBe('string');
    });

    it('engine is a readonly string', () => {
      const adapter = createAdapter();
      expect(typeof adapter.engine).toBe('string');
    });

    it('version is optional string or undefined', () => {
      const adapter = createAdapter();
      expect(adapter.version === undefined || typeof adapter.version === 'string').toBe(true);
    });

    it('detect returns a promise', () => {
      const adapter = createAdapter();
      const result = adapter.detect(createEnv(createMockPageController({})[0]));
      expect(result).toBeInstanceOf(Promise);
    });

    it('dumpScene returns a promise', () => {
      const adapter = createAdapter();
      const result = adapter.dumpScene(createEnv(createMockPageController({})[0]), {});
      expect(result).toBeInstanceOf(Promise);
    });

    it('pickAt returns a promise', () => {
      const adapter = createAdapter();
      const result = adapter.pickAt(createEnv(createMockPageController({})[0]), { x: 0, y: 0 });
      expect(result).toBeInstanceOf(Promise);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// PIXI.JS ADAPTER TESTS
// ════════════════════════════════════════════════════════════════════════════════

const createPixiAdapter = (): CanvasEngineAdapter => new PixiJSCanvasAdapter();

describe('PixiJSCanvasAdapter', () => {
  runInterfaceConformanceTests(createPixiAdapter, 'PixiJS', 'pixi');

  // ── detect() ────────────────────────────────────────────────────────────────

  describe('detect()', () => {
    it('returns null when window.PIXI is undefined', async () => {
      const [pageController] = createMockPageController({
        present: false,
        hasApp: false,
        version: undefined,
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns null when PIXI exists but PIXI.Application is absent', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasApp: false,
        version: '7.3.2',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns CanvasDetection when PIXI.Application is present', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasApp: true,
        version: '8.2.0',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.engine).toBe('PixiJS');
      expect(result!.version).toBe('8.2.0');
      expect(result!.adapterId).toBe('pixi');
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it('returns detection with PIXI.Application evidence', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasApp: true,
        version: '7.1.0',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(Array.isArray(result!.evidence)).toBe(true);
      expect(
        result!.evidence.some((e: string) => e.includes('PIXI') || e.includes('Application')),
      ).toBe(true);
    });

    it('returns null when evaluate throws', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('CDP error')),
      } as unknown as PageController;
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });
  });

  // ── dumpScene() ────────────────────────────────────────────────────────────

  describe('dumpScene()', () => {
    it('returns full scene dump with scene tree from PIXI.Application.stage', async () => {
      const sceneNode = makeSceneNode({
        id: 'pixi-root',
        type: 'Container',
        path: 'PIXI.Application.stage',
        children: [
          makeSceneNode({
            id: 'sprite-bg',
            name: 'Background',
            type: 'Sprite',
            path: 'PIXI.Application.stage/sprite-bg',
          }),
        ],
      });

      const [pageController] = createMockPageController({
        engine: 'PixiJS',
        version: '8.1.0',
        canvas: CANVAS_1920_1080,
        sceneTree: sceneNode,
        totalNodes: 2,
        completeness: 'full',
      });
      const env = createEnv(pageController);
      const opts: DumpOpts = { maxDepth: 20 };

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.dumpScene(env, opts);

      expect(result.engine).toBe('PixiJS');
      expect(result.version).toBe('8.1.0');
      expect(result.canvas.width).toBe(1920);
      expect(result.canvas.height).toBe(1080);
      expect(result.canvas.contextType).toBe('webgl2');
      expect(result.sceneTree).toBeDefined();
      expect(result.sceneTree).not.toBeNull();
      expect(result.totalNodes).toBe(2);
      expect(result.completeness).toBe('full');
    });

    it('returns completeness full when scene tree is returned', async () => {
      const [pageController] = createMockPageController({
        engine: 'PixiJS',
        canvas: CANVAS_800_600,
        sceneTree: makeSceneNode(),
        totalNodes: 1,
        completeness: 'full',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.completeness).toBe('full');
    });

    it('returns completeness partial when stage is not found', async () => {
      const [pageController] = createMockPageController({
        engine: 'PixiJS',
        canvas: CANVAS_800_600,
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.completeness).toBe('partial');
      expect(result.sceneTree).toBeDefined();
    });

    it('calls pageController.evaluate with a PixiJS scene dump script', async () => {
      const [pageController, evaluate] = createMockPageController({
        engine: 'PixiJS',
        canvas: CANVAS_800_600,
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      await adapter.dumpScene(env, { maxDepth: 10 });

      expect(evaluate).toHaveBeenCalled();
      const calledScript = evaluate.mock.calls[0]![0] as string;
      expect(typeof calledScript).toBe('string');
      expect(calledScript.length).toBeGreaterThan(0);
    });

    it('returns correct canvas metadata in dump result', async () => {
      const [pageController] = createMockPageController({
        engine: 'PixiJS',
        version: '7.3.0',
        canvas: { width: 1280, height: 720, dpr: 1.5, contextType: 'webgl' as const },
        sceneTree: makeSceneNode(),
        totalNodes: 1,
        completeness: 'full',
      });
      const env = createEnv(pageController);

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.canvas.width).toBe(1280);
      expect(result.canvas.height).toBe(720);
      expect(result.canvas.dpr).toBe(1.5);
      expect(result.canvas.contextType).toBe('webgl');
    });
  });

  // ── pickAt() ────────────────────────────────────────────────────────────────

  describe('pickAt()', () => {
    it('returns successful pick result using container.getBounds() for world bounds', async () => {
      const pickedNode = makeSceneNode({
        id: 'player',
        type: 'Sprite',
        name: 'PlayerSprite',
        interactive: true,
        x: 100,
        y: 200,
        width: 64,
        height: 64,
        worldBounds: { x: 100, y: 200, width: 64, height: 64 },
        path: 'PIXI.Application.stage/player',
      });

      const [pageController] = createMockPageController({
        success: true,
        picked: pickedNode,
        candidates: [{ node: pickedNode, depth: 2 }],
        coordinates: {
          screen: { x: 150, y: 250 },
          canvas: { x: 150, y: 250 },
        },
        hitTestMethod: 'engine',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 150, y: 250 };

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.picked).not.toBeNull();
      expect(result.picked!.id).toBe('player');
      expect(result.picked!.worldBounds).toBeDefined();
      expect(result.hitTestMethod).toBe('engine');
    });

    it('respects interactive property (eventMode in v8, interactive in v7)', async () => {
      const interactiveNode = makeSceneNode({
        id: 'button',
        type: 'Container',
        interactive: true,
        path: 'PIXI.Application.stage/button',
      });

      const [pageController] = createMockPageController({
        success: true,
        picked: interactiveNode,
        candidates: [{ node: interactiveNode, depth: 1 }],
        coordinates: {
          screen: { x: 400, y: 300 },
          canvas: { x: 400, y: 300 },
        },
        hitTestMethod: 'manual',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 400, y: 300 };

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.picked!.interactive).toBe(true);
    });

    it('returns failed pick when no hit at coordinates', async () => {
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

      const adapter = new PixiJSCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
      expect(result.candidates).toEqual([]);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PHASER ADAPTER TESTS
// ════════════════════════════════════════════════════════════════════════════════

const createPhaserAdapter = (): CanvasEngineAdapter => new PhaserCanvasAdapter();

describe('PhaserCanvasAdapter', () => {
  runInterfaceConformanceTests(createPhaserAdapter, 'Phaser', 'phaser');

  // ── detect() ────────────────────────────────────────────────────────────────

  describe('detect()', () => {
    it('returns null when window.Phaser is undefined', async () => {
      const [pageController] = createMockPageController({
        present: false,
        hasGames: false,
        version: undefined,
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns null when Phaser exists but Phaser.GAMES is empty', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasGames: false,
        version: '3.60.0',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns CanvasDetection when Phaser.GAMES has entries', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasGames: true,
        version: '3.60.0',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.engine).toBe('Phaser');
      expect(result!.adapterId).toBe('phaser');
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it('extracts game version from Phaser.VERSION', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasGames: true,
        version: '3.55.2',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result!.version).toBe('3.55.2');
    });

    it('includes evidence of Phaser.GAMES detection', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasGames: true,
        version: '3.70.0',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(Array.isArray(result!.evidence)).toBe(true);
      expect(
        result!.evidence.some((e: string) => e.includes('Phaser') || e.includes('GAMES')),
      ).toBe(true);
    });

    it('returns null when evaluate throws', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('CDP error')),
      } as unknown as PageController;
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });
  });

  // ── dumpScene() ────────────────────────────────────────────────────────────

  describe('dumpScene()', () => {
    it('traverses game.scene to dump active scenes', async () => {
      const sceneNode = makeSceneNode({
        id: 'main-scene',
        type: 'Phaser.Scene',
        path: 'Phaser.Game.scenes[main]',
      });

      const [pageController] = createMockPageController({
        engine: 'Phaser',
        version: '3.60.0',
        canvas: CANVAS_1920_1080,
        sceneTree: sceneNode,
        totalNodes: 1,
        completeness: 'full',
      });
      const env = createEnv(pageController);
      const opts: DumpOpts = { maxDepth: 20 };

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.dumpScene(env, opts);

      expect(result.engine).toBe('Phaser');
      expect(result.version).toBe('3.60.0');
      expect(result.canvas.width).toBe(1920);
      expect(result.sceneTree).toBeDefined();
      expect(result.completeness).toBe('full');
    });

    it('handles multiple scenes in game.scene', async () => {
      const [pageController] = createMockPageController({
        engine: 'Phaser',
        canvas: CANVAS_800_600,
        sceneTree: makeSceneNode({
          id: 'boot-scene',
          path: 'Phaser.Game.scenes[boot]',
          children: [
            makeSceneNode({ id: 'game-scene', path: 'Phaser.Game.scenes[game]' }),
            makeSceneNode({ id: 'ui-scene', path: 'Phaser.Game.scenes[ui]' }),
          ],
        }),
        totalNodes: 3,
        completeness: 'full',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.sceneTree).toBeDefined();
      expect(result.totalNodes).toBe(3);
    });

    it('marks completeness as partial when no active scene found', async () => {
      const [pageController] = createMockPageController({
        engine: 'Phaser',
        canvas: CANVAS_800_600,
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.completeness).toBe('partial');
    });

    it('returns canvas metadata from Phaser canvas element', async () => {
      const [pageController] = createMockPageController({
        engine: 'Phaser',
        version: '3.55.2',
        canvas: { width: 1024, height: 768, dpr: 1, contextType: 'webgl' as const },
        sceneTree: makeSceneNode(),
        totalNodes: 1,
        completeness: 'full',
      });
      const env = createEnv(pageController);

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.canvas.width).toBe(1024);
      expect(result.canvas.height).toBe(768);
      expect(result.canvas.contextType).toBe('webgl');
    });
  });

  // ── pickAt() ────────────────────────────────────────────────────────────────

  describe('pickAt()', () => {
    it('returns successful pick using scene.input.hitTestPointer()', async () => {
      const pickedNode = makeSceneNode({
        id: 'phaser-button',
        type: 'Image',
        interactive: true,
        x: 300,
        y: 400,
        path: 'Phaser.Game.scenes[game]/phaser-button',
      });

      const [pageController] = createMockPageController({
        success: true,
        picked: pickedNode,
        candidates: [{ node: pickedNode, depth: 2 }],
        coordinates: {
          screen: { x: 300, y: 400 },
          canvas: { x: 300, y: 400 },
        },
        hitTestMethod: 'engine',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 300, y: 400 };

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.picked).not.toBeNull();
      expect(result.picked!.id).toBe('phaser-button');
    });

    it('handles disabled input gracefully', async () => {
      const [pageController] = createMockPageController({
        success: false,
        picked: null,
        candidates: [],
        coordinates: {
          screen: { x: 500, y: 500 },
          canvas: { x: 500, y: 500 },
        },
        hitTestMethod: 'none',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 500, y: 500 };

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
    });

    it('returns failed pick when hit test finds no object', async () => {
      const [pageController] = createMockPageController({
        success: false,
        picked: null,
        candidates: [],
        coordinates: {
          screen: { x: 9999, y: 9999 },
          canvas: { x: 9999, y: 9999 },
        },
        hitTestMethod: 'none',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 9999, y: 9999 };

      const adapter = new PhaserCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(false);
      expect(result.candidates).toHaveLength(0);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// COCOS CREATOR ADAPTER TESTS
// ════════════════════════════════════════════════════════════════════════════════

const createCocosAdapter = (): CanvasEngineAdapter => new CocosCanvasAdapter();

describe('CocosCanvasAdapter', () => {
  runInterfaceConformanceTests(createCocosAdapter, 'CocosCreator', 'cocos');

  // ── detect() ────────────────────────────────────────────────────────────────

  describe('detect()', () => {
    it('returns null when window.cc is undefined', async () => {
      const [pageController] = createMockPageController({
        present: false,
        hasDirector: false,
        version: undefined,
        versionMajor: undefined,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns null when cc exists but cc.director is absent', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasDirector: false,
        version: '2.4.3',
        versionMajor: 2,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });

    it('returns CanvasDetection when cc.director is present', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasDirector: true,
        version: '3.8.0',
        versionMajor: 3,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.engine).toBe('CocosCreator');
      expect(result!.adapterId).toBe('cocos');
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it('identifies v2 Cocos from API differences', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasDirector: true,
        version: '2.4.3',
        versionMajor: 2,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(
        result!.evidence.some(
          (e: string) => e.includes('2') || e.includes('v2') || e.includes('CC'),
        ),
      ).toBe(true);
    });

    it('identifies v3 Cocos from API differences', async () => {
      const [pageController] = createMockPageController({
        present: true,
        hasDirector: true,
        version: '3.8.0',
        versionMajor: 3,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).not.toBeNull();
      expect(result!.evidence.some((e: string) => e.includes('3') || e.includes('v3'))).toBe(true);
    });

    it('returns null when evaluate throws', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('CDP error')),
      } as unknown as PageController;
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.detect(env);

      expect(result).toBeNull();
    });
  });

  // ── dumpScene() ────────────────────────────────────────────────────────────

  describe('dumpScene()', () => {
    it('traverses director.getScene() to dump scene children', async () => {
      const sceneNode = makeSceneNode({
        id: 'cocos-scene',
        type: 'Scene',
        path: 'cc.director.getScene()',
        children: [
          makeSceneNode({
            id: 'canvas-node',
            name: 'Canvas',
            type: 'Node',
            path: 'cc.director.getScene()/canvas-node',
          }),
        ],
      });

      const [pageController] = createMockPageController({
        engine: 'CocosCreator',
        version: '3.8.0',
        canvas: CANVAS_1920_1080,
        sceneTree: sceneNode,
        totalNodes: 2,
        completeness: 'full',
      });
      const env = createEnv(pageController);
      const opts: DumpOpts = { maxDepth: 20 };

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.dumpScene(env, opts);

      expect(result.engine).toBe('CocosCreator');
      expect(result.version).toBe('3.8.0');
      expect(result.canvas.width).toBe(1920);
      expect(result.sceneTree).toBeDefined();
      expect(result.totalNodes).toBe(2);
      expect(result.completeness).toBe('full');
    });

    it('handles v3 node system (cc.Node hierarchy)', async () => {
      const v3SceneNode = makeSceneNode({
        id: 'v3-scene',
        type: 'Scene',
        path: 'cc.director.getScene()',
        children: [
          makeSceneNode({ id: 'sprite', type: 'Sprite', path: 'cc.director.getScene()/sprite' }),
        ],
      });

      const [pageController] = createMockPageController({
        engine: 'CocosCreator',
        version: '3.7.0',
        canvas: CANVAS_1920_1080,
        sceneTree: v3SceneNode,
        totalNodes: 2,
        completeness: 'full',
        versionMajor: 3,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.engine).toBe('CocosCreator');
      expect(result.completeness).toBe('full');
    });

    it('handles v2 node system (cc.Node hierarchy)', async () => {
      const v2SceneNode = makeSceneNode({
        id: 'v2-scene',
        type: 'Scene',
        path: 'cc.director.getScene()',
        children: [
          makeSceneNode({
            id: 'ccsprite',
            type: 'cc.Sprite',
            path: 'cc.director.getScene()/ccsprite',
          }),
        ],
      });

      const [pageController] = createMockPageController({
        engine: 'CocosCreator',
        version: '2.4.3',
        canvas: CANVAS_1920_1080,
        sceneTree: v2SceneNode,
        totalNodes: 2,
        completeness: 'full',
        versionMajor: 2,
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.engine).toBe('CocosCreator');
      expect(result.completeness).toBe('full');
    });

    it('marks completeness as partial when getScene returns null', async () => {
      const [pageController] = createMockPageController({
        engine: 'CocosCreator',
        canvas: CANVAS_800_600,
        sceneTree: null,
        totalNodes: 0,
        completeness: 'partial',
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.completeness).toBe('partial');
    });

    it('returns correct canvas metadata', async () => {
      const [pageController] = createMockPageController({
        engine: 'CocosCreator',
        version: '2.4.3',
        canvas: { width: 960, height: 640, dpr: 1, contextType: 'webgl' as const },
        sceneTree: makeSceneNode(),
        totalNodes: 1,
        completeness: 'full',
      });
      const env = createEnv(pageController);

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.dumpScene(env, {});

      expect(result.canvas.width).toBe(960);
      expect(result.canvas.height).toBe(640);
      expect(result.canvas.contextType).toBe('webgl');
    });
  });

  // ── pickAt() ────────────────────────────────────────────────────────────────

  describe('pickAt()', () => {
    it('returns successful pick using hitTest or bounding box check', async () => {
      const pickedNode = makeSceneNode({
        id: 'cocos-button',
        type: 'Button',
        interactive: true,
        x: 200,
        y: 150,
        width: 100,
        height: 50,
        worldBounds: { x: 150, y: 125, width: 100, height: 50 },
        path: 'cc.director.getScene()/canvas/cocos-button',
      });

      const [pageController] = createMockPageController({
        success: true,
        picked: pickedNode,
        candidates: [{ node: pickedNode, depth: 2 }],
        coordinates: {
          screen: { x: 200, y: 150 },
          canvas: { x: 200, y: 150 },
        },
        hitTestMethod: 'engine',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 200, y: 150 };

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.picked).not.toBeNull();
      expect(result.picked!.id).toBe('cocos-button');
    });

    it('returns failed pick when no node at coordinates', async () => {
      const [pageController] = createMockPageController({
        success: false,
        picked: null,
        candidates: [],
        coordinates: {
          screen: { x: -1, y: -1 },
          canvas: { x: -1, y: -1 },
        },
        hitTestMethod: 'none',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: -1, y: -1 };

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
      expect(result.candidates).toEqual([]);
    });

    it('handles v3 hitTest path', async () => {
      const v3Node = makeSceneNode({
        id: 'v3-sprite',
        type: 'Sprite',
        interactive: true,
        path: 'cc.director.getScene()/v3-sprite',
      });

      const [pageController] = createMockPageController({
        success: true,
        picked: v3Node,
        candidates: [{ node: v3Node, depth: 1 }],
        coordinates: {
          screen: { x: 100, y: 100 },
          canvas: { x: 100, y: 100 },
        },
        hitTestMethod: 'engine',
      });
      const env = createEnv(pageController);
      const opts: PickOpts = { x: 100, y: 100 };

      const adapter = new CocosCanvasAdapter();
      const result = await adapter.pickAt(env, opts);

      expect(result.success).toBe(true);
      expect(result.hitTestMethod).toBe('engine');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ADAPTER REGISTRY / IDENTITY TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Multi-engine canvas adapter registry', () => {
  it('PixiJS adapter has id "pixi"', () => {
    const adapter = new PixiJSCanvasAdapter();
    expect(adapter.id).toBe('pixi');
  });

  it('Phaser adapter has id "phaser"', () => {
    const adapter = new PhaserCanvasAdapter();
    expect(adapter.id).toBe('phaser');
  });

  it('Cocos adapter has id "cocos"', () => {
    const adapter = new CocosCanvasAdapter();
    expect(adapter.id).toBe('cocos');
  });

  it('each adapter has a unique id', () => {
    const ids = [
      new PixiJSCanvasAdapter().id,
      new PhaserCanvasAdapter().id,
      new CocosCanvasAdapter().id,
    ];

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('each adapter has the correct engine name', () => {
    expect(new PixiJSCanvasAdapter().engine).toBe('PixiJS');
    expect(new PhaserCanvasAdapter().engine).toBe('Phaser');
    expect(new CocosCanvasAdapter().engine).toBe('CocosCreator');
  });

  it('each adapter returns completeness full on successful dump', async () => {
    const mockResult = {
      engine: 'Test',
      canvas: CANVAS_1920_1080,
      sceneTree: makeSceneNode(),
      totalNodes: 1,
      completeness: 'full',
    };

    const [pixiPC] = createMockPageController(mockResult);
    const [phaserPC] = createMockPageController({ ...mockResult, engine: 'Phaser' });
    const [cocosPC] = createMockPageController({ ...mockResult, engine: 'CocosCreator' });

    const pixiResult = await new PixiJSCanvasAdapter().dumpScene(createEnv(pixiPC), {});
    const phaserResult = await new PhaserCanvasAdapter().dumpScene(createEnv(phaserPC), {});
    const cocosResult = await new CocosCanvasAdapter().dumpScene(createEnv(cocosPC), {});

    expect(pixiResult.completeness).toBe('full');
    expect(phaserResult.completeness).toBe('full');
    expect(cocosResult.completeness).toBe('full');
  });

  it('each adapter returns completeness partial on fallback', async () => {
    const mockResult = {
      engine: 'Test',
      canvas: CANVAS_1920_1080,
      sceneTree: null,
      totalNodes: 0,
      completeness: 'partial',
    };

    const [pixiPC] = createMockPageController(mockResult);
    const [phaserPC] = createMockPageController({ ...mockResult, engine: 'Phaser' });
    const [cocosPC] = createMockPageController({ ...mockResult, engine: 'CocosCreator' });

    const pixiResult = await new PixiJSCanvasAdapter().dumpScene(createEnv(pixiPC), {});
    const phaserResult = await new PhaserCanvasAdapter().dumpScene(createEnv(phaserPC), {});
    const cocosResult = await new CocosCanvasAdapter().dumpScene(createEnv(cocosPC), {});

    expect(pixiResult.completeness).toBe('partial');
    expect(phaserResult.completeness).toBe('partial');
    expect(cocosResult.completeness).toBe('partial');
  });

  it('all adapters implement CanvasEngineAdapter interface', () => {
    // This test verifies at runtime that each adapter satisfies the interface
    // by checking that all required methods exist and have the correct return types.

    const adapters = [
      new PixiJSCanvasAdapter(),
      new PhaserCanvasAdapter(),
      new CocosCanvasAdapter(),
    ];

    for (const adapter of adapters) {
      expect(typeof adapter.id).toBe('string');
      expect(typeof adapter.engine).toBe('string');
      expect(typeof adapter.detect).toBe('function');
      expect(typeof adapter.dumpScene).toBe('function');
      expect(typeof adapter.pickAt).toBe('function');
    }
  });
});
