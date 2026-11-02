import traverse from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Interprocedural taint summaries for {@link analyzeDataFlowWithTaint}.
 *
 * The main analyzer keeps a flat, module-scoped taint map and cannot follow
 * taint through user-defined helpers (`y = wrap(tainted)`). This module builds a
 * per-function summary — "which parameter indices, when tainted, taint the
 * return value" plus "does the body return a taint source directly" — so call
 * sites can be resolved without inlining the callee.
 */

export interface SourceInfo {
  sourceType: string;
  sourceLine: number;
}

/** Taint atoms tracked for a value inside a single function body. */
interface TaintInfo {
  /** Parameter indices whose taint reaches this value. */
  params: Set<number>;
  /** A known taint source (e.g. `location.hash`) reaching this value. */
  source: SourceInfo | null;
}

export interface FunctionSummary {
  /** If any of these param indices is tainted, the return value is tainted. */
  taintedParamIndices: Set<number>;
  /** The function unconditionally returns this taint source, if any. */
  returnsSource: SourceInfo | null;
}

type SanitizerCheck = (node: t.CallExpression, sanitizers: Set<string>) => boolean;

interface FnDef {
  params: Array<string | null>;
  body: t.BlockStatement | t.Expression;
}

interface Ctx {
  local: Map<string, TaintInfo>;
  summaries: Map<string, FunctionSummary>;
  sanitizers: Set<string>;
  checkSanitizer: SanitizerCheck;
}

const NETWORK_METHODS = new Set(['fetch', 'ajax', 'get', 'post', 'request', 'axios']);

/**
 * Recognise a browser-controlled taint source from a member or call expression.
 * Kept in sync with the source shapes seeded by the main analyzer's first pass.
 */
export function identifySource(node: t.Node): SourceInfo | null {
  const line = node.loc?.start.line ?? 0;

  if (t.isMemberExpression(node) && t.isIdentifier(node.property)) {
    const obj = node.object;
    const prop = node.property.name;
    if (t.isIdentifier(obj)) {
      if (obj.name === 'location' && ['href', 'search', 'hash', 'pathname'].includes(prop)) {
        return { sourceType: 'user_input', sourceLine: line };
      }
      if (obj.name === 'document' && prop === 'cookie') {
        return { sourceType: 'storage', sourceLine: line };
      }
      if (obj.name === 'localStorage' || obj.name === 'sessionStorage') {
        return { sourceType: 'storage', sourceLine: line };
      }
      if (obj.name === 'window' && prop === 'name') {
        return { sourceType: 'user_input', sourceLine: line };
      }
      if ((obj.name === 'event' || obj.name === 'message') && prop === 'data') {
        return { sourceType: 'network', sourceLine: line };
      }
    }
  }

  if (t.isCallExpression(node)) {
    const callee = node.callee;
    if (
      t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      NETWORK_METHODS.has(callee.property.name)
    ) {
      return { sourceType: 'network', sourceLine: line };
    }
  }

  return null;
}

/** Name of a call target when it is a bare identifier (`wrap(...)`), else null. */
export function calleeName(node: t.CallExpression): string | null {
  return t.isIdentifier(node.callee) ? node.callee.name : null;
}

function emptyTaint(): TaintInfo {
  return { params: new Set(), source: null };
}

function mergeInto(dst: TaintInfo, src: TaintInfo): void {
  src.params.forEach((p) => dst.params.add(p));
  if (!dst.source && src.source) {
    dst.source = src.source;
  }
}

function unionTaint(a: TaintInfo, b: TaintInfo): TaintInfo {
  const result: TaintInfo = { params: new Set(a.params), source: a.source };
  mergeInto(result, b);
  return result;
}

function evalExpr(node: t.Node | null | undefined, ctx: Ctx): TaintInfo {
  if (!node) {
    return emptyTaint();
  }

  if (t.isIdentifier(node)) {
    return ctx.local.get(node.name) ?? emptyTaint();
  }

  const source = identifySource(node);
  if (source) {
    return { params: new Set(), source };
  }

  if (t.isMemberExpression(node)) {
    // Member-chain: `a.data` carries the taint of its base object.
    return evalExpr(node.object, ctx);
  }

  if (t.isBinaryExpression(node)) {
    const left = t.isExpression(node.left) ? evalExpr(node.left, ctx) : emptyTaint();
    return unionTaint(left, evalExpr(node.right, ctx));
  }

  if (t.isCallExpression(node)) {
    if (ctx.checkSanitizer(node, ctx.sanitizers)) {
      return emptyTaint();
    }

    const argInfos = node.arguments.map((arg) =>
      t.isExpression(arg) ? evalExpr(arg, ctx) : emptyTaint(),
    );

    const name = calleeName(node);
    if (name && ctx.summaries.has(name)) {
      const summary = ctx.summaries.get(name)!;
      const result: TaintInfo = { params: new Set(), source: summary.returnsSource };
      summary.taintedParamIndices.forEach((idx) => {
        const argInfo = argInfos[idx];
        if (argInfo) {
          mergeInto(result, argInfo);
        }
      });
      return result;
    }

    // Unknown callee: conservatively pass through taint from any argument.
    const merged = emptyTaint();
    for (const argInfo of argInfos) {
      mergeInto(merged, argInfo);
    }
    return merged;
  }

  return emptyTaint();
}

function processStmt(node: t.Node, ctx: Ctx, ret: TaintInfo): void {
  if (t.isVariableDeclaration(node)) {
    for (const decl of node.declarations) {
      if (t.isIdentifier(decl.id) && decl.init) {
        ctx.local.set(decl.id.name, evalExpr(decl.init, ctx));
      }
    }
    return;
  }

  if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression)) {
    const { left, right } = node.expression;
    if (t.isIdentifier(left)) {
      const prev = ctx.local.get(left.name) ?? emptyTaint();
      ctx.local.set(left.name, unionTaint(prev, evalExpr(right, ctx)));
    }
    return;
  }

  if (t.isReturnStatement(node)) {
    if (node.argument) {
      mergeInto(ret, evalExpr(node.argument, ctx));
    }
    return;
  }

  if (t.isIfStatement(node)) {
    processStmt(node.consequent, ctx, ret);
    if (node.alternate) {
      processStmt(node.alternate, ctx, ret);
    }
    return;
  }

  if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      processStmt(stmt, ctx, ret);
    }
    return;
  }

  if (
    t.isForStatement(node) ||
    t.isForInStatement(node) ||
    t.isForOfStatement(node) ||
    t.isWhileStatement(node) ||
    t.isDoWhileStatement(node)
  ) {
    if (node.body) {
      processStmt(node.body, ctx, ret);
    }
    return;
  }

  if (t.isTryStatement(node)) {
    if (node.block) {
      processStmt(node.block, ctx, ret);
    }
    if (node.handler?.body) {
      processStmt(node.handler.body, ctx, ret);
    }
    if (node.finalizer) {
      processStmt(node.finalizer, ctx, ret);
    }
  }

  // Nested function declarations are intentionally not descended into: they get
  // their own summaries via the top-level fixpoint.
}

function analyzeFunction(
  def: FnDef,
  summaries: Map<string, FunctionSummary>,
  sanitizers: Set<string>,
  checkSanitizer: SanitizerCheck,
): TaintInfo {
  const local = new Map<string, TaintInfo>();
  def.params.forEach((name, index) => {
    if (name) {
      local.set(name, { params: new Set([index]), source: null });
    }
  });

  const ctx: Ctx = { local, summaries, sanitizers, checkSanitizer };
  const ret: TaintInfo = emptyTaint();

  if (t.isBlockStatement(def.body)) {
    for (const stmt of def.body.body) {
      processStmt(stmt, ctx, ret);
    }
  } else {
    // Arrow with an expression body: the expression IS the return value.
    mergeInto(ret, evalExpr(def.body, ctx));
  }

  return ret;
}

function sameSummary(a: FunctionSummary, b: FunctionSummary): boolean {
  if (a.taintedParamIndices.size !== b.taintedParamIndices.size) {
    return false;
  }
  for (const idx of a.taintedParamIndices) {
    if (!b.taintedParamIndices.has(idx)) {
      return false;
    }
  }
  return Boolean(a.returnsSource) === Boolean(b.returnsSource);
}

/**
 * Compute interprocedural taint summaries for every named function reachable in
 * the AST. Uses a monotonic fixpoint (taint only grows), so mutual recursion
 * converges; an iteration cap guards against pathological inputs.
 */
export function buildFunctionSummaries(
  ast: t.Node,
  sanitizers: Set<string>,
  checkSanitizer: SanitizerCheck,
): Map<string, FunctionSummary> {
  const fns = new Map<string, FnDef>();

  const register = (name: string, fn: t.Function): void => {
    if (fns.has(name)) {
      return;
    }
    const params = fn.params.map((p) => (t.isIdentifier(p) ? p.name : null));
    fns.set(name, { params, body: fn.body });
  };

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id) {
        register(path.node.id.name, path.node);
      }
    },
    VariableDeclarator(path) {
      const init = path.node.init;
      if (
        t.isIdentifier(path.node.id) &&
        (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))
      ) {
        register(path.node.id.name, init);
      }
    },
    AssignmentExpression(path) {
      const { left, right } = path.node;
      if (
        t.isIdentifier(left) &&
        (t.isFunctionExpression(right) || t.isArrowFunctionExpression(right))
      ) {
        register(left.name, right);
      }
    },
  });

  const summaries = new Map<string, FunctionSummary>();
  for (const name of fns.keys()) {
    summaries.set(name, { taintedParamIndices: new Set(), returnsSource: null });
  }

  // Worst case is a reverse-declared call chain of length N (f_N → f_{N-1} → …
  // → f_1), which needs N iterations to propagate taint end-to-end. Cap at the
  // function count with a sane floor/ceiling so pathological inputs stay bounded.
  const MAX_ITERATIONS = Math.min(Math.max(fns.size, 8), 64);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let changed = false;
    for (const [name, def] of fns) {
      const ret = analyzeFunction(def, summaries, sanitizers, checkSanitizer);
      const next: FunctionSummary = {
        taintedParamIndices: ret.params,
        returnsSource: ret.source,
      };
      if (!sameSummary(summaries.get(name)!, next)) {
        summaries.set(name, next);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return summaries;
}
