import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: any) => payload,
    }),
  },
}));

vi.mock('@src/server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
  ConsoleMonitor: vi.fn(),
  CodeCollector: vi.fn(),
}));

import { AdvancedToolHandlersIntercept } from '@server/domains/network/handlers.impl.core.runtime.intercept';

describe('AdvancedToolHandlersIntercept', () => {
  const collector = createCodeCollectorMock();
  const consoleMonitor = {
    enableFetchIntercept: vi.fn(),
    getFetchInterceptStatus: vi.fn(),
    disableFetchIntercept: vi.fn(),
    removeFetchInterceptRule: vi.fn(),
  } as any;

  let handler: AdvancedToolHandlersIntercept;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new AdvancedToolHandlersIntercept(collector as any, consoleMonitor);
  });

  // ---------- handleNetworkInterceptResponse ----------

  describe('handleNetworkInterceptResponse', () => {
    it('returns error when no rules provided', async () => {
      const body = parseJson<any>(await handler.handleNetworkInterceptResponse({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('No valid rules provided');
    });

    it('handles single rule mode correctly', async () => {
      consoleMonitor.enableFetchIntercept.mockResolvedValue([
        { id: 'rule1', urlPattern: '*api*', stage: 'Response', responseCode: 200 },
      ]);
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: ['rule1'] });

      const body = parseJson<any>(
        await handler.handleNetworkInterceptResponse({
          urlPattern: '*api*',
          responseCode: 200,
          responseBody: { key: 'value' },
        }),
      );

      expect(consoleMonitor.enableFetchIntercept).toHaveBeenCalledWith([
        {
          urlPattern: '*api*',
          urlPatternType: 'glob',
          stage: 'Response',
          responseCode: 200,
          responseHeaders: undefined,
          responseBody: '{"key":"value"}',
        },
      ]);
      expect(body.success).toBe(true);
      expect(body.createdRules).toHaveLength(1);
    });

    it('handles single rule with string body and regex pattern', async () => {
      consoleMonitor.enableFetchIntercept.mockResolvedValue([
        { id: 'rule2', urlPattern: '.*', stage: 'Request', responseCode: 404 },
      ]);
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: ['rule2'] });

      const body = parseJson<any>(
        await handler.handleNetworkInterceptResponse({
          urlPattern: '.*',
          urlPatternType: 'regex',
          stage: 'Request',
          responseCode: 404,
          responseHeaders: { 'X-Test': 'test' },
          responseBody: 'string body',
        }),
      );

      expect(consoleMonitor.enableFetchIntercept).toHaveBeenCalledWith([
        {
          urlPattern: '.*',
          urlPatternType: 'regex',
          stage: 'Request',
          responseCode: 404,
          responseHeaders: { 'X-Test': 'test' },
          responseBody: 'string body',
        },
      ]);
      expect(body.success).toBe(true);
    });

    it('handles batch rule mode correctly', async () => {
      consoleMonitor.enableFetchIntercept.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: ['1', '2'] });

      const body = parseJson<any>(
        await handler.handleNetworkInterceptResponse({
          rules: [
            { urlPattern: '*a*' },
            { urlPattern: '*b*', responseBody: 'body' },
            { invalid: 'rule' }, // Should be skipped
          ],
        }),
      );

      expect(consoleMonitor.enableFetchIntercept).toHaveBeenCalledWith([
        {
          urlPattern: '*a*',
          urlPatternType: 'glob',
          stage: 'Response',
          responseCode: 200,
          responseHeaders: undefined,
          responseBody: undefined,
        },
        {
          urlPattern: '*b*',
          urlPatternType: 'glob',
          stage: 'Response',
          responseCode: 200,
          responseHeaders: undefined,
          responseBody: 'body',
        },
      ]);
      expect(body.success).toBe(true);
      expect(body.createdRules).toHaveLength(2);
    });

    it('returns error when batch mode passes empty valid rules', async () => {
      const body = parseJson<any>(
        await handler.handleNetworkInterceptResponse({
          rules: [{ invalid: 'rule' }],
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('No valid rules provided');
    });

    it('catches enableFetchIntercept errors', async () => {
      consoleMonitor.enableFetchIntercept.mockRejectedValue(new Error('CDP error'));

      const body = parseJson<any>(
        await handler.handleNetworkInterceptResponse({ urlPattern: '*api*' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe('CDP error');
    });

    it('catches enableFetchIntercept generic errors', async () => {
      consoleMonitor.enableFetchIntercept.mockRejectedValue('String error');

      const body = parseJson<any>(
        await handler.handleNetworkInterceptResponse({ urlPattern: '*api*' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe('String error');
    });
  });

  // ---------- handleNetworkInterceptList ----------

  describe('handleNetworkInterceptList', () => {
    it('returns current rules and status', async () => {
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: ['rule1'], enabled: true });

      const body = parseJson<any>(await handler.handleNetworkInterceptList({}));
      expect(body.success).toBe(true);
      expect(body.enabled).toBe(true);
      expect(body.rules).toHaveLength(1);
    });

    it('returns empty guidance if no rules', async () => {
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [], enabled: false });

      const body = parseJson<any>(await handler.handleNetworkInterceptList({}));
      expect(body.success).toBe(true);
      expect(body.hint).toContain('network_intercept(action: "add")');
    });
  });

  // ---------- handleNetworkInterceptDisable ----------

  describe('handleNetworkInterceptDisable', () => {
    it('returns error when neither ruleId nor all is provided', async () => {
      const body = parseJson<any>(await handler.handleNetworkInterceptDisable({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Provide either "ruleId"');
    });

    it('removes all rules', async () => {
      consoleMonitor.disableFetchIntercept.mockResolvedValue({ removedRules: 3 });

      const body = parseJson<any>(await handler.handleNetworkInterceptDisable({ all: true }));
      expect(consoleMonitor.disableFetchIntercept).toHaveBeenCalled();
      expect(body.success).toBe(true);
      expect(body.removedRules).toBe(3);
    });

    it('removes a specific rule', async () => {
      consoleMonitor.removeFetchInterceptRule.mockResolvedValue(true);
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [] });

      const body = parseJson<any>(await handler.handleNetworkInterceptDisable({ ruleId: 'ab-12' }));
      expect(consoleMonitor.removeFetchInterceptRule).toHaveBeenCalledWith('ab-12');
      expect(body.success).toBe(true);
      expect(body.message).toContain('removed');
    });

    it('reports rule not found when removing specific rule', async () => {
      consoleMonitor.removeFetchInterceptRule.mockResolvedValue(false);
      consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [] });

      const body = parseJson<any>(await handler.handleNetworkInterceptDisable({ ruleId: 'ab-12' }));
      expect(body.success).toBe(false);
      expect(body.message).toContain('not found');
    });

    it('catches disable errors', async () => {
      consoleMonitor.disableFetchIntercept.mockRejectedValue(new Error('Fatal exception'));

      const body = parseJson<any>(await handler.handleNetworkInterceptDisable({ all: true }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('Fatal exception');
    });

    it('catches disable string errors', async () => {
      consoleMonitor.disableFetchIntercept.mockRejectedValue('Fatal exception');

      const body = parseJson<any>(await handler.handleNetworkInterceptDisable({ all: true }));
      expect(body.success).toBe(false);
      expect(body.error).toBe('Fatal exception');
    });
  });
});
