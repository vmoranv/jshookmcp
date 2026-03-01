import { logger } from '../../utils/logger.js';
import type { ParseResult } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import type {
  CallExpression as BabelCallExpression,
  File as BabelFile,
  FunctionDeclaration as BabelFunctionDeclaration,
  VariableDeclarator as BabelVariableDeclarator,
} from '@babel/types';

type ScriptSourceRecord = {
  source?: string;
};

type ExtractFunctionTreeContext = {
  getScriptSource(scriptId: string): Promise<ScriptSourceRecord | null | undefined>;
};

type BabelParserModule = typeof import('@babel/parser');
type BabelTraverseFn = typeof import('@babel/traverse').default;
type BabelGenerateFn = typeof import('@babel/generator').default;
type BabelTypesModule = typeof import('@babel/types');

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const asCallable = (value: unknown): ((...args: unknown[]) => unknown) | null =>
  typeof value === 'function' ? (value as (...args: unknown[]) => unknown) : null;

const resolveCallableExport = (
  moduleValue: unknown,
  namedExport: 'traverse' | 'generate'
): ((...args: unknown[]) => unknown) | null => {
  const moduleRecord = asRecord(moduleValue);
  const defaultExport = moduleRecord?.default;
  const defaultRecord = asRecord(defaultExport);

  return (
    asCallable(defaultRecord?.default) ??
    asCallable(defaultExport) ??
    asCallable(moduleRecord?.[namedExport]) ??
    asCallable(moduleValue)
  );
};

export interface ExtractFunctionTreeResult {
  mainFunction: string;
  code: string;
  functions: Array<{
    name: string;
    code: string;
    dependencies: string[];
    startLine: number;
    endLine: number;
    size: number;
  }>;
  callGraph: Record<string, string[]>;
  totalSize: number;
  extractedCount: number;
}

export async function extractFunctionTreeCore(
  ctx: ExtractFunctionTreeContext,
  scriptId: string,
  functionName: string,
  options: {
    maxDepth?: number;
    maxSize?: number;
    includeComments?: boolean;
  } = {}
): Promise<ExtractFunctionTreeResult> {
  const { maxDepth = 3, maxSize = 500, includeComments = true } = options;

  const script = await ctx.getScriptSource(scriptId);
  if (!script || !script.source) {
    throw new Error(`Script not found: ${scriptId}`);
  }

  let parser: BabelParserModule;
  let traverse: BabelTraverseFn;
  let generate: BabelGenerateFn;
  let t: BabelTypesModule;

  try {
    parser = await import('@babel/parser');
    const traverseModule: unknown = await import('@babel/traverse');
    const traverseCandidate = resolveCallableExport(traverseModule, 'traverse');
    if (typeof traverseCandidate !== 'function') {
      throw new Error('Invalid @babel/traverse export shape');
    }
    traverse = traverseCandidate as BabelTraverseFn;
    const generatorModule: unknown = await import('@babel/generator');
    const generateCandidate = resolveCallableExport(generatorModule, 'generate');
    if (typeof generateCandidate !== 'function') {
      throw new Error('Invalid @babel/generator export shape');
    }
    generate = generateCandidate as BabelGenerateFn;
    t = await import('@babel/types');
  } catch (error: unknown) {
    throw new Error(
      `Failed to load Babel dependencies. Please install: npm install @babel/parser @babel/traverse @babel/generator @babel/types\nError: ${getErrorMessage(error)}`
    );
  }

  let ast: ParseResult<BabelFile>;

  try {
    ast = parser.parse(script.source, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
  } catch (error: unknown) {
    throw new Error(`Failed to parse script ${scriptId}: ${getErrorMessage(error)}`);
  }

  const allFunctions = new Map<
    string,
    {
      name: string;
      code: string;
      dependencies: string[];
      startLine: number;
      endLine: number;
      size: number;
    }
  >();
  const callGraph: Record<string, string[]> = {};

  const extractDependencies = (
    path: NodePath<BabelFunctionDeclaration | BabelVariableDeclarator>
  ): string[] => {
    const deps = new Set<string>();
    path.traverse({
      CallExpression(callPath: NodePath<BabelCallExpression>) {
        if (t.isIdentifier(callPath.node.callee)) {
          deps.add(callPath.node.callee.name);
        }
      },
    });
    return Array.from(deps);
  };

  traverse(ast, {
    FunctionDeclaration(path: NodePath<BabelFunctionDeclaration>) {
      const name = path.node.id?.name;
      if (!name) return;

      const funcCode = generate(path.node, { comments: includeComments }).code;
      const deps = extractDependencies(path);

      allFunctions.set(name, {
        name,
        code: funcCode,
        startLine: path.node.loc?.start.line || 0,
        endLine: path.node.loc?.end.line || 0,
        dependencies: deps,
        size: funcCode.length,
      });

      callGraph[name] = deps;
    },

    VariableDeclarator(path: NodePath<BabelVariableDeclarator>) {
      if (
        t.isIdentifier(path.node.id) &&
        (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init))
      ) {
        const name = path.node.id.name;
        const funcCode = generate(path.node, { comments: includeComments }).code;
        const deps = extractDependencies(path);

        allFunctions.set(name, {
          name,
          code: funcCode,
          startLine: path.node.loc?.start.line || 0,
          endLine: path.node.loc?.end.line || 0,
          dependencies: deps,
          size: funcCode.length,
        });

        callGraph[name] = deps;
      }
    },
  });

  const extracted = new Set<string>();
  const toExtract = [functionName];
  let currentDepth = 0;

  while (toExtract.length > 0 && currentDepth < maxDepth) {
    const current = toExtract.shift()!;
    if (extracted.has(current)) continue;

    const func = allFunctions.get(current);
    if (!func) continue;

    extracted.add(current);

    for (const dep of func.dependencies) {
      if (!extracted.has(dep) && allFunctions.has(dep)) {
        toExtract.push(dep);
      }
    }

    currentDepth++;
  }

  const functions = Array.from(extracted)
    .map((name) => allFunctions.get(name)!)
    .filter(Boolean);

  const code = functions.map((f) => f.code).join('\n\n');
  const totalSize = code.length;

  if (totalSize > maxSize * 1024) {
    logger.warn(
      `Extracted code size (${(totalSize / 1024).toFixed(2)}KB) exceeds limit (${maxSize}KB)`
    );
  }

  logger.info(
    `extractFunctionTree: ${functionName} - extracted ${functions.length} functions (${(totalSize / 1024).toFixed(2)}KB)`
  );

  return {
    mainFunction: functionName,
    code,
    functions,
    callGraph,
    totalSize,
    extractedCount: functions.length,
  };
}
