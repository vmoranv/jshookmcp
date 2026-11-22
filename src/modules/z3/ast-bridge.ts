/**
 * Bridge: JavaScript expression AST → Z3 AST.
 *
 * Parses a JS expression string with `@babel/parser` and walks the resulting
 * tree to build the equivalent Z3 high-level expression. The built Z3 AST
 * is suitable for `solver.add(...)`.
 *
 * Supported JS subset:
 *   NumericLiteral        → Int.val(n)
 *   Identifier            → declared variable lookup (Int/BitVec/Real/Bool)
 *   BinaryExpression      + - * / % < > <= >= == === != !==
 *   LogicalExpression     && ||
 *   UnaryExpression       !  -
 *   ParenthesizedExpression  (transparent)
 *   BooleanLiteral (true/false) → Bool.val(true/false)
 *
 * The Z3 high-level API exposes instance methods on typed expression classes
 * (e.g. `ArithImpl.gt`, `ArithImpl.add`, `BoolImpl.and`). We call these via
 * duck-type reflection (`call` / `call1`) to avoid importing z3-solver's
 * deep generics.
 *
 * @module @modules/z3/ast-bridge
 */

import { parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import type { Z3Api } from './Z3Solver';

export type VarType = 'int' | 'bitvec' | 'real' | 'bool';

export interface VarDecl {
  name: string;
  type: VarType;
  /** Bit width for `type: 'bitvec'`. Default 64. */
  bits?: number;
}

export class AstBridgeError extends Error {
  readonly nodeType: string;
  constructor(message: string, nodeType: string) {
    super(message);
    this.nodeType = nodeType;
    this.name = 'AstBridgeError';
  }
}

// Duck-typed Context. Internal helpers accept `any` so we don't fight
// z3-solver's branded-name generics (`Context<'main'>` vs `Context<Name>`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

interface VarEnv {
  int: Map<string, unknown>;
  bitvec: Map<string, unknown>;
  real: Map<string, unknown>;
  bool: Map<string, unknown>;
}

/**
 * Convert a JS expression string to a Z3 boolean expression (suitable for
 * `solver.add(...)`). Throws `AstBridgeError` for unsupported operators or
 * undeclared variables.
 *
 * @param expr JS expression, e.g. `"x > 10 && y <= 20"`, `"!(x === 0)"`
 * @param _api Z3 API surface (unused after constructing the Context)
 * @param ctx  A Z3 Context from `new api.Context('main')`
 * @param vars Variable declarations referenced by the expression
 */
export function jsExprToZ3(expr: string, _api: Z3Api, ctx: Ctx, vars: VarDecl[]): unknown {
  const ast = parseExpression(expr, {
    sourceType: 'unambiguous',
    errorRecovery: false,
  });
  const env = buildEnv(ctx, vars);
  return visit(ast, ctx, env);
}

// ---- variable environment ----

function buildEnv(ctx: Ctx, vars: VarDecl[]): VarEnv {
  const env: VarEnv = { int: new Map(), bitvec: new Map(), real: new Map(), bool: new Map() };
  for (const v of vars) {
    switch (v.type) {
      case 'int':
        env.int.set(v.name, ctx.Int.const(v.name));
        break;
      case 'bitvec': {
        env.bitvec.set(v.name, ctx.BitVec.const(v.name, v.bits ?? 64));
        break;
      }
      case 'real':
        env.real.set(v.name, ctx.Real.const(v.name));
        break;
      case 'bool':
        env.bool.set(v.name, ctx.Bool.const(v.name));
        break;
    }
  }
  return env;
}

function lookupVar(env: VarEnv, name: string): unknown | null {
  return (
    env.int.get(name) ?? env.bitvec.get(name) ?? env.real.get(name) ?? env.bool.get(name) ?? null
  );
}

/**
 * JS binary operator → Z3 method. A table instead of a switch keeps `visit`
 * under the repo's cyclomatic-complexity ratchet.
 */
const BINARY_METHODS: Readonly<Record<string, string>> = {
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '%': 'mod',
  // z3 5.4+ keeps Int ** Int in Int; with both operands Int the result no
  // longer silently widens to Real.
  '**': 'pow',
  '<': 'lt',
  '>': 'gt',
  '<=': 'le',
  '>=': 'ge',
  '==': 'eq',
  '===': 'eq',
  '!=': 'neq',
  '!==': 'neq',
};

// ---- AST visitor ----

function visit(node: t.Node, ctx: Ctx, env: VarEnv): unknown {
  if (t.isNumericLiteral(node)) {
    return ctx.Int.val(node.value);
  }
  if (t.isBooleanLiteral(node)) {
    return ctx.Bool.val(node.value);
  }
  if (t.isIdentifier(node)) {
    const v = lookupVar(env, node.name);
    if (v === null) throw new AstBridgeError(`Undeclared variable: ${node.name}`, node.type);
    return v;
  }
  if (t.isParenthesizedExpression(node)) {
    return visit(node.expression, ctx, env);
  }
  if (t.isUnaryExpression(node)) {
    const arg = visit(node.argument, ctx, env);
    if (node.operator === '!') return call1(arg, 'not');
    if (node.operator === '-') return call1(arg, 'neg');
    if (node.operator === '+') return arg;
    throw new AstBridgeError(`Unsupported unary operator: ${node.operator}`, node.type);
  }
  if (t.isBinaryExpression(node)) {
    const left = visit(node.left, ctx, env);
    const right = visit(node.right, ctx, env);
    const method = BINARY_METHODS[node.operator];
    if (!method) {
      throw new AstBridgeError(`Unsupported binary operator: ${node.operator}`, node.type);
    }
    return call(left, method, right);
  }
  if (t.isLogicalExpression(node)) {
    const left = visit(node.left, ctx, env);
    const right = visit(node.right, ctx, env);
    if (node.operator === '&&') return call(left, 'and', right);
    if (node.operator === '||') return call(left, 'or', right);
    throw new AstBridgeError(`Unsupported logical operator: ${node.operator}`, node.type);
  }
  throw new AstBridgeError(`Unsupported node type: ${node.type}`, node.type);
}

/**
 * Quick check: does the expression parse (no Z3 round-trip)?
 * Use this in tests / tool-input validation.
 */
export function canParseExpr(expr: string): boolean {
  try {
    parseExpression(expr, { sourceType: 'unambiguous', errorRecovery: true });
    return true;
  } catch {
    return false;
  }
}

// ---- duck-type helpers (ArithImpl / BoolImpl / BitVecImpl are real classes
//      with `.gt()`, `.and()`, etc. as prototype methods — no .ast unwrap) ----

function call(recv: unknown, method: string, arg: unknown): unknown {
  const fn = (recv as Record<string, unknown>)?.[method];
  if (typeof fn !== 'function') {
    throw new AstBridgeError(
      `Operand does not support .${method}() — likely type mismatch ` +
        `(got ${recv === null ? 'null' : typeof recv}: ${String(Object.getPrototypeOf(recv ?? Object.prototype)?.constructor?.name ?? '?')})`,
      'BinaryExpression',
    );
  }
  return (fn as (a: unknown) => unknown).call(recv, arg);
}

function call1(recv: unknown, method: string): unknown {
  const fn = (recv as Record<string, unknown>)?.[method];
  if (typeof fn !== 'function') {
    throw new AstBridgeError(
      `Operand does not support .${method}() — likely type mismatch ` +
        `(got ${recv === null ? 'null' : typeof recv})`,
      'UnaryExpression',
    );
  }
  return (fn as () => unknown).call(recv);
}
