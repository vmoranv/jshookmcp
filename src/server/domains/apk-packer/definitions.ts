import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Tool definitions for the apk-packer domain.
 *
 * Both tools are pure declarative-fingerprint operations:
 *   - apk_packer_detect matches a target APK (or already-unpacked dir)
 *     against the caller-provided customSignatures set.
 *   - apk_packer_list_signatures exposes the in-process signature table
 *     so callers can inspect or filter it.
 *
 * The framework ships no built-in fingerprints - every signature used at
 * detection time comes from the caller.
 *
 * No unpacking, no payload, no shellcode - only filename matching.
 */
export const apkPackerTools: Tool[] = [
  tool('apk_packer_detect', (t) =>
    t
      .desc(
        'Detect Android APK packers by matching `lib/<abi>/lib*.so` filenames ' +
          'against user-supplied fingerprints with ReDoS-guarded regex compilation. ' +
          'Read-only - no unpacking or execution.',
      )
      .string('apkPath', 'Absolute path to the .apk (or .aab) file to inspect')
      .string('dirPath', 'Optional path to a directory containing an already-unpacked APK tree')
      .enum(
        'ruleMode',
        ['append', 'prepend', 'replace'],
        'How customSignatures interact with the default (empty) signature table',
        { default: 'append' },
      )
      .array(
        'customSignatures',
        {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name of the fingerprint entry' },
            category: {
              type: 'string',
              description: 'Optional free-form category label supplied by the caller',
            },
            libPatterns: {
              type: 'array',
              items: { type: 'string' },
              description:
                'lib basenames or anchored regex sources (case-insensitive; ReDoS-guarded)',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Optional single-hit confidence hint (default: medium)',
            },
            notes: { type: 'string', description: 'Free-form notes surfaced in list-signatures' },
          },
          required: ['name', 'libPatterns'],
        },
        'Fingerprints supplied by the caller. Compile-time and runtime ReDoS guards apply.',
      )
      .query(),
  ),
  tool('apk_packer_list_signatures', (t) =>
    t
      .desc(
        'List the fingerprint entries currently visible to the apk-packer domain ' +
          '(the framework ships none; all entries come from caller-provided ' +
          'customSignatures). Optionally filter by case-insensitive category substring. ' +
          'Purely informational - no APK input required.',
      )
      .string('category', 'Optional case-insensitive category substring filter')
      .query(),
  ),
];
