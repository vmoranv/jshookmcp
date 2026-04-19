import type { ToolResponse } from '@server/types';
import type {
  ImageContent,
  EmbeddedResource,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';

export type { ToolResponse };

/**
 * Fluent builder for MCP tool responses.
 *
 * Replaces the verbose 14-line deep-nesting pattern:
 * ```
 * return { content: [{ type: 'text', text: JSON.stringify({...}, null, 2) }] };
 * ```
 *
 * With a chainable API:
 * ```
 * return R.ok().set('driver', 'chrome').json();
 * ```
 */
export class ResponseBuilder {
  private payload: Record<string, unknown> = {};
  private _isError = false;
  private _additionalContent: (ImageContent | EmbeddedResource)[] = [];
  private _useStructured = false;

  /** Mark as success (sets `success: true`). */
  ok(): this {
    this.payload.success = true;
    return this;
  }

  /** Mark as failure (sets `success: false, error: <message>, message: <message>`). */
  fail(error: unknown): this {
    this.payload.success = false;
    const msg = error instanceof Error ? error.message : String(error);
    this.payload.error = msg;
    this.payload.message = msg;
    return this;
  }

  /** Set a single key-value pair. */
  set(key: string, value: unknown): this {
    this.payload[key] = value;
    return this;
  }

  /** Merge multiple fields at once. */
  merge(fields: Record<string, unknown>): this {
    Object.assign(this.payload, fields);
    return this;
  }

  /** Set MCP-level `isError: true` on the response envelope. */
  mcpError(): this {
    this._isError = true;
    return this;
  }

  /** Push an image block to the final response. */
  image(base64: string, mimeType: string): this {
    this._additionalContent.push({
      type: 'image',
      data: base64,
      mimeType,
    });
    return this;
  }

  /** Push an embedded resource block to the final response. */
  embeddedResource(uri: string, text: string, mimeType = 'text/plain'): this {
    this._additionalContent.push({
      type: 'resource',
      resource: {
        uri,
        text,
        mimeType,
      },
    });
    return this;
  }

  /** Send output payload natively as `structuredContent` in the MCP envelope instead of stringifying inside text block. */
  structured(): this {
    this._useStructured = true;
    return this;
  }

  /**
   * Build the ToolResponse. Handles text vs structured plus extra blocks.
   * Optionally merges extra fields before building.
   */
  json(fields?: Record<string, unknown>): ToolResponse {
    if (fields) {
      this.merge(fields);
    }
    const textContent: TextContent = { type: 'text', text: JSON.stringify(this.payload, null, 2) };
    const content = [textContent, ...this._additionalContent];

    return {
      content,
      ...(this._isError ? { isError: true } : {}),
      ...(this._useStructured ? { structuredContent: this.payload } : {}),
    } as ToolResponse;
  }

  /** Alias for json(). */
  build(fields?: Record<string, unknown>): ToolResponse {
    return this.json(fields);
  }

  /** Build a ToolResponse from an arbitrary value (no success/error wrapper). */
  static raw(data: unknown): ToolResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  /**
   * Build a ToolResponse from a plain text string.
   * Setting `isError = true` returns a soft error for macro compatibility
   * without triggering a JSON-RPC ErrorCode.
   */
  static text(text: string, isError = false): ToolResponse {
    return {
      content: [{ type: 'text', text }],
      ...(isError ? { isError: true } : {}),
    };
  }

  /**
   * Safely extract and parse JSON from an MCP ToolResponse.
   * Useful for consuming tool results in workflow/orchestration logic.
   */
  static parse<T = any>(response: ToolResponse): T {
    if (!response.content || response.content.length === 0) {
      throw new Error('ToolResponse has no content');
    }
    const textBlock = response.content.find((c) => c.type === 'text');
    if (!textBlock || !('text' in textBlock)) {
      throw new Error('ToolResponse has no text content block');
    }
    try {
      return JSON.parse(textBlock.text) as T;
    } catch (e) {
      throw new Error(
        `Failed to parse tool result as JSON: ${String(e)}\nRaw text: ${textBlock.text.substring(0, 500)}`,
        { cause: e },
      );
    }
  }
}

/** Shorthand factory — the primary entry point for building responses. */
export const R = {
  /** Start a success response (`{ success: true, ... }`). */
  ok: () => new ResponseBuilder().ok(),
  /** Start a failure response (`{ success: false, error: "..." }`). */
  fail: (error: unknown) => new ResponseBuilder().fail(error),
  /** Wrap an existing object as-is (no success/error wrapper). */
  raw: (data: unknown) => ResponseBuilder.raw(data),
  /** Wrap a plain text string. */
  text: (text: string, isError = false) => ResponseBuilder.text(text, isError),
  /** Parse a response back into an object. */
  parse: <T = any>(response: ToolResponse) => ResponseBuilder.parse<T>(response),
};
