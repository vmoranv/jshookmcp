/**
 * Tool-execution permission gate tests.
 *
 * Covers the ordered rule engine (findLast semantics), the legacy
 * toolExecution.allowTools whitelist compilation, pattern matching against
 * stable args JSON, the deny error response shape, and the doom-loop circuit
 * breaker (threshold, reset, per-session scoping, env override).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  buildDoomLoopErrorResponse,
  buildToolGateDenyResponse,
  compileToolRules,
  describeRule,
  evaluateToolRules,
  ruleMatchesTool,
  runToolExecutionGate,
  stableSerializeArgs,
  ToolCallContextGuard,
  type ToolExecutionGateHost,
  type ToolPermissionRule,
} from '@server/ToolCallContextGuard';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { TOOL_GATE_MAX_LISTED_RULES } from '@src/constants/server';

interface GateErrorResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

function parseGateError(response: GateErrorResponse): Record<string, unknown> {
  expect(response.isError).toBe(true);
  return JSON.parse(response.content[0]!.text) as Record<string, unknown>;
}

/**
 * Duck-typed event bus that records emitted events for telemetry assertions.
 * emitBusEvent tolerates partial buses by design (emit-presence duck typing);
 * the cast only bridges the narrow test double to the full EventBus type.
 */
function recordingBus() {
  const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const bus = {
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload: payload as Record<string, unknown> });
      return Promise.resolve();
    },
  };
  return { emitted, bus: bus as unknown as EventBus<ServerEventMap> };
}

describe('stableSerializeArgs', () => {
  it('excludes the _meta envelope so client progress tokens do not defeat loop keys', () => {
    const withMeta = stableSerializeArgs({ a: 1, _meta: { progressToken: 42, sessionId: 's' } });
    const withoutMeta = stableSerializeArgs({ a: 1 });
    expect(withMeta).toBe('{"a":1}');
    expect(withMeta).toBe(withoutMeta);
  });

  it('falls back to a stable marker for unserializable args', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(stableSerializeArgs(cyclic)).toBe('<unserializable>');
  });
});

describe('compileToolRules', () => {
  it('returns an empty list when neither allowTools nor rules are configured', () => {
    expect(compileToolRules([], [])).toEqual([]);
  });

  it('compiles a non-empty allowTools whitelist with an implicit base deny-all', () => {
    const compiled = compileToolRules(['page_navigate', 'search_in_scripts'], []);
    expect(compiled).toEqual([
      { tool: '*', action: 'deny', source: 'allowTools' },
      { tool: 'page_navigate', action: 'allow', source: 'allowTools' },
      { tool: 'search_in_scripts', action: 'allow', source: 'allowTools' },
    ]);
  });

  it('places allowTools expansion before user rules', () => {
    const userRules: ToolPermissionRule[] = [
      { tool: 'page/*', action: 'deny' },
      { tool: 'console_execute', action: 'allow' },
    ];
    const compiled = compileToolRules(['page_navigate'], userRules);
    expect(compiled.map((rule) => rule.source)).toEqual([
      'allowTools',
      'allowTools',
      'rules',
      'rules',
    ]);
  });
});

describe('ruleMatchesTool', () => {
  it('matches exact tool names only', () => {
    expect(ruleMatchesTool('page_navigate', 'page_navigate')).toBe(true);
    expect(ruleMatchesTool('page_navigate', 'page_navigate_async')).toBe(false);
  });

  it('supports domain/* wildcards against the domain_ prefix', () => {
    expect(ruleMatchesTool('page/*', 'page_navigate')).toBe(true);
    expect(ruleMatchesTool('page/*', 'page_evaluate')).toBe(true);
    expect(ruleMatchesTool('page/*', 'console_execute')).toBe(false);
    expect(ruleMatchesTool('page/*', 'page')).toBe(false);
  });

  it('supports the * match-all selector', () => {
    expect(ruleMatchesTool('*', 'page_navigate')).toBe(true);
    expect(ruleMatchesTool('*', 'anything')).toBe(true);
  });
});

describe('evaluateToolRules (findLast semantics)', () => {
  it('allows everything when no rules match', () => {
    const decision = evaluateToolRules([], 'page_navigate', '{}');
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRule).toBeNull();
  });

  it('denies on a matching deny rule and reports it', () => {
    const rules: ToolPermissionRule[] = [{ tool: 'process_kill', action: 'deny' }];
    const decision = evaluateToolRules(rules, 'process_kill', '{}');
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toEqual({ tool: 'process_kill', action: 'deny' });
  });

  it('lets a later rule override an earlier one (deny then allow)', () => {
    const rules: ToolPermissionRule[] = [
      { tool: 'page/*', action: 'deny' },
      { tool: 'page_navigate', action: 'allow' },
    ];
    expect(evaluateToolRules(rules, 'page_navigate', '{}').allowed).toBe(true);
    expect(evaluateToolRules(rules, 'page_evaluate', '{}').allowed).toBe(false);
  });

  it('lets a later deny override an earlier allow', () => {
    const rules: ToolPermissionRule[] = [
      { tool: 'page/*', action: 'allow' },
      { tool: 'page_evaluate', action: 'deny' },
    ];
    expect(evaluateToolRules(rules, 'page_evaluate', '{}').allowed).toBe(false);
    expect(evaluateToolRules(rules, 'page_navigate', '{}').allowed).toBe(true);
  });

  it('applies pattern matching against the stable args JSON', () => {
    const rules: ToolPermissionRule[] = [
      { tool: 'page_evaluate', pattern: '*dangerous*', action: 'deny' },
    ];
    expect(evaluateToolRules(rules, 'page_evaluate', '{"expr":"dangerous()"}').allowed).toBe(false);
    expect(evaluateToolRules(rules, 'page_evaluate', '{"expr":"safe()"}').allowed).toBe(true);
  });

  it('only considers rules whose tool selector matches when a pattern is present', () => {
    const rules: ToolPermissionRule[] = [{ tool: 'console_execute', pattern: '*', action: 'deny' }];
    expect(evaluateToolRules(rules, 'page_evaluate', '{"expr":"anything"}').allowed).toBe(true);
  });

  it('implements allowTools whitelist semantics (unlisted tools denied)', () => {
    const rules = compileToolRules(['page_navigate'], []);
    expect(evaluateToolRules(rules, 'page_navigate', '{}').allowed).toBe(true);
    const denied = evaluateToolRules(rules, 'console_execute', '{}');
    expect(denied.allowed).toBe(false);
    expect(denied.matchedRule?.source).toBe('allowTools');
  });

  it('lets user rules override both the whitelist base and its allow entries', () => {
    const punchThrough = compileToolRules(
      ['page_navigate'],
      [{ tool: 'console_execute', action: 'allow' }],
    );
    expect(evaluateToolRules(punchThrough, 'console_execute', '{}').allowed).toBe(true);

    const lockDown = compileToolRules(
      ['page_navigate'],
      [{ tool: 'page_navigate', pattern: '*evil*', action: 'deny' }],
    );
    expect(evaluateToolRules(lockDown, 'page_navigate', '{"q":"evil"}').allowed).toBe(false);
    expect(evaluateToolRules(lockDown, 'page_navigate', '{"q":"fine"}').allowed).toBe(true);
  });
});

describe('buildToolGateDenyResponse', () => {
  it('names the matched rule (tool + pattern + action) and lists active rules', () => {
    const compiled = compileToolRules(
      [],
      [{ tool: 'page_evaluate', pattern: '*dangerous*', action: 'deny' }],
    );
    const response = buildToolGateDenyResponse('page_evaluate', compiled[0]!, compiled);
    const payload = parseGateError(response);

    expect(payload.error).toContain('tool=page_evaluate');
    expect(payload.error).toContain('pattern="*dangerous*"');
    expect(payload.error).toContain('action=deny');
    expect(payload.deniedBy).toEqual({
      tool: 'page_evaluate',
      pattern: '*dangerous*',
      action: 'deny',
    });
    expect(payload.hint).toContain('toolExecution.rules');
  });

  it('describes an allowTools whitelist miss explicitly', () => {
    const compiled = compileToolRules(['page_navigate'], []);
    const denyRule = compiled.find((rule) => rule.action === 'deny')!;
    const payload = parseGateError(
      buildToolGateDenyResponse('console_execute', denyRule, compiled),
    );
    expect(payload.error).toContain('allowTools whitelist');
    expect(payload.error).toContain('console_execute');
  });

  it('truncates the rule list to 10 entries with a remaining-count note', () => {
    const many: ToolPermissionRule[] = Array.from({ length: 15 }, (_, index) => ({
      tool: `tool_${index}`,
      action: 'allow' as const,
    }));
    const denyRule: ToolPermissionRule = { tool: '*', action: 'deny' };
    const payload = parseGateError(buildToolGateDenyResponse('tool_0', denyRule, many));

    const activeRules = payload.activeRules as string[];
    expect(activeRules).toHaveLength(TOOL_GATE_MAX_LISTED_RULES + 1);
    expect(activeRules[TOOL_GATE_MAX_LISTED_RULES]).toBe('...and 5 more rules');
  });

  it('serializes to an isError response with a success:false payload', () => {
    const compiled = compileToolRules([], [{ tool: 'page_evaluate', action: 'deny' }]);
    const response = buildToolGateDenyResponse('page_evaluate', compiled[0]!, compiled);
    expect(response.isError).toBe(true);
    expect(parseGateError(response).success).toBe(false);
  });
});

describe('buildDoomLoopErrorResponse', () => {
  it('reports the looped tool, consecutive count, and threshold', () => {
    const response = buildDoomLoopErrorResponse('page_navigate', '{"url":"https://x"}', {
      count: 5,
      threshold: 5,
      fullAdvisory: true,
    });
    const payload = parseGateError(response);

    expect(payload.success).toBe(false);
    expect(payload.error).toContain('page_navigate');
    expect(payload.error).toContain('5');
    expect(payload.doomLoop).toEqual({
      toolName: 'page_navigate',
      consecutiveCount: 5,
      threshold: 5,
    });
    expect(payload.hint).toContain('different');
  });

  it('omits the long advisory on non-milestone calls to avoid error flooding', () => {
    const response = buildDoomLoopErrorResponse('page_navigate', '{}', {
      count: 7,
      threshold: 5,
      fullAdvisory: false,
    });
    const payload = parseGateError(response);
    expect(payload.advisory).toBeUndefined();

    const milestone = buildDoomLoopErrorResponse('page_navigate', '{}', {
      count: 10,
      threshold: 5,
      fullAdvisory: true,
    });
    expect(parseGateError(milestone).advisory).toBeDefined();
  });
});

describe('ToolCallContextGuard.recordDoomLoopCall', () => {
  let guard: ToolCallContextGuard;

  beforeEach(() => {
    guard = new ToolCallContextGuard(() => null);
  });

  it('does not trip below the threshold and trips on the Nth identical call', () => {
    for (let i = 1; i < 5; i++) {
      expect(guard.recordDoomLoopCall('page_navigate', '{"url":"https://x"}')).toBeNull();
    }
    const trip = guard.recordDoomLoopCall('page_navigate', '{"url":"https://x"}');
    expect(trip).toEqual({ count: 5, threshold: 5, fullAdvisory: true });
  });

  it('keeps counting past the threshold and repeats the advisory every N calls', () => {
    const key = '{"url":"https://x"}';
    for (let i = 1; i < 12; i++) {
      guard.recordDoomLoopCall('page_navigate', key);
    }
    const trips = [12, 13, 14, 15, 16].map((expected) => {
      const trip = guard.recordDoomLoopCall('page_navigate', key);
      expect(trip?.count).toBe(expected);
      return trip?.fullAdvisory;
    });
    // Milestones at multiples of the threshold (15) get the full advisory.
    expect(trips).toEqual([false, false, false, true, false]);
  });

  it('resets the counter when the arguments change', () => {
    for (let i = 0; i < 4; i++) {
      guard.recordDoomLoopCall('page_navigate', '{"url":"https://x"}');
    }
    expect(guard.recordDoomLoopCall('page_navigate', '{"url":"https://y"}')).toBeNull();
    for (let i = 0; i < 3; i++) {
      expect(guard.recordDoomLoopCall('page_navigate', '{"url":"https://y"}')).toBeNull();
    }
    const trip = guard.recordDoomLoopCall('page_navigate', '{"url":"https://y"}');
    expect(trip?.count).toBe(5);
  });

  it('resets the counter when a different tool is called', () => {
    for (let i = 0; i < 4; i++) {
      guard.recordDoomLoopCall('page_navigate', '{}');
    }
    guard.recordDoomLoopCall('page_evaluate', '{}');
    expect(guard.recordDoomLoopCall('page_navigate', '{}')).toBeNull();
  });

  it('tracks meta tool names too (call_tool routes inner calls here)', () => {
    for (let i = 0; i < 4; i++) {
      guard.recordDoomLoopCall('search_tools', '{"query":"hook"}');
    }
    expect(guard.recordDoomLoopCall('search_tools', '{"query":"hook"}')?.count).toBe(5);
  });

  it('isolates counters per MCP session', async () => {
    const key = '{"url":"https://x"}';
    await runWithToolRequestContext({ sessionId: 'session-a' }, async () => {
      for (let i = 0; i < 3; i++) guard.recordDoomLoopCall('page_navigate', key);
    });
    await runWithToolRequestContext({ sessionId: 'session-b' }, async () => {
      expect(guard.recordDoomLoopCall('page_navigate', key)).toBeNull();
    });
    await runWithToolRequestContext({ sessionId: 'session-a' }, async () => {
      expect(guard.recordDoomLoopCall('page_navigate', key)).toBeNull(); // 4th for session-a
      expect(guard.recordDoomLoopCall('page_navigate', key)?.count).toBe(5);
    });
  });

  it('honors an explicit threshold parameter and disables at 0', () => {
    expect(guard.recordDoomLoopCall('page_navigate', '{}', 2)).toBeNull();
    expect(guard.recordDoomLoopCall('page_navigate', '{}', 2)).toEqual({
      count: 2,
      threshold: 2,
      fullAdvisory: true,
    });

    const off = new ToolCallContextGuard(() => null);
    for (let i = 0; i < 10; i++) {
      expect(off.recordDoomLoopCall('page_navigate', '{}', 0)).toBeNull();
    }
  });

  it('resetDoomLoopStatesForTesting clears all session counters', async () => {
    const key = '{}';
    await runWithToolRequestContext({ sessionId: 'reset-session' }, async () => {
      for (let i = 0; i < 4; i++) guard.recordDoomLoopCall('page_navigate', key);
      guard.resetDoomLoopStatesForTesting();
      expect(guard.recordDoomLoopCall('page_navigate', key)).toBeNull();
    });
  });

  it('does not disturb the existing repeat guard state', () => {
    guard.recordDoomLoopCall('stealth_inject', '{}');
    guard.recordDoomLoopCall('stealth_inject', '{}');
    guard.recordDoomLoopCall('stealth_inject', '{}');
    // Repeat guard counts tool names only — untouched by doom-loop calls.
    expect(guard.isRepeatLoop()).toBe(false);
    expect(guard.recordCall('stealth_inject')).toBe(1);
  });
});

describe('MCP_DOOM_LOOP_THRESHOLD env override', () => {
  it('lowers the default threshold when the env var is set', async () => {
    vi.resetModules();
    vi.stubEnv('MCP_DOOM_LOOP_THRESHOLD', '2');
    try {
      const { MCP_DOOM_LOOP_THRESHOLD: threshold } = await import('@src/constants/server');
      expect(threshold).toBe(2);
      const { ToolCallContextGuard: FreshGuard } = await import('@server/ToolCallContextGuard');
      const fresh = new FreshGuard(() => null);
      fresh.recordDoomLoopCall('page_navigate', '{}');
      expect(fresh.recordDoomLoopCall('page_navigate', '{}')).toEqual({
        count: 2,
        threshold: 2,
        fullAdvisory: true,
      });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('describeRule', () => {
  it('includes pattern only when present', () => {
    expect(describeRule({ tool: 'page/*', action: 'deny' })).toBe('tool=page/* action=deny');
    expect(describeRule({ tool: 'page/*', pattern: '*x*', action: 'allow' })).toBe(
      'tool=page/* pattern="*x*" action=allow',
    );
  });
});

describe('runToolExecutionGate (shared meta-tool gate entry)', () => {
  const denyActivateTools: ToolPermissionRule[] = [{ tool: 'activate_tools', action: 'deny' }];

  it('denies a matching rule and returns the domain-path deny response shape', () => {
    const { bus, emitted } = recordingBus();
    const host: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: denyActivateTools } },
      eventBus: bus,
      contextGuard: new ToolCallContextGuard(() => null),
    };

    const response = runToolExecutionGate(host, 'activate_tools', { names: ['page_navigate'] });

    expect(response).not.toBeNull();
    const payload = parseGateError(response!);
    expect(payload.success).toBe(false);
    expect(payload.deniedBy).toEqual({ tool: 'activate_tools', action: 'deny' });
    expect(payload.activeRules).toEqual(['tool=activate_tools action=deny']);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('tool.gate.denied');
    expect(emitted[0]!.payload).toMatchObject({
      toolName: 'activate_tools',
      source: 'rules',
      rule: { tool: 'activate_tools', action: 'deny' },
    });
  });

  it('carries the ALS session id on deny telemetry when _meta.sessionId is absent', () => {
    const { bus, emitted } = recordingBus();
    const host: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: denyActivateTools } },
      eventBus: bus,
    };

    return runWithToolRequestContext({ sessionId: 'meta-session' }, async () => {
      runToolExecutionGate(host, 'activate_tools', {});
      expect(emitted[0]!.payload.sessionId).toBe('meta-session');
    });
  });

  it('applies rule patterns against the stable args JSON', () => {
    const host: ToolExecutionGateHost = {
      config: {
        toolExecution: {
          allowTools: [],
          rules: [{ tool: 'search_tools', pattern: '*secret*', action: 'deny' }],
        },
      },
    };

    expect(
      runToolExecutionGate(host, 'search_tools', { query: 'read secret keys' }),
    ).not.toBeNull();
    expect(runToolExecutionGate(host, 'search_tools', { query: 'page' })).toBeNull();
  });

  it('applies the doom-loop breaker on the 5th consecutive identical call', () => {
    const { bus, emitted } = recordingBus();
    const host: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: [] } },
      eventBus: bus,
      contextGuard: new ToolCallContextGuard(() => null),
    };

    for (let i = 0; i < 4; i++) {
      expect(runToolExecutionGate(host, 'search_tools', { query: 'hook' })).toBeNull();
    }
    const response = runToolExecutionGate(host, 'search_tools', { query: 'hook' });
    expect(response).not.toBeNull();
    const payload = parseGateError(response!);
    expect(payload.doomLoop).toEqual({
      toolName: 'search_tools',
      consecutiveCount: 5,
      threshold: 5,
    });
    expect(emitted[0]!.payload).toMatchObject({
      toolName: 'search_tools',
      source: 'doom-loop',
      rule: null,
      consecutiveCount: 5,
      threshold: 5,
    });
  });

  it('resets the doom streak when arguments change between calls', () => {
    const host: ToolExecutionGateHost = {
      contextGuard: new ToolCallContextGuard(() => null),
    };

    for (let i = 0; i < 4; i++) {
      expect(runToolExecutionGate(host, 'search_tools', { query: 'hook' })).toBeNull();
    }
    expect(runToolExecutionGate(host, 'search_tools', { query: 'other' })).toBeNull();
    for (let i = 0; i < 3; i++) {
      expect(runToolExecutionGate(host, 'search_tools', { query: 'other' })).toBeNull();
    }
    expect(runToolExecutionGate(host, 'search_tools', { query: 'other' })?.isError).toBe(true);
  });

  it('recordDoomLoop=false skips doom accounting while rules still apply (call_tool proxy)', () => {
    const guard = new ToolCallContextGuard(() => null);
    const denyCallTool: ToolPermissionRule[] = [{ tool: 'call_tool', action: 'deny' }];
    const host: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: [] } },
      contextGuard: guard,
    };

    for (let i = 0; i < 10; i++) {
      expect(
        runToolExecutionGate(
          host,
          'call_tool',
          { name: 'page_navigate' },
          { recordDoomLoop: false },
        ),
      ).toBeNull();
    }
    // The skipped streak must not have touched the guard's tracker.
    expect(guard.recordDoomLoopCall('call_tool', '{"name":"page_navigate"}')).toBeNull();

    // Rule evaluation still runs when doom accounting is skipped.
    const denyingHost: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: denyCallTool } },
    };
    expect(
      runToolExecutionGate(denyingHost, 'call_tool', {}, { recordDoomLoop: false }),
    ).not.toBeNull();
  });

  it('keeps default behavior unchanged: no config, no rules, no guard means allow-all', () => {
    const emptyHost: ToolExecutionGateHost = {};
    expect(runToolExecutionGate(emptyHost, 'search_tools', {})).toBeNull();
    expect(runToolExecutionGate(emptyHost, 'activate_tools', { names: ['x'] })).toBeNull();

    const emptySectionHost: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: [] } },
    };
    expect(runToolExecutionGate(emptySectionHost, 'call_tool', {})).toBeNull();
  });

  it('tolerates a missing contextGuard: rules still evaluate, doom-loop is skipped', () => {
    const host: ToolExecutionGateHost = {
      config: { toolExecution: { allowTools: [], rules: denyActivateTools } },
    };
    expect(runToolExecutionGate(host, 'activate_tools', {})).not.toBeNull();
    expect(runToolExecutionGate(host, 'search_tools', {})).toBeNull();
  });
});

describe('toolExecution config schema', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MCP_TOOL_ALLOW_TOOLS;
    delete process.env.MCP_TOOL_RULES_JSON;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('defaults to an empty (allow-all) toolExecution section', async () => {
    const { getConfig } = await import('@utils/config');
    expect(getConfig().toolExecution).toEqual({ allowTools: [], rules: [] });
  });

  it('parses MCP_TOOL_ALLOW_TOOLS as a CSV list', async () => {
    process.env.MCP_TOOL_ALLOW_TOOLS = 'page_navigate, search_in_scripts ,';
    const { getConfig } = await import('@utils/config');
    expect(getConfig().toolExecution!.allowTools).toEqual(['page_navigate', 'search_in_scripts']);
  });

  it('parses MCP_TOOL_RULES_JSON and drops invalid entries individually', async () => {
    process.env.MCP_TOOL_RULES_JSON = JSON.stringify([
      { tool: 'page/*', pattern: '*admin*', action: 'deny' },
      { tool: '', action: 'deny' },
      { tool: 'console_execute', action: 'bogus' },
      { tool: 'process_kill', action: 'deny' },
    ]);
    const { getConfig } = await import('@utils/config');
    expect(getConfig().toolExecution!.rules).toEqual([
      { tool: 'page/*', pattern: '*admin*', action: 'deny' },
      { tool: 'process_kill', action: 'deny' },
    ]);
  });

  it('fails closed (throws) for malformed rule JSON instead of silently disabling the gate', async () => {
    process.env.MCP_TOOL_RULES_JSON = 'not-json';
    const { getConfig } = await import('@utils/config');
    expect(() => getConfig()).toThrow(/MCP_TOOL_RULES_JSON is not valid JSON/);
  });

  it('fails closed (throws) when rule JSON is not an array', async () => {
    process.env.MCP_TOOL_RULES_JSON = JSON.stringify({ tool: 'page_navigate', action: 'deny' });
    const { getConfig } = await import('@utils/config');
    expect(() => getConfig()).toThrow(/must be a JSON array/);
  });

  it('flags malformed rules in validateConfig', async () => {
    const { validateConfig } = await import('@utils/config');
    const { getConfig } = await import('@utils/config');
    const config = getConfig();
    config.toolExecution!.rules = [
      { tool: 'page/*', action: 'deny' },
      { tool: '', action: 'deny' },
      { tool: 'page_*', action: 'allow' },
      { tool: 'console_execute', action: 'bogus' },
    ] as never;
    const { valid, errors } = validateConfig(config);
    expect(valid).toBe(false);
    expect(errors.some((error) => error.includes('toolExecution.rules[1].tool'))).toBe(true);
    expect(errors.some((error) => error.includes('toolExecution.rules[2].tool'))).toBe(true);
    expect(errors.some((error) => error.includes('toolExecution.rules[3].action'))).toBe(true);
  });
});
