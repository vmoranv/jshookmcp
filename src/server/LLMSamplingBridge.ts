/**
 * LLMSamplingBridge — thin wrapper over MCP `sampling/createMessage` that allows
 * jshookmcp server-side tool handlers to delegate LLM inference back to the
 * connected client.
 *
 * Usage:
 *   const bridge = new LLMSamplingBridge(mcpServer);
 *   if (bridge.isSamplingSupported()) {
 *     const result = await bridge.sampleText({
 *       systemPrompt: 'You are a JS reverse engineer.',
 *       userMessage: 'Suggest meaningful names for: _0x1a2b, _0x3c4d',
 *       maxTokens: 256,
 *     });
 *   }
 *
 * @module LLMSamplingBridge
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '@utils/logger';

export interface SampleTextParams {
  /** System-level instruction for the LLM */
  systemPrompt: string;
  /** The user message / query to send */
  userMessage: string;
  /** Maximum tokens to generate (default: 512) */
  maxTokens?: number;
  /** Optional model hint (substring match, e.g. 'sonnet', 'haiku') */
  modelHint?: string;
  /** Temperature for sampling (default: omitted → client decides) */
  temperature?: number;
}

export class LLMSamplingBridge {
  constructor(private readonly mcpServer: McpServer) {}

  /**
   * Check whether the connected client has declared `capabilities.sampling`.
   * Returns false before initialization completes or if the client doesn't support sampling.
   */
  isSamplingSupported(): boolean {
    try {
      const caps = this.mcpServer.server.getClientCapabilities();
      return !!caps?.sampling;
    } catch {
      return false;
    }
  }

  /**
   * Request a one-shot text completion from the client's LLM.
   *
   * Returns the text response, or `null` if:
   * - The client doesn't support sampling
   * - The request fails for any reason
   *
   * This method NEVER throws — it is designed for graceful degradation.
   */
  async sampleText(params: SampleTextParams): Promise<string | null> {
    if (!this.isSamplingSupported()) {
      logger.debug('Sampling not supported by connected client, skipping LLM delegation');
      return null;
    }

    try {
      const result = await this.mcpServer.server.createMessage({
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: params.userMessage },
          },
        ],
        systemPrompt: params.systemPrompt,
        maxTokens: params.maxTokens ?? 512,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.modelHint
          ? {
              modelPreferences: {
                hints: [{ name: params.modelHint }],
                intelligencePriority: 0.8,
                speedPriority: 0.7,
                costPriority: 0.3,
              },
            }
          : {}),
      });

      // Extract text from the response content
      const content = result.content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map((block) => block.text);
        return textParts.length > 0 ? textParts.join('') : null;
      }

      // Single content block (backward compat)
      if (content && typeof content === 'object' && 'type' in content && content.type === 'text') {
        return (content as { type: 'text'; text: string }).text;
      }

      logger.warn('sampling/createMessage returned non-text content');
      return null;
    } catch (error) {
      logger.warn('LLM sampling request failed:', error);
      return null;
    }
  }
}
