import { describe, expect, it, vi } from 'vitest';
import { CanvasToolHandlers } from '@server/domains/canvas/handlers';
import { fingerprintCanvas, resolveAdapter } from '@server/domains/canvas/handlers/shared';
import type {
  CanvasDomainDependencies,
  PageController,
  DebuggerManager,
  TraceRecorder,
} from '@server/domains/canvas/dependencies';

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

describe('CanvasToolHandlers', () => {
  // ── Mock factories ────────────────────────────────────────────────────

  function createMockPageController(evaluateResult: unknown = {}) {
    return {
      evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
  }

  function createSequentialMockPageController(...results: unknown[]) {
    let callIndex = 0;
    return {
      evaluate: vi.fn().mockImplementation(() => {
        return Promise.resolve(results[callIndex++] ?? results[results.length - 1]);
      }),
    };
  }

  function createScriptExecutingPageController(context: {
    window: Record<string, unknown>;
    document: {
      querySelectorAll(selector: string): unknown[];
      getElementById(id: string): unknown;
    };
  }) {
    return {
      evaluate: vi
        .fn()
        .mockImplementation(async (script: string) => executeEvaluateScript(script, context)),
    };
  }

  function createMockDebuggerManager() {
    const eventManager = {
      setEventListenerBreakpoint: vi.fn().mockResolvedValue('event-bp-1'),
      removeEventListenerBreakpoint: vi.fn().mockResolvedValue(true),
    };
    return {
      enable: vi.fn(),
      ensureAdvancedFeatures: vi.fn(),
      getEventManager: vi.fn().mockReturnValue(eventManager),
      waitForPaused: vi.fn(),
      resume: vi.fn(),
    };
  }

  function createMockTraceRecorder() {
    return {
      start: vi.fn(),
      stop: vi.fn(),
    };
  }

  function createMockEvidenceStore() {
    return {
      addNode: vi.fn().mockReturnValue({ id: 'node-1' }),
      addEdge: vi.fn(),
      getNode: vi.fn(),
    };
  }

  function createHandlers(deps?: unknown): CanvasToolHandlers {
    const d = (deps as Partial<CanvasDomainDependencies>) ?? {};
    return new CanvasToolHandlers({
      pageController: (d.pageController ?? createMockPageController()) as PageController,
      debuggerManager: (d.debuggerManager ?? createMockDebuggerManager()) as DebuggerManager,
      traceRecorder: (d.traceRecorder ?? createMockTraceRecorder()) as TraceRecorder,
      evidenceStore: d.evidenceStore ?? createMockEvidenceStore(),
    });
  }

  // ── handleFingerprint ─────────────────────────────────────────────────

  describe('shared canvas helpers', () => {
    it('resolveAdapter loads built-in adapters through the shared adapter registry', () => {
      expect(resolveAdapter({ adapterId: 'laya' })?.id).toBe('laya');
      expect(resolveAdapter({ adapterId: 'pixi' })?.id).toBe('pixi');
      expect(resolveAdapter({ adapterId: 'phaser' })?.id).toBe('phaser');
      expect(resolveAdapter({ adapterId: 'cocos' })?.id).toBe('cocos');
      expect(resolveAdapter({ adapterId: 'unknown' })).toBeNull();
    });

    it('fingerprintCanvas prefers the engine associated with the requested canvas', async () => {
      const layaCanvas = { id: 'laya-canvas' };
      const pixiCanvas = { id: 'pixi-canvas', _pixiApp: { stage: {} } };
      const canvases = [layaCanvas, pixiCanvas];
      const pageController = createScriptExecutingPageController({
        window: {
          Laya: { version: '2.0.0' },
          PIXI: { VERSION: '8.0.0', Application: {} },
          __pixiApp: { view: pixiCanvas },
        },
        document: {
          querySelectorAll: (selector: string) => (selector === 'canvas' ? canvases : []),
          getElementById: (id: string) => canvases.find((canvas) => canvas.id === id) ?? null,
        },
      });

      const detection = await fingerprintCanvas(
        pageController as unknown as PageController,
        'pixi-canvas',
      );

      expect(detection).toMatchObject({
        engine: 'PixiJS',
        adapterId: 'pixi',
      });
      expect(detection?.evidence).toContain('target canvas owns _pixiApp');
    });
  });

  describe('handleFingerprint', () => {
    it('returns fingerprint result when engine is detected', async () => {
      const pageController = createMockPageController([
        {
          pattern: 'Laya',
          adapterId: 'laya',
          engine: 'LayaAir',
          present: true,
          version: '2.12.0',
        },
      ]);
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});

      expect(result).toBeDefined();
      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.candidates).toBeDefined();
      expect(Array.isArray(parsed.candidates)).toBe(true);
      expect(parsed.candidates.length).toBeGreaterThan(0);
      expect(parsed.candidates[0]).toMatchObject({
        engine: 'LayaAir',
        version: '2.12.0',
        adapterId: 'laya',
      });
    });

    it('returns empty candidates when no engine is detected', async () => {
      // Three sequential evaluate calls: engine scan, canvas info, RAF evidence
      const pageController = createSequentialMockPageController([], [], false);
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});

      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.candidates).toEqual([]);
      expect(parsed.fingerprintComplete).toBe(false);
    });

    it('accepts optional canvasId argument without throwing', async () => {
      const pageController = createSequentialMockPageController([], [], false);
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({ canvasId: 'my-canvas' });

      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.candidates).toEqual([]);
    });

    it('propagates pageController errors gracefully', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error(' CDP error')),
      };
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleFingerprint({});

      expect(result).toBeDefined();
      // Should return an error-structured response, not throw
      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toBeTruthy();
    });
  });

  // ── handleSceneDump ───────────────────────────────────────────────────

  describe('handleSceneDump', () => {
    it('returns partial dump when no canvas engine is detected', async () => {
      // fingerprintCanvas → evaluate returns [] (no engine)
      // partialSceneDump → evaluate returns canvas metadata
      const pageController = createSequentialMockPageController(
        [], // fingerprint result: no engine
        [{ id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({});

      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.completeness).toBe('partial');
      expect(parsed.sceneTree).toBeNull();
    });

    it('does not write debug output while handling scene dumps', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const pageController = createSequentialMockPageController(
        [],
        [{ id: 'canvas-0', width: 800, height: 600, dpr: 1, contextType: 'webgl' }],
      );
      const handlers = createHandlers({ pageController });

      try {
        await handlers.handleSceneDump({});
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });

    it('accepts canvasId, maxDepth, onlyInteractive, onlyVisible args', async () => {
      const pageController = createSequentialMockPageController(
        [], // no engine
        [{ id: 'test-canvas', width: 1920, height: 1080, dpr: 2, contextType: 'webgl2' }],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handleSceneDump({
        canvasId: 'game-canvas',
        maxDepth: 10,
        onlyInteractive: true,
        onlyVisible: true,
      });

      expect(result).toBeDefined();
      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.completeness).toBe('partial');
    });
  });

  // ── handlePick ────────────────────────────────────────────────────────

  describe('handlePick', () => {
    it('returns success=false when no canvas engine is detected', async () => {
      // handlePick makes 2 evaluate calls: coordinate transform + fingerprint
      const pageController = createSequentialMockPageController(
        {
          screen: { x: 400, y: 300 },
          canvasRect: { left: 0, top: 0, width: 800, height: 600 },
          canvasX: 400,
          canvasY: 300,
        },
        [], // no engine detected
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 400, y: 300 });

      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(false);
      expect(parsed.candidates).toEqual([]);
      expect(parsed.hitTestMethod).toBe('none');
    });

    it('requires x and y arguments', async () => {
      const pageController = createSequentialMockPageController(
        { screen: { x: 0, y: 0 }, canvasX: 0, canvasY: 0 },
        [],
      );
      const handlers = createHandlers({ pageController });

      // Missing x/y should not throw (argNumberRequired throws, but wrapped in try-catch)
      const result = await handlers.handlePick({});
      expect(result).toBeDefined();
    });

    it('accepts highlight option without throwing', async () => {
      const pageController = createSequentialMockPageController(
        { screen: { x: 100, y: 200 }, canvasX: 100, canvasY: 200 },
        [],
      );
      const handlers = createHandlers({ pageController });

      const result = await handlers.handlePick({ x: 100, y: 200, highlight: true });
      expect(result).toBeDefined();
    });
  });

  // ── handleTraceClick ──────────────────────────────────────────────────

  describe('handleTraceClick', () => {
    it('calls debuggerManager.enable and setEventListenerBreakpoint', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['pointerdown', 'pointerup', 'click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          {
            functionName: 'onClick',
            url: 'game.js',
            location: { lineNumber: 42, columnNumber: 5 },
          },
        ],
      });
      const handlers = createHandlers({ pageController, debuggerManager });

      await handlers.handleTraceClick({ x: 100, y: 200 });

      expect(debuggerManager.enable).toHaveBeenCalled();
      expect(debuggerManager.ensureAdvancedFeatures).toHaveBeenCalled();
      expect(debuggerManager.getEventManager()).toBeDefined();
      expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(5000);
      expect(debuggerManager.resume).toHaveBeenCalled();
    });

    it('records evidence with correct metadata', async () => {
      // handleTraceClick makes one evaluate call via dispatchCanvasClick
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'PixiJS',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const evidenceStore = createMockEvidenceStore();
      const handlers = createHandlers({ pageController, debuggerManager, evidenceStore });

      await handlers.handleTraceClick({ x: 50, y: 50 });

      expect(evidenceStore.addNode).toHaveBeenCalledWith(
        'function',
        'canvas_trace',
        expect.objectContaining({
          engine: 'PixiJS',
          x: 50,
          y: 50,
        }),
      );
    });

    it('returns a structured CanvasTraceResult', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['pointerdown', 'click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      debuggerManager.waitForPaused.mockResolvedValue({
        callFrames: [
          {
            functionName: 'handleTap',
            url: 'Sprite.js',
            location: { lineNumber: 10, columnNumber: 0 },
          },
          {
            functionName: '(anonymous)',
            url: 'index.js',
            location: { lineNumber: 5, columnNumber: 0 },
          },
        ],
      });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({ x: 10, y: 10, maxFrames: 50 });

      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('inputFlow');
      expect(parsed).toHaveProperty('domEventChain');
      expect(parsed).toHaveProperty('handlerFrames');
      expect(parsed).toHaveProperty('handlersTriggered');
      expect(parsed).toHaveProperty('engineDispatchChain');
      expect(parsed).toHaveProperty('hitTarget');
      expect(Array.isArray(parsed.handlerFrames)).toBe(true);
      expect(parsed.handlerFrames).toHaveLength(2);
    });

    it('uses default breakpointType "click" when not specified', async () => {
      const pageController = createSequentialMockPageController({
        domEventChain: ['click'],
        pickedNode: null,
        engine: 'LayaAir',
        engineChain: [],
      });
      const debuggerManager = createMockDebuggerManager();
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      await handlers.handleTraceClick({ x: 0, y: 0 });

      const eventManager = debuggerManager.getEventManager();
      expect(eventManager.setEventListenerBreakpoint).toHaveBeenCalledWith('click');
    });

    it('respects explicit breakpointType argument', async () => {
      const dispatchedTypes: string[] = [];
      const canvas = {
        id: 'game-canvas',
        width: 200,
        height: 120,
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 200,
          bottom: 120,
          width: 200,
          height: 120,
        }),
        dispatchEvent: (event: { type: string }) => {
          dispatchedTypes.push(event.type);
          return true;
        },
      };
      const pageController = createScriptExecutingPageController({
        window: { Laya: { version: '3.0.0' } },
        document: {
          querySelectorAll: (selector: string) => (selector === 'canvas' ? [canvas] : []),
          getElementById: (id: string) => (id === 'game-canvas' ? canvas : null),
        },
      });
      const debuggerManager = createMockDebuggerManager();
      debuggerManager.waitForPaused.mockResolvedValue({ callFrames: [] });
      const handlers = createHandlers({ pageController, debuggerManager });

      const result = await handlers.handleTraceClick({
        x: 40,
        y: 20,
        canvasId: 'game-canvas',
        breakpointType: 'mousedown',
      });
      const text =
        (result as unknown as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);

      const eventManager = debuggerManager.getEventManager();
      expect(eventManager.setEventListenerBreakpoint).toHaveBeenCalledWith('mousedown');
      expect(eventManager.removeEventListenerBreakpoint).toHaveBeenCalledWith('event-bp-1');
      expect(parsed.inputFlow).toEqual(['pointerdown', 'mousedown']);
      expect(dispatchedTypes).toEqual(['pointerdown', 'mousedown']);
    });

    it('removes the temporary event breakpoint when dispatch fails', async () => {
      const pageController = {
        evaluate: vi.fn().mockRejectedValue(new Error('dispatch failed')),
      };
      const debuggerManager = createMockDebuggerManager();
      const handlers = createHandlers({ pageController, debuggerManager });

      await handlers.handleTraceClick({ x: 0, y: 0, breakpointType: 'click' });

      const eventManager = debuggerManager.getEventManager();
      expect(eventManager.removeEventListenerBreakpoint).toHaveBeenCalledWith('event-bp-1');
    });
  });
});
