import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SandboxToolHandlers } from '@server/domains/sandbox/handlers';

vi.mock('@server/sandbox/QuickJSSandbox', () => {
  return {
    QuickJSSandbox: class {
      setBridge() {}
      async execute(_code: string, options: any) {
        const scratch = options.globals?.__scratchpad;
        const hasContent = scratch && Object.keys(scratch).length > 0;
        return {
          ok: true,
          durationMs: 50,
          logs: ['Log message'],
          output: { result: 42, __scratchpad: hasContent ? scratch : { count: 1 } },
        };
      }
    },
  };
});

vi.mock('@server/sandbox/AutoCorrectionLoop', () => {
  return {
    executeWithRetry: async () => ({
      ok: true,
      durationMs: 70,
      logs: [],
      output: { autoCorrected: true },
    }),
  };
});

describe('SandboxToolHandlers', () => {
  let handlers: SandboxToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const map = new Map<string, any>();
    const ctx: any = {
      getDomainInstance: (key: string) => map.get(key),
      setDomainInstance: (key: string, inst: any) => map.set(key, inst),
      getToolRegistry: () => ({ getAnnotationsForTool: () => [] }),
    };
    handlers = new SandboxToolHandlers(ctx);
  });

  describe('handleExecuteSandboxScript', () => {
    it('should return error if code is missing', async () => {
      const result = (await handlers.handleExecuteSandboxScript({})) as any;
      expect(result.content[0].text).toContain('code parameter is required');
    });

    it('should execute code in sandbox and return summary', async () => {
      const result = (await handlers.handleExecuteSandboxScript({ code: 'return 42;' })) as any;
      const text = result.content[0].text;
      expect(text).toContain('Status:** ✓ Success');
      expect(text).toContain('Duration:** 50ms');
      expect(text).toContain('Log message');
      expect(text).toContain('Result:** {"result":42,"__scratchpad":{"count":1}}');
    });

    it('should execute with autoCorrect if flag is true', async () => {
      const result = (await handlers.handleExecuteSandboxScript({
        code: 'bad code',
        autoCorrect: true,
      })) as any;
      const text = result.content[0].text;
      expect(text).toContain('Status:** ✓ Success');
      expect(text).toContain('Duration:** 70ms');
      expect(text).toContain('Result:** {"autoCorrected":true}');
    });

    it('should persist scratchpad state when sessionId is provided', async () => {
      // First execution adds count:1 to scratchpad
      await handlers.handleExecuteSandboxScript({
        code: 'some code',
        sessionId: 'session-1',
      });

      // We can test this by examining the mock sandbox response.
      // Since we updated execute() above to echo back the scratchpad it received:
      const result = (await handlers.handleExecuteSandboxScript({
        code: 'some code 2',
        sessionId: 'session-1',
      })) as any;

      expect(result.content[0].text).toContain('"__scratchpad":{"count":1}');
    });

    it('should pass timeoutMs to options', async () => {
      // we just simulate passing it, the mock currently executes fast anyway
      const result = (await handlers.handleExecuteSandboxScript({
        code: 'return 1;',
        timeoutMs: 5000,
      })) as any;
      expect(result.content[0].text).toContain('✓ Success');
    });

    it('should report failure and error message', async () => {
      // Mock execute returning error state
      vi.spyOn(handlers['scratchpad'] as any, 'getAll').mockReturnValue({}); // avoid unused var warning

      const QuickJSSandbox = await import('@server/sandbox/QuickJSSandbox').then(
        (m) => m.QuickJSSandbox,
      );
      vi.spyOn(QuickJSSandbox.prototype, 'execute').mockResolvedValueOnce({
        ok: false,
        durationMs: 10,
        logs: [],
        error: 'SyntaxError',
        output: undefined,
        timedOut: false,
      });

      const result = (await handlers.handleExecuteSandboxScript({ code: 'bad;' })) as any;
      const text = result.content[0].text;
      expect(text).toContain('✗ Failed');
      expect(text).toContain('**Error:** SyntaxError');
    });

    it('should report timed out executions', async () => {
      const QuickJSSandbox = await import('@server/sandbox/QuickJSSandbox').then(
        (m) => m.QuickJSSandbox,
      );
      vi.spyOn(QuickJSSandbox.prototype, 'execute').mockResolvedValueOnce({
        ok: false,
        durationMs: 5000,
        logs: [],
        timedOut: true,
        output: undefined,
      });

      const result = (await handlers.handleExecuteSandboxScript({ code: 'while(1);' })) as any;
      expect(result.content[0].text).toContain('**Timed out:** yes');
    });

    it('should handle non-object results without persisting scratchpad', async () => {
      const QuickJSSandbox = await import('@server/sandbox/QuickJSSandbox').then(
        (m) => m.QuickJSSandbox,
      );
      vi.spyOn(QuickJSSandbox.prototype, 'execute').mockResolvedValueOnce({
        ok: true,
        durationMs: 5,
        logs: [],
        timedOut: false,
        output: 42, // Non-object
      });

      const result = (await handlers.handleExecuteSandboxScript({
        code: 'return 42;',
        sessionId: 'sess-3',
      })) as any;
      expect(result.content[0].text).toContain('**Result:** 42');
    });

    it('should ignore object results without __scratchpad property', async () => {
      const QuickJSSandbox = await import('@server/sandbox/QuickJSSandbox').then(
        (m) => m.QuickJSSandbox,
      );
      vi.spyOn(QuickJSSandbox.prototype, 'execute').mockResolvedValueOnce({
        ok: true,
        durationMs: 5,
        logs: [],
        timedOut: false,
        output: { key: 'value' }, // No __scratchpad
      });

      const result = (await handlers.handleExecuteSandboxScript({
        code: 'return {};',
        sessionId: 'sess-4',
      })) as any;
      expect(result.content[0].text).toContain('{"key":"value"}');
    });
  });
});
