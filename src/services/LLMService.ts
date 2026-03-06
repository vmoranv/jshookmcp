import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import type { LLMConfig } from '@internal-types/index';
import { logger } from '@utils/logger';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

export class LLMService {
  private config: LLMConfig;
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private hasLoggedVisionModelWarning = false;
  private retryOptions: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };

  constructor(config: LLMConfig, retryOptions?: RetryOptions) {
    this.config = config;
    if (retryOptions) {
      this.retryOptions = { ...this.retryOptions, ...retryOptions };
    }
    this.initClients();
  }

  private initClients(): void {
    if (this.config.provider === 'openai' && this.config.openai?.apiKey) {
      this.openai = new OpenAI({
        apiKey: this.config.openai.apiKey,
        baseURL: this.config.openai.baseURL,
      });
      logger.info('OpenAI client initialized');
    }

    if (this.config.provider === 'anthropic' && this.config.anthropic?.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: this.config.anthropic.apiKey,
        ...(this.config.anthropic.baseURL ? { baseURL: this.config.anthropic.baseURL } : {}),
      });
      logger.info('Anthropic client initialized');
    }
  }

  async chat(
    messages: LLMMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      try {
        if (this.config.provider === 'openai') {
          return await this.chatOpenAI(messages, options);
        } else if (this.config.provider === 'anthropic') {
          return await this.chatAnthropic(messages, options);
        } else {
          throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
        }
      } finally {
        logger.debug(`LLM call completed in ${Date.now() - startTime}ms`);
      }
    });
  }

  async analyzeImage(imageInput: string, prompt: string, isFilePath = false): Promise<string> {
    return this.withRetry(async () => {
      const startTime = Date.now();
      try {
        let imageBase64: string;
        if (isFilePath) {
          logger.info('Reading image file:', imageInput);
          const imageBuffer = await readFile(imageInput);
          imageBase64 = imageBuffer.toString('base64');
          logger.info(`Image file read (${(imageBuffer.length / 1024).toFixed(2)} KB)`);
        } else {
          imageBase64 = imageInput;
        }

        if (this.config.provider === 'openai') {
          if (!this.openai) {
            throw new Error('OpenAI client not initialized');
          }

          const model = this.config.openai?.model || 'gpt-4-vision-preview';
          const isVisionModel =
            model.includes('vision') || model.includes('gpt-4o') || model.includes('gpt-4-turbo');

          if (!isVisionModel) {
            if (!this.hasLoggedVisionModelWarning) {
              logger.warn(
                `Model ${model} does not support vision. Use gpt-4-vision-preview, gpt-4o, or gpt-4-turbo.`
              );
              this.hasLoggedVisionModelWarning = true;
            }
            throw new Error(
              `Model ${model} does not support image analysis. ` +
                `Please use gpt-4-vision-preview, gpt-4o, or gpt-4-turbo.`
            );
          }

          logger.info('Using OpenAI Vision model:', model);

          const response = await this.openai.chat.completions.create({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${imageBase64}` },
                  },
                ],
              },
            ],
            max_tokens: 1000,
          });

          return response.choices[0]?.message?.content || '';
        } else if (this.config.provider === 'anthropic') {
          if (!this.anthropic) {
            throw new Error('Anthropic client not initialized');
          }

          const model = this.config.anthropic?.model || 'claude-3-opus-20240229';
          logger.info('Using Anthropic Vision model:', model);

          const response = await this.anthropic.messages.create({
            model,
            max_tokens: 1000,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: imageBase64,
                    },
                  },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          });

          const textContent = response.content.find(
            (c: unknown) => (c as { type: string }).type === 'text'
          ) as { text: string } | undefined;
          return textContent?.text || '';
        } else {
          throw new Error(`Unsupported LLM provider for image analysis: ${this.config.provider}`);
        }
      } finally {
        logger.debug(`Image analysis completed in ${Date.now() - startTime}ms`);
      }
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    let delay = this.retryOptions.initialDelay;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.shouldRetry(lastError) || attempt === this.retryOptions.maxRetries) {
          throw lastError;
        }

        logger.warn(
          `LLM call failed (attempt ${attempt + 1}/${this.retryOptions.maxRetries + 1}): ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * this.retryOptions.backoffMultiplier, this.retryOptions.maxDelay);
      }
    }

    throw lastError || new Error('Unknown error');
  }

  private shouldRetry(error: Error): boolean {
    const message = error.message.toLowerCase();
    const retryableErrors = [
      'rate limit',
      'timeout',
      'network',
      'econnreset',
      'enotfound',
      'etimedout',
      '429',
      '500',
      '502',
      '503',
      '504',
    ];
    return retryableErrors.some((pattern) => message.includes(pattern));
  }

  private async chatOpenAI(
    messages: LLMMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.openai.chat.completions.create({
      model: this.config.openai?.model || 'gpt-4-turbo-preview',
      messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No response from OpenAI');
    }

    return {
      content: choice.message.content,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  private async chatAnthropic(
    messages: LLMMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const systemMessage = messages.find((msg) => msg.role === 'system');
    const userMessages = messages.filter((msg) => msg.role !== 'system');

    const response = await this.anthropic.messages.create({
      model: this.config.anthropic?.model || 'claude-3-5-sonnet-20241022',
      max_tokens: options?.maxTokens ?? 4000,
      temperature: options?.temperature ?? 0.7,
      system: systemMessage?.content,
      messages: userMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    return {
      content: content.text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }
}
