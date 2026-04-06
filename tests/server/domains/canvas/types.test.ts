import { describe, expect, it } from 'vitest';
import type {
  CanvasSceneNode,
  CanvasSceneDump,
  CanvasPickResult,
  CanvasDetection,
  CanvasEngineAdapter,
  WorldBounds,
  DOMEventFrame,
  StackFrame,
  HandlerInfo,
  CanvasContextType,
  CanvasTraceBreakpointType,
  CanvasDumpCompleteness,
  CanvasHitTestMethod,
  CanvasNetworkProtocol,
  CanvasTraceResult,
  NetworkEvent,
  DumpOpts,
  PickOpts,
  TraceOpts,
} from '@server/domains/canvas/types';

describe('canvas domain types', () => {
  // ── Primitive types ───────────────────────────────────────────────────

  describe('CanvasContextType', () => {
    it('accepts all expected literal values', () => {
      const values: CanvasContextType[] = ['2d', 'webgl', 'webgl2', 'webgpu'];
      expect(values).toBeDefined();
    });
  });

  describe('CanvasTraceBreakpointType', () => {
    it('accepts all expected literal values', () => {
      const values: CanvasTraceBreakpointType[] = ['click', 'mousedown', 'pointerdown'];
      expect(values).toBeDefined();
    });
  });

  describe('CanvasDumpCompleteness', () => {
    it('accepts "full" and "partial"', () => {
      const values: CanvasDumpCompleteness[] = ['full', 'partial'];
      expect(values).toBeDefined();
    });
  });

  describe('CanvasHitTestMethod', () => {
    it('accepts all expected literal values', () => {
      const values: CanvasHitTestMethod[] = ['engine', 'manual', 'none'];
      expect(values).toBeDefined();
    });
  });

  describe('CanvasNetworkProtocol', () => {
    it('accepts all expected literal values', () => {
      const values: CanvasNetworkProtocol[] = ['http', 'websocket', 'fetch'];
      expect(values).toBeDefined();
    });
  });

  // ── WorldBounds ──────────────────────────────────────────────────────

  describe('WorldBounds', () => {
    it('has required numeric fields', () => {
      const wb: WorldBounds = { x: 10, y: 20, width: 100, height: 200 };
      expect(wb.x).toBe(10);
      expect(wb.y).toBe(20);
      expect(wb.width).toBe(100);
      expect(wb.height).toBe(200);
    });
  });

  // ── CanvasSceneNode ─────────────────────────────────────────────────

  describe('CanvasSceneNode', () => {
    it('has all required primitive fields', () => {
      const node: CanvasSceneNode = {
        id: 'node-1',
        type: 'Sprite',
        name: 'Player',
        visible: true,
        interactive: true,
        mouseEnabled: true,
        alpha: 0.8,
        x: 100,
        y: 200,
        width: 50,
        height: 60,
        worldBounds: { x: 100, y: 200, width: 50, height: 60 },
        path: 'Laya.stage/Scene/Player',
      };

      expect(node.id).toBe('node-1');
      expect(node.type).toBe('Sprite');
      expect(node.visible).toBe(true);
      expect(node.interactive).toBe(true);
      expect(node.alpha).toBe(0.8);
      expect(node.x).toBe(100);
      expect(node.y).toBe(200);
      expect(node.width).toBe(50);
      expect(node.height).toBe(60);
      expect(node.worldBounds).toBeDefined();
      expect(node.path).toBe('Laya.stage/Scene/Player');
    });

    it('accepts optional name and mouseEnabled', () => {
      const node: CanvasSceneNode = {
        id: 'node-2',
        type: 'Node',
        visible: false,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        worldBounds: { x: 0, y: 0, width: 0, height: 0 },
        path: 'root',
      };

      expect(node.name).toBeUndefined();
      expect(node.mouseEnabled).toBeUndefined();
    });

    it('accepts optional children array of CanvasSceneNode', () => {
      const child: CanvasSceneNode = {
        id: 'child-1',
        type: 'Image',
        visible: true,
        interactive: false,
        alpha: 1,
        x: 0,
        y: 0,
        width: 32,
        height: 32,
        worldBounds: { x: 0, y: 0, width: 32, height: 32 },
        path: 'root/child',
      };
      const parent: CanvasSceneNode = {
        id: 'parent-1',
        type: 'Node',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        worldBounds: { x: 0, y: 0, width: 64, height: 64 },
        path: 'root',
        children: [child],
      };

      expect(parent.children).toBeDefined();
      expect(parent.children).toHaveLength(1);
      expect(parent.children![0]!.id).toBe('child-1');
    });

    it('accepts optional customData record', () => {
      const node: CanvasSceneNode = {
        id: 'node-3',
        type: 'Button',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        worldBounds: { x: 0, y: 0, width: 100, height: 40 },
        path: 'ui/button',
        customData: { scaleX: 2, scaleY: 2, rotation: 45, label: 'Play' },
      };

      expect(node.customData).toBeDefined();
      expect(node.customData!.scaleX).toBe(2);
      expect(node.customData!.label).toBe('Play');
    });
  });

  // ── CanvasSceneDump ─────────────────────────────────────────────────

  describe('CanvasSceneDump', () => {
    it('has required engine, canvas, sceneTree, totalNodes, completeness', () => {
      const sceneTree: CanvasSceneNode = {
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
      };

      const dump: CanvasSceneDump = {
        engine: 'LayaAir',
        version: '2.12.0',
        canvas: {
          id: 'game-canvas',
          width: 1920,
          height: 1080,
          dpr: 2,
          contextType: 'webgl2',
        },
        sceneTree,
        totalNodes: 42,
        completeness: 'full',
      };

      expect(dump.engine).toBe('LayaAir');
      expect(dump.version).toBe('2.12.0');
      expect(dump.canvas.width).toBe(1920);
      expect(dump.canvas.height).toBe(1080);
      expect(dump.canvas.dpr).toBe(2);
      expect(dump.canvas.contextType).toBe('webgl2');
      expect(dump.sceneTree).toBeDefined();
      expect(dump.totalNodes).toBe(42);
      expect(dump.completeness).toBe('full');
    });

    it('accepts missing version', () => {
      const dump: CanvasSceneDump = {
        engine: 'PixiJS',
        canvas: { width: 800, height: 600, dpr: 1, contextType: 'webgl' },
        sceneTree: {
          id: 'stage',
          type: 'Stage',
          visible: true,
          interactive: false,
          alpha: 1,
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          worldBounds: { x: 0, y: 0, width: 800, height: 600 },
          path: 'stage',
        },
        totalNodes: 0,
        completeness: 'partial',
      };

      expect(dump.version).toBeUndefined();
      expect(dump.completeness).toBe('partial');
    });
  });

  // ── CanvasPickResult ─────────────────────────────────────────────────

  describe('CanvasPickResult', () => {
    it('has all required fields for a successful pick', () => {
      const pickedNode: CanvasSceneNode = {
        id: 'sprite-1',
        type: 'Sprite',
        visible: true,
        interactive: true,
        alpha: 1,
        x: 100,
        y: 200,
        width: 64,
        height: 64,
        worldBounds: { x: 100, y: 200, width: 64, height: 64 },
        path: 'stage/sprite',
      };

      const result: CanvasPickResult = {
        success: true,
        picked: pickedNode,
        candidates: [{ node: pickedNode, depth: 1 }],
        coordinates: {
          screen: { x: 150, y: 250 },
          canvas: { x: 132, y: 220 },
          stage: { x: 132, y: 220 },
        },
        hitTestMethod: 'engine',
      };

      expect(result.success).toBe(true);
      expect(result.picked).toBeDefined();
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.depth).toBe(1);
      expect(result.coordinates.screen.x).toBe(150);
      expect(result.coordinates.canvas.y).toBe(220);
      expect(result.coordinates.stage?.x).toBe(132);
      expect(result.hitTestMethod).toBe('engine');
    });

    it('has all required fields for a failed pick', () => {
      const result: CanvasPickResult = {
        success: false,
        picked: null,
        candidates: [],
        coordinates: {
          screen: { x: 0, y: 0 },
          canvas: { x: 0, y: 0 },
        },
        hitTestMethod: 'none',
      };

      expect(result.success).toBe(false);
      expect(result.picked).toBeNull();
      expect(result.candidates).toEqual([]);
      expect(result.hitTestMethod).toBe('none');
    });

    it('accepts optional stage coordinates', () => {
      const result: CanvasPickResult = {
        success: true,
        picked: null,
        candidates: [],
        coordinates: {
          screen: { x: 100, y: 100 },
          canvas: { x: 50, y: 50 },
          stage: { x: 25, y: 25 },
        },
        hitTestMethod: 'manual',
      };

      expect(result.coordinates.stage).toBeDefined();
    });
  });

  // ── CanvasDetection ─────────────────────────────────────────────────

  describe('CanvasDetection', () => {
    it('has required fields', () => {
      const detection: CanvasDetection = {
        engine: 'LayaAir',
        version: '3.0.0',
        confidence: 0.95,
        evidence: ['window.Laya is defined', 'Laya.stage is present'],
        adapterId: 'laya',
      };

      expect(detection.engine).toBe('LayaAir');
      expect(detection.confidence).toBe(0.95);
      expect(detection.evidence).toEqual(expect.any(Array));
      expect(detection.adapterId).toBe('laya');
    });

    it('accepts missing version', () => {
      const detection: CanvasDetection = {
        engine: 'PixiJS',
        confidence: 0.9,
        evidence: ['window.PIXI detected'],
        adapterId: 'pixi',
      };

      expect(detection.version).toBeUndefined();
    });
  });

  // ── CanvasEngineAdapter ───────────────────────────────────────────────

  describe('CanvasEngineAdapter interface', () => {
    it('can be implemented with required fields', () => {
      const adapter: CanvasEngineAdapter = {
        id: 'laya',
        engine: 'LayaAir',
        version: '2.x',
        detect: async () => null,
        dumpScene: async () => ({
          engine: 'LayaAir',
          canvas: { width: 0, height: 0, dpr: 1, contextType: 'webgl' },
          sceneTree: {
            id: 'root',
            type: 'Stage',
            visible: true,
            interactive: false,
            alpha: 1,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            worldBounds: { x: 0, y: 0, width: 0, height: 0 },
            path: 'root',
          },
          totalNodes: 0,
          completeness: 'partial',
        }),
        pickAt: async () => ({
          success: false,
          picked: null,
          candidates: [],
          coordinates: { screen: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } },
          hitTestMethod: 'none',
        }),
      };

      expect(adapter.id).toBe('laya');
      expect(adapter.engine).toBe('LayaAir');
    });
  });

  // ── CanvasTraceResult ────────────────────────────────────────────────

  describe('CanvasTraceResult', () => {
    it('has all required fields', () => {
      const result: CanvasTraceResult = {
        inputFlow: ['pointerdown', 'pointerup', 'click'],
        hitTarget: null,
        domEventChain: [{ type: 'click', target: 'game.js', phase: 'at-target' }],
        engineDispatchChain: ['EventDispatcher'],
        handlerFrames: [
          { functionName: 'onClick', scriptUrl: 'game.js', lineNumber: 10, columnNumber: 0 },
        ],
        handlersTriggered: [{ functionName: 'onClick', scriptUrl: 'game.js', lineNumber: 10 }],
        networkEmitted: [],
      };

      expect(result.inputFlow).toEqual(['pointerdown', 'pointerup', 'click']);
      expect(result.hitTarget).toBeNull();
      expect(result.domEventChain).toHaveLength(1);
      expect(result.domEventChain[0]!.phase).toBe('at-target');
      expect(result.engineDispatchChain).toContain('EventDispatcher');
      expect(result.handlerFrames).toHaveLength(1);
      expect(result.handlersTriggered).toHaveLength(1);
      expect(result.networkEmitted).toEqual([]);
    });
  });

  // ── DOMEventFrame ────────────────────────────────────────────────────

  describe('DOMEventFrame', () => {
    it('has all phase literal variants', () => {
      const phases: DOMEventFrame['phase'][] = ['capturing', 'at-target', 'bubbling'];
      phases.forEach((p) => {
        const frame: DOMEventFrame = { type: 'click', phase: p };
        expect(frame.phase).toBe(p);
      });
    });
  });

  // ── StackFrame & HandlerInfo ─────────────────────────────────────────

  describe('StackFrame', () => {
    it('has required functionName and optional source location', () => {
      const frame: StackFrame = {
        functionName: 'Sprite.onClick',
        scriptUrl: 'Sprite.ts',
        lineNumber: 42,
        columnNumber: 8,
      };

      expect(frame.functionName).toBe('Sprite.onClick');
      expect(frame.scriptUrl).toBe('Sprite.ts');
      expect(frame.lineNumber).toBe(42);
      expect(frame.columnNumber).toBe(8);
    });
  });

  describe('HandlerInfo', () => {
    it('has required functionName and optional source location', () => {
      const info: HandlerInfo = {
        functionName: 'handleTap',
        scriptUrl: 'Game.ts',
        lineNumber: 99,
      };

      expect(info.functionName).toBe('handleTap');
      expect(info.lineNumber).toBe(99);
    });
  });

  // ── NetworkEvent ─────────────────────────────────────────────────────

  describe('NetworkEvent', () => {
    it('has required protocol and optional request fields', () => {
      const event: NetworkEvent = {
        protocol: 'fetch',
        url: 'https://api.example.com/data',
        method: 'GET',
        payloadPreview: '{"key":"value"}',
      };

      expect(event.protocol).toBe('fetch');
      expect(event.url).toBe('https://api.example.com/data');
      expect(event.method).toBe('GET');
    });
  });

  // ── Option types ────────────────────────────────────────────────────

  describe('DumpOpts', () => {
    it('has all optional fields', () => {
      const opts: DumpOpts = {
        canvasId: 'canvas-0',
        maxDepth: 10,
        onlyInteractive: true,
        onlyVisible: false,
      };

      expect(opts.canvasId).toBe('canvas-0');
      expect(opts.maxDepth).toBe(10);
      expect(opts.onlyInteractive).toBe(true);
    });
  });

  describe('PickOpts', () => {
    it('requires x, y and accepts optional canvasId', () => {
      const opts: PickOpts = { x: 100, y: 200, canvasId: 'game' };
      expect(opts.x).toBe(100);
      expect(opts.y).toBe(200);
      expect(opts.canvasId).toBe('game');
    });
  });

  describe('TraceOpts', () => {
    it('has all optional fields', () => {
      const opts: TraceOpts = {
        targetNodeId: 'node-5',
        breakpointType: 'mousedown',
        maxFrames: 100,
      };

      expect(opts.targetNodeId).toBe('node-5');
      expect(opts.breakpointType).toBe('mousedown');
      expect(opts.maxFrames).toBe(100);
    });
  });
});
