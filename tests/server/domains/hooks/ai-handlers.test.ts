import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIHookToolHandlers } from '../../../../src/server/domains/hooks/ai-handlers';
import type { PageController } from '../../../../src/server/domains/shared/modules';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '../../../../src/modules/collector/PageController';

vi.mock('../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: vi.fn(),
  evaluateOnNewDocumentWithTimeout: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe('AIHookToolHandlers', () => {
  let pageControllerMock: vi.Mocked<PageController>;
  let pageMock: any;
  let handlers: AIHookToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageMock = {};
    pageControllerMock = {
      getPage: vi.fn().mockResolvedValue(pageMock),
    } as any;
    handlers = new AIHookToolHandlers(pageControllerMock);
  });

  describe('handleAIHookInject', () => {
    it('injects via evaluate by default without explicit method', async () => {
      const res = await handlers.handleAIHookInject({ hookId: 'test1', code: 'alert(1)' });
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateWithTimeout).toHaveBeenCalled();
    });

    it('injects via evaluateOnNewDocument when defined in method', async () => {
      const res = await handlers.handleAIHookInject({
        hookId: 'test2',
        code: 'alert(1)',
        method: 'evaluateOnNewDocument',
      });
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateOnNewDocumentWithTimeout).toHaveBeenCalled();
    });

    it('handles missing required arguments gracefully', async () => {
      const res = await handlers.handleAIHookInject({});
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('hookId');
    });

    it('throws appropriately on injection crash from execution context', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('inject fail'));
      const res = await handlers.handleAIHookInject({ hookId: 'test1', code: 'alert(1)' });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('inject fail');
    });

    it('throws appropriately on injection string crash from execution context', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('inject string fail');
      const res = await handlers.handleAIHookInject({ hookId: 'test1', code: 'alert(1)' });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('inject string fail');
    });
  });

  describe('handleAIHookGetData', () => {
    it('retrieves accurate hook data map if present in target context', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({ hookId: 'test1', totalRecords: 5 });
      const res = await handlers.handleAIHookGetData({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": true');
      expect(res.content[0].text).toContain('"totalRecords": 5');

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;

      // 1. Missing hook
      (global as any).window = {};
      expect(fn('test1')).toBeNull();

      // 2. Present hook
      (global as any).window = { __aiHooks: { test1: [{}] }, __aiHookMetadata: { test1: {} } };
      expect(fn('test1').totalRecords).toBe(1);
    });

    it('returns false payload representation if hook completely missing', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue(null);
      const res = await handlers.handleAIHookGetData({ hookId: 'test_miss' });
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles crash trace error', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookGetData({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles string trace error', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookGetData({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAIHookList', () => {
    it('lists hooks present as array structure', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue([{ hookId: 'test1' }]);
      const res = await handlers.handleAIHookList({});
      expect(res.content[0].text).toContain('"success": true');
      expect(res.content[0].text).toContain('"totalHooks": 1');

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = {};
      expect(fn()).toEqual([]);

      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: { test1: [{}] } };
      expect(fn()[0].recordCount).toBe(1);

      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: {} };
      expect(fn()[0].recordCount).toBe(0);
    });

    it('handles generic internal errors gracefully outside hook mappings', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookList({});
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('err');
    });

    it('handles string based error traces accurately for internal catch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookList({});
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('string error');
    });
  });

  describe('handleAIHookClear', () => {
    it('clears specific hook if hookId passed specifically', async () => {
      const res = await handlers.handleAIHookClear({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHooks: { test1: [1, 2, 3] } };
      fn('test1');
      expect((global as any).window.__aiHooks.test1).toEqual([]);

      // Non-existent hook coverage branch
      (global as any).window = {};
      fn('test2'); // Should not throw
    });

    it('clears all hooks across broad context boundaries', async () => {
      const res = await handlers.handleAIHookClear({});
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHooks: { test1: [1], test2: [2] } };
      fn();
      expect((global as any).window.__aiHooks.test1).toEqual([]);

      (global as any).window = {};
      fn(); // Should not throw
    });

    it('handles error traces accurately for internal catch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookClear({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles string traces accurately for internal catch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookClear({});
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAIHookToggle', () => {
    it('toggles a singular specific hook successfully evaluating page switch', async () => {
      const res = await handlers.handleAIHookToggle({ hookId: 'test1', enabled: true });
      expect(res.content[0].text).toContain('"success": true');
      expect(evaluateWithTimeout).toHaveBeenCalled();

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHookMetadata: { test1: { enabled: false } } };
      fn('test1', true);
      expect((global as any).window.__aiHookMetadata.test1.enabled).toBe(true);

      (global as any).window = {};
      fn('test1', true); // Should not throw
    });

    it('toggles hook specifically evaluating page switch to off', async () => {
      const res = await handlers.handleAIHookToggle({ hookId: 'test1', enabled: false });
      expect(res.content[0].text).toContain('"success": true');
    });

    it('handles error bounds catch on evaluating page switch', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookToggle({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": false');
    });

    it('handles string limits safely', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookToggle({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": false');
    });
  });

  describe('handleAIHookExport', () => {
    it('exports a specific hook from defined context evaluation boundary', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({ hookId: 'test1' });
      const res = await handlers.handleAIHookExport({ hookId: 'test1' });
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: { test1: [{}] } };
      const exp1 = fn('test1');
      expect(exp1.records.length).toBe(1);

      (global as any).window = {};
      const expMissing = fn('test1');
      expect(expMissing.records).toEqual([]);
    });

    it('exports all hooks when no identity limits restrict search bound', async () => {
      vi.mocked(evaluateWithTimeout).mockResolvedValue({ metadata: {} });
      const res = await handlers.handleAIHookExport({});
      expect(res.content[0].text).toContain('"success": true');

      // Execute callback for coverage
      const fn = vi.mocked(evaluateWithTimeout).mock.calls[0][1] as Function;
      (global as any).window = { __aiHookMetadata: { test1: {} }, __aiHooks: { test1: [{}] } };
      const expAll = fn();
      expect(expAll.records.test1.length).toBe(1);

      (global as any).window = {};
      const expMissing = fn();
      expect(expMissing.records).toEqual({});
    });

    it('safely handles error maps', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue(new Error('err'));
      const res = await handlers.handleAIHookExport({});
      expect(res.content[0].text).toContain('"success": false');
    });

    it('safely handles string error maps', async () => {
      vi.mocked(evaluateWithTimeout).mockRejectedValue('string error');
      const res = await handlers.handleAIHookExport({});
      expect(res.content[0].text).toContain('"success": false');
    });
  });
});
