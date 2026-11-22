/**
 * Per-session call-loop detection: consecutive repeat warning, doom-loop
 * circuit breaker, and isomorphic (cosmetic-argument-mutation) loop detection.
 *
 * State is keyed by the MCP session id from {@link getToolRequestContext}; the
 * instance itself is owned by one server context, so counters are isolated and
 * garbage-collected with it.
 */
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { META_TOOL_NAMES } from '@server/MCPServer.search.meta-names';
import { MCP_DOOM_LOOP_THRESHOLD } from '@src/constants/server';
import { normalizeSemanticArgs, type DoomLoopTrip, type IsomorphicTrip } from './ToolExecutionGate';

/** Max consecutive identical calls before injecting a warning. */
const MAX_CONSECUTIVE_REPEATS = 3;
const MAX_REPEAT_SCOPES = 256;

/** Meta-tools excluded from repeat detection — agents legitimately chain these. */
const REPEAT_GUARD_EXCLUDES = META_TOOL_NAMES;

export class CallLoopDetector {
  /** Repeat detection is isolated per MCP client session in shared-daemon mode. */
  private readonly repeatStates = new Map<
    string,
    { lastToolName: string | null; consecutiveCount: number }
  >();

  /**
   * Doom-loop detection (consecutive identical tool+args calls) uses the same
   * per-session keying and scope cap as repeat detection.
   */
  private readonly doomLoopStates = new Map<string, { lastKey: string | null; count: number }>();

  /** Isomorphic semantic call tracker (normalized args) per session. */
  private readonly isomorphicStates = new Map<string, { lastKey: string | null; count: number }>();

  private getRepeatState(): { lastToolName: string | null; consecutiveCount: number } {
    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.repeatStates.get(scope);
    if (!state) {
      if (this.repeatStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.repeatStates.keys().next().value as string | undefined;
        if (oldest) this.repeatStates.delete(oldest);
      }
      state = { lastToolName: null, consecutiveCount: 0 };
      this.repeatStates.set(scope, state);
    }
    return state;
  }

  /** Current consecutive count for the active session (0 before any call). */
  getRepeatCount(): number {
    return this.getRepeatState().consecutiveCount;
  }

  /**
   * Record a tool call for repeat detection.
   * Call this BEFORE enrichResponse for accurate tracking.
   * Returns the current consecutive count (1 = first call).
   */
  recordCall(toolName: string): number {
    if (REPEAT_GUARD_EXCLUDES.has(toolName)) {
      // Don't track meta-tools — they chain legitimately
      return 0;
    }

    const state = this.getRepeatState();
    if (toolName === state.lastToolName) {
      state.consecutiveCount++;
    } else {
      state.lastToolName = toolName;
      state.consecutiveCount = 1;
    }
    return state.consecutiveCount;
  }

  /** Check if the current call is a suspected repeat loop. */
  isRepeatLoop(): boolean {
    return this.getRepeatState().consecutiveCount >= MAX_CONSECUTIVE_REPEATS;
  }

  /**
   * Record one tool call in the doom-loop tracker and report whether it
   * tripped the circuit breaker. Consecutive identical calls (same tool name +
   * stable args key) within one MCP session accumulate; a call with different
   * arguments or a different tool resets the counter. A non-positive
   * threshold disables the breaker entirely. Unlike the repeat guard, meta
   * tools are NOT excluded here: call_tool-routed invocations carry the inner
   * tool name and are exactly the degenerate-loop shape this tracks.
   */
  recordDoomLoopCall(
    toolName: string,
    argsJson: string,
    threshold: number = MCP_DOOM_LOOP_THRESHOLD,
  ): DoomLoopTrip | null {
    if (threshold <= 0) return null;

    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.doomLoopStates.get(scope);
    if (!state) {
      if (this.doomLoopStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.doomLoopStates.keys().next().value as string | undefined;
        if (oldest) this.doomLoopStates.delete(oldest);
      }
      state = { lastKey: null, count: 0 };
      this.doomLoopStates.set(scope, state);
    }

    const key = `${toolName}\u0000${argsJson}`;
    if (state.lastKey === key) {
      state.count += 1;
    } else {
      state.lastKey = key;
      state.count = 1;
    }
    if (state.count < threshold) return null;
    return { count: state.count, threshold, fullAdvisory: state.count % threshold === 0 };
  }

  /**
   * Record tool call with normalized semantic arguments (isomorphic loop
   * detection). Catches agents that mutate cosmetic/ephemeral parameters.
   */
  recordIsomorphicCall(
    toolName: string,
    args: Record<string, unknown>,
    threshold = 4,
  ): IsomorphicTrip | null {
    if (threshold <= 0) return null;
    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.isomorphicStates.get(scope);
    if (!state) {
      if (this.isomorphicStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.isomorphicStates.keys().next().value as string | undefined;
        if (oldest) this.isomorphicStates.delete(oldest);
      }
      state = { lastKey: null, count: 0 };
      this.isomorphicStates.set(scope, state);
    }

    const semanticSig = normalizeSemanticArgs(args);
    const key = `${toolName}\u0000${semanticSig}`;
    if (state.lastKey === key) {
      state.count += 1;
    } else {
      state.lastKey = key;
      state.count = 1;
    }

    if (state.count < threshold) return null;
    return { count: state.count, threshold, semanticSignature: key };
  }

  /** Test hook: clear all doom-loop counters across sessions. */
  resetDoomLoopStatesForTesting(): void {
    this.doomLoopStates.clear();
  }

  /** Test hook: clear all isomorphic counters across sessions. */
  resetIsomorphicStatesForTesting(): void {
    this.isomorphicStates.clear();
  }
}
