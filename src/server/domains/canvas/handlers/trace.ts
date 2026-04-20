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
}

interface EventBreakpointManagerLike {
  setEventListenerBreakpoint(eventName: string, targetName?: string): Promise<string>;
  removeEventListenerBreakpoint?(breakpointId: string): Promise<boolean>;
}

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

  try {
    // Step 2: Dispatch click at coordinates
    const dispatchResult = await dispatchCanvasClick(
      pageController,
      x,
      y,
      canvasId,
      breakpointType,
    );

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

    return {
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
  } finally {
    try {
      await debuggerManager.resume();
    } catch {
      // Ignore resume failures during cleanup.
    }
    if (typeof eventMgr.removeEventListenerBreakpoint === 'function') {
      try {
        await eventMgr.removeEventListenerBreakpoint(breakpointId);
      } catch {
        // Ignore cleanup failures; the trace result is already computed.
      }
    }
  }
}

async function dispatchCanvasClick(
  pageController: PageController,
  x: number,
  y: number,
  canvasId?: string,
  breakpointType: string = 'click',
): Promise<DispatchResult> {
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
  return pageController.evaluate(script);
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
