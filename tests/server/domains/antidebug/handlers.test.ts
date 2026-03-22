import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { AntiDebugToolHandlers } from '@server/domains/antidebug/handlers';
import { createCodeCollectorMock, createPageMock, parseJson } from '../shared/mock-factories';



describe('AntiDebugToolHandlers', () => {
  const page = createPageMock();
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlers = new AntiDebugToolHandlers(collector as any);
  });

  interface TimingBypassResponse {
    success: boolean;
    maxDrift: number;
    tool?: string;
    error?: string;
  }

  it('clamps maxDrift to minimum value in timing bypass', async () => {
    const body = parseJson<TimingBypassResponse>(
      await handlers.handleAntiDebugBypassTiming({ maxDrift: -10 })
    );
    expect(body.success).toBe(true);
    expect(body.maxDrift).toBe(0);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
    expect(page.evaluate).toHaveBeenCalledOnce();
  });

  it('clamps maxDrift to maximum value in timing bypass', async () => {
    const body = parseJson<TimingBypassResponse>(
      await handlers.handleAntiDebugBypassTiming({ maxDrift: 5000 })
    );
    expect(body.success).toBe(true);
    expect(body.maxDrift).toBe(1000);
  });

  it('returns error payload when timing bypass injection fails', async () => {
    (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('page unavailable'));
    const body = parseJson<TimingBypassResponse>(await handlers.handleAntiDebugBypassTiming({}));
    expect(body.success).toBe(false);
    expect(body.tool).toBe('antidebug_bypass_timing');
    expect(body.error).toContain('page unavailable');
  });

  interface DebuggerBypassResponse {
    success: boolean;
    mode: string;
    tool?: string;
    error?: string;
  }

  it('uses default mode for invalid debugger bypass mode', async () => {
    const body = parseJson<DebuggerBypassResponse>(
      await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'invalid' })
    );
    expect(body.success).toBe(true);
    expect(body.mode).toBe('remove');
  });

  interface DetectProtectionsResponse {
    success: boolean;
    detected: boolean;
    count: number;
    protections: unknown[];
  }

  it('maps detect protections result fields', async () => {
    (page.evaluate as Mock).mockResolvedValueOnce({
      success: true,
      detected: true,
      count: 2,
      protections: [
        { type: 'debugger', severity: 'high', evidence: 'x', recommendedBypass: 'remove' },
      ],
      recommendations: ['a'],
      evidence: { key: 1 },
    });

    const body = parseJson<DetectProtectionsResponse>(
      await handlers.handleAntiDebugDetectProtections({})
    );
    expect(body.success).toBe(true);
    expect(body.detected).toBe(true);
    expect(body.count).toBe(2);
    expect(body.protections.length).toBe(1);
  });

  it('returns default empty detect protections payload when page returns null', async () => {
    (page.evaluate as Mock).mockResolvedValueOnce(null);
    const body = parseJson<DetectProtectionsResponse>(
      await handlers.handleAntiDebugDetectProtections({})
    );
    expect(body.success).toBe(true);
    expect(body.detected).toBe(false);
    expect(body.count).toBe(0);
    expect(body.protections).toEqual([]);
  });

  describe('handleAntiDebugBypassAll', () => {
    interface BypassAllResponse {
      success: boolean;
      tool: string;
      persistent: boolean;
      injectedCount: number;
      injected: string[];
      error?: string;
    }

    it('injects all bypass scripts with persistence by default', async () => {
      const body = parseJson<BypassAllResponse>(await handlers.handleAntiDebugBypassAll({}));
      expect(body.success).toBe(true);
      expect(body.tool).toBe('antidebug_bypass_all');
      expect(body.persistent).toBe(true);
      expect(body.injectedCount).toBe(4);
      expect(body.injected).toEqual([
        'bypassDebuggerStatement',
        'bypassTiming',
        'bypassStackTrace',
        'bypassConsoleDetect',
      ]);
      // 4 scripts × evaluateOnNewDocument (persistent) + 4 scripts × evaluate
      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(4);
      expect(page.evaluate).toHaveBeenCalledTimes(4);
    });

    it('skips evaluateOnNewDocument when persistent=false', async () => {
      const body = parseJson<BypassAllResponse>(
        await handlers.handleAntiDebugBypassAll({ persistent: false })
      );
      expect(body.success).toBe(true);
      expect(body.persistent).toBe(false);
      expect(page.evaluateOnNewDocument).not.toHaveBeenCalled();
      expect(page.evaluate).toHaveBeenCalledTimes(4);
    });

    it('returns error on page failure', async () => {
      (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('no page'));
      const body = parseJson<BypassAllResponse>(await handlers.handleAntiDebugBypassAll({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('no page');
    });
  });

  describe('handleAntiDebugBypassStackTrace', () => {
    interface StackTraceResponse {
      success: boolean;
      filterPatterns: string[];
    }

    it('uses default filter patterns when none provided', async () => {
      const body = parseJson<StackTraceResponse>(
        await handlers.handleAntiDebugBypassStackTrace({})
      );
      expect(body.success).toBe(true);
      expect(body.filterPatterns).toContain('puppeteer');
      expect(body.filterPatterns).toContain('devtools');
    });

    it('merges user patterns with defaults', async () => {
      const body = parseJson<StackTraceResponse>(
        await handlers.handleAntiDebugBypassStackTrace({
          filterPatterns: ['custom_pattern', 'another'],
        })
      );
      expect(body.success).toBe(true);
      expect(body.filterPatterns).toContain('custom_pattern');
      expect(body.filterPatterns).toContain('another');
      expect(body.filterPatterns).toContain('puppeteer');
    });

    it('handles comma-separated string patterns', async () => {
      const body = parseJson<StackTraceResponse>(
        await handlers.handleAntiDebugBypassStackTrace({
          filterPatterns: 'foo, bar, baz',
        })
      );
      expect(body.success).toBe(true);
      expect(body.filterPatterns).toContain('foo');
      expect(body.filterPatterns).toContain('bar');
    });

    it('deduplicates patterns', async () => {
      const body = parseJson<StackTraceResponse>(
        await handlers.handleAntiDebugBypassStackTrace({
          filterPatterns: ['puppeteer', 'puppeteer', 'custom'],
        })
      );
      const puppeteerCount = body.filterPatterns.filter((p: string) => p === 'puppeteer').length;
      expect(puppeteerCount).toBe(1);
    });

    it('returns error on failure', async () => {
      (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('crash'));
      const body = parseJson<StackTraceResponse>(
        await handlers.handleAntiDebugBypassStackTrace({})
      );
      expect(body.success).toBe(false);
    });
  });

  describe('handleAntiDebugBypassConsoleDetect', () => {
    interface ConsoleDetectResponse {
      success: boolean;
      tool: string;
      persistent: boolean;
    }

    it('injects console detect bypass script', async () => {
      const body = parseJson<ConsoleDetectResponse>(
        await handlers.handleAntiDebugBypassConsoleDetect({})
      );
      expect(body.success).toBe(true);
      expect(body.tool).toBe('antidebug_bypass_console_detect');
      expect(body.persistent).toBe(true);
    });

    it('returns error on failure', async () => {
      (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('no page'));
      const body = parseJson<ConsoleDetectResponse>(
        await handlers.handleAntiDebugBypassConsoleDetect({})
      );
      expect(body.success).toBe(false);
    });
  });

  describe('handleAntiDebugBypassDebuggerStatement', () => {
    it('accepts noop mode', async () => {
      const body = parseJson<DebuggerBypassResponse>(
        await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'noop' })
      );
      expect(body.success).toBe(true);
      expect(body.mode).toBe('noop');
    });

    it('accepts remove mode', async () => {
      const body = parseJson<DebuggerBypassResponse>(
        await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'remove' })
      );
      expect(body.success).toBe(true);
      expect(body.mode).toBe('remove');
    });

    it('normalizes case for mode', async () => {
      const body = parseJson<DebuggerBypassResponse>(
        await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'NOOP' })
      );
      expect(body.success).toBe(true);
      expect(body.mode).toBe('noop');
    });

    it('returns error on page failure', async () => {
      (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('err'));
      const body = parseJson<DebuggerBypassResponse>(
        await handlers.handleAntiDebugBypassDebuggerStatement({})
      );
      expect(body.success).toBe(false);
    });
  });

  describe('parseBooleanArg edge cases', () => {
    it('handles numeric 1 and 0', async () => {
      // persistent=1 should be true
      const body1 = parseJson<BypassAllResponse>(
        await handlers.handleAntiDebugBypassAll({ persistent: 1 })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body1.persistent).toBe(true);

      vi.clearAllMocks();

      const body0 = parseJson<BypassAllResponse>(
        await handlers.handleAntiDebugBypassAll({ persistent: 0 })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body0.persistent).toBe(false);
    });

    it('handles string true/false', async () => {
      const bodyTrue = parseJson<BypassAllResponse>(
        await handlers.handleAntiDebugBypassAll({ persistent: 'yes' })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(bodyTrue.persistent).toBe(true);

      vi.clearAllMocks();

      const bodyFalse = parseJson<BypassAllResponse>(
        await handlers.handleAntiDebugBypassAll({ persistent: 'off' })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(bodyFalse.persistent).toBe(false);
    });
  });

  describe('parseNumberArg edge cases', () => {
    it('parses string numbers', async () => {
      const body = parseJson<TimingBypassResponse>(
        await handlers.handleAntiDebugBypassTiming({ maxDrift: '100' })
      );
      expect(body.maxDrift).toBe(100);
    });

    it('uses default for non-numeric strings', async () => {
      const body = parseJson<TimingBypassResponse>(
        await handlers.handleAntiDebugBypassTiming({ maxDrift: 'abc' })
      );
      expect(body.maxDrift).toBe(50); // default
    });

    it('uses default for NaN', async () => {
      const body = parseJson<TimingBypassResponse>(
        await handlers.handleAntiDebugBypassTiming({ maxDrift: NaN })
      );
      expect(body.maxDrift).toBe(50);
    });

    it('uses default for Infinity', async () => {
      const body = parseJson<TimingBypassResponse>(
        await handlers.handleAntiDebugBypassTiming({ maxDrift: Infinity })
      );
      expect(body.maxDrift).toBe(50);
    });
  });

  describe('detect protections error path', () => {
    it('returns error on evaluate failure', async () => {
      (collector.getActivePage as Mock).mockRejectedValueOnce(new Error('timeout'));
      const body = parseJson<DetectProtectionsResponse>(
        await handlers.handleAntiDebugDetectProtections({})
      );
      expect(body.success).toBe(false);
      expect(body.tool).toBe('antidebug_detect_protections');
    });
  });
});

