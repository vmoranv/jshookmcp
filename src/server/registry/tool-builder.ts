/**
 * Fluent tool definition builder — replaces raw JSON nesting with chainable API.
 *
 * Usage:
 *   tool('memory_first_scan')
 *     .desc('Start a new memory scan session')
 *     .number('pid', 'Target process ID')
 *     .string('value', 'Search value')
 *     .required('pid', 'value')
 *     .openWorld()
 *     .build()
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

interface PropertySchema {
  type?: JsonSchemaType;
  description?: string;
  default?: unknown;
  enum?: readonly string[];
  items?: PropertySchema | Record<string, unknown>;
  properties?: Record<string, PropertySchema>;
  required?: string[];
  [key: string]: unknown;
}

interface ParamOpts {
  default?: unknown;
}

class ToolBuilder {
  private readonly _name: string;
  private _description = '';
  private readonly _properties: Record<string, PropertySchema> = {};
  private readonly _required: string[] = [];
  private _readOnlyHint = false;
  private _destructiveHint = false;
  private _idempotentHint = false;
  private _openWorldHint = false;

  constructor(name: string) {
    this._name = name;
  }

  desc(description: string): this {
    this._description = description;
    return this;
  }

  // ── Typed param shortcuts ──

  string(name: string, description: string, opts?: ParamOpts): this {
    this._properties[name] = { type: 'string', description, ...this.defaults(opts) };
    return this;
  }

  number(name: string, description: string, opts?: ParamOpts): this {
    this._properties[name] = { type: 'number', description, ...this.defaults(opts) };
    return this;
  }

  integer(name: string, description: string, opts?: ParamOpts): this {
    this._properties[name] = { type: 'integer', description, ...this.defaults(opts) };
    return this;
  }

  boolean(name: string, description: string, opts?: ParamOpts): this {
    this._properties[name] = { type: 'boolean', description, ...this.defaults(opts) };
    return this;
  }

  enum(name: string, values: readonly string[], description: string, opts?: ParamOpts): this {
    this._properties[name] = {
      type: 'string',
      enum: values,
      description,
      ...this.defaults(opts),
    };
    return this;
  }

  array(name: string, items: PropertySchema | Record<string, unknown>, description: string): this {
    this._properties[name] = { type: 'array', items, description };
    return this;
  }

  object(
    name: string,
    props: Record<string, PropertySchema>,
    description: string,
    opts?: { required?: string[] },
  ): this {
    this._properties[name] = {
      type: 'object',
      properties: props,
      description,
      ...(opts?.required ? { required: opts.required } : {}),
    };
    return this;
  }

  /** Add a raw JSON schema property (escape hatch for complex schemas). */
  prop(name: string, schema: PropertySchema): this {
    this._properties[name] = schema;
    return this;
  }

  // ── Constraints ──

  required(...names: string[]): this {
    this._required.push(...names);
    return this;
  }

  // ── Annotation shortcuts (default = false) ──

  readOnly(): this {
    this._readOnlyHint = true;
    return this;
  }

  destructive(): this {
    this._destructiveHint = true;
    return this;
  }

  idempotent(): this {
    this._idempotentHint = true;
    return this;
  }

  openWorld(): this {
    this._openWorldHint = true;
    return this;
  }

  // ── Build ──

  build(): Tool {
    const result: Tool = {
      name: this._name,
      description: this._description,
      inputSchema: {
        type: 'object' as const,
        properties: this._properties as unknown as Record<string, object>,
        ...(this._required.length > 0 ? { required: this._required } : {}),
      },
      annotations: {
        readOnlyHint: this._readOnlyHint,
        destructiveHint: this._destructiveHint,
        idempotentHint: this._idempotentHint,
        openWorldHint: this._openWorldHint,
      },
    };
    return result;
  }

  // ── Internal ──

  private defaults(opts?: ParamOpts): Record<string, unknown> {
    if (opts?.default === undefined) return {};
    return { default: opts.default };
  }
}

/** Create a new tool definition with fluent builder API. */
export function tool(name: string): ToolBuilder {
  return new ToolBuilder(name);
}
