import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Tool definitions for the apk-packer domain.
 *
 * Both tools are pure declarative-fingerprint operations:
 *   - `apk_packer_detect` matches a target APK (or already-unpacked dir)
 *     against the built-in DEFAULT_SIGNATURES plus optional customSignatures.
 *   - `apk_packer_list_signatures` exposes the in-process signature table so
 *     callers can inspect or filter the catalogue.
 *
 * No unpacking, no payload, no shellcode — only filename matching.
 */
export const apkPackerTools: Tool[] = [
  tool('apk_packer_detect', (t) =>
    t
      .desc(
        'Detect Android APK commercial packers by matching `lib/<abi>/lib*.so` ' +
          'filenames against a built-in declarative fingerprint database covering ' +
          '16+ vendors (Qihoo Jiagu, Tencent Legu, Bangcle/SecNeo, Ijiami, Baidu, ' +
          'Aliyun, NetEase Yidun, DexGuard, DexProtector, AppSealing, Virbox, ' +
          'ApkProtect, Naga, Kiwi, UPX, ...). Supports user-supplied customSignatures ' +
          'with ReDoS-guarded regex compilation. **Does not unpack, execute, or ' +
          'otherwise interact with the packed payload.**',
      )
      .string('apkPath', 'Absolute path to the .apk (or .aab) file to inspect')
      .string('dirPath', 'Optional path to a directory containing an already-unpacked APK tree')
      .enum(
        'ruleMode',
        ['append', 'prepend', 'replace'],
        'How customSignatures interact with DEFAULT_SIGNATURES',
        { default: 'append' },
      )
      .array(
        'customSignatures',
        {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name, e.g. "MyCustomGuard"' },
            vendor: { type: 'string', description: 'Vendor / origin label' },
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
          required: ['name', 'vendor', 'libPatterns'],
        },
        'Additional fingerprints supplied by the caller. Compile-time and ' +
          'runtime ReDoS guards apply.',
      )
      .query(),
  ),
  tool('apk_packer_list_signatures', (t) =>
    t
      .desc(
        'List the built-in declarative fingerprint database used by ' +
          '`apk_packer_detect`. Optionally filter by case-insensitive vendor ' +
          'substring. Purely informational — no APK input required.',
      )
      .string('vendor', 'Optional case-insensitive vendor substring filter')
      .query(),
  ),
];
