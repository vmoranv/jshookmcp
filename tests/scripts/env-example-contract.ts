import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
// TS 7.0 ships no compiler API; parse with the project's own Babel toolchain.
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;

const TYPED_READER_NAMES = new Set([
  'autoInt',
  'bool',
  'csv',
  'float',
  'int',
  'list',
  'readEnvBoolean',
  'readEnvCsv',
  'readEnvFloat',
  'readEnvInteger',
  'readEnvIntegerList',
  'readEnvNullableString',
  'readEnvString',
  'str',
]);

const CONFIG_FALLBACK_HELPERS = new Set([
  'envBool',
  'envFloat',
  'envInt',
  'envString',
  'positiveEnvInt',
  'ratioEnvFloat',
]);

const CONFIG_EFFECTIVE_DEFAULTS = new Map<string, string>([
  ['MCP_TRANSPORT', 'stdio'],
  ['MCP_LOG_LEVEL', 'info'],
  ['MCP_TOOL_PROFILE', 'search'],
  ['MCP_BROWSER_FLEET_WORKERS_JSON', '[{"id":"local"}]'],
  ['SEARCH_VECTOR_ENABLED', 'true'],
  ['SEARCH_VECTOR_MODEL_ID', 'minishlab/potion-code-16M-v2'],
  ['MCP_PLUGIN_SIGNATURE_REQUIRED', 'false'],
  ['MCP_PLUGIN_STRICT_LOAD', 'false'],
  ['JSHOOK_OBSERVABILITY_EXPORTER', 'otlp'],
  ['JSHOOK_OTLP_QUERY_TEXT', 'truncated'],
  ['JSHOOK_OTLP_TOOL_ARGS', 'shape'],
]);

export interface StaticEnvironmentDefault {
  key: string;
  value?: string;
  expression: string;
  file: string;
  reader: string;
  nullable: boolean;
}

export interface DynamicEnvironmentReader {
  argument: string;
  file: string;
  reader: string;
}

export interface ProcessEnvironmentAccess {
  file: string;
  key: string;
}

interface SourceContext {
  declarations: ReadonlyMap<string, t.Expression>;
  file: string;
  source: string;
  ast: t.File;
}

function unwrap(node: t.Expression): t.Expression {
  if (
    t.isParenthesizedExpression(node) ||
    t.isTSAsExpression(node) ||
    t.isTSTypeAssertion(node) ||
    t.isTSSatisfiesExpression(node)
  ) {
    return unwrap(node.expression);
  }
  return node;
}

function propertyValue(object: unknown, key: string): unknown {
  return typeof object === 'object' && object !== null
    ? (object as Record<string, unknown>)[key]
    : undefined;
}

function literalText(node: t.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function propertyKeyName(key: t.Node): string | undefined {
  if (t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  if (t.isNumericLiteral(key)) return String(key.value);
  return undefined;
}

function evaluate(
  expression: t.Node,
  declarations: ReadonlyMap<string, t.Expression>,
  seen = new Set<string>(),
): unknown {
  const node = unwrap(expression as t.Expression);
  if (t.isNumericLiteral(node)) return node.value;
  const text = literalText(node);
  if (text !== undefined) return text;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isArrayExpression(node)) {
    return node.elements.map((element) =>
      element && typeof (element as t.Node).type === 'string'
        ? evaluate(element as t.Node, declarations, seen)
        : undefined,
    );
  }
  if (t.isObjectExpression(node)) {
    return Object.fromEntries(
      node.properties.flatMap((property) => {
        if (!t.isObjectProperty(property)) return [];
        const name = propertyKeyName(property.key);
        if (name === undefined) return [];
        return [[name, evaluate(property.value as t.Node, declarations, seen)]];
      }),
    );
  }
  if (t.isIdentifier(node)) {
    if (node.name === 'undefined' || seen.has(node.name)) return undefined;
    const initializer = declarations.get(node.name);
    if (!initializer) return undefined;
    return evaluate(initializer, declarations, new Set(seen).add(node.name));
  }
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    return propertyValue(evaluate(node.object, declarations, seen), node.property.name);
  }
  if (t.isUnaryExpression(node)) {
    const operand = evaluate(node.argument, declarations, seen);
    if (typeof operand !== 'number') return undefined;
    if (node.operator === '-') return -operand;
    if (node.operator === '+') return operand;
    if (node.operator === '~') return ~operand;
    return undefined;
  }
  if (t.isBinaryExpression(node)) {
    const left = evaluate(node.left, declarations, seen);
    const right = evaluate(node.right, declarations, seen);
    if (node.operator === '+') {
      return typeof left === 'number' && typeof right === 'number'
        ? left + right
        : typeof left === 'string' && typeof right === 'string'
          ? left + right
          : undefined;
    }
    if (typeof left !== 'number' || typeof right !== 'number') return undefined;
    switch (node.operator) {
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return left / right;
      case '%':
        return left % right;
      case '**':
        return left ** right;
      case '<<':
        return left << right;
      case '>>':
        return left >> right;
      case '>>>':
        return left >>> right;
      case '|':
        return left | right;
      case '&':
        return left & right;
      case '^':
        return left ^ right;
      default:
        return undefined;
    }
  }
  return undefined;
}

function serializeEnvironmentValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.replaceAll('\n', '\\n');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((entry) => ['string', 'number'].includes(typeof entry))) {
    return value.join(',');
  }
  return undefined;
}

function sourceContext(path: string, projectRoot: string): SourceContext {
  const source = readFileSync(path, 'utf8');
  const ast = parser.parse(source, {
    sourceType: 'module',
    // JSX parsing is enabled only for .tsx; in .ts it misreads generic
    // arrows like <T>(...) as JSX opening elements.
    plugins: path.endsWith('.tsx') ? ['jsx', 'typescript'] : ['typescript'],
  });
  const declarations = new Map<string, t.Expression>();

  traverse(ast, {
    VariableDeclarator(declarationPath) {
      const declaration = declarationPath.node;
      const initializer = declaration.init;
      if (t.isIdentifier(declaration.id) && initializer !== null && initializer !== undefined) {
        declarations.set(declaration.id.name, initializer);
      }
    },
  });

  return {
    declarations,
    file: relative(projectRoot, path).replaceAll('\\', '/'),
    source,
    ast,
  };
}

function staticEnvironmentKey(node: t.Node | undefined): string | undefined {
  const text = literalText(node);
  return text !== undefined && /^[A-Z][A-Z0-9_]*$/u.test(text) ? text : undefined;
}

export function collectTypedEnvironmentReaders(
  paths: readonly string[],
  projectRoot: string,
): {
  defaults: StaticEnvironmentDefault[];
  dynamic: DynamicEnvironmentReader[];
} {
  const defaults: StaticEnvironmentDefault[] = [];
  const dynamic: DynamicEnvironmentReader[] = [];

  for (const path of paths) {
    const context = sourceContext(path, projectRoot);
    if (context.file === 'src/config/environment.ts') continue;

    const sourceText = (node: t.Node): string =>
      context.source.slice(node.start ?? 0, node.end ?? 0);

    traverse(context.ast, {
      CallExpression(callPath) {
        const callee = callPath.node.callee;
        if (!t.isIdentifier(callee)) return;
        const reader = callee.name;
        if (!TYPED_READER_NAMES.has(reader)) return;

        const args = callPath.node.arguments;
        const firstArgument = args[0] as t.Node | undefined;
        const key = staticEnvironmentKey(firstArgument);
        if (key === undefined) {
          dynamic.push({
            argument: firstArgument ? sourceText(firstArgument) : '<missing>',
            file: context.file,
            reader,
          });
        } else {
          const nullable = reader === 'readEnvNullableString';
          const fallback = nullable ? undefined : (args[1] as t.Expression | undefined);
          defaults.push({
            key,
            value: nullable
              ? ''
              : fallback === undefined
                ? undefined
                : serializeEnvironmentValue(evaluate(fallback, context.declarations)),
            expression: fallback === undefined ? '' : sourceText(fallback),
            file: context.file,
            reader,
            nullable,
          });
        }
      },
    });
  }

  return { defaults, dynamic };
}

function findConfigFallback(node: t.Node): t.Expression | undefined {
  if (t.isCallExpression(node)) {
    const callee = node.callee;
    if (t.isIdentifier(callee) && CONFIG_FALLBACK_HELPERS.has(callee.name)) {
      return node.arguments[0] as t.Expression | undefined;
    }
    if (
      t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      callee.property.name === 'default'
    ) {
      return node.arguments[0] as t.Expression | undefined;
    }
  }

  let found: t.Expression | undefined;
  const visitChild = (child: unknown): void => {
    if (found !== undefined) return;
    if (child && typeof (child as t.Node).type === 'string') {
      found = findConfigFallback(child as t.Node);
    }
  };
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const entry of child) visitChild(entry);
    } else {
      visitChild(child);
    }
  }
  return found;
}

export function collectCentralConfigDefaults(
  configPath: string,
  projectRoot: string,
): StaticEnvironmentDefault[] {
  const context = sourceContext(configPath, projectRoot);
  const sourceText = (node: t.Node): string => context.source.slice(node.start ?? 0, node.end ?? 0);
  let configObject: t.ObjectExpression | undefined;

  traverse(context.ast, {
    VariableDeclarator(declarationPath) {
      if (configObject !== undefined) {
        declarationPath.stop();
        return;
      }
      const declaration = declarationPath.node;
      if (!t.isIdentifier(declaration.id) || declaration.id.name !== 'ConfigSchema') return;
      const init = declaration.init;
      if (init === null || init === undefined) return;
      const initializer = unwrap(init);
      const firstArgument = t.isCallExpression(initializer) ? initializer.arguments[0] : undefined;
      if (firstArgument !== undefined && t.isObjectExpression(firstArgument)) {
        configObject = firstArgument;
      }
    },
  });

  if (!configObject) throw new Error('ConfigSchema must remain statically discoverable');
  const resolvedConfigObject = configObject;

  return resolvedConfigObject.properties.flatMap((property): StaticEnvironmentDefault[] => {
    if (!t.isObjectProperty(property)) return [];
    const key = propertyKeyName(property.key);
    if (key === undefined || key === 'NODE_ENV' || key === 'MCP_SERVER_VERSION') return [];

    const effectiveDefault = CONFIG_EFFECTIVE_DEFAULTS.get(key);
    const fallback = findConfigFallback(property.value as t.Node);
    const evaluated = fallback === undefined ? undefined : evaluate(fallback, context.declarations);
    const value = effectiveDefault ?? serializeEnvironmentValue(evaluated) ?? '';

    return [
      {
        key,
        value,
        expression:
          effectiveDefault ?? (fallback === undefined ? '<optional>' : sourceText(fallback)),
        file: context.file,
        reader: 'ConfigSchema',
        nullable: fallback === undefined,
      },
    ];
  });
}

function isProcessEnvironment(node: t.Node): node is t.MemberExpression {
  return (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.object) &&
    node.object.name === 'process' &&
    t.isIdentifier(node.property) &&
    node.property.name === 'env'
  );
}

export function collectProcessEnvironmentAccesses(
  paths: readonly string[],
  projectRoot: string,
): ProcessEnvironmentAccess[] {
  const accesses: ProcessEnvironmentAccess[] = [];

  for (const path of paths) {
    const context = sourceContext(path, projectRoot);

    traverse(context.ast, {
      MemberExpression(memberPath) {
        const node = memberPath.node;
        if (!isProcessEnvironment(node)) return;
        const parent = memberPath.parent;
        if (
          t.isMemberExpression(parent) &&
          !parent.computed &&
          parent.object === node &&
          t.isIdentifier(parent.property)
        ) {
          accesses.push({ file: context.file, key: parent.property.name });
        } else if (t.isMemberExpression(parent) && parent.computed && parent.object === node) {
          const argumentText = literalText(parent.property as t.Node);
          accesses.push({ file: context.file, key: argumentText ?? '<dynamic>' });
        } else {
          accesses.push({ file: context.file, key: '<all>' });
        }
      },
    });
  }

  return accesses;
}
