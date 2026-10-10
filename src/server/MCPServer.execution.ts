/**
 * MCPServer.execution — Tool execution orchestration with tracking
 *
 * Extracted from MCPServer.ts to isolate the execution pipeline:
 * - Circuit breaker checks
 * - Browser session coordination
 * - Large data offloading
 * - Context enrichment
 * - Token budget tracking
 * - Domain TTL refresh
 * - Event bus notifications
 * - Execution metrics collection (E2E performance testing)
 * - Instrumentation spans/metrics (see src/server/observability/)
 */

import { logger } from '@utils/logger';
import { asErrorResponse } from '@server/domains/shared/response';
import { getToolDomain } from '@server/ToolCatalog';
import { classifyErrorKind } from '@server/observability/ToolCallTraceRecorder';
import { fastValidateToolArgs } from '@server/registry/compiled-validators';
import { refreshDomainTtlForTool } from '@server/MCPServer.activation.ttl';
import { recordToolUse } from '@server/MCPServer.search.helpers';
import { emitBusEvent } from '@server/EventBus';
import {
  MetricNames,
  resolveInstrumentation,
  SpanNames,
} from '@server/observability/InstrumentationContract';
import { renderToolArgsAttrs } from '@server/observability/toolArgsPolicy';
import {
  buildDoomLoopErrorResponse,
  buildToolGateDenyResponse,
  compileToolRules,
  evaluateToolRules,
  stableSerializeArgs,
} from '@server/ToolCallContextGuard';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolArgs } from '@server/types';
import {
  ARGS_PREVIEW_MAX_CHARS,
  COST_HINT_DEFAULT,
  COST_HINT_FEEDBACK,
  COST_HINT_MULTIPLIER,
  COST_HINT_SEARCH,
  COST_HINT_SECURITY,
  COST_HINT_WORKFLOW,
  DEFAULT_RETRY_AFTER_SEC,
  MCP_DOOM_LOOP_THRESHOLD,
  TOOL_EXEC_HANG_WATCHDOG_MS,
} from '@src/constants';
import {
  BrowserSessionQueueError,
  parseBrowserSessionSnapshot,
  type BrowserSessionCoordinator,
} from '@server/runtime/BrowserSessionCoordinator';
import {
  BrowserFleetLeaseError,
  type BrowserFleetRoute,
  type BrowserFleetRouter,
} from '@server/runtime/BrowserFleetRouter';
import type { ServerRuntimeState } from '@server/runtime/ServerRuntimeState';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { SessionScopedResourcePoolCapacityError } from '@server/runtime/SessionScopedResourcePool';
import {
  shouldCollectExecutionMetrics,
  captureExecutionMetricMemory,
  buildExecutionMetrics,
  appendExecutionMetrics,
} from '@server/MCPServer.metrics';

const DIRECT_COST_KEYS = ['durationMs', 'waitMs', 'captureDurationMs', 'sampleDurationMs'] as const;
const TIMEOUT_COST_KEYS = ['timeoutMs', 'timeout'] as const;
const MIN_BROWSER_COST_HINT_MS = 1;
const MAX_BROWSER_COST_HINT_MS = 30_000;

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Max characters of an error message carried on execution events (metadata only). */
const EXECUTION_EVENT_ERROR_SUMMARY_MAX_CHARS = 200;

/**
 * Resolve the MCP session id attached to a tool call for event metadata:
 * explicit `_meta.sessionId` wins over the per-request AsyncLocalStorage scope.
 */
function resolveCallSessionId(args: ToolArgs): string | null {
  const explicit = (args['_meta'] as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim();
  return getToolRequestContext()?.sessionId ?? null;
}

/** Truncate an error message for `tool.execution.finished.errorSummary` (no payloads). */
function truncateErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > EXECUTION_EVENT_ERROR_SUMMARY_MAX_CHARS
    ? `${message.slice(0, EXECUTION_EVENT_ERROR_SUMMARY_MAX_CHARS)}…`
    : message;
}

export function estimateBrowserSessionToolCostMs(toolName: string, args: ToolArgs): number {
  for (const key of DIRECT_COST_KEYS) {
    const value = finitePositiveNumber(args[key]);
    if (value !== null) {
      return Math.min(MAX_BROWSER_COST_HINT_MS, Math.max(MIN_BROWSER_COST_HINT_MS, value));
    }
  }

  for (const key of TIMEOUT_COST_KEYS) {
    const value = finitePositiveNumber(args[key]);
    if (value !== null) {
      // A timeout is an upper bound rather than an expected duration. The EWMA
      // replaces this conservative cold-start estimate after the first sample.
      return Math.min(
        MAX_BROWSER_COST_HINT_MS,
        Math.max(MIN_BROWSER_COST_HINT_MS, value * COST_HINT_MULTIPLIER),
      );
    }
  }

  if (/captcha_(wait|solve)|widget_solve/.test(toolName)) return MAX_BROWSER_COST_HINT_MS;
  if (/page_(navigate|wait_for_selector)|debugger_.*wait|wait_for_debugger/.test(toolName)) {
    return COST_HINT_SEARCH;
  }
  if (/human_mouse_move/.test(toolName)) return COST_HINT_FEEDBACK;
  if (/human_scroll/.test(toolName)) return COST_HINT_SECURITY;
  return /(^|_)(get|list|status|inspect|detect|stats|capabilities)(_|$)/.test(toolName)
    ? COST_HINT_DEFAULT
    : COST_HINT_WORKFLOW;
}

/**
 * Tool-execution permission gate: ordered rules from ctx.config.toolExecution
 * (legacy allowTools whitelist compiled as leading allow rules, last matching
 * rule wins) followed by the doom-loop circuit breaker. Runs BEFORE any
 * execution machinery so a denied or looped call never touches the circuit
 * breaker, browser session coordination, or the token budget.
 *
 * Returns the immediate error response, or null when the call may proceed.
 */
function checkToolExecutionGate(
  ctx: MCPServerContext,
  name: string,
  args: ToolArgs,
): { content: Array<{ type: 'text'; text: string }>; isError: true } | null {
  const argsJson = stableSerializeArgs(args);
  const toolExecution = ctx.config?.toolExecution;
  const compiledRules = compileToolRules(
    toolExecution?.allowTools ?? [],
    toolExecution?.rules ?? [],
  );
  const decision = evaluateToolRules(compiledRules, name, argsJson);
  if (!decision.allowed && decision.matchedRule) {
    // Metadata-only deny telemetry (rule is static config, never runtime args).
    emitBusEvent(ctx.eventBus, 'tool.gate.denied', {
      toolName: name,
      source: decision.matchedRule.source ?? 'rules',
      rule: {
        tool: decision.matchedRule.tool,
        ...(decision.matchedRule.pattern !== undefined
          ? { pattern: decision.matchedRule.pattern }
          : {}),
        action: decision.matchedRule.action,
      },
      sessionId: resolveCallSessionId(args),
      timestamp: new Date().toISOString(),
    });
    return buildToolGateDenyResponse(name, decision.matchedRule, compiledRules);
  }
  const trip = ctx.contextGuard.recordDoomLoopCall(name, argsJson, MCP_DOOM_LOOP_THRESHOLD);
  if (trip) {
    emitBusEvent(ctx.eventBus, 'tool.gate.denied', {
      toolName: name,
      source: 'doom-loop',
      rule: null,
      consecutiveCount: trip.count,
      threshold: trip.threshold,
      sessionId: resolveCallSessionId(args),
      timestamp: new Date().toISOString(),
    });
    return buildDoomLoopErrorResponse(name, argsJson, trip);
  }
  return null;
}

/**
 * Executes a tool with full tracking: circuit breaker, session coordination,
 * offloading, context enrichment, token budget, domain TTL, event emission.
 *
 * This is the main execution pipeline for all tool calls.
 */
export async function executeToolWithTracking(ctx: MCPServerContext, name: string, args: ToolArgs) {
  // LRU input (kimi-cu report P2-4): budget eviction orders candidates by
  // this timestamp, so freshly used tools survive activation pressure.
  recordToolUse(ctx, name);
  let timeoutTimer: NodeJS.Timeout | undefined;
  const timeoutMs = TOOL_EXEC_HANG_WATCHDOG_MS;
  const collectExecutionMetrics = shouldCollectExecutionMetrics();
  const executionStartedAt = collectExecutionMetrics ? new Date().toISOString() : null;
  // Always record the wall-clock start — durationMs feeds the per-tool latency
  // histogram via the 'tool:called' event (r1-2). Two performance.now() calls per
  // tool call is negligible, unlike the E2E-gated CPU/memory snapshots below.
  const executionStartTime = performance.now();
  // Resolved once per call rather than once per emission: this is a hot path,
  // and resolution is a Map read behind a `typeof` guard.
  const instrumentation = resolveInstrumentation(ctx);
  const executionCpuStart = collectExecutionMetrics ? process.cpuUsage() : null;
  const executionMemoryBefore = collectExecutionMetrics ? captureExecutionMetricMemory() : null;
  try {
    const gateResponse = checkToolExecutionGate(ctx, name, args);
    if (gateResponse) return gateResponse;

    if (ctx.circuitBreaker.shouldBlock(name)) {
      const state = ctx.circuitBreaker.getState(name);
      const retryAfter = state
        ? Math.ceil(
            (ctx.circuitBreaker.getRecoveryMs() - (Date.now() - state.lastFailureTime)) / 1000,
          )
        : DEFAULT_RETRY_AFTER_SEC;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Circuit breaker open for tool "${name}"`,
              reason: `Tool has failed consecutively ${state?.failureCount ?? 0} times`,
              retryAfterSeconds: retryAfter,
            }),
          },
        ],
        isError: true,
      };
    }

    // Level-2 fast validation (JIT compiled validator pool): rejects
    // unambiguously invalid arguments without a Zod pass. Conservative by
    // design — unknown/complex tools validate as OK and fall through to the
    // SDK's strict Zod validation on MCP-envelope calls.
    const validationSpan = instrumentation.startSpan(SpanNames.toolValidateInput, {
      toolName: name,
      domain: getToolDomain(name) ?? null,
    });
    const fastArgError = fastValidateToolArgs(name, args);
    // Ended before the early return below, so a rejected tool still gets a
    // timed span rather than an unterminated one.
    //
    // `!fastArgError`, mirroring the `if (fastArgError)` early return exactly:
    // the validator's contract is `string | null`, where NULL means valid. An
    // earlier `=== undefined` here compiled cleanly and reported `valid: false`
    // for every successful validation — a span attribute that always lied.
    validationSpan.end({ valid: !fastArgError });
    if (fastArgError) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Invalid arguments for tool "${name}": ${fastArgError}`,
            }),
          },
        ],
        isError: true,
      };
    }

    // Admitted for execution: broadcast started BEFORE any execution machinery
    // runs (paired with exactly one finished on both the success and error paths).
    emitBusEvent(ctx.eventBus, 'tool.execution.started', {
      toolName: name,
      domain: getToolDomain(name) ?? null,
      sessionId: resolveCallSessionId(args),
      timestamp: new Date().toISOString(),
    });

    let enriched;
    try {
      const toolDomain = getToolDomain(name);
      const browserCoordinator =
        toolDomain === 'browser' || ctx.contextGuard.isContextSensitive(name)
          ? ctx.getDomainInstance<BrowserSessionCoordinator>('browserSessionCoordinator')
          : null;
      const explicitSessionId = (args['_meta'] as { sessionId?: unknown } | undefined)?.sessionId;
      const sessionId =
        typeof explicitSessionId === 'string' && explicitSessionId.trim().length > 0
          ? explicitSessionId.trim()
          : (getToolRequestContext()?.sessionId ?? null);
      const fleetRouter = browserCoordinator
        ? ctx.getDomainInstance<BrowserFleetRouter>('browserFleetRouter')
        : null;
      let fleetRoute: BrowserFleetRoute | null = null;
      if (browserCoordinator && fleetRouter) {
        fleetRoute = await fleetRouter.admitLocalSession(sessionId?.trim() || 'default');
      }
      const executeInContext = async () => {
        timeoutTimer = setTimeout(() => {
          try {
            const safeArgs = JSON.stringify(args).slice(0, ARGS_PREVIEW_MAX_CHARS);
            logger.warn(
              `Telemetry Alert [ERR-03]: Tool execution hung (${Math.round(timeoutMs / 1000)}s) for '${name}'. ` +
                `Args preview: ${safeArgs}...`,
            );
          } catch {
            logger.warn(
              `Telemetry Alert [ERR-03]: Tool execution hung (${Math.round(timeoutMs / 1000)}s) for '${name}'.`,
            );
          }
        }, timeoutMs);
        timeoutTimer.unref();
        try {
          const executeTool = async () => {
            // Covers the real handler call only — not the whole request. The
            // gate, validation and admission above are measured by their own
            // span, and `tool:called`'s durationMs already covers the full
            // interval, so this span is the one that isolates handler cost.
            const executeSpan = instrumentation.startSpan(SpanNames.toolExecute, {
              toolName: name,
              domain: toolDomain,
            });
            // `handlerReturned` means "did not throw". A tool that returns
            // `isError: true` is a successful execution with a failed result —
            // that distinction belongs to the metrics, not to this span.
            let handlerReturned = false;
            try {
              if (browserCoordinator) {
                await browserCoordinator.restoreSessionContext(sessionId);
              }
              const response = await ctx.router.execute(name, args);

              // Keep browser-derived state reads inside the session AsyncLocalStorage scope.
              await ctx.largeDataOffloader.offload(name, response);
              if (toolDomain === 'browser') {
                browserCoordinator?.noteToolResult(
                  sessionId,
                  name,
                  parseBrowserSessionSnapshot(response),
                );
              }
              ctx.contextGuard.recordCall(name);
              const enrichedResponse = ctx.contextGuard.enrichResponse(name, response);
              handlerReturned = true;
              return enrichedResponse;
            } catch (error) {
              // Recorded as a span event rather than a second end(): keeping a
              // single end path in `finally` is what keeps the duration honest.
              executeSpan.addEvent('error', {
                message: error instanceof Error ? error.message : String(error),
              });
              throw error;
            } finally {
              executeSpan.end({
                ok: handlerReturned,
                // Argument capture per the global tool-args policy: default
                // records ONLY key names (shape) — values need an explicit
                // JSHOOK_OTLP_TOOL_ARGS opt-in and are credential-scrubbed.
                ...renderToolArgsAttrs(args),
              });
            }
          };
          if (fleetRouter && fleetRoute) {
            const execution = await fleetRouter.runWithLeaseKeepAlive(fleetRoute, executeTool);
            fleetRoute = execution.route;
            return execution.value;
          }
          return await executeTool();
        } finally {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
      };
      enriched = browserCoordinator
        ? await browserCoordinator.runExclusive(sessionId, executeInContext, {
            toolName: name,
            costHintMs: estimateBrowserSessionToolCostMs(name, args),
            signal: getToolRequestContext()?.signal,
          })
        : await executeInContext();
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
    ctx.getDomainInstance<ServerRuntimeState>('serverRuntimeState')?.recordToolCall(name, args);
    if (
      collectExecutionMetrics &&
      executionStartedAt &&
      executionCpuStart &&
      executionMemoryBefore
    ) {
      enriched = appendExecutionMetrics(
        enriched,
        buildExecutionMetrics(
          executionStartedAt,
          executionStartTime,
          timeoutMs,
          executionCpuStart,
          executionMemoryBefore,
        ),
      );
    }
    try {
      ctx.tokenBudget.recordToolCall(name, args, enriched);
    } catch (trackingError) {
      logger.warn('Token tracking failed, continuing without tracking this call:', trackingError);
    }
    // Refresh domain TTL when an activated tool is used
    if (ctx.activatedToolNames.has(name)) {
      refreshDomainTtlForTool(ctx, name);
    }
    let toolResultSuccess = !enriched.isError;
    const successFlag = enriched?.success;
    if (typeof successFlag === 'boolean') {
      // ResponseBuilder carries the payload's `success` boolean on the envelope,
      // so we can read it without a full JSON.parse of the text content.
      toolResultSuccess = successFlag;
    } else if (enriched?.structuredContent && typeof enriched.structuredContent === 'object') {
      const resultPayload = enriched.structuredContent as Record<string, unknown>;
      toolResultSuccess = resultPayload.success !== false;
    } else if (enriched?.content?.[0]?.type === 'text' && 'text' in enriched.content[0]) {
      // Fallback for raw (non-ResponseBuilder) handlers that still encode
      // `success` inside the text payload.
      try {
        const parsed = JSON.parse(enriched.content[0].text) as Record<string, unknown>;
        toolResultSuccess = parsed.success !== false;
      } catch {
        toolResultSuccess = !enriched.isError;
      }
    }
    // Circuit breaker: record success or failure
    if (toolResultSuccess) {
      ctx.circuitBreaker.recordSuccess(name);
    } else {
      ctx.circuitBreaker.recordFailure(name);
    }
    // Duration is computed ONCE and shared by the event and the metric below.
    // Two clocks for the same interval is exactly how an event stream and a
    // metrics backend drift apart, after which neither is trustworthy.
    const toolDurationMs = Number((performance.now() - executionStartTime).toFixed(2));
    // Emit tool:called event for ActivationController
    void ctx.eventBus.emit('tool:called', {
      toolName: name,
      domain: getToolDomain(name) ?? null,
      sessionId:
        typeof (args['_meta'] as { sessionId?: unknown } | undefined)?.sessionId === 'string'
          ? (args['_meta'] as { sessionId: string }).sessionId.trim() || null
          : (getToolRequestContext()?.sessionId ?? null),
      timestamp: new Date().toISOString(),
      success: toolResultSuccess,
      durationMs: toolDurationMs,
      errorKind: classifyErrorKind({
        isError: enriched.isError === true,
        successFlag: toolResultSuccess,
      }),
      args,
      result: {
        success: toolResultSuccess,
        isError: enriched.isError === true,
      },
    });
    // Metadata-only execution telemetry for the unified event stream (GET /events).
    emitBusEvent(ctx.eventBus, 'tool.execution.finished', {
      toolName: name,
      domain: getToolDomain(name) ?? null,
      sessionId: resolveCallSessionId(args),
      durationMs: toolDurationMs,
      ok: toolResultSuccess,
      timestamp: new Date().toISOString(),
    });
    // One observation, two sinks: the event stream stays in-process, these go to
    // whichever instrumentation backend is configured. Emitted from the same
    // point so the two can never disagree about what happened.
    instrumentation.emitMetric(MetricNames.toolCallsTotal, 1, 'counter', {
      tool: name,
      success: toolResultSuccess,
    });
    if (!toolResultSuccess) {
      instrumentation.emitMetric(MetricNames.toolErrorsTotal, 1, 'counter', { tool: name });
    }
    instrumentation.emitMetric(MetricNames.toolDurationMs, toolDurationMs, 'histogram', {
      tool: name,
      success: toolResultSuccess,
    });
    const searchQualityTracker =
      ctx.getDomainInstance<import('@server/search/SearchQualityTracker').SearchQualityTracker>(
        'searchQualityTracker',
      );
    searchQualityTracker?.associateLastSearch(name);
    // Learning signal for the search engine (adaptive vector weight +
    // recency boost) fires on the direct-call path too, not just the
    // call_tool proxy — this is the common path for agents invoking an
    // already-active tool. Registered by getSearchEngine; absent until the
    // first search builds the engine (no signal to learn from before that).
    try {
      const searchEngine =
        ctx.getDomainInstance<import('@server/search/ToolSearchEngine').ToolSearchEngine>(
          'searchEngine',
        );
      searchEngine?.recordToolCallFeedback(name, '');
    } catch {
      /* non-critical — feedback must never fail a tool call */
    }
    ctx.mcpLog.info('jshookmcp', {
      event: 'tool_called',
      toolName: name,
      domain: getToolDomain(name) ?? null,
      success: toolResultSuccess,
    });
    // Commit pending resource updates to prevent stream flooding
    ctx
      .getDomainInstance<import('@server/evidence/ReverseEvidenceGraph').ReverseEvidenceGraph>(
        'evidenceGraph',
      )
      ?.commit();
    return enriched;
  } catch (error) {
    // Pair the earlier started event even on the failure path. Message-only
    // summary — never the args or response payloads.
    const failureDurationMs = Number((performance.now() - executionStartTime).toFixed(2));
    emitBusEvent(ctx.eventBus, 'tool.execution.finished', {
      toolName: name,
      domain: getToolDomain(name) ?? null,
      sessionId: resolveCallSessionId(args),
      durationMs: failureDurationMs,
      ok: false,
      errorSummary: truncateErrorSummary(error),
      timestamp: new Date().toISOString(),
    });
    // The throwing path exits separately from the success path, so it accounts
    // for its own sample. Without this every throw would be invisible to the
    // counters and the error rate would read as zero.
    instrumentation.emitMetric(MetricNames.toolCallsTotal, 1, 'counter', {
      tool: name,
      success: false,
    });
    instrumentation.emitMetric(MetricNames.toolErrorsTotal, 1, 'counter', { tool: name });
    instrumentation.emitMetric(MetricNames.toolDurationMs, failureDurationMs, 'histogram', {
      tool: name,
      success: false,
    });
    // Failures that throw never reach the success-path `tool:called` emit, so
    // without this the trace would record only calls that returned — a trace
    // of the easy calls. Timeouts, validation rejections and gate blocks all
    // surface here as thrown errors.
    void ctx.eventBus.emit('tool:called', {
      toolName: name,
      domain: getToolDomain(name) ?? null,
      sessionId: resolveCallSessionId(args),
      timestamp: new Date().toISOString(),
      success: false,
      durationMs: failureDurationMs,
      errorKind: classifyErrorKind({
        thrown: true,
        timedOut: error instanceof Error && /hung|timeout/i.test(error.message),
      }),
    });
    const admissionError =
      error instanceof BrowserSessionQueueError ||
      error instanceof BrowserFleetLeaseError ||
      error instanceof SessionScopedResourcePoolCapacityError;
    if (!admissionError) {
      ctx.circuitBreaker.recordFailure(name);
    }
    const errorResponse =
      error instanceof BrowserSessionQueueError
        ? {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: error.message,
                  code: error.code,
                  retryAfterMs: error.retryAfterMs,
                  queueDepth: error.queueDepth,
                  queueLimit: error.queueLimit,
                }),
              },
            ],
            isError: true,
          }
        : error instanceof BrowserFleetLeaseError
          ? {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: false,
                    error: error.message,
                    code: error.code,
                    retryAfterMs: error.retryAfterMs,
                    targetWorkerId: error.targetWorkerId,
                    targetEndpoint: error.targetEndpoint,
                    fencingToken: error.fencingToken,
                  }),
                },
              ],
              isError: true,
            }
          : error instanceof SessionScopedResourcePoolCapacityError
            ? {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      success: false,
                      error: error.message,
                      code: error.code,
                      retryAfterMs: error.retryAfterMs,
                      resourceCount: error.size,
                      resourceLimit: error.limit,
                    }),
                  },
                ],
                isError: true,
              }
            : asErrorResponse(error);
    try {
      ctx.tokenBudget.recordToolCall(name, args, errorResponse);
    } catch (trackingError) {
      logger.warn('Token tracking failed on error path:', trackingError);
    }
    ctx
      .getDomainInstance<import('@server/evidence/ReverseEvidenceGraph').ReverseEvidenceGraph>(
        'evidenceGraph',
      )
      ?.commit();
    if (admissionError) return errorResponse;
    // Log the original error (including its stack) before re-throwing — the
    // error response above only carries the message, and the throw would
    // otherwise be the last trace of the failure.
    logger.error(`Tool execution failed for '${name}':`, error);
    throw error;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
}
