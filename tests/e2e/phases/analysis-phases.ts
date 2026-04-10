import type { Phase } from '@tests/e2e/helpers/types';

export const analysisPhases: Phase[] = [
  {
    name: 'Encoding & Binary',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: [
      'binary_detect_format',
      'binary_decode',
      'binary_encode',
      'binary_entropy_analysis',
      'protobuf_decode_raw',
    ],
  },
  {
    name: 'Analysis & Deobfuscation',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: [
      'deobfuscate',
      'advanced_deobfuscate',
      'webcrack_unpack',
      'understand_code',
      'detect_obfuscation',
      'detect_crypto',
    ],
  },
  {
    name: 'Hooks',
    group: 'compute-browser',
    setup: [],
    tools: [
      'manage_hooks',
      'ai_hook_inject',
      'ai_hook_toggle',
      'ai_hook_get_data',
      'ai_hook_list',
      'ai_hook_export',
      'ai_hook_clear',
      'hook_preset',
    ],
  },
  {
    name: 'GraphQL',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: [
      'graphql_introspect',
      'graphql_extract_queries',
      'graphql_replay',
      'call_graph_analyze',
    ],
  },
  {
    name: 'Transform & Crypto',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: [
      'ast_transform_preview',
      'ast_transform_apply',
      'ast_transform_chain',
      'crypto_extract_standalone',
      'crypto_test_harness',
      'crypto_compare',
    ],
  },
];
