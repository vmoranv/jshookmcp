/**
 * ElicitationBridge — thin wrapper over MCP `elicitation/create` that allows
 * jshookmcp server-side tool handlers to request interactive user input
 * from the connected client.
 *
 * Primary use case: pausing automation when a CAPTCHA is detected,
 * prompting the user to solve it, then resuming.
 *
 * Both `form` and `url` elicitation modes are supported.
 *
 * @module ElicitationBridge
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ElicitRequestFormParams,
  PrimitiveSchemaDefinition,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@utils/logger';

/** Result of an elicitation request */
export interface ElicitationResult {
  /**
   * The user's action:
   * - 'accept': User submitted the form / completed the URL flow
   * - 'decline': User declined to provide input
   * - 'dismiss': User dismissed the elicitation dialog
   */
  action: 'accept' | 'decline' | 'dismiss';
  /** Form field values (only present when action === 'accept' and mode === 'form') */
  content?: Record<string, unknown>;
}

export class ElicitationBridge {
  constructor(private readonly mcpServer: McpServer) {}

  /**
   * Check whether the connected client has declared `capabilities.elicitation`.
   */
  isElicitationSupported(): boolean {
    try {
      const caps = this.mcpServer.server.getClientCapabilities();
      return !!caps?.elicitation;
    } catch {
      return false;
    }
  }

  /**
   * Request user input via a form-based elicitation dialog.
   *
   * Uses the SDK's `PrimitiveSchemaDefinition` union:
   * - `{ type: 'string', title?, description?, default? }`
   * - `{ type: 'number' | 'integer', title?, description?, default? }`
   * - `{ type: 'boolean', title?, description?, default? }`
   * - `{ type: 'string', enum: string[], title?, description?, default? }`
   *
   * Returns the user's response, or `null` if elicitation is not supported.
   * Never throws — designed for graceful degradation.
   */
  async requestFormInput(params: ElicitRequestFormParams): Promise<ElicitationResult | null> {
    if (!this.isElicitationSupported()) {
      logger.debug('Elicitation not supported by connected client');
      return null;
    }

    try {
      const result = await this.mcpServer.server.elicitInput(params);

      return {
        action: result.action as 'accept' | 'decline' | 'dismiss',
        content: result.content as Record<string, unknown> | undefined,
      };
    } catch (error) {
      logger.warn('Elicitation request failed:', error);
      return null;
    }
  }

  /**
   * Convenience: request a simple confirmation from the user.
   *
   * @param message - The question to ask
   * @returns true if accepted, false if declined/dismissed/unsupported
   */
  async requestConfirmation(message: string): Promise<boolean> {
    const result = await this.requestFormInput({
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          confirmed: {
            type: 'boolean',
            description: 'Confirm this action',
            title: 'Confirm',
            default: true,
          } satisfies PrimitiveSchemaDefinition,
        },
        required: ['confirmed'],
      },
    });

    return result?.action === 'accept' && result.content?.confirmed === true;
  }

  /**
   * Request CAPTCHA solution from the user.
   *
   * @param captchaUrl - URL of the page with the CAPTCHA
   * @param captchaType - Type of CAPTCHA detected (e.g., 'reCAPTCHA', 'hCaptcha', 'Cloudflare')
   * @returns The user's input (or null if not supported / declined)
   */
  async requestCaptchaSolution(
    captchaUrl: string,
    captchaType: string,
  ): Promise<{ solved: boolean; token?: string } | null> {
    const result = await this.requestFormInput({
      message: [
        `🛡️ CAPTCHA detected: **${captchaType}**`,
        '',
        `Page: ${captchaUrl}`,
        '',
        'Please solve the CAPTCHA in your browser, then confirm completion below.',
        'If a token/response was generated, paste it in the token field.',
      ].join('\n'),
      requestedSchema: {
        type: 'object',
        properties: {
          solved: {
            type: 'boolean',
            description: 'Have you solved the CAPTCHA?',
            title: 'CAPTCHA Solved',
            default: false,
          } satisfies PrimitiveSchemaDefinition,
          token: {
            type: 'string',
            description: 'CAPTCHA response token (if available)',
            title: 'Response Token',
          } satisfies PrimitiveSchemaDefinition,
        },
        required: ['solved'],
      },
    });

    if (!result || result.action !== 'accept') return null;

    return {
      solved: result.content?.solved === true,
      token: typeof result.content?.token === 'string' ? result.content.token : undefined,
    };
  }
}
