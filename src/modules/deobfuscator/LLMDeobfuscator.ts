/**
 * LLMDeobfuscator — uses MCP sampling delegation to enhance deobfuscation
 * with LLM-powered semantic analysis.
 *
 * This module leverages the connected client's LLM (via `sampling/createMessage`)
 * to perform tasks that rule-based engines struggle with, such as:
 * - Inferring meaningful variable names from obfuscated identifiers
 * - Suggesting function purposes from code patterns
 *
 * All methods gracefully degrade to `null` when sampling is unavailable.
 *
 * @module LLMDeobfuscator
 */

import type { LLMSamplingBridge } from '@server/LLMSamplingBridge';
import { logger } from '@utils/logger';

/** Maximum code snippet size sent to the LLM (chars) to avoid token overflow */
const MAX_CODE_SNIPPET = 2000;
/** Maximum number of identifiers to send in one request */
const MAX_IDENTIFIERS = 20;

export interface NameSuggestion {
  original: string;
  suggested: string;
  confidence: 'high' | 'medium' | 'low';
}

export class LLMDeobfuscator {
  constructor(private readonly bridge: LLMSamplingBridge) {}

  /**
   * Check if the underlying sampling bridge supports LLM delegation.
   */
  isAvailable(): boolean {
    return this.bridge.isSamplingSupported();
  }

  /**
   * Use the client's LLM to suggest meaningful names for obfuscated identifiers.
   *
   * @param code - The obfuscated code snippet (truncated to MAX_CODE_SNIPPET)
   * @param identifiers - Array of obfuscated identifier names to rename
   * @returns Map of old → new names, or `null` if sampling unavailable/failed
   */
  async suggestVariableNames(
    code: string,
    identifiers: string[],
  ): Promise<NameSuggestion[] | null> {
    if (!this.bridge.isSamplingSupported()) {
      logger.debug('LLMDeobfuscator: sampling not available, skipping name suggestion');
      return null;
    }

    const trimmedIds = identifiers.slice(0, MAX_IDENTIFIERS);
    const trimmedCode = code.slice(0, MAX_CODE_SNIPPET);

    const userMessage = [
      'Given this obfuscated JavaScript code, suggest meaningful variable/function names',
      `for these identifiers: ${trimmedIds.join(', ')}`,
      '',
      '```javascript',
      trimmedCode,
      '```',
      '',
      'Respond ONLY with a valid JSON array of objects with fields:',
      '  { "original": "<old_name>", "suggested": "<new_name>", "confidence": "high"|"medium"|"low" }',
      '',
      'Rules:',
      '- Use camelCase for variables/functions, PascalCase for classes',
      '- If uncertain, use confidence "low"',
      '- If the name is already meaningful, keep it and mark confidence "high"',
    ].join('\n');

    const result = await this.bridge.sampleText({
      systemPrompt:
        'You are an expert JavaScript reverse engineer. You specialize in deobfuscation and renaming obfuscated identifiers to semantically meaningful names. Output only valid JSON.',
      userMessage,
      maxTokens: 256,
      temperature: 0.3,
      modelHint: 'haiku', // Prefer fast, cost-effective model for this task
    });

    if (!result) return null;

    return this.parseNameSuggestions(result, trimmedIds);
  }

  /**
   * Use the client's LLM to infer the purpose of a function from its code.
   *
   * @param code - The function's code snippet
   * @returns A brief description of the function's purpose, or null
   */
  async inferFunctionPurpose(code: string): Promise<string | null> {
    if (!this.bridge.isSamplingSupported()) return null;

    const trimmedCode = code.slice(0, MAX_CODE_SNIPPET);

    const result = await this.bridge.sampleText({
      systemPrompt:
        'You are a JavaScript reverse engineer. Analyze code and describe its purpose in one concise sentence.',
      userMessage: `What does this function do?\n\n\`\`\`javascript\n${trimmedCode}\n\`\`\`\n\nRespond with a single sentence.`,
      maxTokens: 100,
      temperature: 0.2,
      modelHint: 'haiku',
    });

    return result?.trim() ?? null;
  }

  /**
   * Parse the LLM's JSON response into structured name suggestions.
   * Robust against malformed output.
   */
  private parseNameSuggestions(rawResponse: string, expectedIds: string[]): NameSuggestion[] {
    try {
      // Extract JSON array from the response (handle markdown code blocks)
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('LLMDeobfuscator: no JSON array found in LLM response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      if (!Array.isArray(parsed)) return [];

      const expectedSet = new Set(expectedIds);

      return parsed
        .filter(
          (item): item is { original: string; suggested: string; confidence: string } =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as Record<string, unknown>).original === 'string' &&
            typeof (item as Record<string, unknown>).suggested === 'string',
        )
        .filter((item) => expectedSet.has(item.original))
        .map((item) => ({
          original: item.original,
          suggested: item.suggested,
          confidence: (['high', 'medium', 'low'].includes(item.confidence)
            ? item.confidence
            : 'low') as 'high' | 'medium' | 'low',
        }));
    } catch (error) {
      logger.warn('LLMDeobfuscator: failed to parse LLM response:', error);
      return [];
    }
  }
}
