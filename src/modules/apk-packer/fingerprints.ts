/**
 * Built-in declarative fingerprint database for Android APK packers.
 *
 * Sources: publicly available reverse-engineering write-ups, MobSF, APKiD.
 * Each entry only describes *which lib filename* identifies the packer —
 * the detector never unpacks, executes, or otherwise interacts with the
 * packed payload.
 *
 * Filename matching is case-insensitive; the detector lowercases inputs.
 */

import type { PackerSignature } from './types';

/**
 * Default fingerprint table. Order is informational only — the detector
 * evaluates every signature against every lib path.
 *
 * Each `libPatterns` entry is either:
 *   - a lowercase literal filename (fastest, equality match)
 *   - a `RegExp` anchored against the basename
 */
export const DEFAULT_SIGNATURES: readonly PackerSignature[] = Object.freeze([
  {
    name: 'Qihoo 360 Jiagu',
    vendor: 'Qihoo',
    libPatterns: [
      'libjiagu.so',
      'libjiagu_art.so',
      'libjiagu_x86.so',
      'libjiagu_64.so',
      /^libjiagu_[\w.-]+\.so$/i,
    ],
    notes: 'Most prevalent commercial Android packer in mainland China.',
  },
  {
    name: 'Tencent Legu',
    vendor: 'Tencent',
    libPatterns: ['libshell.so', /^libshella-[\w.-]+\.so$/i, /^libshellx-[\w.-]+\.so$/i],
    notes: 'Tencent Legu app reinforcement.',
  },
  {
    name: 'Tencent TMP / YuanShield',
    vendor: 'Tencent',
    libPatterns: ['libtup.so', /^libtosprotection[\w.-]*\.so$/i],
    notes: 'Tencent 御安全 (TMP) protection runtime.',
  },
  {
    name: 'Bangcle / SecNeo',
    vendor: 'Bangcle',
    libPatterns: ['libsecexe.so', 'libsecmain.so', 'libdexhelper.so', 'libdexhelper-x86.so'],
    notes: 'Bangcle (now SecNeo) classic and modern reinforcement runtimes.',
  },
  {
    name: 'Ijiami / 爱加密',
    vendor: 'Ijiami',
    libPatterns: ['libexec.so', 'libexecmain.so', 'ijiami.dat'],
    notes: 'APKiD historically mis-tags this as UPX.',
  },
  {
    name: 'Baidu Protection',
    vendor: 'Baidu',
    libPatterns: ['libbaiduprotect.so', /^libbaiduprotect_[\w.-]+\.so$/i],
    notes: 'Baidu app reinforcement.',
  },
  {
    name: 'Alibaba JuAnQuan',
    vendor: 'Alibaba',
    libPatterns: ['libmobisec.so', 'libpreverify1.so', 'libmobisecy.so'],
    notes: 'Aliyun 阿里聚安全 reinforcement.',
  },
  {
    name: 'NetEase Yidun',
    vendor: 'NetEase',
    libPatterns: ['libnesec.so', 'libnesecpro.so'],
    notes: 'NetEase 易盾 reinforcement.',
  },
  {
    name: 'DexGuard',
    vendor: 'Guardsquare',
    libPatterns: ['libdexguard.so'],
    notes: 'Guardsquare DexGuard runtime helper.',
  },
  {
    name: 'DexProtector',
    vendor: 'Licel',
    libPatterns: [/^libdexprotector[\w.-]*\.so$/i, 'libdpboot.so'],
    notes: 'Licel DexProtector runtime + bootloader helper.',
  },
  {
    name: 'AppSealing',
    vendor: 'INKA Entworks',
    libPatterns: ['libcovault-appsec.so', 'libcovault-appsealing.so'],
    notes: 'AppSealing (INKA) runtime guard.',
  },
  {
    name: 'Virbox Protector',
    vendor: 'SenseShield',
    libPatterns: [/^libvmp_[\w.-]+\.so$/i, 'libccg.so'],
    notes: 'SenseShield Virbox / Themida-like VMP.',
  },
  {
    name: 'ApkProtect',
    vendor: 'ApkProtect',
    libPatterns: ['libapkprotect.so', 'libapkprotect2.so'],
    notes: 'Legacy commercial packer.',
  },
  {
    name: 'Naga Protect',
    vendor: 'Naga',
    libPatterns: ['libchaosvmp.so', 'libnagain.so'],
    notes: 'Chaos VMP runtime helper.',
  },
  {
    name: 'Kiwi (KDP)',
    vendor: 'Kiwi',
    libPatterns: ['libkdp.so'],
    notes: 'Kiwi DRM / packer runtime.',
  },
  {
    name: 'UPX',
    vendor: 'UPX',
    libPatterns: [/^libupx[\w.-]*\.so$/i],
    confidence: 'low',
    notes:
      'Generic ELF compressor. Filename match alone is weak — many vendors rename UPX-packed libs.',
  },
]);
