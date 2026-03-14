import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mocks for API calls
const openaiCreateMock = vi.fn();
const anthropicCreateMock = vi.fn();
// Track constructor args manually (vi.fn() gets reset by vitest's mockReset)
let openaiConstructorArgs: unknown[][] = [];
let anthropicConstructorArgs: unknown[][] = [];

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: openaiCreateMock } };
      constructor(...args: unknown[]) {
        openaiConstructorArgs.push(args);
      }
    },
  };
});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: anthropicCreateMock };
      constructor(...args: unknown[]) {
        anthropicConstructorArgs.push(args);
      }
    },
  };
});

vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { LLMService } from '@services/LLMService';
import type { LLMMessage } from '@services/LLMService';
import { readFile } from 'fs/promises';

const sampleMessages: LLMMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

describe('LLMService', () => {
  beforeEach(() => {
    openaiCreateMock.mockReset();
    anthropicCreateMock.mockReset();
    openaiConstructorArgs = [];
    anthropicConstructorArgs = [];
  });

  // -----------------------------------------------------------------------
  // constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('initializes OpenAI client when provider is openai with apiKey', () => {
      new LLMService({ provider: 'openai', openai: { apiKey: 'sk-test', model: 'gpt-4' } });
      expect(openaiConstructorArgs).toHaveLength(1);
      expect(openaiConstructorArgs[0]![0]).toEqual({ apiKey: 'sk-test', baseURL: undefined });
    });

    it('initializes Anthropic client when provider is anthropic with apiKey', () => {
      new LLMService({ provider: 'anthropic', anthropic: { apiKey: 'ant-test', model: 'claude-3' } });
      expect(anthropicConstructorArgs).toHaveLength(1);
      expect(anthropicConstructorArgs[0]![0]).toEqual({ apiKey: 'ant-test' });
    });

    it('does not initialize OpenAI when apiKey is missing', () => {
      new LLMService({ provider: 'openai' });
      expect(openaiConstructorArgs).toHaveLength(0);
    });

    it('does not initialize Anthropic when apiKey is missing', () => {
      new LLMService({ provider: 'anthropic' });
      expect(anthropicConstructorArgs).toHaveLength(0);
    });

    it('passes baseURL to Anthropic when provided', () => {
      new LLMService({
        provider: 'anthropic',
        anthropic: { apiKey: 'key', model: 'c3', baseURL: 'https://custom.api' },
      });
      expect(anthropicConstructorArgs[0]![0]).toEqual({ apiKey: 'key', baseURL: 'https://custom.api' });
    });

    it('accepts custom retry options', () => {
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4' } },
        { maxRetries: 5, initialDelay: 500 },
      );
      expect(svc).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // chat — OpenAI
  // -----------------------------------------------------------------------
  describe('chat — OpenAI', () => {
    let service: LLMService;
    beforeEach(() => {
      service = new LLMService(
        { provider: 'openai', openai: { apiKey: 'sk-test', model: 'gpt-4' } },
        { maxRetries: 0 },
      );
    });

    it('returns content and usage from OpenAI response', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hi there' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      const result = await service.chat(sampleMessages);
      expect(result.content).toBe('Hi there');
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it('returns undefined usage when OpenAI omits it', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'response' } }],
      });
      const result = await service.chat(sampleMessages);
      expect(result.usage).toBeUndefined();
    });

    it('throws when OpenAI returns empty choices', async () => {
      openaiCreateMock.mockResolvedValueOnce({ choices: [{}] });
      await expect(service.chat(sampleMessages)).rejects.toThrow('No response from OpenAI');
    });

    it('passes temperature and maxTokens to OpenAI', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });
      await service.chat(sampleMessages, { temperature: 0.5, maxTokens: 2000 });
      expect(openaiCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5, max_tokens: 2000 }),
      );
    });

    it('throws when OpenAI client not initialized', async () => {
      const svc = new LLMService({ provider: 'openai' }, { maxRetries: 0 });
      await expect(svc.chat(sampleMessages)).rejects.toThrow('OpenAI client not initialized');
    });
  });

  // -----------------------------------------------------------------------
  // chat — Anthropic
  // -----------------------------------------------------------------------
  describe('chat — Anthropic', () => {
    let service: LLMService;
    beforeEach(() => {
      service = new LLMService(
        { provider: 'anthropic', anthropic: { apiKey: 'ant-key', model: 'claude-3' } },
        { maxRetries: 0 },
      );
    });

    it('returns content and usage from Anthropic response', async () => {
      anthropicCreateMock.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello from Claude' }],
        usage: { input_tokens: 8, output_tokens: 4 },
      });
      const result = await service.chat(sampleMessages);
      expect(result.content).toBe('Hello from Claude');
      expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 4, totalTokens: 12 });
    });

    it('separates system message from user messages for Anthropic', async () => {
      anthropicCreateMock.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      await service.chat(sampleMessages);
      expect(anthropicCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('throws when Anthropic returns unexpected content type', async () => {
      anthropicCreateMock.mockResolvedValueOnce({
        content: [{ type: 'image', data: 'abc' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      await expect(service.chat(sampleMessages)).rejects.toThrow('Unexpected response type from Anthropic');
    });

    it('throws when Anthropic returns empty content', async () => {
      anthropicCreateMock.mockResolvedValueOnce({
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      await expect(service.chat(sampleMessages)).rejects.toThrow('Unexpected response type');
    });

    it('throws when Anthropic client not initialized', async () => {
      const svc = new LLMService({ provider: 'anthropic' }, { maxRetries: 0 });
      await expect(svc.chat(sampleMessages)).rejects.toThrow('Anthropic client not initialized');
    });
  });

  // -----------------------------------------------------------------------
  // chat — unsupported provider
  // -----------------------------------------------------------------------
  describe('chat — unsupported provider', () => {
    it('throws for unknown provider', async () => {
      const svc = new LLMService({ provider: 'unknown' as 'openai' }, { maxRetries: 0 });
      await expect(svc.chat(sampleMessages)).rejects.toThrow('Unsupported LLM provider');
    });
  });

  // -----------------------------------------------------------------------
  // retry logic
  // -----------------------------------------------------------------------
  describe('retry logic', () => {
    it('retries on rate limit error and succeeds', async () => {
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4' } },
        { maxRetries: 2, initialDelay: 1, maxDelay: 10, backoffMultiplier: 2 },
      );
      openaiCreateMock
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });

      const result = await svc.chat(sampleMessages);
      expect(result.content).toBe('ok');
      expect(openaiCreateMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-retryable errors', async () => {
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4' } },
        { maxRetries: 3, initialDelay: 1 },
      );
      openaiCreateMock.mockRejectedValueOnce(new Error('invalid_api_key'));
      await expect(svc.chat(sampleMessages)).rejects.toThrow('invalid_api_key');
      expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    });

    it('exhausts retries and throws last error', async () => {
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4' } },
        { maxRetries: 2, initialDelay: 1, maxDelay: 5, backoffMultiplier: 2 },
      );
      openaiCreateMock.mockRejectedValue(new Error('503 service unavailable'));
      await expect(svc.chat(sampleMessages)).rejects.toThrow('503 service unavailable');
      expect(openaiCreateMock).toHaveBeenCalledTimes(3);
    });

    it('retries on various retryable error patterns', async () => {
      for (const pattern of ['timeout', 'network error', 'econnreset', '429', '502']) {
        openaiCreateMock.mockReset();
        const svc = new LLMService(
          { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4' } },
          { maxRetries: 1, initialDelay: 1 },
        );
        openaiCreateMock
          .mockRejectedValueOnce(new Error(pattern))
          .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });
        const result = await svc.chat(sampleMessages);
        expect(result.content).toBe('ok');
      }
    });

    it('wraps non-Error thrown values', async () => {
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4' } },
        { maxRetries: 0 },
      );
      openaiCreateMock.mockRejectedValueOnce('string error');
      await expect(svc.chat(sampleMessages)).rejects.toThrow('string error');
    });
  });

  // -----------------------------------------------------------------------
  // analyzeImage — OpenAI
  // -----------------------------------------------------------------------
  describe('analyzeImage — OpenAI', () => {
    let service: LLMService;
    beforeEach(() => {
      service = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-4o' } },
        { maxRetries: 0 },
      );
    });

    it('sends base64 image to OpenAI vision model', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'I see a cat' } }],
      });
      const result = await service.analyzeImage('base64data', 'What is this?');
      expect(result).toBe('I see a cat');
    });

    it('reads file from disk when isFilePath is true', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'file image' } }],
      });
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('png-data'));
      const result = await service.analyzeImage('/path/to/image.png', 'describe', true);
      expect(result).toBe('file image');
      expect(readFile).toHaveBeenCalledWith('/path/to/image.png');
    });

    it('throws when model does not support vision', async () => {
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-3.5-turbo' } },
        { maxRetries: 0 },
      );
      await expect(svc.analyzeImage('data', 'what')).rejects.toThrow('does not support image analysis');
    });

    it('warns only once for non-vision model', async () => {
      const { logger } = await import('@utils/logger');
      const svc = new LLMService(
        { provider: 'openai', openai: { apiKey: 'k', model: 'gpt-3.5-turbo' } },
        { maxRetries: 0 },
      );
      await expect(svc.analyzeImage('d', 'p')).rejects.toThrow();
      await expect(svc.analyzeImage('d', 'p')).rejects.toThrow();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('returns empty string when response content is null', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });
      const result = await service.analyzeImage('data', 'test');
      expect(result).toBe('');
    });

    it('throws when OpenAI client not initialized for image analysis', async () => {
      const svc = new LLMService({ provider: 'openai' }, { maxRetries: 0 });
      await expect(svc.analyzeImage('d', 'p')).rejects.toThrow('OpenAI client not initialized');
    });
  });

  // -----------------------------------------------------------------------
  // analyzeImage — Anthropic
  // -----------------------------------------------------------------------
  describe('analyzeImage — Anthropic', () => {
    let service: LLMService;
    beforeEach(() => {
      service = new LLMService(
        { provider: 'anthropic', anthropic: { apiKey: 'k', model: 'claude-3-opus-20240229' } },
        { maxRetries: 0 },
      );
    });

    it('sends base64 image to Anthropic', async () => {
      anthropicCreateMock.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Anthropic sees a dog' }],
      });
      const result = await service.analyzeImage('base64data', 'What animal?');
      expect(result).toBe('Anthropic sees a dog');
    });

    it('returns empty when no text content block found', async () => {
      anthropicCreateMock.mockResolvedValueOnce({
        content: [{ type: 'image', data: 'something' }],
      });
      const result = await service.analyzeImage('data', 'test');
      expect(result).toBe('');
    });

    it('throws when Anthropic client not initialized for image analysis', async () => {
      const svc = new LLMService({ provider: 'anthropic' }, { maxRetries: 0 });
      await expect(svc.analyzeImage('d', 'p')).rejects.toThrow('Anthropic client not initialized');
    });
  });

  // -----------------------------------------------------------------------
  // analyzeImage — unsupported provider
  // -----------------------------------------------------------------------
  describe('analyzeImage — unsupported provider', () => {
    it('throws for unknown provider', async () => {
      const svc = new LLMService({ provider: 'other' as 'openai' }, { maxRetries: 0 });
      await expect(svc.analyzeImage('d', 'p')).rejects.toThrow('Unsupported LLM provider for image analysis');
    });
  });
});
