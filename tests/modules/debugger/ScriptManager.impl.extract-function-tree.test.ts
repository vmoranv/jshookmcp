import { describe, it, expect, vi, beforeEach } from 'vitest';

const functionTreeMocks = vi.hoisted(() => {
  const state = {
    declarations: [] as Array<{
      name: string;
      code: string;
      deps: string[];
      startLine: number;
      endLine: number;
    }>,
    variables: [] as Array<{
      name: string;
      code: string;
      deps: string[];
      startLine: number;
      endLine: number;
      initType: 'FunctionExpression' | 'ArrowFunctionExpression';
    }>,
    parse: vi.fn(),
    traverse: vi.fn(),
    generate: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
  };

  // oxlint-disable-next-line consistent-function-scoping
  const createPath = (
    node: {
      name: string;
      code: string;
      deps: string[];
      startLine: number;
      endLine: number;
      initType?: 'FunctionExpression' | 'ArrowFunctionExpression';
    },
    type: 'FunctionDeclaration' | 'VariableDeclarator',
  ) => ({
    node:
      type === 'FunctionDeclaration'
        ? {
            type,
            id: { type: 'Identifier', name: node.name },
            loc: {
              start: { line: node.startLine },
              end: { line: node.endLine },
            },
            mockCode: node.code,
            mockDeps: node.deps,
          }
        : {
            type,
            id: { type: 'Identifier', name: node.name },
            init: { type: node.initType },
            loc: {
              start: { line: node.startLine },
              end: { line: node.endLine },
            },
            mockCode: node.code,
            mockDeps: node.deps,
          },
    traverse(visitor: {
      CallExpression?: (path: { node: { callee: { type: string; name: string } } }) => void;
    }) {
      node.deps.forEach((dep) => {
        visitor.CallExpression?.({
          node: {
            callee: {
              type: 'Identifier',
              name: dep,
            },
          },
        });
      });
    },
  });

  return { ...state, createPath };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: functionTreeMocks.logger,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@babel/parser', () => ({
  parse: functionTreeMocks.parse,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@babel/traverse', () => ({
  default: functionTreeMocks.traverse,
  traverse: functionTreeMocks.traverse,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@babel/generator', () => ({
  default: functionTreeMocks.generate,
  generate: functionTreeMocks.generate,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@babel/types', () => ({
  isIdentifier: (value: { type?: string } | null | undefined) => value?.type === 'Identifier',
  isFunctionExpression: (value: { type?: string } | null | undefined) =>
    value?.type === 'FunctionExpression',
  isArrowFunctionExpression: (value: { type?: string } | null | undefined) =>
    value?.type === 'ArrowFunctionExpression',
}));

import { extractFunctionTreeCore } from '@modules/debugger/ScriptManager.impl.extract-function-tree';

describe('ScriptManager extract-function-tree internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functionTreeMocks.declarations = [];
    functionTreeMocks.variables = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    functionTreeMocks.parse.mockReturnValue({ type: 'File' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    functionTreeMocks.traverse.mockImplementation(
      (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        _ast: any,
        visitor: {
          FunctionDeclaration?: (path: ReturnType<typeof functionTreeMocks.createPath>) => void;
          VariableDeclarator?: (path: ReturnType<typeof functionTreeMocks.createPath>) => void;
        },
      ) => {
        functionTreeMocks.declarations.forEach((item) =>
          visitor.FunctionDeclaration?.(functionTreeMocks.createPath(item, 'FunctionDeclaration')),
        );
        functionTreeMocks.variables.forEach((item) =>
          visitor.VariableDeclarator?.(functionTreeMocks.createPath(item, 'VariableDeclarator')),
        );
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    functionTreeMocks.generate.mockImplementation(
      (node: { mockCode?: string }, options?: { comments?: boolean }) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        code: node.mockCode ?? '',
        comments: options?.comments,
      }),
    );
  });

  it('rejects missing scripts before attempting parsing', async () => {
    const ctx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getScriptSource: vi.fn().mockResolvedValue(null),
    };

    await expect(extractFunctionTreeCore(ctx, 'script-1', 'main')).rejects.toThrow(
      'Script not found: script-1',
    );
  });

  it('wraps parser failures with script context', async () => {
    const ctx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getScriptSource: vi.fn().mockResolvedValue({
        source: 'const =',
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    functionTreeMocks.parse.mockImplementation(() => {
      throw new Error('Unexpected token');
    });

    await expect(extractFunctionTreeCore(ctx, 'script-1', 'main')).rejects.toThrow(
      'Failed to parse script script-1: Unexpected token',
    );
  });

  it('extracts function declarations, variable functions, and call graphs', async () => {
    const ctx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getScriptSource: vi.fn().mockResolvedValue({
        source: 'function main() {}',
      }),
    };
    functionTreeMocks.declarations = [
      {
        name: 'main',
        code: 'function main() { helper(); util(); }',
        deps: ['helper', 'util'],
        startLine: 1,
        endLine: 3,
      },
      {
        name: 'helper',
        code: 'function helper() { return leaf(); }',
        deps: ['leaf'],
        startLine: 5,
        endLine: 7,
      },
      {
        name: 'leaf',
        code: 'function leaf() { return true; }',
        deps: [],
        startLine: 9,
        endLine: 11,
      },
    ];
    functionTreeMocks.variables = [
      {
        name: 'util',
        code: 'const util = () => 1;',
        deps: [],
        startLine: 13,
        endLine: 13,
        initType: 'ArrowFunctionExpression',
      },
    ];

    const result = await extractFunctionTreeCore(ctx, 'script-1', 'main', {
      includeComments: false,
      maxDepth: 5,
    });

    expect(result.mainFunction).toBe('main');
    expect(result.extractedCount).toBe(4);
    expect(result.functions.map((func) => func.name)).toEqual(
      expect.arrayContaining(['main', 'helper', 'leaf', 'util']),
    );
    expect(result.callGraph).toEqual({
      main: ['helper', 'util'],
      helper: ['leaf'],
      leaf: [],
      util: [],
    });
    expect(result.code).toContain('function main()');
    expect(result.code).toContain('const util = () => 1;');
    expect(functionTreeMocks.generate).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect.any(Object),
      expect.objectContaining({ comments: false }),
    );
    expect(functionTreeMocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('extractFunctionTree: main - extracted 4 functions'),
    );
  });

  it('limits extraction by maxDepth and warns on oversized output', async () => {
    const ctx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getScriptSource: vi.fn().mockResolvedValue({
        source: 'function main() {}',
      }),
    };
    functionTreeMocks.declarations = [
      {
        name: 'main',
        code: 'function main() { helper(); }',
        deps: ['helper'],
        startLine: 1,
        endLine: 3,
      },
      {
        name: 'helper',
        code: 'function helper() { return leaf(); }',
        deps: ['leaf'],
        startLine: 5,
        endLine: 7,
      },
      {
        name: 'leaf',
        code: 'function leaf() { return true; }',
        deps: [],
        startLine: 9,
        endLine: 11,
      },
    ];

    const result = await extractFunctionTreeCore(ctx, 'script-1', 'main', {
      maxDepth: 2,
      maxSize: 0,
    });

    expect(result.functions.map((func) => func.name)).toEqual(['main', 'helper']);
    expect(functionTreeMocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Extracted code size'),
    );
  });
});
