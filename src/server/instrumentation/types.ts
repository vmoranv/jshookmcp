/**
 * InstrumentationSession type definitions.
 *
 * Defines the unified abstraction for all instrumentation operations:
 * before-load inject, runtime function hook, XHR/Fetch intercept, function trace.
 */

/** The four categories of instrumentation that a session can manage. */
export enum InstrumentationType {
  BEFORE_LOAD_INJECT = 'before-load-inject',
  RUNTIME_HOOK = 'runtime-hook',
  NETWORK_INTERCEPT = 'network-intercept',
  FUNCTION_TRACE = 'function-trace',
}

/** A single instrumentation operation registered within a session. */
export interface InstrumentationOperation {
  /** Unique operation identifier. */
  readonly id: string;
  /** Parent session identifier. */
  readonly sessionId: string;
  /** Instrumentation category. */
  readonly type: InstrumentationType;
  /** Target: function name, URL pattern, or script content. */
  readonly target: string;
  /** Type-specific configuration forwarded to the underlying handler. */
  readonly config: Record<string, unknown>;
  /** Unix epoch ms when the operation was registered. */
  readonly createdAt: number;
  /** Current lifecycle status. */
  status: 'active' | 'paused' | 'completed' | 'failed';
}

/** A captured data point produced by an instrumentation operation. */
export interface InstrumentationArtifact {
  /** Operation that produced this artifact. */
  readonly operationId: string;
  /** Parent session identifier. */
  readonly sessionId: string;
  /** Instrumentation type that produced this data. */
  readonly type: InstrumentationType;
  /** Unix epoch ms when captured. */
  readonly timestamp: number;
  /** Type-specific captured data. */
  readonly data: InstrumentationArtifactData;
}

/** Union of all possible artifact data shapes, keyed by instrumentation type. */
export interface InstrumentationArtifactData {
  // ── Hook artifacts ──
  args?: unknown[];
  returnValue?: unknown;
  callStack?: string;
  presetIds?: string[];
  failedPresets?: Array<{ preset: string; error: string }>;

  // ── Intercept artifacts ──
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  requestId?: string;
  statusCode?: number;
  statusText?: string;
  bodyTruncated?: boolean;
  replayMode?: 'dry-run' | 'live';

  // ── Trace artifacts ──
  functionName?: string;
  executionTimeMs?: number;

  // ── Inject artifacts ──
  scriptContent?: string;
  injectionPoint?: 'before-load' | 'runtime';
}

/** Summary information for a session. */
export interface SessionInfo {
  /** Unique session identifier. */
  readonly id: string;
  /** Optional human-readable label. */
  readonly name?: string;
  /** Unix epoch ms when created. */
  readonly createdAt: number;
  /** Number of registered operations. */
  operationCount: number;
  /** Number of captured artifacts. */
  artifactCount: number;
  /** Lifecycle status. */
  status: 'active' | 'destroyed';
}

/** Fully expanded session view for resources and exports. */
export interface InstrumentationSessionSnapshot {
  session: SessionInfo;
  stats: {
    operationCount: number;
    artifactCount: number;
  };
  operations: InstrumentationOperation[];
  artifacts: InstrumentationArtifact[];
}
