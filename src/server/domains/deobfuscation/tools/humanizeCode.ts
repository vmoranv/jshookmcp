import { z } from 'zod';
import { ToolArgs } from '@server/types';
import { logger } from '@utils/logger';
import OpenAI from 'openai';
import { HuggingFaceTransformers } from '@huggingface/transformers';
import { groq } from 'groq-sdk';
import { RateLimiter } from 'limiter';

interface HumanizeResult {
  code: string;
  suggestions: string[];
  model: string;
}

export class HumanizeCodeTool {
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly hfTransformers: HuggingFaceTransformers = new HuggingFaceTransformers(),
    private readonly openai: OpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    private readonly groqClient: groq = new groq({ apiKey: process.env.GROQ_API_KEY }),
  ) {
    this.rateLimiter = new RateLimiter({
      tokensPerInterval: 10,
      interval: 'minute',
      fireImmediately: true,
    });
  }

  async execute(args: ToolArgs): Promise<{
    humanizedCode: string;
    suggestions: string[];
    modelConsensus: Record<string, HumanizeResult>;
  }> {
    const { code, models = ['openai'], aggressiveness = 5 } = args.input as {
      code: string;
      models: string[];
      aggressiveness: number;
    };

    try {
      const results = await Promise.allSettled(
        models.map(model => this.humanizeWithModel(code, model, aggressiveness))
      );

      const successfulResults = results
        .filter((result): result is PromiseFulfilledResult<HumanizeResult> => result.status === 'fulfilled')
        .map(result => result.value);

      if (successfulResults.length === 0) {
        throw new Error('All humanization models failed');
      }

      // Consensus: Use the first model's result (or implement voting logic)
      const primaryResult = successfulResults[0];
      return {
        humanizedCode: primaryResult.code,
        suggestions: successfulResults.flatMap(r => r.suggestions),
        modelConsensus: successfulResults.reduce((acc, r) => ({ ...acc, [r.model]: r }), {}),
      };
    } catch (error) {
      const errorDetails = {
        error: 'HumanizationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: {
          codePreview: code.substring(0, 500),
          models,
          aggressiveness,
        },
      };
      logger.error(`Humanization failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  private async humanizeWithModel(
    code: string,
    model: string,
    aggressiveness: number
  ): Promise<HumanizeResult> {
    switch (model) {
      case 'openai':
        return this.humanizeWithOpenAI(code, aggressiveness);
      case 'huggingface':
        return this.humanizeWithHuggingFace(code, aggressiveness);
      case 'grok':
        return this.humanizeWithGroq(code, aggressiveness);
      default:
        throw new Error(`Unsupported model: ${model}`);
    }
  }

  private async humanizeWithOpenAI(code: string, aggressiveness: number): Promise<HumanizeResult> {
    await this.rateLimiter.removeTokens(1);
    const prompt = this.buildHumanizationPrompt(code, aggressiveness);
    
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a senior JavaScript developer. Refactor the following deobfuscated code to be human-readable, idiomatic, and well-commented. Include actionable suggestions for further improvements after the code block in a SUGGESTIONS section.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const result = response.choices[0].message.content || '';
      const suggestions = this.extractSuggestions(result);
      return {
        code: result.replace(/SUGGESTIONS:.+/s, ''),
        suggestions,
        model: 'openai',
      };
    } catch (error) {
      logger.warn(`OpenAI failed, falling back to HuggingFace: ${error}`);
      return this.humanizeWithHuggingFace(code, aggressiveness);
    }
  }

  private async humanizeWithHuggingFace(code: string, aggressiveness: number): Promise<HumanizeResult> {
    await this.rateLimiter.removeTokens(1);
    const prompt = this.buildHumanizationPrompt(code, aggressiveness);
    const result = await this.hfTransformers.generateText({
      prompt,
      maxLength: 2048,
    });

    const suggestions = this.extractSuggestions(result);
    return {
      code: result.replace(/SUGGESTIONS:.+/s, ''),
      suggestions,
      model: 'huggingface',
    };
  }

  private async humanizeWithGroq(code: string, aggressiveness: number): Promise<HumanizeResult> {
    await this.rateLimiter.removeTokens(1);
    const prompt = this.buildHumanizationPrompt(code, aggressiveness);
    const response = await this.groqClient.chat.completions.create({
      model: 'mixtral-8x7b-32768',
      messages: [
        {
          role: 'system',
          content: 'You are a senior JavaScript developer. Refactor the following deobfuscated code to be human-readable, idiomatic, and well-commented. Include actionable suggestions for further improvements after the code block in a SUGGESTIONS section.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const result = response.choices[0].message.content || '';
    const suggestions = this.extractSuggestions(result);
    return {
      code: result.replace(/SUGGESTIONS:.+/s, ''),
      suggestions,
      model: 'grok',
    };
  }

  private extractSuggestions(text: string): string[] {
    const suggestionMatch = text.match(/SUGGESTIONS:(.+)/s);
    if (!suggestionMatch) return [];
    return suggestionMatch[1].split('\n').filter(s => s.trim());
  }

  private buildHumanizationPrompt(code: string, aggressiveness: number): string {
    return `
Refactor this deobfuscated JavaScript code to be human-readable, idiomatic, and well-commented.
Follow these rules:
1. Rename variables/functions to descriptive names (e.g., "a" → "userInput").
2. Add JSDoc comments for functions and classes.
3. Split large functions into smaller, modular ones.
4. Use modern ES6+ syntax (e.g., arrow functions, destructuring).
5. Aggressiveness: ${aggressiveness}/10 (higher = more aggressive refactoring).
6. Preserve original functionality.
7. After the refactored code, add a SUGGESTIONS section with actionable improvements.

Code:
\`\`\`javascript
${code}
\`\`\`
`;
  }
}