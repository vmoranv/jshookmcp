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
import type {
  McpServer,
  ElicitRequestFormParams,
  PrimitiveSchemaDefinition,
} from '@modelcontextprotocol/server';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { logger } from '@utils/logger';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { readEnvNullableString } from '@src/config/environment';

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

/** One pending input request inside an InputRequiredResult suspension (MRTR). */
export interface InputRequiredRequest {
  type: 'form';
  message: string;
  requestedSchema: ElicitRequestFormParams['requestedSchema'];
}

/**
 * MRTR-style suspension envelope — returned by tools that need input when the
 * connected client cannot elicit inline. The client completes the flow by
 * re-calling the tool with `resumeToken` (= requestState) and the responses.
 */
export interface InputRequiredSuspension {
  resultType: 'input_required';
  inputRequests: InputRequiredRequest[];
  requestState: string;
  instruction?: string;
}

/** Decrypted payload of a requestState token. */
export interface RequestStateContents<T = Record<string, unknown>> {
  kind: string;
  data: T;
}

// ── Encrypted requestState codec (AES-256-GCM) ──

let processStateKey: Buffer | null = null;

/**
 * Server-side key material for requestState tokens. `MCP_REQUEST_STATE_SECRET`
 * (>= 16 chars) enables multi-instance deployments; otherwise a per-process
 * random key is used — tokens are round-trip state, not persistent storage,
 * so a process restart invalidating outstanding tokens is acceptable.
 */
function getRequestStateKey(): Buffer {
  const envSecret = readEnvNullableString('MCP_REQUEST_STATE_SECRET');
  if (envSecret && envSecret.length >= 16) {
    return createHash('sha256').update(envSecret).digest();
  }
  if (!processStateKey) {
    processStateKey = randomBytes(32);
  }
  return processStateKey;
}

export class ElicitationBridge {
  private readonly mcpServer: McpServer;
  constructor(mcpServer: McpServer) {
    this.mcpServer = mcpServer;
  }

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
      // getToolRequestContext() returns null outside a tool-call execution
      // (e.g. invoked from a background task) — resolve the request id
      // defensively before deciding whether to route the reply back.
      const requestContext = getToolRequestContext();
      const requestId = requestContext?.requestId ?? null;
      const result =
        requestId === null
          ? await this.mcpServer.server.elicitInput(params)
          : await this.mcpServer.server.elicitInput(params, {
              relatedRequestId: requestId,
            });

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

  // ── MRTR (InputRequiredResult) support ──

  /**
   * Encrypt an arbitrary state payload into an opaque `requestState` token.
   * The token round-trips through the client without the client being able to
   * read or tamper with it (AES-256-GCM). Tokens expire after `ttlMs`
   * (default 10 minutes).
   */
  createRequestState<T extends Record<string, unknown>>(
    data: T,
    opts: { ttlMs?: number; kind?: string } = {},
  ): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', getRequestStateKey(), iv);
    const plaintext = Buffer.from(
      JSON.stringify({
        kind: opts.kind ?? 'generic',
        exp: Date.now() + (opts.ttlMs ?? 10 * 60_000),
        data,
      }),
      'utf8',
    );
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Decrypt and verify a `requestState` token produced by
   * {@link createRequestState}. Returns `null` for tampered, malformed or
   * expired tokens — callers treat that as "suspension no longer resumable".
   */
  readRequestState<T extends Record<string, unknown> = Record<string, unknown>>(
    token: string,
  ): RequestStateContents<T> | null {
    try {
      const [version, ivB64, tagB64, ctB64] = token.split('.');
      if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) return null;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        getRequestStateKey(),
        Buffer.from(ivB64, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64url')),
        decipher.final(),
      ]);
      const parsed = JSON.parse(plaintext.toString('utf8')) as {
        kind: string;
        exp: number;
        data: T;
      };
      if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
      return { kind: parsed.kind, data: parsed.data };
    } catch {
      return null;
    }
  }

  /**
   * Build an MRTR-style `InputRequiredResult` suspension envelope. Embeds the
   * form params + caller context into the encrypted requestState so the flow
   * can resume on a later tool call without trusting client-side storage.
   */
  buildInputRequiredSuspension(
    formParams: ElicitRequestFormParams,
    state: Record<string, unknown> = {},
    opts: { ttlMs?: number; kind?: string; instruction?: string } = {},
  ): InputRequiredSuspension {
    const requestState = this.createRequestState(
      { formParams, ...state },
      { ttlMs: opts.ttlMs ?? 10 * 60_000, kind: opts.kind ?? 'input_required' },
    );
    return {
      resultType: 'input_required',
      inputRequests: [
        {
          type: 'form',
          message: formParams.message,
          requestedSchema: formParams.requestedSchema,
        },
      ],
      requestState,
      ...(opts.instruction ? { instruction: opts.instruction } : {}),
    };
  }

  /** True when a tool response is an {@link InputRequiredSuspension} envelope. */
  isInputRequiredSuspension(response: ToolResponse): boolean {
    try {
      const parsed = R.parse<Record<string, unknown>>(response);
      return parsed['resultType'] === 'input_required';
    } catch {
      return false;
    }
  }

  /**
   * Wrap a suspension envelope into a ToolResponse.
   */
  suspensionToResponse(suspension: InputRequiredSuspension): ToolResponse {
    return R.ok()
      .merge({ ...suspension })
      .json();
  }

  /**
   * Decrypt a requestState token for a resuming tool call.
   * Returns the original form params plus the caller-embedded state, or null.
   */
  resumeFromState<T extends Record<string, unknown> = Record<string, unknown>>(
    token: string,
    expectedKind?: string,
  ): { formParams: ElicitRequestFormParams; state: RequestStateContents<T> } | null {
    const contents = this.readRequestState<{ formParams?: ElicitRequestFormParams } & T>(token);
    if (!contents) return null;
    if (expectedKind && contents.kind !== expectedKind) return null;
    if (!contents.data?.formParams) return null;
    const { formParams, ...rest } = contents.data;
    return { formParams: formParams!, state: { ...contents, data: rest as T } };
  }

  /**
   * MRTR-style suspend-and-resume wrapper (plan Task 3.1 API).
   *
   * - Client supports elicitation: sends the form inline and resumes
   *   `executor` with the responses; decline/dismiss fails the response.
   * - Client does NOT support elicitation: returns an InputRequiredResult
   *   suspension envelope carrying an encrypted requestState — the flow is
   *   resumed later by re-calling the tool with `resumeToken`.
   */
  async requestInputAndAwait(
    formParams: ElicitRequestFormParams,
    executor: (
      responses: Record<string, unknown>,
      result: ElicitationResult,
    ) => Promise<ToolResponse>,
    opts: {
      stateTtlMs?: number;
      stateKind?: string;
      instruction?: string;
      /** Extra context embedded (encrypted) into the requestState for the resuming call. */
      state?: Record<string, unknown>;
    } = {},
  ): Promise<ToolResponse> {
    const result = await this.requestFormInput(formParams);

    if (result) {
      if (result.action !== 'accept') {
        return R.fail(`Input request was ${result.action}d by the user.`)
          .set('inputResult', result.action)
          .json();
      }
      return executor(result.content ?? {}, result);
    }

    return this.suspensionToResponse(
      this.buildInputRequiredSuspension(formParams, opts.state ?? {}, {
        ttlMs: opts.stateTtlMs,
        kind: opts.stateKind,
        instruction: opts.instruction,
      }),
    );
  }
}
