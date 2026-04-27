/**
 * canvas_trace_click_handler tool handler.
 *
 * Enables CDP event breakpoints, dispatches click, captures call stack,
 * records evidence.
 */
import type {
  PageController,
  DebuggerManager,
  EvidenceStore,
} from '@server/domains/canvas/dependencies';
import type { CanvasTraceResult } from '@server/domains/canvas/types';

interface DispatchResult {
  domEventChain: string[];
  pickedNode: { id: string } | null;
  engine: string | undefined;
  engineChain: string[];
  cleanupToken?: string;
}

interface PendingDispatch {
  result: DispatchResult;
  completion: Promise<void>;
}

interface EventBreakpointManagerLike {
  setEventListenerBreakpoint(eventName: string, targetName?: string): Promise<string>;
  removeEventListenerBreakpoint?(breakpointId: string): Promise<boolean>;
}

type ClickCapablePageController = Partial<Pick<PageController, 'click'>>;

export async function handleTraceClick(
  pageController: PageController,
  debuggerManager: DebuggerManager,
  evidenceStore: EvidenceStore,
  args: Record<string, unknown>,
): Promise<CanvasTraceResult> {
  const x = args['x'] as number;
  const y = args['y'] as number;
  const canvasId = args['canvasId'] as string | undefined;
  const maxFrames = (args['maxFrames'] as number | undefined) ?? 50;
  const breakpointType = (args['breakpointType'] as string | undefined) ?? 'click';

  // Step 1: Enable debugger and set event breakpoint
  await debuggerManager.enable();
  await debuggerManager.ensureAdvancedFeatures();
  const eventMgr = debuggerManager.getEventManager() as EventBreakpointManagerLike;
  const breakpointId = await eventMgr.setEventListenerBreakpoint(breakpointType);
  let cleanupToken: string | undefined;
  let pendingDispatch: Promise<void> | undefined;
  let primaryError: unknown;
  let cleanupError: unknown;
  let traceResult: CanvasTraceResult | undefined;

  try {
    // Step 2: Dispatch click at coordinates
    const dispatch = await dispatchCanvasClick(pageController, x, y, canvasId, breakpointType);
    const dispatchResult = dispatch.result;
    pendingDispatch = dispatch.completion;
    cleanupToken = dispatchResult.cleanupToken;

    // Step 3: Wait for debugger to pause on the event breakpoint
    const pausedState = await debuggerManager.waitForPaused(5000);

    let stackFrames: Array<{
      functionName: string;
      scriptUrl?: string;
      lineNumber?: number;
      columnNumber?: number;
    }> = [];

    if (pausedState?.callFrames) {
      stackFrames = pausedState.callFrames.slice(0, maxFrames).map((frame) => ({
        functionName: frame.functionName || '(anonymous)',
        scriptUrl: frame.url,
        lineNumber: frame.location?.lineNumber,
        columnNumber: frame.location?.columnNumber,
      }));
    }

    // Step 4: Record evidence
    recordEvidence(evidenceStore, 'canvas_trace', {
      engine: dispatchResult.engine ?? 'unknown',
      x,
      y,
      handlerCount: stackFrames.length,
    });

    traceResult = {
      inputFlow: dispatchResult.domEventChain ?? [],
      hitTarget: null,
      domEventChain: stackFrames.map((f) => ({
        type: breakpointType,
        target: f.scriptUrl,
        phase: 'at-target' as const,
      })),
      engineDispatchChain: dispatchResult.engineChain ?? [],
      handlerFrames: stackFrames,
      handlersTriggered: stackFrames.map((f) => ({
        functionName: f.functionName,
        scriptUrl: f.scriptUrl,
        lineNumber: f.lineNumber,
      })),
      networkEmitted: [],
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await debuggerManager.resume();
    } catch {
      // Ignore resume failures during cleanup.
    }
    if (pendingDispatch) {
      try {
        await pendingDispatch;
      } catch (error) {
        if (!primaryError) {
          cleanupError = error;
        }
      }
    }
    await cleanupCanvasTraceTarget(pageController, cleanupToken);
    if (typeof eventMgr.removeEventListenerBreakpoint === 'function') {
      try {
        await eventMgr.removeEventListenerBreakpoint(breakpointId);
      } catch {
        // Ignore cleanup failures; the trace result is already computed.
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  if (!traceResult) {
    throw new Error('Canvas trace did not produce a result.');
  }

  return traceResult;
}

async function dispatchCanvasClick(
  pageController: PageController,
  x: number,
  y: number,
  canvasId?: string,
  breakpointType: string = 'click',
): Promise<PendingDispatch> {
  if (
    breakpointType === 'click' &&
    typeof (pageController as ClickCapablePageController).click === 'function'
  ) {
    return dispatchRealCanvasClick(pageController, x, y, canvasId, breakpointType);
  }

  return dispatchSyntheticCanvasClick(pageController, x, y, canvasId, breakpointType);
}

async function dispatchRealCanvasClick(
  pageController: PageController,
  x: number,
  y: number,
  canvasId?: string,
  breakpointType: string = 'click',
): Promise<PendingDispatch> {
  const dispatchSequence = getDispatchSequence(breakpointType);
  const cleanupToken = `jshook-trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const prepared = await pageController.evaluate<
    DispatchResult & {
      selector?: string;
      offset?: { x: number; y: number };
    }
  >(`
    (function() {
      var canvases = ${
        canvasId
          ? `[document.getElementById(${JSON.stringify(canvasId)})]`
          : 'Array.from(document.querySelectorAll("canvas"))'
      };
      var target = null;
      if (${!!canvasId}) {
        target = document.getElementById(${JSON.stringify(canvasId)});
      } else {
        for (var i = canvases.length - 1; i >= 0; i--) {
          var r = canvases[i].getBoundingClientRect();
          if (${x} >= r.left && ${x} <= r.right && ${y} >= r.top && ${y} <= r.bottom) {
            target = canvases[i];
            break;
          }
        }
      }
      if (!target) return { domEventChain: [], pickedNode: null, engine: undefined, engineChain: [] };

      target.setAttribute('data-jshook-trace-token', ${JSON.stringify(cleanupToken)});
      var rect = target.getBoundingClientRect();
      var offsetX = Math.max(0, Math.min(${x} - rect.left, Math.max(rect.width - 1, 0)));
      var offsetY = Math.max(0, Math.min(${y} - rect.top, Math.max(rect.height - 1, 0)));
      return {
        domEventChain: ${JSON.stringify(dispatchSequence)},
        pickedNode: target.id ? { id: String(target.id) } : null,
        engine: window.Laya ? 'LayaAir' : (window.PIXI ? 'PixiJS' : undefined),
        engineChain: [],
        cleanupToken: ${JSON.stringify(cleanupToken)},
        selector: 'canvas[data-jshook-trace-token="${cleanupToken}"]',
        offset: { x: offsetX, y: offsetY }
      };
    })()
  `);

  if (!prepared.selector || !prepared.offset) {
    return {
      result: prepared,
      completion: Promise.resolve(),
    };
  }

  return {
    result: prepared,
    completion:
      (pageController as ClickCapablePageController).click?.(prepared.selector, {
        button: 'left',
        clickCount: 1,
        offset: prepared.offset,
      }) ?? Promise.resolve(),
  };
}

async function dispatchSyntheticCanvasClick(
  pageController: PageController,
  x: number,
  y: number,
  canvasId?: string,
  breakpointType: string = 'click',
): Promise<PendingDispatch> {
  const dispatchSequence = getDispatchSequence(breakpointType);
  const script = `
    (function() {
      var canvases = ${
        canvasId
          ? `[document.getElementById(${JSON.stringify(canvasId)})]`
          : 'Array.from(document.querySelectorAll("canvas"))'
      };
      var target = null;
      if (${!!canvasId}) {
        target = document.getElementById(${JSON.stringify(canvasId)});
      } else {
        for (var i = canvases.length - 1; i >= 0; i--) {
          var r = canvases[i].getBoundingClientRect();
          if (${x} >= r.left && ${x} <= r.right && ${y} >= r.top && ${y} <= r.bottom) {
            target = canvases[i];
            break;
          }
        }
      }
      if (!target) return { domEventChain: [], pickedNode: null, engine: undefined, engineChain: [] };

      var rect = target.getBoundingClientRect();
      var cx = (${x} - rect.left) * (target.width / rect.width);
      var cy = (${y} - rect.top) * (target.height / rect.height);

      var events = [];
      ${JSON.stringify(dispatchSequence)}.forEach(function(type) {
        var EventCtor = type.indexOf('pointer') === 0 && typeof PointerEvent === 'function'
          ? PointerEvent
          : MouseEvent;
        var e = new EventCtor(type, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: ${x},
          clientY: ${y},
          button: 0,
          buttons: 1,
          pointerId: 1
        });
        target.dispatchEvent(e);
        events.push(type);
      });
      return {
        domEventChain: events,
        pickedNode: null,
        engine: window.Laya ? 'LayaAir' : (window.PIXI ? 'PixiJS' : undefined),
        engineChain: []
      };
    })()
  `;
  const result = await pageController.evaluate<DispatchResult>(script);
  return {
    result,
    completion: Promise.resolve(),
  };
}

async function cleanupCanvasTraceTarget(
  pageController: PageController,
  cleanupToken?: string,
): Promise<void> {
  if (!cleanupToken) {
    return;
  }

  try {
    await pageController.evaluate(`
      (function() {
        var target = document.querySelector('canvas[data-jshook-trace-token="${cleanupToken}"]');
        if (target) {
          target.removeAttribute('data-jshook-trace-token');
        }
        return true;
      })()
    `);
  } catch {
    // Ignore cleanup failures; they should not mask the trace result.
  }
}

function getDispatchSequence(breakpointType: string): string[] {
  if (breakpointType === 'mousedown') {
    return ['pointerdown', 'mousedown'];
  }
  if (breakpointType === 'pointerdown') {
    return ['pointerdown'];
  }
  return ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
}

function recordEvidence(
  evidenceStore: EvidenceStore,
  label: string,
  metadata: Record<string, unknown>,
): string {
  try {
    const node = evidenceStore.addNode('function' as never, label, metadata);
    return node.id;
  } catch {
    return 'evidence-unavailable';
  }
}
