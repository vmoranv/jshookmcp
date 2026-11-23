/**
 * Instrumentation contract for jshookmcp.
 *
 * A minimal span/metric interface that can be backed by OpenTelemetry,
 * Prometheus, or a no-op implementation. `NoopInstrumentation` is the default
 * (zero overhead); `InMemoryInstrumentation` is the in-process option; a real
 * exporter implements this same interface and replaces it wholesale.
 *
 * WHY THE INVARIANT BELOW MATTERS
 * -------------------------------
 * This contract was added on 2026-03-03 and sat with ZERO consumers for six
 * months, while its own header claimed it was "used by default". The names in
 * `SpanNames`/`MetricNames` are now emitted from real call sites, and
 * `scripts/audit/event-contracts.mjs` fails the build if a declared name loses
 * its producer — so the claim cannot quietly rot back into a lie.
 */

/* ---------- Types ---------- */

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface SpanLike {
  readonly name: string;
  readonly startTime: number;
  end(attrs?: Record<string, unknown>): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
}

/* ---------- Contract ---------- */

/**
 * Implementations MUST NOT throw and MUST NOT block.
 *
 * Instrumentation observes the system; it must never be able to break it. A
 * span that cannot be exported, a backend that is unreachable, a buffer that is
 * full — all of those are the implementation's problem to swallow, not the
 * caller's to handle. Call sites in this repo do not wrap these calls in
 * try/catch, precisely because that guarantee lives here.
 */
export interface InstrumentationContract {
  startSpan(name: string, attrs?: Record<string, unknown>): SpanLike;
  emitMetric(name: string, value: number, type: MetricType, attrs?: Record<string, unknown>): void;
  flush?(): Promise<void>;
  /**
   * One-way teardown: flush what is buffered and stop background timers.
   * Called from closeServer(); safe to skip for no-op/memory backends.
   */
  shutdown?(): Promise<void>;
}

/* ---------- Well-known names ---------- */

export const SpanNames = {
  toolExecute: 'tool.execute',
  /**
   * One span per pipeline STAGE that can fail before the handler runs
   * (session restore, ...). Attributes: toolName, stage, ok. Metadata only —
   * no arguments and no error text — so the stage can be named downstream even
   * for installs that never enabled the richer `tool.execute` trace.
   */
  toolExecuteStage: 'tool.execute.stage',
  toolValidateInput: 'tool.validate_input',
  registryDiscovery: 'registry.discovery',
  pluginLifecycle: 'plugin.lifecycle',
  workflowRun: 'workflow.run',
  workflowStep: 'workflow.step',
  bridgeRequest: 'bridge.request',
  /**
   * Named `captcha.detect`, NOT `captcha.solve`.
   *
   * Nothing in this repo solves a CAPTCHA: `CaptchaPolicy.determineCaptchaResolution`
   * returns a recommendation to solve it manually, and `AICaptchaDetector` waits
   * for a human to do so. The original name promised a capability the code does
   * not have — the same defect class as the rest of this file's history.
   */
  captchaDetect: 'captcha.detect',
  /**
   * One span per tool-search pipeline run (full path AND quick path).
   * Attributes carry the D-3 decision inputs: bm25_top_score,
   * vector_participated, quick_path, result_count, latency at end. Query
   * text is included only per the query-text policy (see
   * `redactQueryText`), because search strings in a reverse-engineering
   * context can embed target URLs and credentials.
   */
  searchQuery: 'search.query',
} as const;

export const MetricNames = {
  toolCallsTotal: 'tool_calls_total',
  toolErrorsTotal: 'tool_errors_total',
  toolDurationMs: 'tool_duration_ms',
  workflowRunsTotal: 'workflow_runs_total',
  workflowErrorsTotal: 'workflow_errors_total',
  workflowDurationMs: 'workflow_duration_ms',
  bridgeRequestsTotal: 'bridge_requests_total',
  bridgeDurationMs: 'bridge_duration_ms',
  pluginActiveTotal: 'plugin_active_total',
  searchQueriesTotal: 'search_queries_total',
  searchLatencyMs: 'search_latency_ms',
  /**
   * Tool-call feedback: +1 per search that was followed by a tool call.
   * Attributes: rank_bucket (top1/top3/top5/top10), tool. This is the
   * lakehouse gold — joins `search.query` spans with `tool.execute` spans.
   */
  searchFeedbackUsed: 'search_feedback_used',
} as const;

/* ---------- No-op implementation ---------- */

/**
 * The zero-overhead default.
 *
 * The signatures mirror `InstrumentationContract` EXACTLY, including parameters
 * the implementation ignores. TypeScript would accept narrower ones (a method
 * with fewer parameters is assignable), but then `new NoopInstrumentation()`
 * could not be called with the attributes the interface promises — and the
 * contract's whole point is that an implementation is swappable. A no-op whose
 * signature is a subset of the contract is a swap that silently stops compiling.
 */
export class NoopInstrumentation implements InstrumentationContract {
  startSpan(name: string, _attrs?: Record<string, unknown>): SpanLike {
    const startTime = Date.now();
    return {
      name,
      startTime,
      end() {
        /* no-op */
      },
      addEvent() {
        /* no-op */
      },
    };
  }

  emitMetric(
    _name: string,
    _value: number,
    _type: MetricType,
    _attrs?: Record<string, unknown>,
  ): void {
    /* no-op */
  }
}

/* ---------- Wiring ---------- */

/**
 * Key under which the active implementation is registered as a domain instance
 * on the server (`MCPServer.setDomainInstance`). Call sites read it back with
 * `resolveInstrumentation(ctx)`.
 */
export const INSTRUMENTATION_DOMAIN_KEY = 'instrumentation';

/**
 * Structural type for "something that may hold domain instances".
 *
 * Deliberately NOT `MCPServerContext`: that type imports this module, so naming
 * it here would close an import cycle. Structural typing also lets the workflow
 * engine and partial test contexts satisfy it without change.
 */
export interface InstrumentationHost {
  getDomainInstance?<T>(key: string): T | undefined;
}

/** Shared fallback. Allocating a Noop per call site would defeat the no-op. */
const NOOP_INSTRUMENTATION = new NoopInstrumentation();

let globalInstrumentation: InstrumentationContract = NOOP_INSTRUMENTATION;

/**
 * Install the process-wide instrumentation.
 *
 * Some genuine emission sites sit BELOW the server layer and have no context to
 * resolve from: `CaptchaDetector` is constructed inside the browser module
 * (`BrowserModeManager` calls `new CaptchaDetector()`), while `bridgeFetch` and
 * `discoverDomainManifests` are module-level functions that receive no context
 * at all. Threading a tracer down through those layers is how instrumentation
 * ends up abandoned half-wired — which is exactly what happened to this module
 * the first time.
 *
 * This is NOT a second source of truth: `MCPServer` installs the SAME instance
 * it registers under `INSTRUMENTATION_DOMAIN_KEY`, so the context path and the
 * global path reach one object. Two handles, one instrument.
 */
export function setGlobalInstrumentation(instrumentation: InstrumentationContract): void {
  globalInstrumentation = instrumentation;
}

/**
 * The process-wide instrumentation, for code with no server context.
 *
 * Server-layer code should prefer `resolveInstrumentation(ctx)`: that asks "what
 * does THIS server use", which is the question a test or a second server
 * instance needs answered correctly. This asks "what does this process use".
 */
export function getGlobalInstrumentation(): InstrumentationContract {
  return globalInstrumentation;
}

/** Restore the no-op. A test seam: a leaked global would poison other suites. */
export function resetGlobalInstrumentation(): void {
  globalInstrumentation = NOOP_INSTRUMENTATION;
}

/**
 * Read the active instrumentation off a context, falling back to a shared no-op.
 *
 * The `typeof` guard is not paranoia: tests and degraded startup paths pass
 * partial contexts (`ctx as never`) with no domain-instance map at all, and a
 * missing instrumentation must never be the reason a tool call fails. Same
 * shape as the `evidenceGraph` lookup in WorkflowEngine.
 */
export function resolveInstrumentation(
  host: InstrumentationHost | undefined,
): InstrumentationContract {
  if (host && typeof host.getDomainInstance === 'function') {
    const found = host.getDomainInstance<InstrumentationContract>(INSTRUMENTATION_DOMAIN_KEY);
    if (found) return found;
  }
  return NOOP_INSTRUMENTATION;
}
