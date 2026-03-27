import type { MacroDefinition } from '../types';

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

export const unpackerFlow: MacroDefinition = {
  id: 'unpacker_flow',
  displayName: 'Unpacker Flow',
  description: 'Detect packer type → extract inner code → deobfuscate → beautify output',
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
      toolName: 'advanced_deobfuscate',
      inputFrom: { code: 'detect_and_unpack.code' },
      optional: true,
    },
    {
      id: 'beautify',
      toolName: 'ast_transform_beautify',
      inputFrom: { code: 'detect_and_unpack.code' },
    },
  ],
};

export const BUILTIN_MACROS: MacroDefinition[] = [deobfuscateAstFlow, unpackerFlow];
