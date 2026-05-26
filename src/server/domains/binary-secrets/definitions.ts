import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Tool definitions for the binary-secrets domain.
 *
 * Single tool: `binary_key_extract` streams a binary file and emits
 * candidate offsets where hardcoded key material may live. The output
 * is purely informational — no decoding, no decryption, no payload.
 *
 * Naming note: every field name says "candidate" rather than "key" to
 * keep the contract clear — a human must verify before treating any
 * hit as a real key.
 */
export const binarySecretsTools: Tool[] = [
  tool('binary_key_extract', (t) =>
    t
      .desc(
        'Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). ' +
          'Read-only — no decryption.',
      )
      .string('filePath', 'Absolute path to the binary file to scan')
      .array(
        'keyLengths',
        { type: 'integer', minimum: 1, maximum: 4096 },
        'Decoded byte lengths to accept (default: [16, 24, 32, 64])',
      )
      .number('minEntropy', 'Inclusive minimum Shannon entropy for raw windows (0..8)', {
        minimum: 0,
        maximum: 8,
      })
      .array(
        'formats',
        { type: 'string', enum: ['raw', 'base64', 'hex'] },
        'Which candidate formats to emit (default: all three)',
      )
      .boolean('includeContext', 'Attach a hex+ASCII context window to each candidate', {
        default: true,
      })
      .integer('contextBytes', 'Context window size on each side, in bytes (0..1024)', {
        minimum: 0,
        maximum: 1024,
        default: 16,
      })
      .integer('maxResults', 'Cap on returned candidates; excess sets `truncated:true`', {
        minimum: 1,
      })
      .integer('maxChunkBytes', 'Streaming chunk size in bytes')
      .object(
        'scanWindow',
        {
          start: { type: 'integer', minimum: 0, description: 'Inclusive start byte offset' },
          end: { type: 'integer', minimum: 1, description: 'Exclusive end byte offset' },
        },
        'Restrict scanning to a byte range (skip ELF headers, focus on a section, etc.)',
      )
      .required('filePath')
      .query(),
  ),
];
