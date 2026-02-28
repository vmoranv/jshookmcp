import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AntiDebugToolHandlers } from '../../../../src/server/domains/antidebug/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('AntiDebugToolHandlers', () => {
  const page = {
    evaluateOnNewDocument: vi.fn(),
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new AntiDebugToolHandlers(collector);
  });

  it('clamps maxDrift to minimum value in timing bypass', async () => {
    const body = parseJson(await handlers.handleAntiDebugBypassTiming({ maxDrift: -10 }));
    expect(body.success).toBe(true);
    expect(body.maxDrift).toBe(0);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
    expect(page.evaluate).toHaveBeenCalledOnce();
  });

  it('clamps maxDrift to maximum value in timing bypass', async () => {
    const body = parseJson(await handlers.handleAntiDebugBypassTiming({ maxDrift: 5000 }));
    expect(body.success).toBe(true);
    expect(body.maxDrift).toBe(1000);
  });

  it('returns error payload when timing bypass injection fails', async () => {
    collector.getActivePage.mockRejectedValueOnce(new Error('page unavailable'));
    const body = parseJson(await handlers.handleAntiDebugBypassTiming({}));
    expect(body.success).toBe(false);
    expect(body.tool).toBe('antidebug_bypass_timing');
    expect(body.error).toContain('page unavailable');
  });

  it('uses default mode for invalid debugger bypass mode', async () => {
    const body = parseJson(await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'invalid' }));
    expect(body.success).toBe(true);
    expect(body.mode).toBe('remove');
  });

  it('maps detect protections result fields', async () => {
    page.evaluate.mockResolvedValueOnce({
      success: true,
      detected: true,
      count: 2,
      protections: [{ type: 'debugger', severity: 'high', evidence: 'x', recommendedBypass: 'remove' }],
      recommendations: ['a'],
      evidence: { key: 1 },
    });

    const body = parseJson(await handlers.handleAntiDebugDetectProtections({}));
    expect(body.success).toBe(true);
    expect(body.detected).toBe(true);
    expect(body.count).toBe(2);
    expect(body.protections.length).toBe(1);
  });

  it('returns default empty detect protections payload when page returns null', async () => {
    page.evaluate.mockResolvedValueOnce(null);
    const body = parseJson(await handlers.handleAntiDebugDetectProtections({}));
    expect(body.success).toBe(true);
    expect(body.detected).toBe(false);
    expect(body.count).toBe(0);
    expect(body.protections).toEqual([]);
  });
});

