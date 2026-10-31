/**
 * AST analysis handlers: analysis_ast_match, analysis_deflat_control_flow
 */

import { argBool, argNumber, argString } from '@server/domains/shared/parse-args';
import { cpuLimit } from '@utils/concurrency';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { parseCode, traverseAst, generateCode, t } from '../shared/ast-utils';
import type { NodePath } from '@babel/traverse';

const SIMPLE_CONTROL_FLOW_HELPERS = new Set(['call', 'apply'] as const);

type BabelNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  [key: string]: unknown;
};

export async function handleAnalysisAstMatch(args: ToolArgs): Promise<ToolResponse> {
  const code = argString(args, 'code');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }
  const nodeType = argString(args, 'nodeType');
  if (!nodeType) {
    return asJsonResponse({ success: false, error: 'nodeType is required' });
  }

  const maxResults = argNumber(args, 'maxResults', 50);
  const filterRaw = argString(args, 'filter');
  let filter: Record<string, string> | undefined;
  if (filterRaw) {
    try {
      filter = JSON.parse(filterRaw) as Record<string, string>;
    } catch {
      return asJsonResponse({ success: false, error: 'filter must be valid JSON' });
    }
  }

  return cpuLimit(async (): Promise<ToolResponse> => {
    let ast: ReturnType<typeof parseCode>;
    try {
      ast = parseCode(code, { plugins: ['jsx', 'typescript'] });
    } catch (err) {
      return asJsonResponse({
        success: false,
        error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const matches: Array<{
      type: string;
      start: number;
      end: number;
      code: string;
      properties: Record<string, unknown>;
    }> = [];

    const targetNodeType = nodeType;

    function matchesFilter(node: BabelNode): boolean {
      if (!filter) return true;
      for (const [path, value] of Object.entries(filter)) {
        const parts = path.split('.');
        let current: unknown = node;
        for (const part of parts) {
          if (current === null || current === undefined || typeof current !== 'object')
            return false;
          current = (current as Record<string, unknown>)[part];
        }
        if (String(current) !== String(value)) return false;
      }
      return true;
    }

    function extractProperties(node: BabelNode): Record<string, unknown> {
      const props: Record<string, unknown> = {};
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range')
          continue;
        const val = node[key];
        if (
          val === null ||
          val === undefined ||
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean'
        ) {
          props[key] = val;
        } else if (Array.isArray(val) && val.length <= 5) {
          props[key] = val.map((v) =>
            typeof v === 'object' && v !== null && 'type' in (v as object)
              ? { type: (v as BabelNode).type }
              : v,
          );
        } else if (typeof val === 'object' && val !== null && 'type' in (val as object)) {
          props[key] = { type: (val as BabelNode).type };
        }
      }
      return props;
    }

    traverseAst(ast, {
      enter(path: NodePath) {
        const node = path.node as BabelNode;
        if (node.type === targetNodeType && matchesFilter(node)) {
          matches.push({
            type: node.type,
            start: node.start ?? -1,
            end: node.end ?? -1,
            code: code.slice(node.start ?? 0, node.end ?? 0),
            properties: extractProperties(node),
          });
          if (matches.length >= maxResults) {
            path.stop();
          }
        }
      },
    });

    return asJsonResponse({ success: true, matches, total: matches.length, nodeType });
  });
}

export async function handleAnalysisDeflatControlFlow(args: ToolArgs): Promise<ToolResponse> {
  const code = argString(args, 'code');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }
  const removeDispatcher = argBool(args, 'removeDispatcher', true);

  return cpuLimit(async (): Promise<ToolResponse> => {
    let ast: ReturnType<typeof parseCode>;
    try {
      ast = parseCode(code, { sourceType: 'unambiguous' });
    } catch (err) {
      return asJsonResponse({
        success: false,
        error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const prepared = preprocessDeflatCode(code);
    if (prepared.code !== code) {
      try {
        ast = parseCode(prepared.code, { sourceType: 'unambiguous' });
      } catch (err) {
        return asJsonResponse({
          success: false,
          error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    let flattenedCount = 0;
    const dispatcherBindings = new Set<t.Identifier>();

    traverseAst(ast, {
      WhileStatement: (path: NodePath) => {
        if (!path.isWhileStatement()) return;
        const shape = matchControlFlowFlattening(path.node);
        if (!shape) return;
        const elements = resolveDispatcherArray(path, shape.arrayName);
        if (!elements) return;
        const dispatchOrder = extractDispatchOrder(elements);
        if (dispatchOrder.length === 0) return;

        const arrayBinding = path.scope.getBinding(shape.arrayName);
        const indexBinding = path.scope.getBinding(shape.indexName);
        if (!arrayBinding || !indexBinding) return;

        const reordered: t.Statement[] = [];
        for (const key of dispatchOrder) {
          const stmts = shape.caseMap.get(key);
          if (stmts) {
            for (const s of stmts) {
              if (s.type === 'BreakStatement') continue;
              if (s.type === 'ContinueStatement') continue;
              reordered.push(s);
            }
          }
        }

        path.replaceWith(t.blockStatement(reordered));
        dispatcherBindings.add(arrayBinding.identifier);
        dispatcherBindings.add(indexBinding.identifier);
        flattenedCount++;
      },
    });

    if (removeDispatcher && dispatcherBindings.size > 0) {
      traverseAst(ast, {
        VariableDeclarator(path: NodePath) {
          if (!path.isVariableDeclarator()) return;
          const node = path.node;
          if (node.id.type === 'Identifier' && dispatcherBindings.has(node.id)) {
            const parent = path.parent;
            if (parent.type === 'VariableDeclaration' && parent.declarations.length === 1) {
              const parentPath = path.parentPath;
              if (parentPath) parentPath.remove();
            } else {
              path.remove();
            }
          }
        },
      });
    }

    const output = generateCode(ast, { retainLines: true });

    return asJsonResponse({
      success: true,
      code: output,
      flattenedCount,
      dispatchersRemoved: removeDispatcher ? dispatcherBindings.size : 0,
      helperTransforms: prepared.transforms,
    });
  });
}

function preprocessDeflatCode(code: string): { code: string; transforms: string[] } {
  let output = code;
  const transforms: string[] = [];

  const simplifiedMemberCalls = output.replace(
    /(\b[a-zA-Z_$][\w$]*)\[['"]([a-zA-Z_$][\w$]*)['"]\]\(([^)]*)\)/g,
    (_full, target: string, prop: string, args: string) => {
      if (!SIMPLE_CONTROL_FLOW_HELPERS.has(prop as 'call' | 'apply')) {
        return _full;
      }
      transforms.push('helper-member-call');
      return `${target}.${prop}(${args})`;
    },
  );
  output = simplifiedMemberCalls;

  return { code: output, transforms };
}

function resolveDispatcherArray(
  path: NodePath<t.WhileStatement>,
  arrayName: string,
): t.Expression | null {
  const binding = path.scope.getBinding(arrayName);
  if (!binding?.path.isVariableDeclarator()) return null;
  const directInit = binding.path.node.init;
  if (directInit) return directInit;

  const parentDeclaration = binding.path.parentPath;
  if (!parentDeclaration.isVariableDeclaration()) return null;
  const siblings = parentDeclaration.getAllNextSiblings();
  for (const candidate of siblings) {
    if (!candidate.isExpressionStatement()) continue;
    const expr = candidate.node.expression;
    if (
      !t.isAssignmentExpression(expr) ||
      expr.operator !== '=' ||
      !t.isIdentifier(expr.left, { name: arrayName })
    ) {
      continue;
    }
    return expr.right;
  }

  return null;
}

/** Shape of a control-flow-flattening dispatcher matched inside a
 * `while (true) { switch (...) { ... } }`. */
interface DispatcherShape {
  arrayName: string;
  indexName: string;
  caseMap: Map<string, t.Statement[]>;
}

/** Match `while (true) { switch (arr[idx++]) {...} }` dispatchers. Returns
 * null for anything else (conditions verbatim from the former visitor). */
function matchControlFlowFlattening(node: t.Node): DispatcherShape | null {
  if (node.type !== 'WhileStatement') return null;
  const whileNode = node as t.WhileStatement;
  const test = whileNode.test;
  if (test.type !== 'BooleanLiteral' || test.value !== true) return null;

  const body = whileNode.body;
  if (body.type !== 'BlockStatement') return null;

  const switchStmt = body.body.find((s): s is t.SwitchStatement => s.type === 'SwitchStatement');
  if (!switchStmt) return null;

  const discriminant = switchStmt.discriminant;
  if (discriminant.type !== 'MemberExpression' || !discriminant.computed) return null;
  const objExpr = discriminant.object;
  if (objExpr.type !== 'Identifier') return null;

  // Accept index as Identifier or UpdateExpression(Identifier++)
  let indexName: string | undefined;
  const propExpr = discriminant.property;
  if (propExpr.type === 'Identifier') {
    indexName = propExpr.name;
  } else if (propExpr.type === 'UpdateExpression' && propExpr.argument.type === 'Identifier') {
    indexName = propExpr.argument.name;
  }
  if (!indexName) return null;

  const cases = switchStmt.cases;
  if (cases.length === 0) return null;

  const caseMap = new Map<string, t.Statement[]>();
  for (const c of cases) {
    if (!c.test || c.test.type !== 'StringLiteral') continue;
    caseMap.set(c.test.value, c.consequent as t.Statement[]);
  }

  return { arrayName: objExpr.name, indexName, caseMap };
}

/** Extract the dispatch order from the array initializer: either a
 * StringLiteral[] or `'a|b|c'.split('|')`. */
function extractDispatchOrder(elements: t.Expression): string[] {
  const order: string[] = [];
  if (elements.type === 'ArrayExpression') {
    for (const el of elements.elements) {
      if (el && el.type === 'StringLiteral') {
        order.push(el.value);
      }
    }
  } else if (
    elements.type === 'CallExpression' &&
    elements.callee.type === 'MemberExpression' &&
    elements.callee.property.type === 'Identifier' &&
    elements.callee.property.name === 'split' &&
    elements.arguments[0]?.type === 'StringLiteral'
  ) {
    const separator = elements.arguments[0].value;
    const strNode = elements.callee.object;
    if (strNode.type === 'StringLiteral') {
      order.push(...strNode.value.split(separator));
    }
  }
  return order;
}
