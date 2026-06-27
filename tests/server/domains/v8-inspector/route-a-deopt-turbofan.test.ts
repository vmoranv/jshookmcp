/**
 * Route A prime v8-inspector: v8_deopt_trace + v8_turbofan_inspect real call tests
 *
 * These handlers return typed objects (not MCP ToolResponse), so we call
 * them directly without parseJson wrapper.
 */

import { describe, expect, it } from 'vitest';

// ── v8_deopt_trace ─────────────────────────────────────────────────────────────

describe('v8_deopt_trace (Route A prime)', () => {
  it('handler returns unavailable mode when no CDP page provided', async () => {
    const { handleDeoptTrace } = await import('@server/domains/v8-inspector/handlers/deopt-trace');
    // No getPage callback → CDP unavailable
    const res = await handleDeoptTrace({
      durationMs: 100,
      maxEvents: 10,
      enable: true,
    });
    expect(res.success).toBe(false);
    expect(res.mode).toBe('unavailable');
    expect(res.events).toEqual([]);
    expect(res.eventCount).toBe(0);
  });

  it('handles enable=false case', async () => {
    const { handleDeoptTrace } = await import('@server/domains/v8-inspector/handlers/deopt-trace');
    const res = await handleDeoptTrace({ durationMs: 500, enable: false });
    // Without CDP, mode should be unavailable either way
    expect(res.mode).toBeDefined();
    expect(res.traceEnabled).toBeDefined();
  });

  it('rejects negative durationMs', async () => {
    const { handleDeoptTrace } = await import('@server/domains/v8-inspector/handlers/deopt-trace');
    const res = await handleDeoptTrace({ durationMs: -100 });
    expect(res.success).toBe(false);
  });

  it('respects maxEvents parameter settings', async () => {
    const { handleDeoptTrace } = await import('@server/domains/v8-inspector/handlers/deopt-trace');
    const res = await handleDeoptTrace({ durationMs: 200, maxEvents: 3 });
    expect(res.mode).toBeDefined();
    expect(Array.isArray(res.events)).toBe(true);
    expect(res.eventCount).toBe(0); // No CDP means no real events
  });
});

// ── v8_turbofan_inspect ───────────────────────────────────────────────────────

describe('v8_turbofan_inspect (Route A prime)', () => {
  it('requires scriptId parameter', async () => {
    const { handleTurbofanInspect } =
      await import('@server/domains/v8-inspector/handlers/turbofan-inspect');
    const res = await handleTurbofanInspect({} as any);
    expect(res.success).toBe(false);
  });

  it('returns heuristic mode when no CDP session is available', async () => {
    const { handleTurbofanInspect } =
      await import('@server/domains/v8-inspector/handlers/turbofan-inspect');
    const res = await handleTurbofanInspect({ scriptId: 'test-script-1' });
    // Heuristic mode or unavailable — either is valid without CDP
    expect(res.mode).toBeDefined();
    expect(typeof res.success).toBe('boolean');
  });

  it('accepts functionName filter', async () => {
    const { handleTurbofanInspect } =
      await import('@server/domains/v8-inspector/handlers/turbofan-inspect');
    const res = await handleTurbofanInspect({ scriptId: 's1', functionName: 'myFunc' });
    expect(res.mode).toBeDefined();
  });

  it('accepts action parameter (inspect/optimize/deoptimize)', async () => {
    const { handleTurbofanInspect } =
      await import('@server/domains/v8-inspector/handlers/turbofan-inspect');
    const res = await handleTurbofanInspect({
      scriptId: 's1',
      action: 'optimize',
      functionName: 'hotFunc',
    });
    expect(res.mode).toBeDefined();
    expect(res.scriptId).toBe('s1');
  });
});

// ── v8_function_retained ──────────────────────────────────────────────────────

describe('v8_function_retained (Route A prime)', () => {
  it('tool is registered in definitions with correct name', async () => {
    const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
    const def = v8InspectorTools.find((t) => t.name === 'v8_function_retained');
    expect(def).toBeTruthy();
    expect(def?.name).toBe('v8_function_retained');
  });

  it('definition requires snapshotId and pattern', async () => {
    const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
    const def = v8InspectorTools.find((t) => t.name === 'v8_function_retained')!;
    const schema = def.inputSchema as any;
    const required: string[] = schema.required ?? [];
    expect(required).toContain('snapshotId');
    expect(required).toContain('pattern');
  });

  it('definition accepts maxResults parameter', async () => {
    const { v8InspectorTools } = await import('@server/domains/v8-inspector/definitions');
    const def = v8InspectorTools.find((t) => t.name === 'v8_function_retained')!;
    const schema = def.inputSchema as any;
    expect(schema.properties.maxResults).toBeTruthy();
  });
});
