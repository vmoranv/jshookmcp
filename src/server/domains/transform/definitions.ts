import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const transformsEnum = [
  'constant_fold',
  'string_decrypt',
  'dead_code_remove',
  'control_flow_flatten',
  'rename_vars',
] as const;

export const transformTools: Tool[] = [
  tool('ast_transform_preview', (t) =>
    t
      .desc(
        'Preview lightweight AST-like transforms (string/regex based) and return before/after diff.',
      )
      .string('code', 'Source code to transform.')
      .array('transforms', { type: 'string', enum: transformsEnum }, 'Ordered transform list.')
      .boolean('preview', 'Whether to generate line diff output.', { default: true })
      .required('code', 'transforms')
      .query(),
  ),
  tool('ast_transform_chain', (t) =>
    t
      .desc('Create and store an in-memory transform chain.')
      .string('name', 'Chain name.')
      .array('transforms', { type: 'string', enum: transformsEnum }, 'Ordered transform list.')
      .string('description', 'Optional chain description.')
      .required('name', 'transforms'),
  ),
  tool('ast_transform_apply', (t) =>
    t
      .desc('Apply transforms to input code or a live page scriptId.')
      .string('scriptId', 'Target script ID from page debugger context.')
      .string('code', 'Direct source code input.')
      .string('chainName', 'Use a saved transform chain by name.')
      .array(
        'transforms',
        { type: 'string', enum: transformsEnum },
        'Direct transform list (used when chainName is not provided).',
      ),
  ),
  tool('crypto_extract_standalone', (t) =>
    t
      .desc(
        'Extract crypto/sign/encrypt function from current page and generate standalone runnable code.',
      )
      .string('targetFunction', 'Target function name/path, e.g. "window.sign".')
      .boolean('includePolyfills', 'Include minimal runtime polyfills.', { default: true })
      .required('targetFunction'),
  ),
  tool('crypto_test_harness', (t) =>
    t
      .desc(
        'Run extracted crypto code in worker_threads + vm sandbox and return deterministic test results.',
      )
      .string('code', 'Standalone function code.')
      .string('functionName', 'Exported function name to execute.')
      .array('testInputs', { type: 'string' }, 'Input list for test execution.')
      .required('code', 'functionName', 'testInputs')
      .query(),
  ),
  tool('crypto_compare', (t) =>
    t
      .desc('Compare two crypto implementations against identical test vectors.')
      .string('code1', 'Implementation A code.')
      .string('code2', 'Implementation B code.')
      .string('functionName', 'Function name shared by both implementations.')
      .array('testInputs', { type: 'string' }, 'Input list for comparison.')
      .required('code1', 'code2', 'functionName', 'testInputs')
      .query(),
  ),
  tool('transform_workbench', (t) =>
    t
      .desc(
        'Run a reproducible binary transform workbench over base64 inputs: base64, hex, XOR, RC4, AES-CBC/ECB decrypt, zlib/gzip inflate, entropy, previews, and magic hints.',
      )
      .string('inputBase64', 'Input bytes encoded as base64.')
      .array(
        'steps',
        {
          type: 'object',
          description:
            'Ordered transform steps: {op:"base64_decode|base64_encode|hex_decode|hex_encode|xor|rc4|aes_cbc_decrypt|aes_ecb_decrypt|zlib_inflate|gzip_inflate|entropy", key?, keyHex?, iv?, ivHex?}. AES ops require key (16/24/32 bytes); aes_cbc_decrypt also requires iv (16 bytes).',
        },
        'Ordered transform workbench steps.',
      )
      .number('previewBytes', 'Number of output bytes to preview.', { default: 128 })
      .boolean('includeOutputBase64', 'Whether to include full output bytes as base64.', {
        default: false,
      })
      .number('maxInputBytes', 'Optional per-call decoded input byte cap.')
      .number('maxOutputBytes', 'Optional per-call output byte cap after each step.')
      .number('maxSteps', 'Optional per-call transform step cap.')
      .array(
        'customMagicHints',
        {
          type: 'object',
          description:
            'Caller-supplied generic magic hint: {label, prefixHex? or prefixAscii?, description?}.',
        },
        'Optional caller-supplied signature hints. Built-in hints stay generic.',
      )
      .required('inputBase64', 'steps')
      .query(),
  ),
];
