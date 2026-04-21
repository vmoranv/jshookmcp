import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InterceptHandlers } from '@server/domains/network/handlers/intercept-handlers';

function parseBody(r: unknown) {
  return JSON.parse((r as { content: [{ text: string }] }).content[0]!.text);
}

function createDeps() {
  const createdRules = [
    { id: 'rule-1', urlPattern: '*api*', stage: 'Response', responseCode: 200 },
  ];
  return {
    consoleMonitor: {
      enableFetchIntercept: vi.fn().mockResolvedValue(createdRules),
      getFetchInterceptStatus: vi.fn().mockReturnValue({ rules: createdRules }),
      disableFetchIntercept: vi.fn().mockResolvedValue({ removedRules: 1 }),
      removeFetchInterceptRule: vi.fn().mockResolvedValue(true),
    },
    eventBus: { emit: vi.fn() } as never,
  };
}

describe('InterceptHandlers', () => {
  let handlers: InterceptHandlers;
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    handlers = new InterceptHandlers(deps as never);
  });

  describe('handleNetworkInterceptResponse', () => {
    it('adds single rule via urlPattern', async () => {
      const r = await handlers.handleNetworkInterceptResponse({
        urlPattern: '*api/status*',
        responseCode: 200,
        responseBody: '{"ok":true}',
      });
      const body = parseBody(r);
      expect(body.createdRules).toHaveLength(1);
      expect(body.message).toContain('1');
    });

    it('adds batch rules via rules array', async () => {
      deps.consoleMonitor.enableFetchIntercept.mockResolvedValue([
        { id: 'r1', urlPattern: '*a*', stage: 'Response', responseCode: 200 },
        { id: 'r2', urlPattern: '*b*', stage: 'Response', responseCode: 200 },
      ]);
      const r = await handlers.handleNetworkInterceptResponse({
        rules: [
          { urlPattern: '*a*', responseBody: 'a' },
          { urlPattern: '*b*', responseBody: 'b' },
        ],
      });
      expect(parseBody(r).createdRules).toHaveLength(2);
    });

    it('fails with no rules', async () => {
      const r = await handlers.handleNetworkInterceptResponse({});
      expect(parseBody(r).success).toBe(false);
      expect(parseBody(r).usage).toBeDefined();
    });

    it('skips invalid rules in array', async () => {
      deps.consoleMonitor.enableFetchIntercept.mockResolvedValue([]);
      const r = await handlers.handleNetworkInterceptResponse({
        rules: [{ notUrlPattern: true }],
      });
      expect(parseBody(r).success).toBe(false);
    });

    it('handles enableFetchIntercept error', async () => {
      deps.consoleMonitor.enableFetchIntercept.mockRejectedValue(new Error('no page'));
      const r = await handlers.handleNetworkInterceptResponse({ urlPattern: '*' });
      expect(parseBody(r).success).toBe(false);
    });

    it('normalizes rule fields', async () => {
      deps.consoleMonitor.enableFetchIntercept.mockImplementation(async (rules) => rules);
      deps.consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [] });
      await handlers.handleNetworkInterceptResponse({
        urlPattern: '/test',
        urlPatternType: 'regex',
        stage: 'Request',
        responseCode: 404,
        responseHeaders: { 'X-Custom': 'val' },
        responseBody: { json: true },
      });
      const call = deps.consoleMonitor.enableFetchIntercept.mock.calls[0]![0] as unknown[];
      const rule = call[0] as Record<string, unknown>;
      expect(rule.urlPatternType).toBe('regex');
      expect(rule.stage).toBe('Request');
      expect(rule.responseCode).toBe(404);
      expect(rule.responseHeaders).toEqual({ 'X-Custom': 'val' });
      expect(rule.responseBody).toBe('{"json":true}');
    });

    it('defaults urlPatternType to glob', async () => {
      deps.consoleMonitor.enableFetchIntercept.mockImplementation(async (r) => r);
      deps.consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [] });
      await handlers.handleNetworkInterceptResponse({ urlPattern: '*' });
      const call = deps.consoleMonitor.enableFetchIntercept.mock.calls[0]![0] as unknown[];
      expect((call[0] as Record<string, unknown>).urlPatternType).toBe('glob');
    });
  });

  describe('handleNetworkInterceptList', () => {
    it('returns active rules', async () => {
      const r = await handlers.handleNetworkInterceptList({});
      expect(parseBody(r).rules).toHaveLength(1);
    });

    it('shows hint when no rules', async () => {
      deps.consoleMonitor.getFetchInterceptStatus.mockReturnValue({ rules: [] });
      const r = await handlers.handleNetworkInterceptList({});
      expect(parseBody(r).hint).toContain('No active');
    });
  });

  describe('handleNetworkInterceptDisable', () => {
    it('fails with no ruleId and all=false', async () => {
      const r = await handlers.handleNetworkInterceptDisable({});
      expect(parseBody(r).success).toBe(false);
    });

    it('disables all rules', async () => {
      const r = await handlers.handleNetworkInterceptDisable({ all: true });
      expect(deps.consoleMonitor.disableFetchIntercept).toHaveBeenCalled();
      expect(parseBody(r).removedRules).toBe(1);
    });

    it('removes specific rule', async () => {
      const r = await handlers.handleNetworkInterceptDisable({ ruleId: 'rule-1' });
      expect(deps.consoleMonitor.removeFetchInterceptRule).toHaveBeenCalledWith('rule-1');
      expect(parseBody(r).success).toBe(true);
    });

    it('reports when rule not found', async () => {
      deps.consoleMonitor.removeFetchInterceptRule.mockResolvedValue(false);
      const r = await handlers.handleNetworkInterceptDisable({ ruleId: 'missing' });
      expect(parseBody(r).success).toBe(false);
    });

    it('handles error', async () => {
      deps.consoleMonitor.disableFetchIntercept.mockRejectedValue(new Error('fail'));
      const r = await handlers.handleNetworkInterceptDisable({ all: true });
      expect(parseBody(r).success).toBe(false);
    });
  });
});
