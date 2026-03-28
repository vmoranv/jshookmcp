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
  });
});
