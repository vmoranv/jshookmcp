/**
 * Fluent tool definition builder — replaces raw JSON nesting with chainable API.
 *
 * The public API stays fluent, but the implementation is immutable:
 * every builder method returns a new builder snapshot instead of mutating
 * instance fields in place.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type BuiltTool = Tool & {
  autocompleteHandlers?: Record<string, (value: string) => string[] | Promise<string[]>>;
  outputSchema?: Record<string, unknown>;
};

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

interface NumberOpts extends ParamOpts {
  minimum?: number;
  maximum?: number;
}

interface StringOpts extends ParamOpts {
  pattern?: string;
}

type AnnotationState = Readonly<{
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}>;

type BuilderState = Readonly<{
  name: string;
  description: string;
  properties: Readonly<Record<string, PropertySchema>>;
  required: readonly string[];
  annotations: AnnotationState;
  asyncTask: boolean;
  autocompleteHandlers: Readonly<Record<string, (value: string) => string[] | Promise<string[]>>>;
  outputSchema?: Record<string, unknown>;
}>;

export interface ToolBuilder {
  desc(description: string): this;
  string(name: string, description: string, opts?: StringOpts): this;
  number(name: string, description: string, opts?: NumberOpts): this;
  integer(name: string, description: string, opts?: NumberOpts): this;
  boolean(name: string, description: string, opts?: ParamOpts): this;
  enum(name: string, values: readonly string[], description: string, opts?: ParamOpts): this;
  array(name: string, items: PropertySchema | Record<string, unknown>, description: string): this;
  object(
    name: string,
    props: Record<string, PropertySchema>,
    description: string,
    opts?: { required?: string[] },
  ): this;
  prop(name: string, schema: PropertySchema): this;
  required(...names: string[]): this;
  requiredOpenWorld(...names: string[]): this;
  readOnly(): this;
  destructive(): this;
  idempotent(): this;
  openWorld(): this;
  query(): this;
  resettable(): this;
  asyncTask(): this;
  autocomplete(argName: string, handler: (value: string) => string[] | Promise<string[]>): this;
  outputSchema(schema: Record<string, unknown>): this;
}

type InternalToolBuilder = ToolBuilder & {
  build(): BuiltTool;
};
type BuilderTracker = { latest?: InternalToolBuilder };

function createInitialState(name: string): BuilderState {
  return {
    name,
    description: '',
    properties: {},
    required: [],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    asyncTask: false,
    autocompleteHandlers: {},
    outputSchema: undefined,
  };
}

function defaults(opts?: ParamOpts): Record<string, unknown> {
  if (opts?.default === undefined) return {};
  return { default: opts.default };
}

function withState(state: BuilderState, patch: Partial<BuilderState>): BuilderState {
  return {
    ...state,
    ...patch,
  };
}

function withProperty(state: BuilderState, name: string, schema: PropertySchema): BuilderState {
  return withState(state, {
    properties: {
      ...state.properties,
      [name]: schema,
    },
  });
}

function withRequiredNames(state: BuilderState, names: string[]): BuilderState {
  return withState(state, {
    required: [...state.required, ...names],
  });
}

function withAnnotations(state: BuilderState, patch: Partial<AnnotationState>): BuilderState {
  return withState(state, {
    annotations: {
      ...state.annotations,
      ...patch,
    },
  });
}

function buildTool(state: BuilderState): BuiltTool {
  return {
    name: state.name,
    description: state.description,
    inputSchema: {
      type: 'object' as const,
      properties: state.properties as unknown as Record<string, object>,
      ...(state.required.length > 0 ? { required: [...state.required] } : {}),
    },
    annotations: {
      readOnlyHint: state.annotations.readOnlyHint,
      destructiveHint: state.annotations.destructiveHint,
      idempotentHint: state.annotations.idempotentHint,
      openWorldHint: state.annotations.openWorldHint,
    },
    ...(state.asyncTask ? { execution: { taskSupport: 'optional' as const } } : {}),
    ...(Object.keys(state.autocompleteHandlers).length > 0
      ? { autocompleteHandlers: state.autocompleteHandlers }
      : {}),
    ...(state.outputSchema ? { outputSchema: state.outputSchema as any } : {}),
  };
}

function createBuilder(state: BuilderState, tracker?: BuilderTracker): InternalToolBuilder {
  const next = (updated: BuilderState): InternalToolBuilder => {
    const nextBuilder = createBuilder(updated, tracker);
    if (tracker) tracker.latest = nextBuilder;
    return nextBuilder;
  };

  const builder: InternalToolBuilder = {
    desc(description: string) {
      return next(withState(state, { description })) as InternalToolBuilder;
    },
    string(name: string, description: string, opts?: StringOpts) {
      const schema: PropertySchema = {
        type: 'string',
        description,
        ...defaults(opts),
      };
      if (opts?.pattern) {
        schema.pattern = opts.pattern;
      }
      return next(withProperty(state, name, schema)) as InternalToolBuilder;
    },
    number(name: string, description: string, opts?: NumberOpts) {
      const schema: PropertySchema = {
        type: 'number',
        description,
        ...defaults(opts),
      };
      if (opts?.minimum !== undefined) {
        schema.minimum = opts.minimum;
      }
      if (opts?.maximum !== undefined) {
        schema.maximum = opts.maximum;
      }
      return next(withProperty(state, name, schema)) as InternalToolBuilder;
    },
    integer(name: string, description: string, opts?: NumberOpts) {
      const schema: PropertySchema = {
        type: 'integer',
        description,
        ...defaults(opts),
      };
      if (opts?.minimum !== undefined) {
        schema.minimum = opts.minimum;
      }
      if (opts?.maximum !== undefined) {
        schema.maximum = opts.maximum;
      }
      return next(withProperty(state, name, schema)) as InternalToolBuilder;
    },
    boolean(name: string, description: string, opts?: ParamOpts) {
      return next(
        withProperty(state, name, {
          type: 'boolean',
          description,
          ...defaults(opts),
        }),
      ) as InternalToolBuilder;
    },
    enum(name: string, values: readonly string[], description: string, opts?: ParamOpts) {
      return next(
        withProperty(state, name, {
          type: 'string',
          enum: values,
          description,
          ...defaults(opts),
        }),
      ) as InternalToolBuilder;
    },
    array(name: string, items: PropertySchema | Record<string, unknown>, description: string) {
      return next(
        withProperty(state, name, {
          type: 'array',
          items,
          description,
        }),
      ) as InternalToolBuilder;
    },
    object(
      name: string,
      props: Record<string, PropertySchema>,
      description: string,
      opts?: { required?: string[] },
    ) {
      return next(
        withProperty(state, name, {
          type: 'object',
          properties: props,
          description,
          ...(opts?.required ? { required: opts.required } : {}),
        }),
      ) as InternalToolBuilder;
    },
    prop(name: string, schema: PropertySchema) {
      return next(withProperty(state, name, schema)) as InternalToolBuilder;
    },
    required(...names: string[]) {
      return next(withRequiredNames(state, names)) as InternalToolBuilder;
    },
    requiredOpenWorld(...names: string[]) {
      return this.required(...names).openWorld();
    },
    readOnly() {
      return next(withAnnotations(state, { readOnlyHint: true })) as InternalToolBuilder;
    },
    destructive() {
      return next(withAnnotations(state, { destructiveHint: true })) as InternalToolBuilder;
    },
    idempotent() {
      return next(withAnnotations(state, { idempotentHint: true })) as InternalToolBuilder;
    },
    openWorld() {
      return next(withAnnotations(state, { openWorldHint: true })) as InternalToolBuilder;
    },
    query() {
      return this.readOnly().idempotent();
    },
    resettable() {
      return this.destructive().idempotent();
    },
    asyncTask() {
      return next(withState(state, { asyncTask: true })) as InternalToolBuilder;
    },
    autocomplete(argName: string, handler: (value: string) => string[] | Promise<string[]>) {
      return next(
        withState(state, {
          autocompleteHandlers: {
            ...state.autocompleteHandlers,
            [argName]: handler,
          },
        }),
      ) as InternalToolBuilder;
    },
    outputSchema(schema: Record<string, unknown>) {
      return next(withState(state, { outputSchema: schema })) as InternalToolBuilder;
    },
    build() {
      return buildTool(state);
    },
  };

  if (tracker && !tracker.latest) tracker.latest = builder;
  return builder;
}

type ToolBuilderConfigurator = (builder: ToolBuilder) => ToolBuilder | void;

/** Create a new tool definition with fluent builder API. */
export function tool(name: string, configure: ToolBuilderConfigurator): BuiltTool {
  const tracker: BuilderTracker = {};
  const builder = createBuilder(createInitialState(name), tracker);
  const configured = configure(builder);
  return ((configured as InternalToolBuilder | undefined) ?? tracker.latest ?? builder).build();
}
