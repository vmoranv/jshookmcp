/**
 * Shared AST utilities for analysis domain.
 * Centralizes @babel/* imports and provides unified parsing/traversal/generation.
 */

import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import type { NodePath } from '@babel/traverse';

// Handle ESM/CJS interop
const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;

export interface ParseOptions {
  sourceType?: 'module' | 'script' | 'unambiguous';
  plugins?: Array<'jsx' | 'typescript'>;
}

export function parseCode(
  code: string,
  options: ParseOptions = {},
): ReturnType<typeof parser.parse> {
  return parser.parse(code, {
    sourceType: options.sourceType ?? 'unambiguous',
    plugins: options.plugins ?? ['jsx', 'typescript'],
  });
}

export function traverseAst(
  ast: ReturnType<typeof parser.parse>,
  visitor: Record<string, ((path: NodePath) => void) | undefined>,
): void {
  traverse(ast, visitor as Parameters<typeof traverse>[1]);
}

export interface GenerateOptions {
  retainLines?: boolean;
  compact?: boolean;
}

export function generateCode(
  ast: ReturnType<typeof parser.parse>,
  options: GenerateOptions = {},
): string {
  return generate(ast, options).code;
}

// Re-export core types for convenience
export { generate };
export type { NodePath };
export * as t from '@babel/types';
