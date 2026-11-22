import * as parser from '@babel/parser';
import { BABEL_PARSE_PLUGINS } from '@utils/babel-plugins';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { replaceOutsideProtectedRanges } from './ast-safe-replace';

const NUMERIC_BINARY_EXPR = /\b(-?\d+(?:\.\d+)?)\s*([+\-%*/])\s*(-?\d+(?:\.\d+)?)\b/g;
const CFF_PATTERN =
  /var\s+([A-Za-z_$]\w*)\s*=\s*['"]([^'"]+)['"]\.split\(['"]\|['"]\)\s*;\s*var\s+(\w+)\s*=\s*0\s*;\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\s*\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;
const CFF_PATTERN_VAR2 =
  /var\s+([A-Za-z_$]\w*)\s*=\s*\[(['"][^'"]*['"]\s*(?:,\s*['"][^'"]*['"]\s*)*)\];\s*var\s+(\w+)\s*=\s*(\d+);\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;
const STRING_CONCAT = /['"]([^'"]*)['"]\s*\+\s*['"]([^'"]*)['"]/g;

interface TextReplacement {
  start: number;
  end: number;
  text: string;
}

function findNonWhitespace(input: string, start: number, step: -1 | 1): string {
  for (let index = start; index >= 0 && index < input.length; index += step) {
    const char = input[index];
    if (char && !/\s/.test(char)) {
      return char;
    }
  }
  return '';
}

function applyTextReplacements(code: string, replacements: TextReplacement[]): string {
  const sorted = replacements.toSorted((a, b) => b.start - a.start || b.end - a.end);
  let next = code;
  for (const replacement of sorted) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return next;
}

function getBindingReplacement(
  path: NodePath<t.Identifier>,
  renameMap: Map<string, string>,
): string | null {
  const replacement = renameMap.get(path.node.name);
  if (!replacement) {
    return null;
  }

  const binding = path.scope.getBinding(path.node.name);
  if (
    !binding ||
    !t.isVariableDeclarator(binding.path.node) ||
    !t.isIdentifier(binding.path.node.id) ||
    !renameMap.has(binding.path.node.id.name)
  ) {
    return null;
  }

  const isBindingId = binding.identifier === path.node;
  const isReference = path.isReferencedIdentifier();
  const isAssignmentTarget = path.key === 'left' && path.parentPath.isAssignmentExpression();
  const isForLoopTarget =
    path.key === 'left' &&
    (path.parentPath.isForInStatement() || path.parentPath.isForOfStatement());
  const isUpdateTarget = path.key === 'argument' && path.parentPath.isUpdateExpression();

  if (!isBindingId && !isReference && !isAssignmentTarget && !isForLoopTarget && !isUpdateTarget) {
    return null;
  }

  return replacement;
}

function applyRenameVarsWithAst(code: string, renameMap: Map<string, string>): string | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: BABEL_PARSE_PLUGINS,
      errorRecovery: true,
    });
    const replacements = new Map<string, TextReplacement>();

    traverse(ast, {
      ObjectProperty(path) {
        if (
          !path.node.shorthand ||
          !t.isIdentifier(path.node.key) ||
          !t.isIdentifier(path.node.value)
        ) {
          return;
        }

        const valuePath = path.get('value');
        if (!valuePath.isIdentifier()) {
          return;
        }

        const replacement = getBindingReplacement(valuePath, renameMap);
        const { start, end } = path.node;
        if (!replacement || start === null || start === undefined) {
          return;
        }
        if (end === null || end === undefined) {
          return;
        }

        replacements.set(`${start}:${end}`, {
          start,
          end,
          text: `${path.node.key.name}: ${replacement}`,
        });
        path.skip();
      },
      Identifier(path) {
        const replacement = getBindingReplacement(path, renameMap);
        const { start, end } = path.node;
        if (!replacement || start === null || start === undefined) {
          return;
        }
        if (end === null || end === undefined) {
          return;
        }

        replacements.set(`${start}:${end}`, {
          start,
          end,
          text: replacement,
        });
      },
    });

    if (replacements.size === 0) {
      return code;
    }
    return applyTextReplacements(code, [...replacements.values()]);
  } catch {
    return null;
  }
}

/**
 * Format a fold result for emission. Integers fold as-is; non-integers fold
 * ONLY when the value survives a 12-digit round-trip (a terminating decimal
 * like 2.5) — non-terminating decimals (1/3) are left unfolded so precision
 * is never truncated. NaN/Infinity never fold.
 */
function formatFoldValue(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toFixed(12));
  if (rounded !== value) return null;
  return String(rounded);
}

/**
 * Resolve a node to its numeric value by recursively evaluating literal-only
 * subtrees (numeric literals, unary +/- literals, and binary expressions of
 * the same). Returns null for anything involving an identifier or other
 * non-literal. Division/modulo by zero yields null (never Infinity/NaN).
 */
function numericValueOf(node: t.Node): number | null {
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isUnaryExpression(node) && (node.operator === '-' || node.operator === '+')) {
    const value = numericValueOf(node.argument);
    if (value === null) return null;
    return node.operator === '-' ? -value : value;
  }
  if (t.isBinaryExpression(node)) {
    const left = numericValueOf(node.left);
    const right = numericValueOf(node.right);
    if (left === null || right === null) return null;
    switch (node.operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return right !== 0 ? left / right : null;
      case '%':
        return right !== 0 ? left % right : null;
    }
  }
  return null;
}

/**
 * AST-guided constant folding. Operator precedence is preserved by
 * construction (the tree already encodes it), so `5+3*2` folds to `11`, never
 * `8*2`. Only INTEGER results are folded: folding floats would lose
 * round-trip precision (`(1/3)*3` must stay `1`), and NaN/Infinity must not
 * be emitted.
 */
function applyConstantFoldWithAst(code: string): string | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: BABEL_PARSE_PLUGINS,
    });
    const replacements = new Map<string, TextReplacement>();
    const record = (
      node: { start?: number | null | undefined; end?: number | null | undefined },
      text: string,
    ): void => {
      if (
        node.start === null ||
        node.start === undefined ||
        node.end === null ||
        node.end === undefined
      ) {
        return;
      }
      // Drop any nested replacement covered by this node: once the outer
      // range is rewritten, the inner positions would drift (they were
      // measured against the original text) and corrupt the output.
      for (const [key, existing] of replacements) {
        if (existing.start >= node.start && existing.end <= node.end) {
          replacements.delete(key);
        }
      }
      replacements.set(`${node.start}:${node.end}`, { start: node.start, end: node.end, text });
    };

    traverse(ast, {
      BinaryExpression: {
        exit(path) {
          const node = path.node;
          // Recursive evaluation: the whole literal-only subtree folds at once
          // (5+3*2 → 11, never 8*2), and precedence is preserved because the
          // tree already encodes it. Non-literal subtrees (identifiers, calls)
          // yield null and are left untouched.
          const value = numericValueOf(node);
          const folded = value === null ? null : formatFoldValue(value);
          if (folded !== null) {
            record(node, folded);
          } else if (
            node.operator === '+' &&
            t.isStringLiteral(node.left) &&
            t.isStringLiteral(node.right)
          ) {
            record(node, JSON.stringify(node.left.value + node.right.value));
          }
        },
      },
    });

    if (replacements.size === 0) {
      return code;
    }
    return applyTextReplacements(code, [...replacements.values()]);
  } catch {
    return null;
  }
}

/**
 * Guarded regex fallback for inputs the parser rejects (e.g. `function { 8 - 3`).
 * Folds only self-contained expressions: a match is skipped when it continues
 * a larger numeric expression (previous non-whitespace char is a digit/`)`/
 * operator) or when it is followed by `*`/`/` — so `5+3*2` is left untouched
 * instead of corrupting precedence into `8*2`.
 */
function applyConstantFoldFallback(code: string): string {
  let result = code;
  result = replaceOutsideProtectedRanges(
    result,
    NUMERIC_BINARY_EXPR,
    (full, leftRaw: string, op: string, rightRaw: string, offset: number, whole: string) => {
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return full;
      }

      // NOTE: `whole` is the full input string, `offset` its global offset —
      // findNonWhitespace must scan the WHOLE string, not the match text.
      const prev = findNonWhitespace(whole, offset - 1, -1);
      const next = findNonWhitespace(whole, offset + full.length, 1);
      const continuesLargerExpr = prev !== '' && /[0-9+\-*/%().\]]/.test(prev);
      const continuesIntoMulDiv = next !== '' && /[0-9*/]/.test(next);
      if (continuesLargerExpr || continuesIntoMulDiv) {
        return full;
      }

      let value: number | null = null;
      if (op === '+') value = left + right;
      else if (op === '-') value = left - right;
      else if (op === '*') value = left * right;
      else if (op === '/' && right !== 0) value = left / right;
      else if (op === '%' && right !== 0) value = left % right;

      if (value === null || !Number.isFinite(value) || !Number.isInteger(value)) {
        return full;
      }
      return String(value);
    },
  );

  result = replaceOutsideProtectedRanges(
    result,
    STRING_CONCAT,
    (_full, left: string, right: string) => JSON.stringify(`${left}${right}`),
  );

  const unaryNegDouble = /--(\d)/g;
  result = replaceOutsideProtectedRanges(result, unaryNegDouble, (_full, digit: string) => digit);

  // Unary plus only when the `+` is a true unary operator (preceded by an
  // expression opener / line start). `5+3*2`'s `+3` is a binary plus — folding
  // it would corrupt `5+3*2` into `53*2`.
  const unaryPlusNumber = /(^|[^0-9a-zA-Z_$)\]})'"`])\+\s*(\d+(?:\.\d+)?)/g;
  result = replaceOutsideProtectedRanges(
    result,
    unaryPlusNumber,
    (_full, prefix: string, num: string) => `${prefix}${num}`,
  );

  const hexPattern = /\b0x([0-9a-fA-F]{2,8})\b/g;
  result = replaceOutsideProtectedRanges(result, hexPattern, (_full, hex: string) => {
    const value = Number.parseInt(hex, 16);
    return Number.isFinite(value) ? String(value) : _full;
  });

  return result;
}

export function applyConstantFold(code: string): string {
  const astResult = applyConstantFoldWithAst(code);
  return astResult === null ? applyConstantFoldFallback(code) : astResult;
}

/** Inner text of a BlockStatement (between the braces, whitespace preserved). */
function blockInnerText(code: string, block: t.BlockStatement): string {
  return code.slice(block.start! + 1, block.end! - 1);
}

function isBlock(n: t.Node | null | undefined): n is t.BlockStatement {
  return !!n && t.isBlockStatement(n);
}

/**
 * AST-guided dead-code removal. The AST's start/end ranges let the rewrite
 * handle NESTED braces correctly (a regex `[^}]*` truncates at the first
 * closing brace and leaves dangling code) while the surrounding whitespace is
 * preserved.
 */
function applyDeadCodeRemoveWithAst(code: string): string | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: BABEL_PARSE_PLUGINS,
    });
    const replacements = new Map<string, TextReplacement>();
    const record = (
      node: { start?: number | null | undefined; end?: number | null | undefined },
      text: string,
    ): void => {
      if (
        node.start === null ||
        node.start === undefined ||
        node.end === null ||
        node.end === undefined
      ) {
        return;
      }
      replacements.set(`${node.start}:${node.end}`, { start: node.start, end: node.end, text });
    };

    traverse(ast, {
      IfStatement: {
        exit(path) {
          const node = path.node;
          if (t.isBooleanLiteral(node.test)) {
            if (node.test.value === false) {
              if (node.alternate && isBlock(node.alternate)) {
                record(node, blockInnerText(code, node.alternate));
              } else if (node.alternate) {
                record(node, code.slice(node.alternate.start!, node.alternate.end!));
              } else {
                record(node, '');
              }
            } else if (node.consequent && isBlock(node.consequent)) {
              record(node, blockInnerText(code, node.consequent));
            } else if (node.consequent) {
              record(node, code.slice(node.consequent.start!, node.consequent.end!));
            }
          } else if (
            node.consequent &&
            isBlock(node.consequent) &&
            node.consequent.body.length === 0
          ) {
            // Empty then-branch: drop it; keep a real else body.
            if (node.alternate && isBlock(node.alternate)) {
              record(node, blockInnerText(code, node.alternate));
            } else if (node.alternate) {
              record(node, code.slice(node.alternate.start!, node.alternate.end!));
            } else {
              record(node, '');
            }
          }
        },
      },
      ConditionalExpression: {
        exit(path) {
          const node = path.node;
          if (t.isBooleanLiteral(node.test)) {
            const chosen = node.test.value ? node.consequent : node.alternate;
            let text = code.slice(chosen.start!, chosen.end!);
            // A bare sequence expression has no parens in the AST range
            // (babel excludes them) — re-wrap so `false ? x : (b,c)` keeps
            // the comma expression intact instead of corrupting it.
            if (t.isSequenceExpression(chosen)) text = `(${text})`;
            record(node, text);
          }
        },
      },
    });

    if (replacements.size === 0) {
      return code;
    }
    return applyTextReplacements(code, [...replacements.values()]);
  } catch {
    return null;
  }
}

/**
 * Guarded regex fallback for unparseable inputs: removes only FLAT dead
 * blocks (no nested braces — `[^{}]*` refuses anything containing a brace),
 * so a nested `if(false){ if(x){a} }` is left untouched instead of being
 * truncated at the first `}`.
 */
function applyDeadCodeRemoveFallback(code: string): string {
  let result = code;

  result = replaceOutsideProtectedRanges(
    result,
    /if\s*\(\s*false\s*\)\s*\{[^{}]*\}\s*else\s*\{([^{}]*)\}/g,
    (_full, elseBody: string) => elseBody,
  );

  result = replaceOutsideProtectedRanges(result, /if\s*\(\s*false\s*\)\s*\{[^{}]*\}\s*/g, '');

  result = replaceOutsideProtectedRanges(
    result,
    /if\s*\(\s*true\s*\)\s*\{([^{}]*)\}\s*(?:else\s*\{[^{}]*\}\s*)?/g,
    (_full, trueBody: string) => trueBody,
  );

  result = replaceOutsideProtectedRanges(
    result,
    /\btrue\s*\?\s*([^:]+)\s*:\s*([^,;)\]}]+)/g,
    (_full, ifVal: string) => ifVal,
  );
  result = replaceOutsideProtectedRanges(
    result,
    /\bfalse\s*\?\s*[^:]+\s*:\s*([^,;)}\]]+)/g,
    (_full, elseVal: string) => elseVal,
  );

  result = replaceOutsideProtectedRanges(result, /if\s*\([^)]*\)\s*\{\s*\}\s*/g, '');
  return result;
}

export function applyDeadCodeRemove(code: string): string {
  const astResult = applyDeadCodeRemoveWithAst(code);
  return astResult === null ? applyDeadCodeRemoveFallback(code) : astResult;
}

export function applyControlFlowFlatten(code: string): string {
  let result = code;

  result = replaceOutsideProtectedRanges(
    result,
    CFF_PATTERN,
    (_full, _dispatcher: string, orderRaw: string, _cursor: string, switchBody: string) => {
      const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
      const caseMap = new Map<string, string>();
      let match: RegExpExecArray | null;
      while ((match = caseRegex.exec(switchBody)) !== null) {
        const key = match[1];
        const body = (match[2] ?? '')
          .replace(/\bcontinue\s*;?/g, '')
          .replace(/\bbreak\s*;?/g, '')
          .trim();
        if (key && body.length > 0) {
          caseMap.set(key, body);
        }
      }
      const order = orderRaw.split('|').map((value) => value.trim());
      const rebuilt = order
        .map((token) => caseMap.get(token))
        .filter((value): value is string => !!value)
        .join('\n');
      return rebuilt.length > 0 ? rebuilt : _full;
    },
  );

  result = replaceOutsideProtectedRanges(
    result,
    CFF_PATTERN_VAR2,
    (
      _full,
      _dispatcher: string,
      arrContent: string,
      _cursor: string,
      _startIdx: string,
      switchBody: string,
    ) => {
      const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
      const caseMap = new Map<string, string>();
      let match: RegExpExecArray | null;
      while ((match = caseRegex.exec(switchBody)) !== null) {
        const key = match[1];
        const body = (match[2] ?? '')
          .replace(/\bcontinue\s*;?/g, '')
          .replace(/\bbreak\s*;?/g, '')
          .trim();
        if (key && body.length > 0) {
          caseMap.set(key, body);
        }
      }
      const order = arrContent
        .split(/,\s*/)
        .map((value) => value.replace(/^['"]|['"]$/g, '').trim());
      const rebuilt = order
        .map((token) => caseMap.get(token))
        .filter((value): value is string => !!value)
        .join('\n');
      return rebuilt.length > 0 ? rebuilt : _full;
    },
  );

  return result;
}

export function applyRenameVars(code: string): { code: string; count: number } {
  const declared = new Set<string>();
  const re = /\b(?:var|let|const)\s+([A-Za-z_$]\w{0,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const name = match[1];
    if (name && (name.length <= 2 || name.startsWith('_0x') || name.startsWith('_'))) {
      declared.add(name);
    }
  }
  if (declared.size === 0) {
    return { code, count: 0 };
  }

  const renameMap = new Map<string, string>();
  let counter = 1;
  for (const name of declared) {
    renameMap.set(name, `var_${counter}`);
    counter++;
  }

  const astRenamed = applyRenameVarsWithAst(code, renameMap);
  if (astRenamed !== null) {
    return {
      code: astRenamed,
      count: astRenamed === code ? 0 : renameMap.size,
    };
  }

  const newCode = code.replace(
    new RegExp(
      `\\b(${[...declared].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
      'g',
    ),
    (token, id, offset, full) => {
      const replacement = renameMap.get(id);
      if (!replacement) {
        return token;
      }

      const prev = offset > 0 ? full[offset - 1] : '';
      const prevNonWhitespace = findNonWhitespace(full, offset - 1, -1);
      const nextNonWhitespace = findNonWhitespace(full, offset + token.length, 1);

      if (prev === '.' || prev === "'" || prev === '"' || prev === '`' || prev === '$') {
        return token;
      }
      if (
        (prevNonWhitespace === '{' || prevNonWhitespace === ',') &&
        (nextNonWhitespace === ':' || nextNonWhitespace === '(')
      ) {
        return token;
      }
      return replacement;
    },
  );

  return { code: newCode, count: newCode === code ? 0 : renameMap.size };
}
