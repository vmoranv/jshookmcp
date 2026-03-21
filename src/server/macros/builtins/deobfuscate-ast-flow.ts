/**
 * Built-in macro: deobfuscate_ast_flow
 *
 * Chains: deobfuscate → advanced_deobfuscate → extract_function_tree
 */

import type { MacroDefinition } from '@server/macros/types';

export const deobfuscateAstFlow: MacroDefinition = {
  id: 'deobfuscate_ast_flow',
  displayName: 'Deobfuscate AST Flow',
  description: 'Chain: deobfuscate → advanced deobfuscation → extract function tree',
  tags: ['analysis', 'deobfuscation', 'ast'],
  timeoutMs: 60_000,
  steps: [
    {
      id: 'deobfuscate',
      toolName: 'deobfuscate',
      input: {},
    },
    {
      id: 'advanced_deobfuscate',
      toolName: 'advanced_deobfuscate',
      inputFrom: { code: 'deobfuscate.code' },
      optional: true,
    },
    {
      id: 'extract_functions',
      toolName: 'extract_function_tree',
      inputFrom: { code: 'deobfuscate.code' },
    },
  ],
};
