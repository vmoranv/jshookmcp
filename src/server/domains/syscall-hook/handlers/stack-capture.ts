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

async function tryGetJsStack(ctx: MCPServerContext): Promise<StackFrame[] | undefined> {
  try {
    const dm = ctx.debuggerManager;
    if (!dm) return undefined;

    // Use the paused state's callFrames if debugger is paused
    let callFrames: unknown = undefined;
    const dmUnknown = dm as unknown as Record<string, unknown>;
    if (typeof dmUnknown.getPausedState === 'function') {
      const state = await (dmUnknown.getPausedState as () => Promise<{ callFrames?: unknown }>)();
      callFrames = state?.callFrames;
    }

    if (!Array.isArray(callFrames) || callFrames.length === 0) {
      return undefined;
    }

    return (callFrames as Array<Record<string, unknown>>).map((frame) => ({
      functionName:
        typeof frame['functionName'] === 'string' ? frame['functionName'] : '<anonymous>',
      scriptUrl: typeof frame['url'] === 'string' ? frame['url'] : undefined,
      lineNumber: typeof frame['lineNumber'] === 'number' ? frame['lineNumber'] : undefined,
      columnNumber: typeof frame['columnNumber'] === 'number' ? frame['columnNumber'] : undefined,
    }));
  } catch {
    return undefined;
  }
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
      const stack = await tryGetJsStack(ctx);
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
