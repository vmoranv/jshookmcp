import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIHookRequest, PageController } from '@server/domains/shared/modules';

// Hoist mock functions so they are available before module-level vi.mock() factories execute.
const mocks = vi.hoisted(() => {
  const generateHook = vi.fn();
  return {
    generateHook,
    AIHookGeneratorCtor: vi.fn().mockImplementation(function (this: {
      generateHook: typeof generateHook;
    }) {
      this.generateHook = generateHook;
    }),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    loggerDebug: vi.fn(),
  };
});

vi.mock('@server/domains/shared/modules', () => ({
  AIHookGenerator: mocks.AIHookGeneratorCtor,
  PageController: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
    debug: mocks.loggerDebug,
  },
}));

import { AIHookToolHandlers } from '@server/domains/hooks/ai-handlers';

type AIHookHandlerResponse = Awaited<ReturnType<AIHookToolHandlers['handleAIHookGenerate']>>;
type AIHookHandlerContent = AIHookHandlerResponse['content'][number];

function getFirstContent(response: AIHookHandlerResponse): AIHookHandlerContent {
  const [content] = response.content;
  expect(content).toBeDefined();
  if (!content) {
    throw new Error('Expected response content');
  }
  return content;
}

function parseJson<T = Record<string, unknown>>(response: AIHookHandlerResponse): T {
  return JSON.parse(getFirstContent(response).text) as T;
}

function getGenerateHookCallArg(): AIHookRequest {
  const [call] = mocks.generateHook.mock.calls;
  expect(call).toBeDefined();
  if (!call) {
    throw new Error('Expected generateHook to be called');
  }
  return call[0] as AIHookRequest;
}

describe('AIHookToolHandlers', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
  };

  const pageController = {
    getPage: vi.fn(async () => page),
  };

  let handlers: AIHookToolHandlers;

  beforeEach(() => {
    // Re-apply all mock implementations because vitest's global mockReset: true
    // clears them after each test.
    mocks.AIHookGeneratorCtor.mockImplementation(function (this: {
      generateHook: typeof mocks.generateHook;
    }) {
      this.generateHook = mocks.generateHook;
    });
    pageController.getPage.mockImplementation(async () => page);

    handlers = new AIHookToolHandlers(pageController as unknown as PageController);
  });

  // ---------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------
  describe('constructor', () => {
    it('creates an instance of AIHookToolHandlers', () => {
      expect(handlers).toBeInstanceOf(AIHookToolHandlers);
    });

    it('instantiates an AIHookGenerator internally', () => {
      expect(mocks.AIHookGeneratorCtor).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookGenerate
  // ---------------------------------------------------------------
  describe('handleAIHookGenerate', () => {
    const defaultGenerateResponse = {
      success: true,
      hookId: 'ai-hook-1-123456',
      generatedCode: '(function(){ /* hook */ })()',
      explanation: 'Hooks the target function',
      injectionMethod: 'evaluateOnNewDocument' as const,
      warnings: [],
    };

    beforeEach(() => {
      mocks.generateHook.mockReturnValue(defaultGenerateResponse);
    });

    it('generates a hook with explicit target object', async () => {
      const target = { type: 'function' as const, name: 'myFunc' };
      const result = await handlers.handleAIHookGenerate({
        target,
        description: 'Test hook',
      });

      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.hookId).toBe('ai-hook-1-123456');
      expect(body.generatedCode).toBe('(function(){ /* hook */ })()');
      expect(body.explanation).toBe('Hooks the target function');
      expect(body.injectionMethod).toBe('evaluateOnNewDocument');
      expect(mocks.generateHook).toHaveBeenCalledOnce();

      const callArg = getGenerateHookCallArg();
      expect(callArg.target).toEqual(target);
      expect(callArg.description).toBe('Test hook');
    });

    it('infers target type "function" for a plain pattern', async () => {
      const result = await handlers.handleAIHookGenerate({
        pattern: 'alert',
        description: 'Hook alert calls',
      });

      const body = parseJson(result);
      expect(body.success).toBe(true);

      const callArg = getGenerateHookCallArg();
      expect(callArg.target).toEqual({ type: 'function', name: 'alert' });
    });

    it('infers target type "api" when pattern is "fetch"', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'fetch' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.target).toEqual({ type: 'api', name: 'fetch' });
    });

    it('infers target type "api" when pattern is "XMLHttpRequest"', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'XMLHttpRequest' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.target).toEqual({ type: 'api', name: 'XMLHttpRequest' });
    });

    it('infers target type "object-method" when pattern contains a dot', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'document.createElement' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.target).toEqual({ type: 'object-method', name: 'createElement' });
    });

    it('handles pattern with multiple dots by extracting the last segment', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'window.document.write' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.target.type).toBe('object-method');
      expect(callArg.target.name).toBe('write');
    });

    it('uses empty string for pattern when neither target nor pattern is given', async () => {
      await handlers.handleAIHookGenerate({});

      const callArg = getGenerateHookCallArg();
      expect(callArg.target).toEqual({ type: 'function', name: '' });
    });

    it('provides default description when none is given', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'eval' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.description).toBe('Hook eval');
    });

    it('provides default behavior when none is given', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'eval' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.behavior).toEqual({
        captureArgs: true,
        captureReturn: true,
        logToConsole: true,
      });
    });

    it('forwards explicit behavior', async () => {
      const behavior = { captureArgs: false, blockExecution: true };
      await handlers.handleAIHookGenerate({ pattern: 'eval', behavior });

      const callArg = getGenerateHookCallArg();
      expect(callArg.behavior).toEqual(behavior);
    });

    it('forwards condition and customCode', async () => {
      const condition = { maxCalls: 5, urlPattern: '*.js' };
      const customCode = { before: 'console.log("before")' };
      await handlers.handleAIHookGenerate({ pattern: 'eval', condition, customCode });

      const callArg = getGenerateHookCallArg();
      expect(callArg.condition).toEqual(condition);
      expect(callArg.customCode).toEqual(customCode);
    });

    it('includes warnings in the response', async () => {
      mocks.generateHook.mockReturnValue({
        ...defaultGenerateResponse,
        warnings: ['Potential performance impact'],
      });

      const result = await handlers.handleAIHookGenerate({ pattern: 'eval' });
      const body = parseJson(result);
      expect(body.warnings).toEqual(['Potential performance impact']);
    });

    it('includes usage instructions with hookId in the response', async () => {
      const result = await handlers.handleAIHookGenerate({ pattern: 'eval' });
      const body = parseJson(result);
      expect(body.usage).toContain('ai-hook-1-123456');
    });

    it('returns error response when generateHook throws an Error', async () => {
      mocks.generateHook.mockImplementation(() => {
        throw new Error('Generation failed');
      });

      const result = await handlers.handleAIHookGenerate({ pattern: 'eval' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Generation failed');
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'AI Hook generation failed',
        expect.any(Error)
      );
    });

    it('stringifies non-Error throwables in the error response', async () => {
      mocks.generateHook.mockImplementation(() => {
        throw 'raw string error';
      });

      const result = await handlers.handleAIHookGenerate({ pattern: 'eval' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('raw string error');
    });

    it('sets condition to undefined when not provided', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'eval' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.condition).toBeUndefined();
    });

    it('sets customCode to undefined when not provided', async () => {
      await handlers.handleAIHookGenerate({ pattern: 'eval' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.customCode).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookInject
  // ---------------------------------------------------------------
  describe('handleAIHookInject', () => {
    it('injects via evaluate by default', async () => {
      const result = await handlers.handleAIHookInject({
        hookId: 'hook-1',
        code: 'console.log("injected")',
      });

      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.hookId).toBe('hook-1');
      expect(body.message).toContain('evaluate');
      expect(body.injectionTime).toBeDefined();
      expect(page.evaluate).toHaveBeenCalledWith('console.log("injected")');
      expect(page.evaluateOnNewDocument).not.toHaveBeenCalled();
    });

    it('injects via evaluateOnNewDocument when method is specified', async () => {
      const result = await handlers.handleAIHookInject({
        hookId: 'hook-2',
        code: 'window.__hook = true',
        method: 'evaluateOnNewDocument',
      });

      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith('window.__hook = true');
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('logs the injection method with evaluate', async () => {
      await handlers.handleAIHookInject({
        hookId: 'hook-eval',
        code: 'code',
        method: 'evaluate',
      });
      expect(mocks.loggerInfo).toHaveBeenCalledWith('Hook injected (evaluate): hook-eval');
    });

    it('logs the injection method with evaluateOnNewDocument', async () => {
      await handlers.handleAIHookInject({
        hookId: 'hook-eond',
        code: 'code',
        method: 'evaluateOnNewDocument',
      });
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        'Hook injected (evaluateOnNewDocument): hook-eond'
      );
    });

    it('stores the injected hook internally and allows multiple injections', async () => {
      await handlers.handleAIHookInject({ hookId: 'persist-1', code: 'a' });
      await handlers.handleAIHookInject({ hookId: 'persist-2', code: 'b' });

      expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('overwrites hook when same hookId is injected twice', async () => {
      await handlers.handleAIHookInject({ hookId: 'dup', code: 'first' });
      await handlers.handleAIHookInject({ hookId: 'dup', code: 'second' });

      expect(page.evaluate).toHaveBeenCalledTimes(2);
      expect(page.evaluate).toHaveBeenNthCalledWith(1, 'first');
      expect(page.evaluate).toHaveBeenNthCalledWith(2, 'second');
    });

    it('returns error response when page.evaluate throws', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Page crashed'));

      const result = await handlers.handleAIHookInject({
        hookId: 'hook-fail',
        code: 'bad code',
      });

      const body = parseJson(result);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Page crashed');
      expect(mocks.loggerError).toHaveBeenCalledWith('Hook injection failed', expect.any(Error));
    });

    it('returns error response when getPage rejects', async () => {
      pageController.getPage.mockRejectedValueOnce(new Error('No browser'));

      const result = await handlers.handleAIHookInject({
        hookId: 'hook-no-page',
        code: 'code',
      });

      const body = parseJson(result);
      expect(body.success).toBe(false);
      expect(body.error).toBe('No browser');
    });

    it('stringifies non-Error throwables', async () => {
      page.evaluate.mockRejectedValueOnce('string rejection');

      const result = await handlers.handleAIHookInject({
        hookId: 'hook-str',
        code: 'code',
      });

      const body = parseJson(result);
      expect(body.success).toBe(false);
      expect(body.error).toBe('string rejection');
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookGetData
  // ---------------------------------------------------------------
  describe('handleAIHookGetData', () => {
    it('returns hook data when hook exists', async () => {
      const hookData = {
        hookId: 'data-hook',
        metadata: { description: 'test' },
        records: [{ args: ['a'], ts: 1000 }],
        totalRecords: 1,
      };
      page.evaluate.mockResolvedValueOnce(hookData);

      const result = await handlers.handleAIHookGetData({ hookId: 'data-hook' });
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.hookId).toBe('data-hook');
      expect(body.totalRecords).toBe(1);
      expect(body.records).toEqual([{ args: ['a'], ts: 1000 }]);
    });

    it('spreads hookData fields into the response', async () => {
      page.evaluate.mockResolvedValueOnce({
        hookId: 'spread-test',
        metadata: { enabled: true },
        records: [],
        totalRecords: 0,
        extraField: 'bonus',
      });

      const result = await handlers.handleAIHookGetData({ hookId: 'spread-test' });
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.hookId).toBe('spread-test');
      expect(body.extraField).toBe('bonus');
    });

    it('returns failure when hook data is null', async () => {
      page.evaluate.mockResolvedValueOnce(null);

      const result = await handlers.handleAIHookGetData({ hookId: 'missing-hook' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.message).toContain('missing-hook');
    });

    it('returns error response on evaluate failure', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Evaluate failed'));

      const result = await handlers.handleAIHookGetData({ hookId: 'err-hook' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Evaluate failed');
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to get hook data', expect.any(Error));
    });

    it('returns error response on getPage failure', async () => {
      pageController.getPage.mockRejectedValueOnce(new Error('No page'));

      const result = await handlers.handleAIHookGetData({ hookId: 'x' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('No page');
    });

    it('stringifies non-Error throwables', async () => {
      page.evaluate.mockRejectedValueOnce(999);

      const result = await handlers.handleAIHookGetData({ hookId: 'x' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('999');
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookList
  // ---------------------------------------------------------------
  describe('handleAIHookList', () => {
    it('returns all hooks from the page', async () => {
      const allHooks = [
        { hookId: 'h1', metadata: { description: 'First' }, recordCount: 3 },
        { hookId: 'h2', metadata: { description: 'Second' }, recordCount: 0 },
      ];
      page.evaluate.mockResolvedValueOnce(allHooks);

      const result = await handlers.handleAIHookList({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.totalHooks).toBe(2);
      expect(body.hooks).toEqual(allHooks);
    });

    it('returns empty list when no hooks exist', async () => {
      page.evaluate.mockResolvedValueOnce([]);

      const result = await handlers.handleAIHookList({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.totalHooks).toBe(0);
      expect(body.hooks).toEqual([]);
    });

    it('ignores the _args parameter', async () => {
      page.evaluate.mockResolvedValueOnce([]);

      const result = await handlers.handleAIHookList({
        arbitrary: 'value',
        ignored: true,
      });
      const body = parseJson(result);
      expect(body.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('List failed'));

      const result = await handlers.handleAIHookList({});
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('List failed');
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to list hooks', expect.any(Error));
    });

    it('returns error response on getPage failure', async () => {
      pageController.getPage.mockRejectedValueOnce(new Error('Browser disconnected'));

      const result = await handlers.handleAIHookList({});
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Browser disconnected');
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookClear
  // ---------------------------------------------------------------
  describe('handleAIHookClear', () => {
    it('clears data for a specific hookId', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      const result = await handlers.handleAIHookClear({ hookId: 'clear-me' });
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.message).toContain('clear-me');
      expect(page.evaluate).toHaveBeenCalledOnce();
    });

    it('clears all hooks when no hookId is provided', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      const result = await handlers.handleAIHookClear({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.message).toBeDefined();
      expect(page.evaluate).toHaveBeenCalledOnce();
    });

    it('clears all hooks when hookId is undefined', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      const result = await handlers.handleAIHookClear({ hookId: undefined });
      const body = parseJson(result);

      expect(body.success).toBe(true);
    });

    it('passes hookId to page.evaluate for single-hook clear', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      await handlers.handleAIHookClear({ hookId: 'specific-clear' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'specific-clear');
    });

    it('calls page.evaluate without extra args for clear-all', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      await handlers.handleAIHookClear({});

      // The clear-all branch calls page.evaluate with just a function, no hookId arg
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
    });

    it('returns error response on failure', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Clear failed'));

      const result = await handlers.handleAIHookClear({ hookId: 'h1' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Clear failed');
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Failed to clear hook data',
        expect.any(Error)
      );
    });

    it('returns error response on getPage failure', async () => {
      pageController.getPage.mockRejectedValueOnce(new Error('No page'));

      const result = await handlers.handleAIHookClear({});
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('No page');
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookToggle
  // ---------------------------------------------------------------
  describe('handleAIHookToggle', () => {
    it('enables a hook', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      const result = await handlers.handleAIHookToggle({
        hookId: 'toggle-hook',
        enabled: true,
      });
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.hookId).toBe('toggle-hook');
      expect(body.enabled).toBe(true);
    });

    it('disables a hook', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      const result = await handlers.handleAIHookToggle({
        hookId: 'toggle-hook',
        enabled: false,
      });
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.hookId).toBe('toggle-hook');
      expect(body.enabled).toBe(false);
    });

    it('passes hookId and enabled state to page.evaluate', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      await handlers.handleAIHookToggle({
        hookId: 'h-toggle',
        enabled: true,
      });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'h-toggle', true);
    });

    it('returns error response on failure', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Toggle failed'));

      const result = await handlers.handleAIHookToggle({
        hookId: 'h1',
        enabled: true,
      });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Toggle failed');
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to toggle hook', expect.any(Error));
    });

    it('stringifies non-Error throwables', async () => {
      page.evaluate.mockRejectedValueOnce(42);

      const result = await handlers.handleAIHookToggle({
        hookId: 'h1',
        enabled: false,
      });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('42');
    });
  });

  // ---------------------------------------------------------------
  // handleAIHookExport
  // ---------------------------------------------------------------
  describe('handleAIHookExport', () => {
    it('exports data for a specific hookId in JSON format by default', async () => {
      const exportData = {
        hookId: 'export-h',
        metadata: { description: 'exported' },
        records: [{ args: [1], ts: 500 }],
      };
      page.evaluate.mockResolvedValueOnce(exportData);

      const result = await handlers.handleAIHookExport({ hookId: 'export-h' });
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.format).toBe('json');
      expect(body.data).toEqual(exportData);
      expect(body.exportTime).toBeDefined();
    });

    it('exports all hooks when no hookId is provided', async () => {
      const exportData = {
        metadata: { h1: { description: 'first' } },
        records: { h1: [{ ts: 1 }] },
      };
      page.evaluate.mockResolvedValueOnce(exportData);

      const result = await handlers.handleAIHookExport({});
      const body = parseJson(result);

      expect(body.success).toBe(true);
      expect(body.data).toEqual(exportData);
    });

    it('respects the format parameter when set to csv', async () => {
      page.evaluate.mockResolvedValueOnce({});

      const result = await handlers.handleAIHookExport({ format: 'csv' });
      const body = parseJson(result);

      expect(body.format).toBe('csv');
    });

    it('defaults format to json when not specified', async () => {
      page.evaluate.mockResolvedValueOnce({});

      const result = await handlers.handleAIHookExport({});
      const body = parseJson(result);

      expect(body.format).toBe('json');
    });

    it('passes hookId to page.evaluate', async () => {
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleAIHookExport({ hookId: 'specific-id' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'specific-id');
    });

    it('passes undefined hookId to page.evaluate when not given', async () => {
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleAIHookExport({});

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), undefined);
    });

    it('includes exportTime as ISO string', async () => {
      page.evaluate.mockResolvedValueOnce({});

      const result = await handlers.handleAIHookExport({});
      const body = parseJson<{ exportTime: string }>(result);

      expect(body.exportTime).toBeDefined();
      expect(() => new Date(body.exportTime)).not.toThrow();
      expect(new Date(body.exportTime).toISOString()).toBe(body.exportTime);
    });

    it('returns error response on failure', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Export failed'));

      const result = await handlers.handleAIHookExport({ hookId: 'h1' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('Export failed');
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Failed to export hook data',
        expect.any(Error)
      );
    });

    it('stringifies non-Error throwables', async () => {
      page.evaluate.mockRejectedValueOnce({ code: 500 });

      const result = await handlers.handleAIHookExport({ hookId: 'h1' });
      const body = parseJson(result);

      expect(body.success).toBe(false);
      expect(body.error).toBe('[object Object]');
    });
  });

  // ---------------------------------------------------------------
  // Response structure consistency
  // ---------------------------------------------------------------
  describe('response structure', () => {
    it('success response has content array with a text-type entry', async () => {
      mocks.generateHook.mockReturnValue({
        success: true,
        hookId: 'struct-test',
        generatedCode: '',
        explanation: '',
        injectionMethod: 'evaluate',
        warnings: [],
      });

      const result = await handlers.handleAIHookGenerate({ pattern: 'x' });
      const content = getFirstContent(result);
      expect(result.content).toHaveLength(1);
      expect(content.type).toBe('text');
      expect(typeof content.text).toBe('string');
    });

    it('error response has content array with success=false', async () => {
      mocks.generateHook.mockImplementation(() => {
        throw new Error('fail');
      });

      const result = await handlers.handleAIHookGenerate({ pattern: 'x' });
      const content = getFirstContent(result);
      expect(result.content).toHaveLength(1);
      expect(content.type).toBe('text');

      const body = JSON.parse(content.text);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('inject success response includes injectionTime ISO string', async () => {
      const result = await handlers.handleAIHookInject({
        hookId: 'time-test',
        code: 'code',
      });

      const body = parseJson<{ success: boolean; injectionTime: string }>(result);
      expect(body.success).toBe(true);
      expect(() => new Date(body.injectionTime)).not.toThrow();
      expect(new Date(body.injectionTime).toISOString()).toBe(body.injectionTime);
    });
  });

  // ---------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------
  describe('edge cases', () => {
    it('handleAIHookGenerate with empty args still calls generateHook', async () => {
      mocks.generateHook.mockReturnValue({
        success: true,
        hookId: 'edge-1',
        generatedCode: '',
        explanation: '',
        injectionMethod: 'evaluate',
        warnings: [],
      });

      const result = await handlers.handleAIHookGenerate({});
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(mocks.generateHook).toHaveBeenCalledOnce();
    });

    it('handleAIHookGenerate with pattern ending in dot falls back to full pattern as name', async () => {
      mocks.generateHook.mockReturnValue({
        success: true,
        hookId: 'edge-dot',
        generatedCode: '',
        explanation: '',
        injectionMethod: 'evaluate',
        warnings: [],
      });

      await handlers.handleAIHookGenerate({ pattern: 'object.' });

      const callArg = getGenerateHookCallArg();
      expect(callArg.target.type).toBe('object-method');
      // 'object.'.split('.').pop() returns '' (falsy), so || falls back to the full pattern
      expect(callArg.target.name).toBe('object.');
    });

    it('handleAIHookGenerate uses target name for default description', async () => {
      mocks.generateHook.mockReturnValue({
        success: true,
        hookId: 'desc-test',
        generatedCode: '',
        explanation: '',
        injectionMethod: 'evaluate',
        warnings: [],
      });

      await handlers.handleAIHookGenerate({
        target: { type: 'function', name: 'myFn' },
      });

      const callArg = getGenerateHookCallArg();
      expect(callArg.description).toBe('Hook myFn');
    });

    it('handleAIHookGenerate uses "target" as fallback description when target has no name', async () => {
      mocks.generateHook.mockReturnValue({
        success: true,
        hookId: 'desc-fallback',
        generatedCode: '',
        explanation: '',
        injectionMethod: 'evaluate',
        warnings: [],
      });

      await handlers.handleAIHookGenerate({
        target: { type: 'custom' },
      });

      const callArg = getGenerateHookCallArg();
      expect(callArg.description).toBe('Hook target');
    });

    it('handleAIHookToggle with enabled=false includes correct state in response', async () => {
      page.evaluate.mockResolvedValueOnce(undefined);

      const result = await handlers.handleAIHookToggle({
        hookId: 'toggle-false',
        enabled: false,
      });
      const body = parseJson(result);
      expect(body.enabled).toBe(false);
    });
  });
});
