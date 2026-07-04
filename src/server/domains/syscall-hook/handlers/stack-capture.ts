/**
 * Syscall JS Stack Capture Handler — syscall_stack_capture
 *
 * Captures JS call stacks that correspond to recent syscall events by
 * integrating with the debugger/v8-inspector domain. Goes beyond the
 * static timing-heuristic SyscallToJSMapper by querying real CDP stacks.
 *
 * Falls back cleanly to the heuristics mapper if no debugger is attached.
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { DebuggerManager, CallFrame } from '@modules/debugger/DebuggerManager';
import type { SyscallEvent } from '@modules/syscall-hook';
import { SyscallToJSMapper } from '@modules/syscall-hook';
import { argNumber, argBool } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StackFrame {
  functionName: string;
  scriptUrl?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface StackCorrelation {
  syscall: SyscallEvent;
  stack?: StackFrame[];
  mapped?: {
    jsFunction: string;
    confidence: number;
    reasoning: string;
  };
}

interface StackCaptureResult {
  success: boolean;
  error?: string;
  events: StackCorrelation[];
  eventCount: number;
  withStacks: number;
  withHeuristicsOnly: number;
  mode: 'debugger' | 'heuristic' | 'mixed';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Pull the paused CDP call frames from the runtime debugger, if one is
 * attached and currently paused. Returns `undefined` when no debugger is
 * attached or the target isn't paused — in those cases the caller falls
 * back to the heuristic mapper.
 *
 * Uses the real `DebuggerManager.getPausedState()` contract (synchronous,
 * returns `PausedState | null`) rather than reflective property probing,
 * so a contract change surfaces at compile time. There is no async CDP
 * round-trip here — `getPausedState` reads the cached paused state already
 * captured by the DebuggerManager's event handler — so no try/catch is
 * needed.
 */
function tryGetJsStack(ctx: MCPServerContext): StackFrame[] | undefined {
  const dm = ctx.debuggerManager as DebuggerManager | undefined;
  if (!dm) return undefined;

  const state = dm.getPausedState();
  const callFrames = state?.callFrames;
  if (!callFrames || callFrames.length === 0) {
    return undefined;
  }

  return callFrames.map((frame: CallFrame) => ({
    functionName: frame.functionName || '<anonymous>',
    scriptUrl: frame.url || undefined,
    lineNumber: frame.location?.lineNumber,
    columnNumber: frame.location?.columnNumber,
  }));
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleSyscallStackCapture(
  args: Record<string, unknown>,
  capturedEvents: SyscallEvent[],
  ctx?: MCPServerContext,
): Promise<StackCaptureResult> {
  const maxEvents = argNumber(args, 'maxEvents', 20);
  const useDebugger = argBool(args, 'useDebugger', true);

  const events = capturedEvents.slice(-maxEvents);
  const mapper = new SyscallToJSMapper();

  let mode: 'debugger' | 'heuristic' | 'mixed' = 'heuristic';
  let withStacks = 0;
  let withHeuristicsOnly = 0;

  const correlations: StackCorrelation[] = [];

  for (const event of events) {
    const correlation: StackCorrelation = { syscall: event };
    let hasStack = false;

    // Try real CDP stack capture first
    if (useDebugger && ctx) {
      const stack = tryGetJsStack(ctx);
      if (stack) {
        correlation.stack = stack;
        hasStack = true;
        withStacks++;
      }
    }

    // Always run heuristics as fallback / complement
    const mapped = mapper.map(event);
    if (mapped) {
      correlation.mapped = {
        jsFunction: mapped.jsFunction ?? 'unknown',
        confidence: mapped.confidence,
        reasoning: mapped.reasoning,
      };
      if (!hasStack) {
        withHeuristicsOnly++;
      }
    } else if (!hasStack) {
      // Neither stack nor heuristic — still include the event for completeness
    }

    correlations.push(correlation);
  }

  if (withStacks > 0 && withHeuristicsOnly > 0) {
    mode = 'mixed';
  } else if (withStacks > 0) {
    mode = 'debugger';
  } else {
    mode = 'heuristic';
  }

  return {
    success: true,
    events: correlations,
    eventCount: correlations.length,
    withStacks,
    withHeuristicsOnly,
    mode,
  };
}
