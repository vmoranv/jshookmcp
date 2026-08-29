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
 */

import { logger } from '@utils/logger';
import { asErrorResponse } from '@server/domains/shared/response';
import { getToolDomain } from '@server/ToolCatalog';
import { fastValidateToolArgs } from '@server/registry/compiled-validators';
import { refreshDomainTtlForTool } from '@server/MCPServer.activation.ttl';
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
 * Executes a tool with full tracking: circuit breaker, session coordination,
 * offloading, context enrichment, token budget, domain TTL, event emission.
 *
 * This is the main execution pipeline for all tool calls.
 */
export async function executeToolWithTracking(ctx: MCPServerContext, name: string, args: ToolArgs) {
  let timeoutTimer: NodeJS.Timeout | undefined;
  const timeoutMs = TOOL_EXEC_HANG_WATCHDOG_MS;
  const collectExecutionMetrics = shouldCollectExecutionMetrics();
  const executionStartedAt = collectExecutionMetrics ? new Date().toISOString() : null;
  // Always record the wall-clock start — durationMs feeds the per-tool latency
  // histogram via the 'tool:called' event (r1-2). Two performance.now() calls per
  // tool call is negligible, unlike the E2E-gated CPU/memory snapshots below.
  const executionStartTime = performance.now();
  const executionCpuStart = collectExecutionMetrics ? process.cpuUsage() : null;
  const executionMemoryBefore = collectExecutionMetrics ? captureExecutionMetricMemory() : null;
  try {
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
    const fastArgError = fastValidateToolArgs(name, args);
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
            return ctx.contextGuard.enrichResponse(name, response);
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
      durationMs: Number((performance.now() - executionStartTime).toFixed(2)),
      args,
      result: {
        success: toolResultSuccess,
        isError: enriched.isError === true,
      },
    });
    const searchQualityTracker =
      ctx.getDomainInstance<import('@server/search/SearchQualityTracker').SearchQualityTracker>(
        'searchQualityTracker',
      );
    searchQualityTracker?.associateLastSearch(name);
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
