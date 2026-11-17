/**
 * Instrumentation wiring for executeToolWithTracking().
 *
 * The claim under test is NOT "the code calls emitMetric" — it is that the
 * declared names reach a real call site with the right shape. This contract sat
 * with zero consumers for six months while its own header claimed it was "used
 * by default"; these assertions are what make the wiring checkable rather than
 * asserted in a comment.
 *
 * The metrics are asserted to be PAIRED with the events emitted from the same
 * point ("one observation, two sinks"): if the two ever disagree about whether a
 * call succeeded, that is a bug in one of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  getToolDomain: vi.fn(() => 'browser'),
  refreshDomainTtlForTool: vi.fn(),
  getToolRequestContext: vi.fn(() => null),
  shouldCollectExecutionMetrics: vi.fn(() => false),
  BrowserSessionQueueError: class extends Error {
    code = 'QUEUE_FULL';
    retryAfterMs = 100;
    queueDepth = 3;
    queueLimit = 5;
  },
  BrowserFleetLeaseError: class extends Error {},
  SessionScopedResourcePoolCapacityError: class extends Error {},
}));

vi.mock('@utils/logger', () => ({ logger: mocks.logger }));
vi.mock('@server/ToolCatalog', () => ({ getToolDomain: mocks.getToolDomain }));
vi.mock('@server/MCPServer.activation.ttl', () => ({
  refreshDomainTtlForTool: mocks.refreshDomainTtlForTool,
}));
vi.mock('@server/runtime/ToolRequestContext', () => ({
  getToolRequestContext: mocks.getToolRequestContext,
}));
vi.mock('@server/MCPServer.metrics', () => ({
  shouldCollectExecutionMetrics: mocks.shouldCollectExecutionMetrics,
}));
vi.mock('@server/runtime/BrowserSessionCoordinator', () => ({
  BrowserSessionQueueError: mocks.BrowserSessionQueueError,
  parseBrowserSessionSnapshot: vi.fn(() => ({})),
}));
vi.mock('@server/runtime/BrowserFleetRouter', () => ({
  BrowserFleetLeaseError: mocks.BrowserFleetLeaseError,
}));
vi.mock('@server/runtime/SessionScopedResourcePool', () => ({
  SessionScopedResourcePoolCapacityError: mocks.SessionScopedResourcePoolCapacityError,
}));
vi.mock('@server/runtime/ServerRuntimeState', () => ({
  getRuntimeState: () => undefined,
}));

import { executeToolWithTracking } from '@server/MCPServer.execution';
import { R } from '@server/domains/shared/ResponseBuilder';
import { installLaunchSignals, resetLaunchSignals } from '@server/observability/launchSignals';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import {
  INSTRUMENTATION_DOMAIN_KEY,
  MetricNames,
  SpanNames,
} from '@server/observability/InstrumentationContract';
import { RecordingInstrumentation } from '@tests/shared/recording-instrumentation';
import type { MCPServerContext } from '@server/MCPServer.context';

// Mirrors the private EXECUTION_EVENT_ERROR_SUMMARY_MAX_CHARS — the span
// attribute and the event summary share one cap by design.
const EXECUTION_EVENT_ERROR_SUMMARY_MAX_CHARS = 200;

function createCtx(
  routerExecute: () => Promise<unknown>,
  instrumentation: RecordingInstrumentation,
): MCPServerContext {
  return {
    circuitBreaker: {
      shouldBlock: vi.fn(() => false),
      getState: () => null,
      getRecoveryMs: () => 30_000,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
    },
    contextGuard: {
      isContextSensitive: () => false,
      recordCall: vi.fn(),
      recordDoomLoopCall: vi.fn(() => null),
      enrichResponse: (_name: string, response: unknown) => response,
    },
    router: { execute: routerExecute },
    largeDataOffloader: { offload: vi.fn() },
    getDomainInstance: <T>(key: string): T | undefined =>
      key === INSTRUMENTATION_DOMAIN_KEY ? (instrumentation as unknown as T) : undefined,
    tokenBudget: { recordToolCall: vi.fn() },
    activatedToolNames: new Set<string>(),
    domainTtlEntries: new Map(),
    extensionToolsByName: new Map(),
    eventBus: { emit: vi.fn(), on: vi.fn() },
    mcpLog: { info: vi.fn() },
    server: { sendToolListChanged: vi.fn(async () => undefined) },
    enabledDomains: new Set(['browser']),
    selectedTools: [],
    activatedRegisteredTools: new Map(),
    routerImpl: undefined,
  } as unknown as MCPServerContext;
}

describe('executeToolWithTracking — instrumentation wiring', () => {
  let instrumentation: RecordingInstrumentation;

  beforeEach(() => {
    vi.clearAllMocks();
    // Stage spans are emitted only for per-process entrypoints, and vitest's
    // node_modules shim already detects as `bin` — pin it so a runner change
    // cannot silently drop the stage assertions.
    resetLaunchSignals();
    installLaunchSignals({ entrypoint: 'bin' });
    instrumentation = new RecordingInstrumentation();
  });

  it('records the failing stage instead of a bare handler verdict', async () => {
    // Session restore is its own stage: a factory that refuses a restored
    // cookie/tab set must not look like the handler crashed.
    const broker = {
      restoreSessionContext: vi.fn(async () => {
        // A real factory failure carries a platform code in the cause chain;
        // that is the structural signal the classifier reads.
        throw new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }),
      noteToolResult: vi.fn(),
      runExclusive: (_s: string, fn: () => Promise<unknown>) => fn(),
    };
    const ctx = createCtx(async () => R.ok().json(), instrumentation);
    (ctx as unknown as { getDomainInstance: (k: string) => unknown }).getDomainInstance = ((
      key: string,
    ) =>
      key === 'browserSessionCoordinator'
        ? broker
        : key === INSTRUMENTATION_DOMAIN_KEY
          ? instrumentation
          : undefined) as never;

    await expect(executeToolWithTracking(ctx, 'page_navigate', {})).rejects.toThrow('fetch failed');
    // The stage helper gates on the entrypoint; re-pin it here because the test
    // itself may follow another describe's `library` fixture.
    installLaunchSignals({ entrypoint: 'bin' });

    const stages = instrumentation.spansNamed(SpanNames.toolExecuteStage);
    expect(stages).toHaveLength(1);
    expect(stages[0]!.attrs).toMatchObject({ toolName: 'page_navigate', stage: 'session_restore' });
    expect(stages[0]!.endAttrs).toEqual({ ok: false });

    // One failure, ONE metric sample — classified by the stage, not `handler`.
    const calls = instrumentation.metricsNamed(MetricNames.toolCallsTotal);
    expect(calls).toHaveLength(1);
    const callAttrs = calls[0]!.attrs ?? {};
    expect(callAttrs).toMatchObject({ tool: 'page_navigate', success: false });
    expect(callAttrs['outcome']).toBe('network');
    const durationAttrs = instrumentation.metricsNamed(MetricNames.toolDurationMs)[0]?.attrs;
    expect(durationAttrs).toEqual(calls[0]!.attrs);
  });

  it('emits the tool spans and metrics on a successful call', async () => {
    const ctx = createCtx(async () => R.ok().json(), instrumentation);

    const response = await executeToolWithTracking(ctx, 'page_navigate', {});
    expect(response).not.toMatchObject({ isError: true });

    // Validation span: started AND ended — a leaked span is invisible to an
    // assertion that only checks it was started.
    const validation = instrumentation.spansNamed(SpanNames.toolValidateInput);
    expect(validation).toHaveLength(1);
    expect(validation[0]!.attrs).toMatchObject({ toolName: 'page_navigate', domain: 'browser' });
    expect(validation[0]!.ended).toBe(true);
    expect(validation[0]!.endAttrs).toEqual({ valid: true });

    const execute = instrumentation.spansNamed(SpanNames.toolExecute);
    expect(execute).toHaveLength(1);
    expect(execute[0]!.ended).toBe(true);
    expect(execute[0]!.endAttrs).toEqual({ ok: true });
    expect(execute[0]!.events).toEqual([]);

    expect(instrumentation.metricsNamed(MetricNames.toolCallsTotal)).toEqual([
      {
        name: MetricNames.toolCallsTotal,
        value: 1,
        type: 'counter',
        attrs: { tool: 'page_navigate', success: true, entrypoint: 'bin' },
      },
    ]);
    expect(instrumentation.metricsNamed(MetricNames.toolErrorsTotal)).toHaveLength(0);
    const duration = instrumentation.metricsNamed(MetricNames.toolDurationMs);
    expect(duration).toHaveLength(1);
    expect(duration[0]!.type).toBe('histogram');
    expect(duration[0]!.value).toBeGreaterThanOrEqual(0);
  });

  it('counts a throwing handler as one call AND one error', async () => {
    const ctx = createCtx(async () => {
      throw new Error('handler exploded');
    }, instrumentation);

    await expect(executeToolWithTracking(ctx, 'page_navigate', {})).rejects.toThrow(
      'handler exploded',
    );

    // Exactly one sample: the catch path must not double-count alongside the
    // success path, or the error rate reads as a fraction of the truth.
    expect(instrumentation.metricsNamed(MetricNames.toolCallsTotal)).toHaveLength(1);
    expect(instrumentation.metricsNamed(MetricNames.toolCallsTotal)[0]!.attrs).toEqual({
      tool: 'page_navigate',
      success: false,
      outcome: 'handler',
      // Attribution signal, present on EVERY call so the counter/duration pair
      // stays byte-identical (the worker folds by hashing the whole attrs).
      entrypoint: 'bin',
    });
    expect(instrumentation.metricsNamed(MetricNames.toolErrorsTotal)).toHaveLength(1);
    expect(instrumentation.metricsNamed(MetricNames.toolDurationMs)[0]!.attrs).toEqual({
      tool: 'page_navigate',
      success: false,
      // Must equal the counter's attrs: the worker folds the pair by hashing
      // the whole attrs object, so a mismatch costs a second row per failure.
      outcome: 'handler',
      entrypoint: 'bin',
    });

    // The failed execution is recorded as a span EVENT, and the span still ends
    // exactly once — that is what keeps the duration honest. The REASON rides
    // the end attributes as structured fields (the OTLP worker persists only
    // span.attributes, so event-only details never reach the database).
    const execute = instrumentation.spansNamed(SpanNames.toolExecute);
    expect(execute).toHaveLength(1);
    expect(execute[0]!.ended).toBe(true);
    // Structured, not raw: the message used to land verbatim in the telemetry
    // database. `error_class` names the stage; the fingerprint groups repeats.
    expect(execute[0]!.endAttrs).toMatchObject({ ok: false, error_class: 'handler' });
    expect(execute[0]!.endAttrs).toHaveProperty('error_fingerprint');
    expect(execute[0]!.endAttrs).not.toHaveProperty('error');
    expect(execute[0]!.events).toEqual(['error']);
  });

  it('records the failure reason of a SOFT-fail response (R.fail, no throw) on the span', async () => {
    const ctx = createCtx(
      async () => R.fail('Executable not found at D:/chrome/chrome.exe').json(),
      instrumentation,
    );

    const response = await executeToolWithTracking(ctx, 'browser_launch', {});
    expect(response).toMatchObject({ success: false });

    // Soft-fail = one call + one error in metrics, same as a throw. The span
    // says WHY via error_class + fingerprint — never the message itself, which
    // would carry the caller's executable path into the telemetry database.
    expect(instrumentation.metricsNamed(MetricNames.toolCallsTotal)[0]!.attrs).toEqual({
      tool: 'browser_launch',
      success: false,
      outcome: 'unknown',
      entrypoint: 'bin',
    });
    const execute = instrumentation.spansNamed(SpanNames.toolExecute);
    expect(execute).toHaveLength(1);
    expect(execute[0]!.endAttrs).toMatchObject({ ok: false });
    expect(execute[0]!.endAttrs).toMatchObject({ ok: false, error_class: 'unknown' });
    expect(execute[0]!.endAttrs).not.toHaveProperty('error');
    expect(typeof (execute[0]!.endAttrs as Record<string, unknown>)['error_fingerprint']).toBe(
      'string',
    );
    expect(execute[0]!.events).toEqual([]);
  });

  it('classifies a soft-fail PrerequisiteError by the code R.fail now carries', async () => {
    // The response envelope has no Error instance. Before the code was carried
    // on the payload, this path could only ever produce `handler` — which is
    // why `browser_launch`'s missing-executable failure was mislabelled and a
    // prerequisite problem looked like a broken handler.
    const ctx = createCtx(
      async () => R.fail(new PrerequisiteError('No browser executable found')).json(),
      instrumentation,
    );

    await executeToolWithTracking(ctx, 'browser_launch', {});

    expect(instrumentation.metricsNamed(MetricNames.toolCallsTotal)[0]!.attrs).toEqual({
      tool: 'browser_launch',
      success: false,
      outcome: 'prereq_missing',
      entrypoint: 'bin',
    });
    expect(instrumentation.metricsNamed(MetricNames.toolDurationMs)[0]!.attrs).toEqual({
      tool: 'browser_launch',
      success: false,
      outcome: 'prereq_missing',
      entrypoint: 'bin',
    });
  });

  it('omits every error attribute on success and fingerprints (not truncates) failures', async () => {
    const longMessage = 'x'.repeat(EXECUTION_EVENT_ERROR_SUMMARY_MAX_CHARS + 50);
    const okCtx = createCtx(async () => R.ok().merge({ anything: 1 }).json(), instrumentation);
    await executeToolWithTracking(okCtx, 'page_navigate', {});
    const okExecute = instrumentation.spansNamed(SpanNames.toolExecute);
    expect(okExecute[0]!.endAttrs).toEqual({ ok: true });
    expect(okExecute[0]!.endAttrs).not.toHaveProperty('error');
    expect(okExecute[0]!.endAttrs).not.toHaveProperty('error_class');
    expect(okExecute[0]!.endAttrs).not.toHaveProperty('error_fingerprint');

    const failCtx = createCtx(async () => R.fail(longMessage).json(), instrumentation);
    await executeToolWithTracking(failCtx, 'page_navigate', {});
    const failExecute = instrumentation.spansNamed(SpanNames.toolExecute);
    expect(failExecute).toHaveLength(2);
    const endAttrs = failExecute[1]!.endAttrs as Record<string, unknown>;
    // The raw text is gone: a 250-char message and a 250,000-char one describe
    // the same failure, and neither may carry the caller's data downstream.
    expect(endAttrs['ok']).toBe(false);
    expect(endAttrs).not.toHaveProperty('error');
    // A soft-fail `R.fail('prose')` carries no structural cause -> `unknown`,
    // which is what the metric's `outcome` says above.
    expect(endAttrs['error_class']).toBe('unknown');
    expect(endAttrs['error_fingerprint']).toMatch(/^[0-9a-f]{8}$/);
  });

  it('emits nothing when the execution gate denies the call', async () => {
    const ctx = createCtx(vi.fn(), instrumentation);
    (ctx as unknown as { config: Record<string, unknown> }).config = {
      toolExecution: { allowTools: [], rules: [{ tool: 'page/*', action: 'deny' }] },
    };

    const response = await executeToolWithTracking(ctx, 'page_navigate', {});
    expect(response).toMatchObject({ isError: true });

    // A denied call never reaches validation or the handler, so a span here
    // would be measuring a request that was refused — noise, not signal.
    expect(instrumentation.spans).toHaveLength(0);
    expect(instrumentation.metrics).toHaveLength(0);
  });

  it('runs against the no-op when no instrumentation is registered', async () => {
    const ctx = createCtx(async () => R.ok().json(), instrumentation);
    // A context whose domain-instance map holds no instrumentation — the shape
    // tests and degraded startup paths produce. `getDomainInstance` must stay
    // CALLABLE: the execution path also reads `serverRuntimeState`,
    // `searchQualityTracker` and `evidenceGraph` through it, so removing the
    // method outright would fail for an unrelated reason and prove nothing about
    // the instrumentation fallback.
    (ctx as unknown as { getDomainInstance: () => undefined }).getDomainInstance = () => undefined;

    const response = await executeToolWithTracking(ctx, 'page_navigate', {});
    expect(response).not.toMatchObject({ isError: true });
    expect(instrumentation.spans).toHaveLength(0);
  });
});
