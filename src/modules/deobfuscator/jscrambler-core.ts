/**
 * Shared pass core for JScrambler deobfuscation — the single source of truth
 * for the Babel parse + five traverse/generate passes (self-defending removal,
 * string decryption, control-flow restoration, dead-code removal, expression
 * simplification).
 *
 * Both consumers import this module:
 *   - `JScramblerDeobfuscator` (main thread) builds a `JscramblerCoreBabel`
 *     from its real `@babel/*` imports and a `log` adapter from `@utils/logger`.
 *   - `jscrambler-worker` loads this file inside the `eval` worker via its
 *     resolved `file://` URL (Node >= 22.18 strips the erasable type syntax
 *     natively) and passes the `@babel/*` namespaces it already resolved from
 *     `babelUrls`.
 *
 * ── Zero-dependency contract ──
 * This module has no runtime imports: Babel is injected through
 * `JscramblerCoreBabel`, logging through the optional `JscramblerLog` callback.
 * The only `import` statements are `import type` (erased at compile time and by
 * Node's native type stripping), so an `eval` worker can `import()` the raw
 * `.ts` source without a bundler or a TS loader. Keep it that way — a runtime
 * `import` of anything repo-relative (`@utils/logger`, etc.) breaks the worker
 * load path, and a non-erasable TS construct (`enum`, `namespace`, parameter
 * properties) breaks native type stripping.
 */

import type * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';

/** Injected Babel runtime surface (matches `babel-urls.ts` + main-thread imports). */
export interface JscramblerCoreBabel {
  parser: typeof import('@babel/parser');
  traverse: (typeof import('@babel/traverse'))['default'];
  generate: (typeof import('@babel/generator'))['default'];
  types: typeof import('@babel/types');
}

export interface JscramblerCoreOptions {
  removeDeadCode: boolean;
  restoreControlFlow: boolean;
  decryptStrings: boolean;
  simplifyExpressions: boolean;
}

export interface JscramblerCoreResult {
  code: string;
  success: boolean;
  transformations: string[];
  warnings: string[];
  confidence: number;
}

export type JscramblerLogLevel = 'info' | 'warn' | 'error';

/**
 * Logging sink. The main thread forwards to `@utils/logger`; the worker forwards
 * to a collector that serializes each entry so it can cross the structured-clone
 * boundary (`error` is reduced to its message).
 */
export type JscramblerLog = (level: JscramblerLogLevel, message: string, error?: unknown) => void;

/** A serialized log record that can cross the worker structured-clone boundary. */
export interface JscramblerLogEntry {
  level: JscramblerLogLevel;
  message: string;
  error?: string;
}

/**
 * Confidence = transformations / CONFIDENCE_DIVISOR (capped at 1.0):
 * each applied transformation contributes one divisor-sized confidence
 * point, so a typical 5-transformation run scores 1.0.
 */
const CONFIDENCE_DIVISOR = 5;
/** Radix used when parseInt is invoked without an explicit radix argument. */
const DEFAULT_PARSE_INT_RADIX = 10;

/** Statically evaluable value during decrypt-function evaluation. */
type EvalValue = string | number | boolean | null | EvalValue[];

export function calculateConfidence(transformationCount: number): number {
  return Math.min(transformationCount / CONFIDENCE_DIVISOR, 1.0);
}

/** JS relational semantics for <, >, <=, >=: null → 0, booleans → 0/1. */
function comparable(value: string | number | boolean | null): string | number {
  if (value === null || typeof value === 'boolean') {
    return Number(value);
  }
  return value;
}

/**
 * Resolved argument values of a call.
 *
 * An argument that cannot be evaluated makes the whole list collapse to `[]`.
 * That is deliberate and load-bearing, not an oversight: the callers detect the
 * collapse by comparing `args.length` against the syntactic argument count, and
 * the zero-argument string methods (`toLowerCase` / `toUpperCase` / `trim`)
 * legitimately fold when the list is empty. Replacing `[]` with a distinct
 * "unresolvable" sentinel changes observable behaviour for
 * `"abc".toLowerCase(null)`, which folds today.
 */
type EvalArgs = Array<string | number | boolean | null>;
type EvalResult = string | number | boolean | null | EvalValue[] | undefined;

/**
 * Global callees that fold over statically known arguments. Membership is
 * checked before the arguments are evaluated so that an unknown identifier
 * never triggers side-effecting evaluation, matching the original arm order.
 */
const GLOBAL_CALLEES: ReadonlySet<string> = new Set(['String', 'Number', 'parseInt', 'parseFloat']);

/** Global callees that fold over statically known arguments. */
function evalGlobalCallee(name: string, args: Array<string | number | boolean | null>): EvalResult {
  if (name === 'String') {
    return args.length === 1 ? String(args[0]) : undefined;
  }
  if (name === 'Number') {
    // A boolean would coerce to 0/1, which is never a decoded string.
    return args.length === 1 && typeof args[0] !== 'boolean' ? Number(args[0]) : undefined;
  }
  if (name === 'parseInt' || name === 'parseFloat') {
    if (args.length === 0) {
      return undefined;
    }
    return name === 'parseInt'
      ? Number.parseInt(
          String(args[0]),
          typeof args[1] === 'number' ? args[1] : DEFAULT_PARSE_INT_RADIX,
        )
      : Number.parseFloat(String(args[0]));
  }
  return undefined;
}

/** `String.fromCharCode(...)` over numeric arguments. */
function evalFromCharCode(args: EvalArgs, argCount: number): EvalResult {
  // A collapsed argument list (length !== argCount) must not fold: that would
  // decrypt to an empty string and silently drop the call.
  if (args.length !== argCount || args.some((v) => typeof v !== 'number')) {
    return undefined;
  }
  return String.fromCharCode(...(args as number[]));
}

/** One string-instance method over an already-resolved receiver and arguments. */
function evalStringMethod(
  receiver: string,
  method: string,
  args: EvalArgs,
  argCount: number,
): EvalResult {
  switch (method) {
    case 'charCodeAt': {
      const idx = args[0];
      return typeof idx === 'number' ? receiver.charCodeAt(idx) : undefined;
    }
    case 'charAt': {
      const idx = args[0];
      return typeof idx === 'number' ? receiver.charAt(idx) : undefined;
    }
    case 'split': {
      const sep = args[0];
      return typeof sep === 'string' ? receiver.split(sep) : undefined;
    }
    case 'substr':
    case 'substring':
    case 'slice': {
      const from = args[0];
      const to = args[1];
      if (typeof from !== 'number' || (to !== undefined && typeof to !== 'number')) {
        return undefined;
      }
      return method === 'substr'
        ? receiver.substr(from, to as number | undefined)
        : method === 'substring'
          ? receiver.substring(from, to as number | undefined)
          : receiver.slice(from, to as number | undefined);
    }
    case 'concat': {
      // Same guard as fromCharCode: unresolvable arguments must not silently
      // collapse the concatenation to the receiver.
      if (args.length !== argCount || args.some((v) => typeof v !== 'string')) {
        return undefined;
      }
      return receiver.concat(...(args as string[]));
    }
    case 'indexOf': {
      const needle = args[0];
      return typeof needle === 'string'
        ? receiver.indexOf(needle, typeof args[1] === 'number' ? args[1] : undefined)
        : undefined;
    }
    case 'toLowerCase':
      return args.length === 0 ? receiver.toLowerCase() : undefined;
    case 'toUpperCase':
      return args.length === 0 ? receiver.toUpperCase() : undefined;
    case 'trim':
      return args.length === 0 ? receiver.trim() : undefined;
    case 'replace': {
      if (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
        return undefined;
      }
      return receiver.split(args[0]).join(args[1]);
    }
    default:
      return undefined;
  }
}

/** Public surface of the core — mirrors the former `JScramberDeobfuscator` methods. */
export interface JscramblerCore {
  deobfuscate(
    code: string,
    options: JscramblerCoreOptions,
    log?: JscramblerLog,
  ): JscramblerCoreResult;
  detectSelfDefending(ast: t.File): boolean;
  removeSelfDefending(ast: t.File): void;
  decryptStrings(ast: t.File, warnings: string[]): number;
  restoreControlFlow(ast: t.File, warnings: string[], log?: JscramblerLog): number;
  removeDeadCode(ast: t.File): number;
  simplifyExpressions(ast: t.File): number;
}

export function createJscramblerCore(babel: JscramblerCoreBabel): JscramblerCore {
  const { parser, traverse, generate, types } = babel;

  function detectSelfDefending(ast: t.File): boolean {
    let hasSelfDefending = false;

    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.body.body.some((stmt) => types.isDebuggerStatement(stmt))) {
          hasSelfDefending = true;
        }

        const code = generate(path.node).code;
        if (code.includes('toString') && code.includes('constructor')) {
          hasSelfDefending = true;
        }
      },
    });

    return hasSelfDefending;
  }

  function removeSelfDefending(ast: t.File): void {
    traverse(ast, {
      DebuggerStatement(path) {
        path.remove();
      },

      CallExpression(path) {
        if (
          types.isIdentifier(path.node.callee) &&
          (path.node.callee.name === 'setInterval' || path.node.callee.name === 'setTimeout')
        ) {
          const arg = path.node.arguments[0];
          if (types.isFunctionExpression(arg) || types.isArrowFunctionExpression(arg)) {
            const body = arg.body;
            if (types.isBlockStatement(body)) {
              if (body.body.some((stmt) => types.isDebuggerStatement(stmt))) {
                if (path.parentPath?.isExpressionStatement()) {
                  path.remove();
                } else {
                  // The timer call is an operand (assignment init, ternary
                  // branch, ...) — removing the node outright would leave
                  // invalid syntax behind; replace it with `undefined`.
                  path.replaceWith(types.identifier('undefined'));
                }
              }
            }
          }
        }
      },
    });
  }

  /**
   * Invoke `onAssignment` for every VariableDeclarator that assigns a function
   * (function expression or arrow function) to an identifier — the
   * `isIdentifier + isFunction` guard previously duplicated in
   * {@link collectFunctionDefs} and {@link findDecryptFunctions}.
   */
  function forEachFunctionAssignment(
    decl: t.VariableDeclarator,
    onAssignment: (name: string, fn: t.Function) => void,
  ): void {
    const { id, init } = decl;
    if (
      types.isIdentifier(id) &&
      (types.isFunctionExpression(init) || types.isArrowFunctionExpression(init))
    ) {
      onAssignment(id.name, init);
    }
  }

  function collectFunctionDefs(ast: t.File): Map<string, t.Function> {
    const defs = new Map<string, t.Function>();
    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.id) {
          defs.set(path.node.id.name, path.node);
        }
      },
      VariableDeclarator(path) {
        forEachFunctionAssignment(path.node, (name, fn) => defs.set(name, fn));
      },
    });
    return defs;
  }

  function collectGlobalArrays(ast: t.File): Map<string, t.ArrayExpression> {
    const arrays = new Map<string, t.ArrayExpression>();
    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;
        if (types.isIdentifier(id) && types.isArrayExpression(init)) {
          arrays.set(id.name, init);
        }
      },
    });
    return arrays;
  }

  /** Heuristic: char-code based decoders, or functions indexing a string array. */
  function looksLikeDecryptFunction(
    fn: t.Function,
    arrays: Map<string, t.ArrayExpression>,
  ): boolean {
    const code = generate(fn).code;
    if (code.includes('fromCharCode') || code.includes('charCodeAt')) {
      return true;
    }

    // Array-index decryption: the body reads from a module-level string array
    // via computed access (`_str[i]`). Array names are source identifiers, so
    // escaping is unnecessary.
    for (const name of arrays.keys()) {
      if (new RegExp(`\\b${name}\\s*\\[`).test(code)) {
        return true;
      }
    }
    return false;
  }

  function findDecryptFunctions(ast: t.File, arrays: Map<string, t.ArrayExpression>): Set<string> {
    const decryptFunctions = new Set<string>();

    const register = (fn: t.Function, name: string | null): void => {
      if (name && looksLikeDecryptFunction(fn, arrays)) {
        decryptFunctions.add(name);
      }
    };

    traverse(ast, {
      FunctionDeclaration(path) {
        register(path.node, path.node.id?.name ?? null);
      },
      VariableDeclarator(path) {
        forEachFunctionAssignment(path.node, (name, fn) => register(fn, name));
      },
    });

    return decryptFunctions;
  }

  /** JS relational semantics for <, >, <=, >=: null → 0, booleans → 0/1. */
  function evalBinary(
    operator: t.BinaryExpression['operator'],
    left: string | number | boolean | null,
    right: string | number | boolean | null,
  ): string | number | boolean | undefined {
    // `+` is the only overloaded operator (string concat when either side is a
    // string), so it stays explicit; the rest come from lookup tables.
    if (operator === '+') {
      return typeof left === 'string' || typeof right === 'string'
        ? String(left) + String(right)
        : (left as number) + (right as number);
    }

    // Own-property guards: a bare lookup resolves inherited keys ('constructor',
    // 'toString', ...) to Object.prototype members and would call those.
    const numeric = Object.hasOwn(NUMERIC_BINARY_OPS, operator)
      ? NUMERIC_BINARY_OPS[operator]
      : undefined;
    if (numeric) {
      return typeof left === 'number' && typeof right === 'number'
        ? numeric(left, right)
        : undefined;
    }

    const comparison = Object.hasOwn(COMPARISON_BINARY_OPS, operator)
      ? COMPARISON_BINARY_OPS[operator]
      : undefined;
    if (comparison) {
      return comparison(comparable(left), comparable(right));
    }

    const equality = Object.hasOwn(EQUALITY_BINARY_OPS, operator)
      ? EQUALITY_BINARY_OPS[operator]
      : undefined;
    if (equality) {
      return equality(left, right);
    }

    return undefined;
  }

  function evalArray(
    node: t.ArrayExpression,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): EvalValue[] | undefined {
    const values: EvalValue[] = [];
    for (const el of node.elements) {
      if (!el || types.isSpreadElement(el)) {
        return undefined;
      }
      const value = evalExpr(el, env, arrays);
      if (value === undefined) {
        return undefined;
      }
      values.push(value);
    }
    return values;
  }

  function evalCall(
    node: t.CallExpression,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): EvalValue | undefined {
    const argCount = node.arguments.length;
    const evalArgs = (): EvalArgs => {
      const values: Array<string | number | boolean | null> = [];
      for (const arg of node.arguments) {
        if (!types.isExpression(arg)) {
          return [];
        }
        const value = evalExpr(arg, env, arrays);
        if (value === undefined || value === null || Array.isArray(value)) {
          return [];
        }
        values.push(value);
      }
      return values;
    };

    const callee = node.callee;
    if (types.isIdentifier(callee)) {
      // Only the four known globals resolve arguments; any other identifier
      // must NOT evaluate them (the original switch arms were lazy too).
      if (!GLOBAL_CALLEES.has(callee.name)) {
        return undefined;
      }
      return evalGlobalCallee(callee.name, evalArgs()) as EvalValue | undefined;
    }

    if (
      types.isMemberExpression(callee) &&
      !callee.computed &&
      types.isIdentifier(callee.property)
    ) {
      const method = callee.property.name;
      // `String` itself is not an env/array value — resolve fromCharCode first.
      if (
        types.isIdentifier(callee.object) &&
        callee.object.name === 'String' &&
        method === 'fromCharCode'
      ) {
        return evalFromCharCode(evalArgs(), argCount) as EvalValue | undefined;
      }
      const obj = evalExpr(callee.object, env, arrays);
      if (obj === undefined || obj === null || typeof obj !== 'string') {
        return undefined;
      }
      return evalStringMethod(obj, method, evalArgs(), argCount) as EvalValue | undefined;
    }
    return undefined;
  }

  function evalExpr(
    node: t.Node,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): EvalValue | undefined {
    if (types.isStringLiteral(node)) {
      return node.value;
    }
    if (types.isNumericLiteral(node)) {
      return node.value;
    }
    if (types.isBooleanLiteral(node)) {
      return node.value;
    }
    if (types.isNullLiteral(node)) {
      return null;
    }
    if (types.isIdentifier(node)) {
      if (env.has(node.name)) {
        return env.get(node.name);
      }
      const arr = arrays.get(node.name);
      return arr ? evalArray(arr, env, arrays) : undefined;
    }
    if (types.isMemberExpression(node)) {
      const obj = evalExpr(node.object, env, arrays);
      if (obj === undefined || obj === null) {
        return undefined;
      }
      if (!node.computed) {
        return undefined;
      }
      const prop = evalExpr(node.property, env, arrays);
      if (typeof obj === 'string' && typeof prop === 'number') {
        return obj.charAt(prop);
      }
      if (Array.isArray(obj) && typeof prop === 'number') {
        return (obj[prop] as string | number | boolean | null | undefined) ?? null;
      }
      return undefined;
    }
    if (types.isArrayExpression(node)) {
      return evalArray(node, env, arrays);
    }
    if (types.isBinaryExpression(node)) {
      const left = evalExpr(node.left, env, arrays);
      const right = evalExpr(node.right, env, arrays);
      if (
        left === undefined ||
        right === undefined ||
        Array.isArray(left) ||
        Array.isArray(right)
      ) {
        return undefined;
      }
      return evalBinary(node.operator, left, right);
    }
    if (types.isUnaryExpression(node)) {
      const value = evalExpr(node.argument, env, arrays);
      if (value === undefined) {
        return undefined;
      }
      switch (node.operator) {
        case '!':
          return !value;
        case '-':
          return typeof value === 'number' ? -value : undefined;
        case '+':
          return typeof value === 'number' ? value : undefined;
        case '~':
          return typeof value === 'number' ? ~value : undefined;
        case 'typeof':
          return typeof value;
        default:
          return undefined;
      }
    }
    if (types.isLogicalExpression(node)) {
      const left = evalExpr(node.left, env, arrays);
      if (left === undefined) {
        return undefined;
      }
      if (node.operator === '&&') {
        return left ? evalExpr(node.right, env, arrays) : left;
      }
      if (node.operator === '||') {
        return left ? left : evalExpr(node.right, env, arrays);
      }
      // '??'
      return left !== null ? left : evalExpr(node.right, env, arrays);
    }
    if (types.isConditionalExpression(node)) {
      const test = evalExpr(node.test, env, arrays);
      if (test === undefined) {
        return undefined;
      }
      return evalExpr(test ? node.consequent : node.alternate, env, arrays);
    }
    if (types.isTemplateLiteral(node)) {
      let result = '';
      for (let i = 0; i < node.quasis.length; i += 1) {
        const q = node.quasis[i]!;
        result += q.value.cooked ?? q.value.raw;
        const expr = node.expressions[i];
        if (expr) {
          const value = evalExpr(expr, env, arrays);
          if (value === undefined || value === null) {
            return undefined;
          }
          result += String(value);
        }
      }
      return result;
    }
    if (types.isCallExpression(node)) {
      return evalCall(node, env, arrays);
    }
    return undefined;
  }

  function evalBlock(
    body: t.BlockStatement,
    env: Map<string, EvalValue>,
    arrays: Map<string, t.ArrayExpression>,
  ): string | number | boolean | null | undefined {
    for (const stmt of body.body) {
      if (types.isVariableDeclaration(stmt)) {
        for (const decl of stmt.declarations) {
          if (!types.isIdentifier(decl.id) || !decl.init) {
            return undefined;
          }
          const value = evalExpr(decl.init, env, arrays);
          if (value === undefined) {
            return undefined;
          }
          env.set(decl.id.name, value);
        }
        continue;
      }
      if (
        types.isExpressionStatement(stmt) &&
        types.isAssignmentExpression(stmt.expression) &&
        types.isIdentifier(stmt.expression.left)
      ) {
        const value = evalExpr(stmt.expression.right, env, arrays);
        if (value === undefined) {
          return undefined;
        }
        env.set(stmt.expression.left.name, value);
        continue;
      }
      if (types.isReturnStatement(stmt)) {
        if (!stmt.argument) {
          return undefined;
        }
        const value = evalExpr(stmt.argument, env, arrays);
        return Array.isArray(value) ? undefined : value;
      }
      return undefined;
    }
    return undefined;
  }

  /** Statically evaluable values inside a decrypt function. */
  function evaluateDecryptCall(
    fn: t.Function,
    args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
    arrays: Map<string, t.ArrayExpression>,
  ): string | number | boolean | null | undefined {
    const env = new Map<string, EvalValue>();

    const params = fn.params;
    for (let i = 0; i < params.length; i += 1) {
      const param = params[i];
      const arg = args[i];
      if (!param || !types.isIdentifier(param) || !arg || !types.isExpression(arg)) {
        return undefined;
      }
      const value = evalExpr(arg, env, arrays);
      if (value === undefined) {
        return undefined;
      }
      env.set(param.name, value);
    }

    if (types.isBlockStatement(fn.body)) {
      return evalBlock(fn.body, env, arrays);
    }
    const bodyValue = evalExpr(fn.body, env, arrays);
    // A decrypt function whose final value is an array is not a string
    // decryptor — treat it as not statically decodable.
    return Array.isArray(bodyValue) ? undefined : bodyValue;
  }

  function valueToNode(value: string | number | boolean): t.Expression {
    if (typeof value === 'string') {
      return types.stringLiteral(value);
    }
    if (typeof value === 'number') {
      return types.numericLiteral(value);
    }
    return types.booleanLiteral(value);
  }

  function decryptStrings(ast: t.File, warnings: string[]): number {
    let count = 0;

    const arrays = collectGlobalArrays(ast);
    const decryptFunctions = findDecryptFunctions(ast, arrays);
    if (decryptFunctions.size === 0) {
      return 0;
    }
    const defs = collectFunctionDefs(ast);

    traverse(ast, {
      CallExpression: (path) => {
        if (!types.isIdentifier(path.node.callee) || !decryptFunctions.has(path.node.callee.name)) {
          return;
        }
        const def = defs.get(path.node.callee.name);
        if (!def) {
          return;
        }
        const result = evaluateDecryptCall(def, path.node.arguments, arrays);
        if (result === undefined || result === null) {
          warnings.push(
            `Unable to statically decrypt ${path.node.callee.name}(...) call; left in place`,
          );
          return;
        }
        path.replaceWith(valueToNode(result));
        count++;
      },
    });

    return count;
  }

  /** Value of a `state = <literal>` statement, or undefined when not one. */
  function extractStateUpdate(stmt: t.Statement, stateName: string): string | number | undefined {
    if (
      !types.isExpressionStatement(stmt) ||
      !types.isAssignmentExpression(stmt.expression) ||
      !types.isIdentifier(stmt.expression.left) ||
      stmt.expression.left.name !== stateName
    ) {
      return undefined;
    }
    const right = stmt.expression.right;
    if (types.isNumericLiteral(right) || types.isStringLiteral(right)) {
      return right.value;
    }
    return undefined;
  }

  /** Case test as a primitive value, or null when not a literal. */
  function caseTestValue(c: t.SwitchCase): string | number | null {
    const test = c.test;
    if (types.isNumericLiteral(test) || types.isStringLiteral(test)) {
      return test.value;
    }
    return null;
  }

  /**
   * Linearize a `while (true) { switch (state) { ... } }` state machine by
   * following the `state = <literal>` updates from the first case. Returns
   * false (leaving the pattern intact) when the state graph is cyclic, jumps
   * to an unknown target, or leaves cases unreachable — flattening those would
   * change program semantics.
   */
  function unflattenControlFlowPattern(path: NodePath<t.WhileStatement>): boolean {
    const whileStmt = path.node;
    if (!types.isBlockStatement(whileStmt.body)) {
      return false;
    }
    const switchStmt = whileStmt.body.body[0];
    if (!types.isSwitchStatement(switchStmt)) {
      return false;
    }

    // The switch discriminant must be a plain state variable.
    if (!types.isIdentifier(switchStmt.discriminant)) {
      return false;
    }
    const stateName = switchStmt.discriminant.name;
    const cases = switchStmt.cases;
    const first = cases[0];
    if (!first || first.test === null) {
      return false;
    }

    const sequence: t.SwitchCase[] = [];
    const visited = new Set<t.SwitchCase>();
    let current: t.SwitchCase | undefined = first;

    while (current) {
      if (visited.has(current)) {
        return false; // state cycle — cannot linearize
      }
      visited.add(current);
      sequence.push(current);

      let nextValue: string | number | null = null;
      for (const stmt of current.consequent) {
        const update = extractStateUpdate(stmt, stateName);
        if (update !== undefined) {
          nextValue = update;
        }
      }
      if (nextValue === null) {
        break; // terminal case
      }
      const nextCase = cases.find((c) => c.test !== null && caseTestValue(c) === nextValue);
      if (nextCase === undefined) {
        return false; // jump to an unknown state
      }
      current = nextCase;
    }

    if (visited.size !== cases.length) {
      return false; // unreachable cases — keep the pattern conservatively
    }

    const flattened = sequence.flatMap((c) =>
      c.consequent.filter(
        (stmt) =>
          extractStateUpdate(stmt, stateName) === undefined &&
          !types.isBreakStatement(stmt) &&
          !types.isContinueStatement(stmt),
      ),
    );

    if (flattened.length === 0) {
      return false;
    }

    path.replaceWithMultiple(flattened);
    return true;
  }

  function isControlFlowFlatteningPattern(node: t.WhileStatement): boolean {
    if (!types.isBooleanLiteral(node.test) || !node.test.value) {
      return false;
    }

    if (!types.isBlockStatement(node.body)) {
      return false;
    }

    const firstStmt = node.body.body[0];
    return types.isSwitchStatement(firstStmt);
  }

  function restoreControlFlow(ast: t.File, warnings: string[], log?: JscramblerLog): number {
    let count = 0;
    traverse(ast, {
      WhileStatement: (path) => {
        if (isControlFlowFlatteningPattern(path.node)) {
          try {
            if (!unflattenControlFlowPattern(path)) {
              warnings.push(
                'Unable to linearize while-switch control-flow pattern (cyclic or unreachable states); left in place',
              );
            } else {
              count++;
            }
          } catch (error) {
            log?.('warn', 'Failed to unflatten control-flow pattern', error);
          }
        }
      },
    });

    return count;
  }

  function removeDeadCode(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      IfStatement(path) {
        if (types.isBooleanLiteral(path.node.test)) {
          if (path.node.test.value) {
            path.replaceWith(path.node.consequent);
          } else {
            if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
          }
          count++;
        }
      },
    });

    return count;
  }

  function simplifyExpressions(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      BinaryExpression(path) {
        if (types.isNumericLiteral(path.node.left) && types.isNumericLiteral(path.node.right)) {
          const left = path.node.left.value;
          const right = path.node.right.value;
          let result: number | undefined;

          switch (path.node.operator) {
            case '+':
              result = left + right;
              break;
            case '-':
              result = left - right;
              break;
            case '*':
              result = left * right;
              break;
            case '/':
              result = left / right;
              break;
          }

          if (result !== undefined) {
            path.replaceWith(types.numericLiteral(result));
            count++;
          }
        }
      },
    });

    return count;
  }

  function deobfuscate(
    code: string,
    options: JscramblerCoreOptions,
    log?: JscramblerLog,
  ): JscramblerCoreResult {
    const transformations: string[] = [];
    const warnings: string[] = [];
    let currentCode = code;

    log?.('info', ' JScrambler...');

    try {
      const ast = parser.parse(currentCode, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      if (detectSelfDefending(ast)) {
        removeSelfDefending(ast);
        transformations.push('Removed self-defending code');
      }

      if (options.decryptStrings) {
        const decrypted = decryptStrings(ast, warnings);
        if (decrypted > 0) {
          transformations.push(`Decrypted ${decrypted} strings`);
        }
      }

      if (options.restoreControlFlow) {
        const restored = restoreControlFlow(ast, warnings, log);
        if (restored > 0) {
          transformations.push(`Restored ${restored} control-flow patterns`);
        }
      }

      if (options.removeDeadCode) {
        const removed = removeDeadCode(ast);
        if (removed > 0) {
          transformations.push(`Removed ${removed} dead branches`);
        }
      }

      if (options.simplifyExpressions) {
        const simplified = simplifyExpressions(ast);
        if (simplified > 0) {
          transformations.push(`Simplified ${simplified} expressions`);
        }
      }

      const output = generate(ast, {
        comments: true,
        compact: false,
      });

      currentCode = output.code;

      log?.(
        'info',
        `JScrambler deobfuscation complete, ${transformations.length} transformations applied`,
      );

      return {
        code: currentCode,
        success: true,
        transformations,
        warnings,
        confidence: calculateConfidence(transformations.length),
      };
    } catch (error) {
      log?.('error', 'JScrambler', error);
      return {
        code: currentCode,
        success: false,
        transformations,
        warnings: [...warnings, String(error)],
        confidence: 0,
      };
    }
  }

  return {
    deobfuscate,
    detectSelfDefending,
    removeSelfDefending,
    decryptStrings,
    restoreControlFlow,
    removeDeadCode,
    simplifyExpressions,
  };
}

/** Numeric-only binary operators (both operands must be numbers). */
const NUMERIC_BINARY_OPS: Partial<Record<string, (left: number, right: number) => number>> = {
  '-': (l, r) => l - r,
  '*': (l, r) => l * r,
  '/': (l, r) => l / r,
  '%': (l, r) => l % r,
  '**': (l, r) => l ** r,
  '<<': (l, r) => l << r,
  '>>': (l, r) => l >> r,
  '>>>': (l, r) => l >>> r,
  '&': (l, r) => l & r,
  '|': (l, r) => l | r,
  '^': (l, r) => l ^ r,
};

/** Relational comparisons over `comparable()`-normalised operands. */
const COMPARISON_BINARY_OPS: Partial<
  Record<string, (left: string | number, right: string | number) => boolean>
> = {
  '<': (l, r) => l < r,
  '>': (l, r) => l > r,
  '<=': (l, r) => l <= r,
  '>=': (l, r) => l >= r,
};

/** Loose and strict equality, preserving the original ==/!= semantics. */
const EQUALITY_BINARY_OPS: Partial<Record<string, (left: unknown, right: unknown) => boolean>> = {
  '===': (l, r) => l === r,
  '!==': (l, r) => l !== r,
  // eslint-disable-next-line eqeqeq
  '==': (l, r) => l == r,
  // eslint-disable-next-line eqeqeq
  '!=': (l, r) => l != r,
};
