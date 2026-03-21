/**
 * Built-in macro: unpacker_flow
 *
 * Chains: detect & unpack → deep deobfuscation → beautify output
 */

import type { MacroDefinition } from '@server/macros/types';

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
