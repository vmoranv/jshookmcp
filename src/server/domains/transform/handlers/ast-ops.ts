import {
  parseCode,
  traverseAst,
  generate,
  t,
  type NodePath,
} from '@server/domains/analysis/shared/ast-utils';
import { decodeEscapedString } from './shared';

type BabelAst = ReturnType<typeof parseCode>;
type Generator = (ast: unknown, options: Record<string, unknown>) => { code: string };

const generateWithOptions = generate as unknown as Generator;

function parseTransformCode(code: string): BabelAst | null {
  try {
    return parseCode(code);
  } catch {
    return null;
  }
}

function preferredQuote(code: string): 'single' | 'double' {
  const single = code.indexOf("'");
  const double = code.indexOf('"');
  if (single >= 0 && (double < 0 || single < double)) return 'single';
  return 'double';
}

function normalizeGeneratedCode(original: string, ast: BabelAst): string {
  const quote = preferredQuote(original);
  let code = generateWithOptions(ast, {
    retainLines: true,
    jsescOption: { quotes: quote },
  }).code;

  const originalTrimmed = original.trim();
  const lastStatement = ast.program.body[ast.program.body.length - 1];
  if (!original.includes('\n')) {
    code = code.replace(/;(?=\S)/g, '; ');
  }
  if (!originalTrimmed.endsWith(';') && lastStatement && t.isExpressionStatement(lastStatement)) {
    code = code.replace(/;$/, '');
  }
  return code;
}

function transformOnce(
  code: string,
  makeVisitor: (markChanged: () => void) => Record<string, (path: NodePath) => void>,
): string {
  const ast = parseTransformCode(code);
  if (!ast) return code;
  let changed = false;
  const markChanged = () => {
    changed = true;
  };
  const visitor = makeVisitor(markChanged);
  traverseAst(ast, visitor);
  if (!changed) return code;
  return normalizeGeneratedCode(code, ast);
}

function isFiniteNumericResult(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) !== Infinity;
}

function foldNumeric(left: number, operator: string, right: number): number | null {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? null : left / right;
    case '%':
      return right === 0 ? null : left % right;
    default:
      return null;
  }
}

export function transformConstantFoldAst(code: string): string {
  let current = code;
  for (let round = 0; round < 4; round++) {
    const next = transformOnce(current, (markChanged) => ({
      BinaryExpression(path) {
        const node = path.node;
        if (!t.isBinaryExpression(node)) return;
        if (t.isNumericLiteral(node.left) && t.isNumericLiteral(node.right)) {
          const folded = foldNumeric(node.left.value, node.operator, node.right.value);
          if (folded === null || !isFiniteNumericResult(folded)) return;
          const normalized = Number.isInteger(folded) ? folded : Number(folded.toFixed(12));
          markChanged();
          path.replaceWith(t.numericLiteral(normalized));
          path.skip();
          return;
        }

        if (
          node.operator === '+' &&
          t.isStringLiteral(node.left) &&
          t.isStringLiteral(node.right)
        ) {
          markChanged();
          path.replaceWith(t.stringLiteral(`${node.left.value}${node.right.value}`));
          path.skip();
        }
      },
    }));
    if (next === current) break;
    current = next;
  }
  return current;
}

function rawStringInner(node: t.StringLiteral): string {
  const raw = (node.extra as { raw?: string } | undefined)?.raw;
  if (typeof raw === 'string' && raw.length >= 2) return raw.slice(1, -1);
  return node.value;
}

function isPrintable(value: string): boolean {
  if (value.length === 0) return false;
  let printable = 0;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) {
      printable += 1;
    }
  }
  return printable / value.length >= 0.9;
}

function tryDecodeBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return isPrintable(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function tryDecodeHex(value: string, rawInner: string): string | null {
  const slashHex = rawInner.match(/^(?:\\x[0-9a-fA-F]{2})+$/);
  const plainHex = /^[0-9a-fA-F]{32,}$/.test(value) && value.length % 2 === 0;
  if (!slashHex && !plainHex) return null;
  try {
    const hex = slashHex ? rawInner.replace(/\\x/g, '') : value;
    const decoded = Buffer.from(hex, 'hex').toString('utf8');
    return isPrintable(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isStringLiteralNode(node: t.Node | null | undefined): node is t.StringLiteral {
  return t.isStringLiteral(node);
}

function calleeName(node: t.Node | null | undefined): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node) && !node.computed) {
    const object = node.object;
    const property = node.property;
    if (t.isIdentifier(object) && t.isIdentifier(property)) {
      return `${object.name}.${property.name}`;
    }
  }
  return null;
}

function tryUnwrapCall(node: t.CallExpression): string | null {
  const callee = calleeName(node.callee);
  if (!callee) return null;
  const args = node.arguments;

  // atob(<base64 literal>) — browser global, obfuscator.io default.
  // atob's own semantics IS base64, so we don't apply the 16-char length gate
  // that guards the speculative StringLiteral decode path; we only require a
  // valid base64 alphabet and a printable result.
  if (callee === 'atob' && args.length === 1) {
    const arg = args[0];
    if (
      isStringLiteralNode(arg) &&
      /^[A-Za-z0-9+/=]*$/.test(arg.value) &&
      arg.value.length % 4 === 0
    ) {
      try {
        const decoded = Buffer.from(arg.value, 'base64').toString('utf8');
        return isPrintable(decoded) ? decoded : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  // Buffer.from(<hex literal>, "hex")
  if (callee === 'Buffer.from' && args.length === 2) {
    const [dataArg, encArg] = args;
    if (
      isStringLiteralNode(dataArg) &&
      isStringLiteralNode(encArg) &&
      encArg.value.toLowerCase() === 'hex'
    ) {
      try {
        const decoded = Buffer.from(dataArg.value, 'hex').toString('utf8');
        return isPrintable(decoded) ? decoded : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  // String.fromCharCode(<num>, <num>, ...) — charcode join
  if (callee === 'String.fromCharCode' && args.length >= 1) {
    const codes: number[] = [];
    for (const arg of args) {
      if (!t.isNumericLiteral(arg) || !Number.isInteger(arg.value)) return null;
      codes.push(arg.value);
    }
    try {
      const decoded = String.fromCharCode(...codes);
      return isPrintable(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function transformStringDecryptAst(code: string): string {
  const ast = parseTransformCode(code);
  if (!ast) return code;
  let overallChanged = false;

  for (const directive of ast.program.directives) {
    const literal = directive.value;
    const raw = (literal.extra as { raw?: string; expressionValue?: string } | undefined)?.raw;
    const rawInner = typeof raw === 'string' ? raw.slice(1, -1) : literal.value;
    const escapedDecoded = decodeEscapedString(rawInner);
    const cleartext =
      tryDecodeBase64(escapedDecoded) ?? tryDecodeHex(escapedDecoded, rawInner) ?? escapedDecoded;
    if (cleartext !== literal.value || rawInner !== escapedDecoded) {
      overallChanged = true;
      ast.program.body.unshift(t.expressionStatement(t.stringLiteral(cleartext)));
      ast.program.directives = ast.program.directives.filter((item) => item !== directive);
    }
  }

  // Multi-pass to a fixpoint (bounded at 4 rounds, matching constant_fold).
  // Nested call wrappers like atob(atob(...)) and atob(Buffer.from(...)) need
  // this: the outer callee is visited before its (still-call) argument, so a
  // single pass leaves the outer wrapper in place once the inner is decoded.
  // Each subsequent pass re-visits the now-literal argument.
  for (let round = 0; round < 4; round++) {
    let roundChanged = false;
    traverseAst(ast, {
      StringLiteral(path) {
        const node = path.node;
        if (!t.isStringLiteral(node)) return;
        const rawInner = rawStringInner(node);
        const escapedDecoded = decodeEscapedString(rawInner);
        const cleartext =
          tryDecodeBase64(escapedDecoded) ??
          tryDecodeHex(escapedDecoded, rawInner) ??
          escapedDecoded;
        if (cleartext !== node.value || rawInner !== escapedDecoded) {
          roundChanged = true;
          overallChanged = true;
          path.replaceWith(t.stringLiteral(cleartext));
          path.skip();
        }
      },
      CallExpression(path) {
        const node = path.node;
        if (!t.isCallExpression(node)) return;
        const unwrapped = tryUnwrapCall(node);
        if (unwrapped !== null) {
          roundChanged = true;
          overallChanged = true;
          path.replaceWith(t.stringLiteral(unwrapped));
          path.skip();
        }
      },
    });
    if (!roundChanged) break;
  }
  if (!overallChanged) return code;
  return normalizeGeneratedCode(code, ast);
}

function isLiteralFalsy(node: t.Node): boolean {
  if (t.isBooleanLiteral(node)) return node.value === false;
  if (t.isNumericLiteral(node)) return node.value === 0;
  if (t.isStringLiteral(node)) return node.value.length === 0;
  if (t.isNullLiteral(node)) return true;
  return false;
}

function isLiteralTruthy(node: t.Node): boolean {
  if (t.isBooleanLiteral(node)) return node.value === true;
  if (t.isNumericLiteral(node)) return node.value !== 0;
  if (t.isStringLiteral(node)) return node.value.length > 0;
  return false;
}

function isAlwaysFalse(node: t.Node): boolean {
  if (isLiteralFalsy(node)) return true;
  // !truthyLiteral -> false  (e.g. !1, !true, !"x") — negated-literal dead guards
  if (t.isUnaryExpression(node, { operator: '!' }) && isLiteralTruthy(node.argument)) return true;
  return false;
}

function replacementStatements(node: t.Statement): t.Statement[] {
  return t.isBlockStatement(node) ? [...node.body] : [node];
}

export function transformDeadCodeRemoveAst(code: string): string {
  return transformOnce(code, (markChanged) => ({
    IfStatement(path) {
      const node = path.node;
      if (!t.isIfStatement(node) || !isAlwaysFalse(node.test)) return;
      markChanged();
      if (node.alternate) {
        path.replaceWithMultiple(replacementStatements(node.alternate));
      } else {
        path.remove();
      }
      path.skip();
    },
  }));
}

function isAlwaysTrue(node: t.Node): boolean {
  if (isLiteralTruthy(node)) return true;
  // !falsyLiteral -> true  (e.g. !0, !false, !"", !null) — negated-literal loop guards
  if (t.isUnaryExpression(node, { operator: '!' }) && isLiteralFalsy(node.argument)) return true;
  // !!array -> true  (obfuscator.io canonical while(!![]))
  if (
    t.isUnaryExpression(node, { operator: '!' }) &&
    t.isUnaryExpression(node.argument, { operator: '!' }) &&
    t.isArrayExpression(node.argument.argument)
  ) {
    return true;
  }
  return false;
}

function identifierName(node: t.Node | null | undefined): string | null {
  return t.isIdentifier(node) ? node.name : null;
}

function switchDispatcher(node: t.Node): { dispatcher: string; cursor: string | null } | null {
  if (!t.isMemberExpression(node) || node.computed !== true) return null;
  const dispatcher = identifierName(node.object);
  if (!dispatcher) return null;
  const property = node.property;
  if (t.isUpdateExpression(property)) {
    return { dispatcher, cursor: identifierName(property.argument) };
  }
  return { dispatcher, cursor: identifierName(property) };
}

function literalKey(node: t.Expression | null | undefined): string | null {
  if (!node) return null;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return String(node.value);
  return null;
}

function orderFromInit(node: t.Node | null | undefined): string[] {
  if (!node) return [];
  if (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isStringLiteral(node.callee.object) &&
    t.isIdentifier(node.callee.property, { name: 'split' })
  ) {
    const delimiter = node.arguments[0];
    if (!delimiter || (t.isStringLiteral(delimiter) && delimiter.value === '|')) {
      return node.callee.object.value.split('|');
    }
  }
  if (t.isArrayExpression(node)) {
    return node.elements
      .map((element) =>
        t.isStringLiteral(element) || t.isNumericLiteral(element) ? String(element.value) : null,
      )
      .filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function dispatcherOrder(
  path: NodePath,
  dispatcher: string,
  switchNode: t.SwitchStatement,
): string[] {
  const binding = path.scope.getBinding(dispatcher);
  const bindingNode = binding?.path.node;
  if (
    bindingNode &&
    t.isVariableDeclarator(bindingNode) &&
    t.isIdentifier(bindingNode.id, { name: dispatcher })
  ) {
    const order = orderFromInit(bindingNode.init);
    if (order.length > 0) return order;
  }
  return switchNode.cases.map((caseNode) => literalKey(caseNode.test)).filter(Boolean) as string[];
}

function isCursorMutation(statement: t.Statement, cursorName: string | null): boolean {
  if (!cursorName) return false;
  const expr = t.isExpressionStatement(statement) ? statement.expression : null;
  // i++ / ++i / i-- / --i
  if (expr && t.isUpdateExpression(expr) && t.isIdentifier(expr.argument, { name: cursorName })) {
    return true;
  }
  // i = ... / i += ... (assignment whose left is the cursor)
  if (expr && t.isAssignmentExpression(expr) && t.isIdentifier(expr.left, { name: cursorName })) {
    return true;
  }
  return false;
}

function extractCaseStatements(
  switchNode: t.SwitchStatement,
  cursorName: string | null,
): Map<string, t.Statement[]> {
  const cases = new Map<string, t.Statement[]>();
  for (const caseNode of switchNode.cases) {
    const key = literalKey(caseNode.test);
    if (!key) continue;
    const statements = caseNode.consequent
      .filter(
        (statement) =>
          !t.isContinueStatement(statement) &&
          !t.isBreakStatement(statement) &&
          !isCursorMutation(statement, cursorName),
      )
      .map((statement) => t.cloneNode(statement, true));
    if (statements.length > 0) cases.set(key, statements);
  }
  return cases;
}

function removeBindingDeclaration(path: NodePath, name: string): void {
  const binding = path.scope.getBinding(name);
  if (!binding) return;
  const bindingPath = binding.path;
  if (!bindingPath.isVariableDeclarator()) return;
  const parent = bindingPath.parentPath;
  if (parent?.isVariableDeclaration() && parent.node.declarations.length === 1) {
    parent.remove();
  } else {
    bindingPath.remove();
  }
}

function flattenLoop(
  path: NodePath<t.WhileStatement | t.DoWhileStatement>,
  markChanged: () => void,
): void {
  const node = path.node;
  if (!isAlwaysTrue(node.test) || !t.isBlockStatement(node.body)) return;
  const switchNode = node.body.body.find((statement): statement is t.SwitchStatement =>
    t.isSwitchStatement(statement),
  );
  if (!switchNode) return;
  const dispatch = switchDispatcher(switchNode.discriminant);
  if (!dispatch) return;
  const order = dispatcherOrder(path, dispatch.dispatcher, switchNode);
  const cases = extractCaseStatements(switchNode, dispatch.cursor);
  const rebuilt = order.flatMap((key) => cases.get(key) ?? []);
  if (rebuilt.length === 0) return;
  markChanged();
  path.replaceWithMultiple(rebuilt);
  removeBindingDeclaration(path, dispatch.dispatcher);
  if (dispatch.cursor) removeBindingDeclaration(path, dispatch.cursor);
  path.skip();
}

export function transformControlFlowFlattenAst(code: string): string {
  const ast = parseTransformCode(code);
  if (!ast) return code;
  let changed = false;
  const markChanged = () => {
    changed = true;
  };
  traverseAst(ast, {
    WhileStatement(path) {
      flattenLoop(path as NodePath<t.WhileStatement>, markChanged);
    },
    DoWhileStatement(path) {
      flattenLoop(path as NodePath<t.DoWhileStatement>, markChanged);
    },
  });

  if (!changed) return code;
  let out = normalizeGeneratedCode(code, ast);
  const originalTrimmed = code.trim();
  if (!originalTrimmed.includes('\n') && ast.program.body.length > 1) {
    out = out.replace(/;\s*/g, ';\n').trim();
  }
  const lastStatement = ast.program.body[ast.program.body.length - 1];
  if (lastStatement && t.isExpressionStatement(lastStatement) && !out.trimEnd().endsWith(';')) {
    out = `${out};`;
  }
  return out;
}

interface RenameBinding {
  path: { isVariableDeclarator(): boolean };
  kind?: string;
}

function shouldRenameBinding(name: string, binding: RenameBinding): boolean {
  if (/^_0x[0-9a-fA-F]+$/.test(name)) return true;
  if (!/^[A-Za-z]$/.test(name)) return false;
  return binding.path.isVariableDeclarator() || binding.kind === 'param';
}

function nextRename(existing: Set<string>, counter: { value: number }): string {
  let candidate = `var_${counter.value}`;
  while (existing.has(candidate)) {
    counter.value += 1;
    candidate = `var_${counter.value}`;
  }
  existing.add(candidate);
  counter.value += 1;
  return candidate;
}

export function transformRenameVarsAst(code: string): string {
  const ast = parseTransformCode(code);
  if (!ast) return code;
  const processedScopes = new WeakSet<object>();
  const counter = { value: 1 };
  let changed = false;

  traverseAst(ast, {
    Scopable(path) {
      const scope = path.scope;
      if (processedScopes.has(scope)) return;
      processedScopes.add(scope);
      const existing = new Set(Object.keys(scope.bindings));
      for (const name of Object.keys(scope.bindings)) {
        const binding = scope.bindings[name];
        if (!binding || !shouldRenameBinding(name, binding)) continue;
        const nextName = nextRename(existing, counter);
        changed = true;
        scope.rename(name, nextName);
      }
    },
  });

  if (!changed) return code;
  return normalizeGeneratedCode(code, ast);
}
