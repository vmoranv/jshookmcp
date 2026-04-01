import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntiDebugToolHandlers } from '../../../../src/server/domains/antidebug/handlers';
import type { CodeCollector } from '../../../../src/server/domains/shared/modules';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '../../../../src/modules/collector/PageController';

vi.mock('../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: vi.fn(),
  evaluateOnNewDocumentWithTimeout: vi.fn(),
}));

describe('AntiDebugToolHandlers', () => {
  let collectorMock: vi.Mocked<CodeCollector>;
  let pageMock: any;
  let handlers: AntiDebugToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageMock = {};
    collectorMock = {
      getActivePage: vi.fn().mockResolvedValue(pageMock),
    } as any;
    handlers = new AntiDebugToolHandlers(collectorMock);
  });

  describe('handleAntiDebugBypassAll', () => {
    it('injects all scripts successfully persistently', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockResolvedValue(undefined);
      vi.mocked(evaluateWithTimeout).mockResolvedValue(undefined);

      const res = await handlers.handleAntiDebugBypassAll({ persistent: true });
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(4);
      expect(evaluateWithTimeout).toHaveBeenCalledTimes(4);
    });

    it('triggers injectScripts for all bypass types including persistent override', async () => {
      const res = await handlers.handleAntiDebugBypassAll({ persistent: {} }); // unhandled object defaults to true
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(4);
      expect(evaluateWithTimeout).toHaveBeenCalledTimes(4);
    });

    it('injects all scripts successfully non-persistently', async () => {
      const res = await handlers.handleAntiDebugBypassAll({ persistent: false });
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateOnNewDocumentWithTimeout).not.toHaveBeenCalled();
      expect(evaluateWithTimeout).toHaveBeenCalledTimes(4);
    });

    it('handles errors gracefully', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('Test error'));
      const res = await handlers.handleAntiDebugBypassAll({ persistent: false });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('Test error');
    });
  });

  describe('handleAntiDebugBypassDebuggerStatement', () => {
    it('injects debugger bypass with specific mode', async () => {
      const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'noop' });
      expect(res.content[0].text).toContain('"mode": "noop"');
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(1);
    });

    it('bubbles and catches errors', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAntiDebugBypassAll({ persistent: true });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('err');
    });

    it('bubbles and catches string errors natively', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAntiDebugBypassAll({ persistent: true });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('string error');
    });
  });

  describe('handleAntiDebugBypassTiming', () => {
    it('injects timing bypass with specific maxDrift', async () => {
      const res = await handlers.handleAntiDebugBypassTiming({ maxDrift: 100 });
      expect(res.content[0].text).toContain('"maxDrift": 100');
    });

    it('parses string maxDrift gracefully', async () => {
      const res = await handlers.handleAntiDebugBypassTiming({ maxDrift: '200' });
      expect(res.content[0].text).toContain('"maxDrift": 200');
    });

    it('bubbles and catches errors', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAntiDebugBypassTiming({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles unexpected native injection throw mapping error string securely', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue('string fail');
      const res = await handlers.handleAntiDebugBypassTiming({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles parseNumberArg without optional min/max constraints (private method coverage)', () => {
      // @ts-expect-error testing private fallback branch
      const res = handlers.parseNumberArg(50, { defaultValue: 10 });
      expect(res).toBe(50);
    });

    it('parses valid positive strings returning true', () => {
      // @ts-expect-error private method test
      expect(handlers.parseBooleanArg('yes', false)).toBe(true);
    });

    it('handles intercept boolean fallbacks for unknown numbers and strings', async () => {
      const resNum = await handlers.handleAntiDebugBypassAll({ persistent: 2 });
      expect(resNum.content[0].text).toContain('"persistent": true');

      const resStr = await handlers.handleAntiDebugBypassAll({ persistent: 'unrecognized' });
      expect(resStr.content[0].text).toContain('"persistent": true');
    });

    it('handles numeric maxDrift fallback for invalid strings', async () => {
      const res = await handlers.handleAntiDebugBypassTiming({ maxDrift: 'invalid string' });
      expect(res.content[0].text).toContain('"success": true');
    });

    it('handles parseDebuggerMode with invalid mode returning default', async () => {
      const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: 'invalid' });
      expect(res.content[0].text).toContain('"success": true');
    });

    it('bubbles generic error via stringified payload correctly when injection errors surface', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAntiDebugBypassDebuggerStatement({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('bubbles native string injection errors', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAntiDebugBypassDebuggerStatement({});
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAntiDebugBypassStackTrace', () => {
    it('injects stack trace bypass with internal and user patterns', async () => {
      const res = await handlers.handleAntiDebugBypassStackTrace({
        filterPatterns: ['my_pattern'],
      });
      expect(res.content[0].text).toContain('my_pattern');
    });

    it('parses string string arrays', async () => {
      const res = await handlers.handleAntiDebugBypassStackTrace({ filterPatterns: 'pat1, pat2' });
      expect(res.content[0].text).toContain('pat1');
      expect(res.content[0].text).toContain('pat2');
    });

    it('bubbles and catches errors', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAntiDebugBypassStackTrace({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('bubbles string generic errors', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAntiDebugBypassStackTrace({});
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAntiDebugBypassConsoleDetect', () => {
    it('injects console detect bypass block', async () => {
      const res = await handlers.handleAntiDebugBypassConsoleDetect({});
      expect(res.content[0].text).toContain('"success": true');
    });

    it('injects string mapped mode', async () => {
      const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: ' noop ' });
      expect(res.content[0].text).toContain('"success": true');
      expect(res.content[0].text).toContain('"mode": "noop"');
    });

    it('injects fallback default remove mode on unhandled type mapped mode', async () => {
      const res = await handlers.handleAntiDebugBypassDebuggerStatement({ mode: { unmapped: 1 } });
      expect(res.content[0].text).toContain('"success": true');
      expect(res.content[0].text).toContain('"mode": "remove"');
    });

    it('bubbles generic error via stringified payload correctly when injection errors surface', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAntiDebugBypassConsoleDetect({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('bubbles native string injection errors', async () => {
      vi.mocked(evaluateOnNewDocumentWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAntiDebugBypassConsoleDetect({});
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAntiDebugDetectProtections', () => {
    it('detects protections successfully from document mapping', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({
        success: true,
        detected: true,
        count: 1,
        protections: [],
        recommendations: [],
        evidence: {},
      });
      const res = await handlers.handleAntiDebugDetectProtections({});
      expect(res.content[0].text).toContain('"detected": true');
    });

    it('returns empty results if evaluation fails', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue(null);
      const res = await handlers.handleAntiDebugDetectProtections({});

      expect(res.content[0].text).toContain('"success": true');
      expect(res.content[0].text).toContain('"detected": false');
    });

    it('bubbles generic error via stringified payload correctly when detection errors surface', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAntiDebugDetectProtections({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('bubbles native string detection errors', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAntiDebugDetectProtections({});
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('Boolean parsing internals', () => {
    it('parses various boolean formats in handleAntiDebugBypassAll implicitly passing through parseBooleanArg', async () => {
      await handlers.handleAntiDebugBypassAll({ persistent: 1 });
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(4);
      vi.clearAllMocks();

      await handlers.handleAntiDebugBypassAll({ persistent: 0 });
      expect(evaluateOnNewDocumentWithTimeout).not.toHaveBeenCalled();
      vi.clearAllMocks();

      await handlers.handleAntiDebugBypassAll({ persistent: 'yes' });
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalledTimes(4);
      vi.clearAllMocks();

      await handlers.handleAntiDebugBypassAll({ persistent: 'false' });
      expect(evaluateOnNewDocumentWithTimeout).not.toHaveBeenCalled();
    });
  });
});
