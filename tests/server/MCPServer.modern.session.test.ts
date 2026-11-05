/**
 * MCP 2.0 concurrency hardening — regression tests for the two preconditions
 * from the MCP2 boundary audit:
 *
 *  (G) Stateful browser tools on the modern `/mcp/v2` leg must require an
 *      explicit session identity. Silently collapsing a missing identity to
 *      the shared `'default'` scope would leak browser-fleet leases and pools
 *      across concurrent stateless clients. Legacy `/mcp` + stdio keep the
 *      historical default.
 *
 * These tests run `executeToolWithTracking` inside a REAL AsyncLocalStorage
 * scope (runWithToolRequestContext), exercising the same signal that
 * registerSingleTool / registerSearchMetaTools establish for modern requests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  getToolDomain: vi.fn(() => 'browser'),
}));

vi.mock('@utils/logger', () => ({ logger: mocks.logger }));
vi.mock('@server/ToolCatalog', () => ({ getToolDomain: mocks.getToolDomain }));
vi.mock('@server/MCPServer.activation.ttl', () => ({
  refreshDomainTtlForTool: vi.fn(),
}));
vi.mock('@server/MCPServer.metrics', () => ({
  shouldCollectExecutionMetrics: () => false,
  captureExecutionMetricMemory: () => ({}),
  buildExecutionMetrics: () => ({}),
  appendExecutionMetrics: (_r: unknown) => _r,
}));
vi.mock('@server/runtime/BrowserSessionCoordinator', () => ({
  BrowserSessionQueueError: class extends Error {},
  parseBrowserSessionSnapshot: () => ({}),
}));
vi.mock('@server/runtime/BrowserFleetRouter', () => ({
  BrowserFleetLeaseError: class extends Error {},
}));
vi.mock('@server/runtime/SessionScopedResourcePool', () => ({
  SessionScopedResourcePoolCapacityError: class extends Error {},
}));
vi.mock('@server/runtime/ServerRuntimeState', () => ({
  getRuntimeState: () => undefined,
}));
// Keep the REAL ToolRequestContext so the ALS isModern signal is exercised.
// Only stub the two helper modules whose real imports pull heavy native deps.
vi.mock('@server/registry/compiled-validators', () => ({
  fastValidateToolArgs: () => null,
}));
vi.mock('@server/ToolCallContextGuard', () => ({
  buildDoomLoopErrorResponse: vi.fn(),
  buildToolGateDenyResponse: vi.fn(),
  compileToolRules: () => [],
  evaluateToolRules: () => ({ allowed: true }),
  stableSerializeArgs: () => '',
}));
vi.mock('@server/observability/InstrumentationContract', () => ({
  MetricNames: {},
  SpanNames: {},
  resolveInstrumentation: () => ({
    startSpan: () => ({ end: vi.fn() }),
    emitMetric: vi.fn(),
  }),
}));
vi.mock('@server/MCPServer.search.helpers', () => ({ recordToolUse: vi.fn() }));
vi.mock('@server/EventBus', () => ({
  emitBusEvent: vi.fn(),
}));

import { executeToolWithTracking } from '@server/MCPServer.execution';
import {
  runWithToolRequestContext,
  type ToolRequestExtra,
} from '@server/runtime/ToolRequestContext';
import type { MCPServerContext } from '@server/MCPServer.context';

interface Harness {
  ctx: MCPServerContext;
  admitLocalSession: ReturnType<typeof vi.fn>;
  restoreSessionContext: ReturnType<typeof vi.fn>;
  routerExecute: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const admitLocalSession = vi.fn(async () => ({ local: true }));
  const restoreSessionContext = vi.fn(async () => undefined);
  const routerExecute = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: '{"success":true}' }],
  }));
  const coordinator = {
    restoreSessionContext,
    noteToolResult: vi.fn(),
    runExclusive: vi.fn(async (_sessionId: string | null, cb: () => Promise<unknown>) => cb()),
  };
  const fleetRouter = {
    admitLocalSession,
    runWithLeaseKeepAlive: vi.fn(async (route: unknown, cb: () => Promise<unknown>) => ({
      route,
      value: await cb(),
    })),
  };
  const instances: Record<string, unknown> = {
    browserSessionCoordinator: coordinator,
    browserFleetRouter: fleetRouter,
  };
  const ctx = {
    circuitBreaker: {
      shouldBlock: () => false,
      getState: () => null,
      getRecoveryMs: () => 30_000,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
    },
    contextGuard: {
      isContextSensitive: () => false,
      recordCall: vi.fn(),
      recordDoomLoopCall: () => null,
      enrichResponse: (_n: string, r: unknown) => r,
    },
    router: { execute: routerExecute },
    largeDataOffloader: { offload: vi.fn() },
    getDomainInstance: (key: string) => instances[key],
    tokenBudget: { recordToolCall: vi.fn() },
    activatedToolNames: new Set<string>(),
    domainTtlEntries: new Map(),
    extensionToolsByName: new Map(),
    eventBus: { emit: vi.fn(async () => undefined) },
    mcpLog: { info: vi.fn() },
    server: { sendToolListChanged: vi.fn(async () => undefined) },
    enabledDomains: new Set(['browser']),
    selectedTools: [],
    activatedRegisteredTools: new Map(),
    config: {},
  } as unknown as MCPServerContext;
  return { ctx, admitLocalSession, restoreSessionContext, routerExecute };
}

/** Run a tool call inside the ALS scope that modern tool registration establishes. */
function callInScope(
  h: Harness,
  extra: ToolRequestExtra | undefined,
  isModern: boolean,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return runWithToolRequestContext(
    extra,
    () => executeToolWithTracking(h.ctx, 'browser_status', args),
    { isModern },
  );
}

describe('/mcp/v2 stateful browser tools require explicit session identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a modern stateless call instead of admitting the shared default session', async () => {
    const h = createHarness();

    const response = (await callInScope(h, undefined, true)) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
    expect(payload.error).toMatch(/Explicit session identity required/);
    expect(payload.hint).toMatch(/mcp-session-id/);
    // The whole point: never fall through to the shared 'default' lease.
    expect(h.admitLocalSession).not.toHaveBeenCalled();
    expect(h.routerExecute).not.toHaveBeenCalled();
  });

  it('admits a modern call that supplies an explicit session id', async () => {
    const h = createHarness();

    const response = (await callInScope(h, { sessionId: 'agent-42' }, true)) as {
      isError?: boolean;
    };

    expect(response.isError).toBeUndefined();
    expect(h.admitLocalSession).toHaveBeenCalledWith('agent-42');
    expect(h.routerExecute).toHaveBeenCalledTimes(1);
  });

  it('preserves the legacy default fallback (isModern=false)', async () => {
    const h = createHarness();

    const response = (await callInScope(h, undefined, false)) as { isError?: boolean };

    expect(response.isError).toBeUndefined();
    expect(h.admitLocalSession).toHaveBeenCalledWith('default');
    expect(h.routerExecute).toHaveBeenCalledTimes(1);
  });
});
