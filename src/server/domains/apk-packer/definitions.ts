import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Tool definitions for the apk-packer domain.
 *
 * Both tools are pure declarative-fingerprint operations:
 *   - `apk_packer_detect` matches a target APK (or already-unpacked dir)
 *     against caller-supplied customSignatures (DEFAULT_SIGNATURES is empty).
 *   - `apk_packer_list_signatures` exposes the in-process signature table so
 *     callers can inspect or filter the catalogue (empty by default).
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
          'against user-supplied customSignatures (ReDoS-guarded regex compilation). ' +
          'The framework ships no built-in signature table — callers provide their own. ' +
          '**Does not unpack, execute, or otherwise interact with the packed payload.**',
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
        'List the in-process signature table used by `apk_packer_detect`. ' +
          'Empty by default; reflects caller-managed state at request time. ' +
          'Optionally filter by case-insensitive category substring.',
      )
      .string('category', 'Optional case-insensitive category substring filter')
      .query(),
  ),
  tool('apk_signing_block_parse', (t) =>
    t
      .desc(
        'Read-only parser for the APK Signing Block (schemes v2/v3/v3.1/v4) plus ' +
          'key-rotation lineage detection and residue-block / dex-prefix / magic-offset ' +
          'anomaly flags. Never mutates the APK.',
      )
      .string('apkPath', 'Absolute path to the .apk file to parse')
      .required('apkPath')
      .query(),
  ),
];
