import type { MacroDefinition } from '../types';
import { MACRO_BUILTIN_TIMEOUT_MS } from '@src/constants';

/**
 * Default built-in macros shipped with jshookmcp.
 *
 * These are simple MacroDefinition data objects — the same format as
 * user-defined JSON macros in macros/. They exist here as TypeScript
 * constants for type safety, but follow the exact same schema.
 *
 * Complex workflow-based macros (DAG, BranchNode) should be registered
 * as extension workflows via the ExtensionManager, NOT placed here.
 */

export const deobfuscateAstFlow: MacroDefinition = {
  id: 'deobfuscate_ast_flow',
  displayName: 'Deobfuscate AST Flow',
  description: 'Chain: deobfuscate → optional webcrack unpack → semantic analysis',
  tags: ['analysis', 'deobfuscation', 'ast'],
  timeoutMs: MACRO_BUILTIN_TIMEOUT_MS,
  steps: [
    {
      id: 'deobfuscate',
      toolName: 'deobfuscate',
      input: {},
    },
    {
      id: 'advanced_deobfuscate',
      toolName: 'webcrack_unpack',
      input: { unpack: true, unminify: true },
      inputFrom: { code: 'deobfuscate.code' },
      optional: true,
    },
    {
      id: 'analyze_deobfuscated',
      toolName: 'understand_code',
      inputFrom: { code: 'deobfuscate.code' },
    },
  ],
};

export const unpackerFlow: MacroDefinition = {
  id: 'unpacker_flow',
  displayName: 'Unpacker Flow',
  description: 'Detect packer type → extract inner code → optional deep unpack → normalize output',
  tags: ['analysis', 'unpacking', 'deobfuscation'],
  timeoutMs: 90_000,
  steps: [
    {
      id: 'detect_and_unpack',
      toolName: 'deobfuscate',
      input: { unpack: true },
    },
    {
      id: 'deep_deobfuscate',
      toolName: 'webcrack_unpack',
      input: { unpack: true, unminify: true },
      inputFrom: { code: 'detect_and_unpack.code' },
      optional: true,
    },
    {
      id: 'normalize_output',
      toolName: 'ast_transform_apply',
      input: { transforms: ['dead_code_remove', 'rename_vars'] },
      inputFrom: { code: 'detect_and_unpack.code' },
    },
  ],
};

export const BUILTIN_MACROS: MacroDefinition[] = [deobfuscateAstFlow, unpackerFlow];
