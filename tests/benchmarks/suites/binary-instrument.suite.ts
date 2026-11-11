/**
 * Binary-instrument domain benchmark (pure-compute subset — no frida/jadx/ghidra).
 *
 * External references:
 *  - DEX file magic "dex\n035\0" (Android ART dex_file_struct.h)
 *  - Shannon entropy classification rule shipped in the tool's own contract:
 *    ≥7.0 bits/byte = encrypted/compressed, <4.0 = code/text
 * Homemade fixtures:
 *  - binary with a constant region and a uniform-random region: profile must separate them
 *  - strings extraction over ASCII + UTF-16LE
 *  - packer signature matching against a caller-supplied custom signature table
 */
import { BinaryScanHandlers } from '@server/domains/binary-instrument/handlers/binary-scan';
import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import { ApkPackerHandlers } from '@server/domains/binary-instrument/apk-packer/handlers.impl';
import { BinarySecretsHandlers } from '@server/domains/binary-instrument/secrets/handlers';
import { body, expectSuccess, type BenchSuite } from '../harness';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';

const scan = new BinaryScanHandlers();
const bi = new BinaryInstrumentHandlers();
const apk = new ApkPackerHandlers();
const secrets = new BinarySecretsHandlers();

const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-bin-'));

// Fixture 1: constant 4KiB region + 4KiB random region
const constRegion = Buffer.alloc(4096, 0x41);
const randRegion = randomBytes(4096);
const mixedBinary = Buffer.concat([constRegion, randRegion]);
const mixedPath = join(tmp, 'mixed.bin');
writeFileSync(mixedPath, mixedBinary);

// Fixture 2: strings — UTF-16LE payload starts at an even byte offset so its
// 2-byte alignment is detectable (odd-offset UTF-16 is a known tool gap).
const asciiStr = 'libnative_sign_payload'; // 22 bytes at offset 2 → ends at 24
const stringsBinary = Buffer.concat([
  Buffer.from([0x00, 0x00]),
  Buffer.from(asciiStr, 'ascii'),
  Buffer.from([0x00, 0x00]), // offsets 24-25
  Buffer.from('SecretKeyStore', 'utf16le'), // starts at even offset 26
  Buffer.from([0x00, 0x00]),
]);
const stringsPath = join(tmp, 'strings.bin');
writeFileSync(stringsPath, stringsBinary);

// Fixture 2b: UTF-16LE string starting at an ODD byte offset (preceded by an
// odd-length ASCII string + terminator) — regression case for the phase scan.
const oddStringsBinary = Buffer.concat([
  Buffer.from([0x00]),
  Buffer.from('abcde', 'ascii'), // offsets 1-5 (odd length shifts the terminator)
  Buffer.from([0x00]), // offset 6
  Buffer.from('OddKey', 'utf16le'), // starts at ODD offset 7
  Buffer.from([0x00, 0x00]),
]);
const oddStringsPath = join(tmp, 'strings-odd.bin');
writeFileSync(oddStringsPath, oddStringsBinary);

// Fixture 3: DEX magic
const dexBinary = Buffer.concat([Buffer.from('dex\n035\0', 'ascii'), Buffer.alloc(32, 0)]);
const dexPath = join(tmp, 'classes.dex');
writeFileSync(dexPath, dexBinary);

// Fixture 4: unpacked "APK" directory with a packer-named .so (dirPath mode)
const fakeApkDir = join(tmp, 'packed-apk');
mkdirSync(join(fakeApkDir, 'lib', 'arm64-v8a'), { recursive: true });
writeFileSync(join(fakeApkDir, 'lib', 'arm64-v8a', 'libjiagu.so'), Buffer.from('fake elf'));
writeFileSync(join(fakeApkDir, 'lib', 'arm64-v8a', 'libnative.so'), Buffer.from('fake elf'));

// Fixture 5: minimal stored-ZIP APK + high-entropy key blob
const u16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v: number): number[] => [
  v & 0xff,
  (v >>> 8) & 0xff,
  (v >>> 16) & 0xff,
  (v >>> 24) & 0xff,
];
function buildStoredZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(Buffer.from(e.data)) >>> 0;
    const size = e.data.length;
    const lfh = Uint8Array.from([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ]);
    chunks.push(lfh, e.data);
    central.push(
      Uint8Array.from([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes,
      ]),
    );
    offset += lfh.length + e.data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(central.length),
    ...u16(central.length),
    ...u32(cdSize),
    ...u32(cdStart),
    ...u16(0),
  ]);
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
const sampleApkPath = join(tmp, 'sample.apk');
writeFileSync(
  sampleApkPath,
  buildStoredZip([
    {
      name: 'AndroidManifest.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.bench.sample"><application android:label="Bench"></application></manifest>',
        'utf8',
      ),
    },
    { name: 'classes.dex', data: dexBinary },
    { name: 'lib/arm64-v8a/libnative.so', data: Buffer.from('fake elf') },
  ]),
);
const keyBlobPath = join(tmp, 'keyblob.bin');
writeFileSync(
  keyBlobPath,
  Buffer.concat([Buffer.alloc(16, 0), randomBytes(32), Buffer.alloc(16, 0)]),
);

const cleanup = () => rmSync(tmp, { recursive: true, force: true });
process.once('exit', cleanup);

export const binarySuite: BenchSuite = {
  name: 'binary-instrument',
  domain: 'binary-instrument',
  description:
    'entropy profile separation, strings extraction (ASCII/UTF-16LE), DEX magic scan, packer signature detection',
  cases: [
    {
      name: 'binary_entropy_profile/regions-separated',
      tool: 'binary_entropy_profile',
      origin: 'homemade',
      reference:
        'tool contract: ≥7.0 bits/byte flags encrypted/compressed — stats must span [0 (constant region), ≥7 (random region)] and flag high regions at offset ≥4096',
      run: () => scan.handleBinaryEntropyProfile({ filePath: mixedPath }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const stats = b.stats as { minEntropy?: number; maxEntropy?: number } | undefined;
        if (!stats || typeof stats.minEntropy !== 'number' || typeof stats.maxEntropy !== 'number')
          return `no stats block: ${JSON.stringify(b).slice(0, 240)}`;
        if (stats.minEntropy > 1.0)
          return `constant region not low entropy: min=${stats.minEntropy}`;
        if (stats.maxEntropy < 7.0)
          return `random region not high entropy: max=${stats.maxEntropy}`;
        const regions = (b.highEntropyRegions ?? []) as Array<{ offset?: number }>;
        if (!Array.isArray(regions) || regions.length === 0)
          return 'no high-entropy regions flagged';
        if (regions.some((r) => (r.offset ?? Infinity) < 4096))
          return 'constant region incorrectly flagged as high entropy';
        return true;
      },
    },
    {
      name: 'binary_strings_extract/ascii-and-utf16',
      tool: 'binary_strings_extract',
      origin: 'homemade',
      reference:
        'planted strings: ASCII "libnative_sign_payload" and 16-bit-aligned UTF-16LE "SecretKeyStore"',
      run: () => scan.handleBinaryStringsExtract({ filePath: stringsPath }),
      validate: (v) => {
        const b = body(v);
        const text = JSON.stringify(b);
        if (b.success === false) return `failed: ${b.error}`;
        if (!text.includes('libnative_sign_payload')) return 'ASCII string missed';
        if (!text.includes('SecretKeyStore')) return 'UTF-16LE string missed (aligned case)';
        return true;
      },
    },
    {
      name: 'binary_strings_extract/utf16-odd-offset',
      tool: 'binary_strings_extract',
      origin: 'homemade',
      reference:
        'UTF-16LE "OddKey" starting at byte offset 7 (odd phase after an odd-length ASCII run) must be found',
      run: () => scan.handleBinaryStringsExtract({ filePath: oddStringsPath }),
      validate: (v) => {
        const b = body(v);
        const text = JSON.stringify(b);
        if (b.success === false) return `failed: ${b.error}`;
        if (!text.includes('OddKey')) return 'odd-offset UTF-16LE string missed';
        return true;
      },
    },
    {
      name: 'binary_strings_extract/regex-filter',
      tool: 'binary_strings_extract',
      origin: 'homemade',
      reference: 'regex filter (pattern arg) must keep only matching strings',
      run: () =>
        scan.handleBinaryStringsExtract({
          filePath: stringsPath,
          pattern: 'libnative_.*',
        }),
      validate: (v) => {
        const b = body(v);
        const text = JSON.stringify(b);
        if (!text.includes('libnative_sign_payload')) return 'matching string missed';
        if (text.includes('SecretKeyStore')) return 'non-matching string leaked through filter';
        return true;
      },
    },
    {
      name: 'dex_scan_file/dex-magic',
      tool: 'dex_scan_file',
      origin: 'external-vector',
      reference: 'DEX magic "dex\n035\0" (ART dex_file_struct.h) must be detected at offset 0',
      run: () => scan.handleDexScanFile({ filePath: dexPath }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b).toLowerCase();
        if (!text.includes('dex')) return 'dex not reported';
        const hits = (b.hits ?? b.matches ?? b.found) as
          | Array<{ offset?: number }>
          | boolean
          | undefined;
        if (typeof hits === 'boolean') return hits ? true : 'dex magic not found';
        if (Array.isArray(hits)) {
          if (hits.length === 0) return 'no hits for a file that IS a dex';
          if (hits[0]?.offset !== undefined && hits[0].offset !== 0)
            return `expected offset 0, got ${hits[0].offset}`;
        }
        return true;
      },
    },
    {
      name: 'apk_packer_detect/custom-signature-match',
      tool: 'apk_packer_detect',
      origin: 'homemade',
      reference:
        'caller-supplied signature table: a lib/arm64-v8a/libjiagu.so file must match a custom jiagu-style signature (dirPath mode)',
      run: () =>
        apk.handleApkPackerDetect({
          dirPath: fakeApkDir,
          customSignatures: [
            {
              name: 'custom-jiagu-test',
              category: 'packer',
              libPatterns: ['libjiagu.*\\.so'],
            },
          ],
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b).toLowerCase();
        if (!text.includes('custom-jiagu-test') && !text.includes('jiagu'))
          return `custom signature did not match: ${text.slice(0, 260)}`;
        return true;
      },
    },
    {
      name: 'apk_packer_list_signatures/empty-default',
      tool: 'apk_packer_list_signatures',
      origin: 'homemade',
      reference:
        'framework ships NO built-in signature table (documented contract) — default is empty',
      run: () => apk.handleApkPackerListSignatures({}),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const sigs = (b.signatures ?? b.list ?? b.items) as unknown[] | undefined;
        if (Array.isArray(sigs) && sigs.length > 0)
          return `expected empty default table, got ${sigs.length} entries`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline APK/DEX, Frida script-gen, capabilities, keys ──
    {
      name: 'binary_instrument_capabilities/probes-toolchains',
      tool: 'binary_instrument_capabilities',
      origin: 'homemade',
      reference: 'reports availability of Frida/Ghidra/JADX/apktool/unidbg toolchains honestly',
      run: () => bi.handleBinaryInstrumentCapabilities(),
      validate: (v) => {
        const b = body(v);
        const caps = b.capabilities as Array<{ capability?: string }> | undefined;
        if (!Array.isArray(caps) || caps.length === 0)
          return `missing capabilities array: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'get_available_plugins/empty-without-context',
      tool: 'get_available_plugins',
      origin: 'homemade',
      reference: 'returns empty plugins array when no extension context is attached',
      run: () => bi.handleGetAvailablePlugins({}),
      validate: (v) => {
        const b = body(v);
        if (!Array.isArray(b.plugins)) return `missing plugins array: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'frida_list_sessions/idle-sessions-list',
      tool: 'frida_list_sessions',
      origin: 'homemade',
      reference: 'returns sessions list cleanly without live device attached',
      run: () => bi.handleFridaListSessions({}),
      validate: (v) => {
        const b = body(v);
        if (!Array.isArray(b.sessions)) return `missing sessions array: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'frida_generate_script/interceptor-template',
      tool: 'frida_generate_script',
      origin: 'homemade',
      reference: 'generates Frida Interceptor.attach JS template for target native function',
      run: () =>
        bi.handleFridaGenerateScript({
          target: 'libnative.so',
          functionName: 'sign_request',
          template: 'trace',
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const script = String(b.script ?? '');
        if (!script.includes('Interceptor') && !script.includes('sign_request'))
          return `generated script missing Interceptor/functionName: ${script.slice(0, 150)}`;
        return true;
      },
    },
    {
      name: 'generate_hooks/frida-hook-script',
      tool: 'generate_hooks',
      origin: 'homemade',
      reference: 'generates Frida hook script for supplied native/Java symbol names',
      run: () => bi.handleGenerateHooks({ symbols: ['Java_com_bench_Sign_compute'] }),
      validate: (v) => {
        const b = body(v);
        const script = String(b.script ?? '');
        if (Number(b.symbolCount) !== 1 || !script.includes('Java_com_bench_Sign_compute'))
          return `generated hook missing expected symbol: ${JSON.stringify(b).slice(0, 150)}`;
        return true;
      },
    },
    {
      name: 'export_hook_script/frida-format-export',
      tool: 'export_hook_script',
      origin: 'homemade',
      reference: 'exports hook template definitions into runnable Frida JS script',
      run: () =>
        bi.handleExportHookScript({
          hookTemplates: JSON.stringify([
            {
              functionName: 'getToken',
              hookCode: 'console.log("getToken called");',
              description: 'log getToken call',
            },
          ]),
        }),
      validate: (v) => {
        const b = body(v);
        if (b.format !== 'frida' || Number(b.hookCount) !== 1)
          return `unexpected export result: ${JSON.stringify(b)}`;
        if (!String(b.script ?? '').includes('getToken'))
          return `exported script missing functionName: ${String(b.script).slice(0, 150)}`;
        return true;
      },
    },
    {
      name: 'apk_native_libs_list/lists-arm64-so',
      tool: 'apk_native_libs_list',
      origin: 'homemade',
      reference: 'lists lib/arm64-v8a/libnative.so from synthetic APK archive via yauzl',
      run: () => bi.handleApkNativeLibsList({ apkPath: sampleApkPath }),
      validate: (v) => {
        const b = body(v);
        if (b.available !== true || Number(b.count) !== 1)
          return `expected 1 native lib, got ${JSON.stringify(b)}`;
        const libs = b.libraries as Array<{ abi?: string; name?: string }>;
        if (libs[0]?.abi !== 'arm64-v8a' || libs[0]?.name !== 'libnative.so')
          return `unexpected library metadata: ${JSON.stringify(libs)}`;
        return true;
      },
    },
    {
      name: 'apk_manifest_dump/extracts-xml-manifest',
      tool: 'apk_manifest_dump',
      origin: 'homemade',
      reference: 'extracts AndroidManifest.xml from synthetic APK archive',
      run: () => bi.handleApkManifestDump({ apkPath: sampleApkPath }),
      validate: (v) => {
        const b = body(v);
        if (b.available !== true || !String(b.manifest ?? '').includes('com.bench.sample'))
          return `expected manifest with com.bench.sample, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'apk_manifest_query/summarizes-package',
      tool: 'apk_manifest_query',
      origin: 'homemade',
      reference: 'queries parsed AndroidManifest.xml package metadata and surface hints',
      run: () => bi.handleApkManifestQuery({ apkPath: sampleApkPath }),
      validate: (v) => {
        const b = body(v);
        if (b.available !== true || !b.summary)
          return `expected summary in manifest query, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'apk_static_triage/inspects-zip-dex-libs',
      tool: 'apk_static_triage',
      origin: 'homemade',
      reference: 'performs static APK triage reporting ZIP entryCount, DEX files, and native libs',
      run: () => bi.handleApkStaticTriage({ apkPath: sampleApkPath }),
      validate: (v) => {
        const b = body(v);
        if (b.available !== true) return `triage failed: ${JSON.stringify(b).slice(0, 200)}`;
        const zip = b.zip as { entryCount?: number } | undefined;
        if (!zip || Number(zip.entryCount) < 3)
          return `expected >=3 ZIP entries in triage, got ${JSON.stringify(zip)}`;
        return true;
      },
    },
    {
      name: 'apk_dex_intake/discovers-classes-dex',
      tool: 'apk_dex_intake',
      origin: 'homemade',
      reference: 'scans APK ZIP for classes.dex magic and headers',
      run: () => bi.handleApkDexIntake({ apkPath: sampleApkPath }),
      validate: (v) => {
        const b = body(v);
        if (b.available !== true && b.success !== true)
          return `dex intake failed: ${JSON.stringify(b).slice(0, 200)}`;
        const text = JSON.stringify(b);
        if (!text.includes('classes.dex'))
          return `expected classes.dex in dex intake report, got ${text.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'apk_signing_block_parse/parses-apk-container',
      tool: 'apk_signing_block_parse',
      origin: 'homemade',
      reference: 'parses APK ZIP EOCD/signing block container cleanly (no false signatures)',
      run: () => apk.handleApkSigningBlockParse({ apkPath: sampleApkPath }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.report || typeof b.report !== 'object')
          return `missing report in signing block parse: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'binary_key_extract/high-entropy-key-blob',
      tool: 'binary_key_extract',
      origin: 'homemade',
      reference: 'extracts high-entropy 32-byte key candidate embedded in zero-padded binary',
      run: () =>
        secrets.handleBinaryKeyExtract({
          filePath: keyBlobPath,
          keyLengths: [32],
          minEntropy: 3.5,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!b.result || typeof b.result !== 'object')
          return `missing result in binary_key_extract: ${JSON.stringify(b)}`;
        return true;
      },
    },
  ],
};
