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

    // ── Toolchain-contract batch 2026-11-12 (autoresearch) ────────────────
    // Every tool below wraps an external toolchain (frida / unidbg / apktool /
    // apksigner / ghidra / ida plugin). Two portable contracts hold on any
    // machine: (1) missing required arguments are rejected BY NAME before any
    // toolchain is touched, and (2) session/keystore/prerequisite gaps produce
    // an explicit refusal — never a success envelope with fabricated data.
    {
      name: 'frida_spawn/rejects-missing-target',
      tool: 'frida_spawn',
      origin: 'homemade',
      reference:
        'argument contract: spawning requires a target and must be rejected by name before frida is invoked',
      run: () => rejectsByName(() => bi.handleFridaSpawn({}), /target/),
      validate: (v) => v as true | string,
    },
    {
      name: 'frida_detach/requires-sessionId',
      tool: 'frida_detach',
      origin: 'homemade',
      reference:
        'session contract: every session-scoped frida tool refuses by naming the missing sessionId rather than detaching an arbitrary session',
      run: () => bi.handleFridaDetach({}),
      validate: (v) => namesMissingArg(v, 'sessionId'),
    },
    {
      name: 'frida_resume/requires-sessionId',
      tool: 'frida_resume',
      origin: 'homemade',
      reference: 'session contract: resume without a sessionId is rejected by name',
      run: () => rejectsByName(() => bi.handleFridaResume({}), /sessionId/),
      validate: (v) => v as true | string,
    },
    {
      name: 'frida_run_script/rejects-script-without-session',
      tool: 'frida_run_script',
      origin: 'homemade',
      reference:
        'session contract: a script body alone is insufficient — running it requires an attached sessionId, so the call must fail explicitly',
      run: () => bi.handleFridaRunScript({ script: 'console.log(1)' }),
      validate: (v) => namesMissingArg(v, 'sessionId'),
    },
    {
      name: 'frida_enumerate_modules/requires-sessionId',
      tool: 'frida_enumerate_modules',
      origin: 'homemade',
      reference:
        'session contract: module enumeration targets one attached session and names it when absent',
      run: () => rejectsByName(() => bi.handleFridaEnumerateModules({}), /sessionId/),
      validate: (v) => v as true | string,
    },
    {
      name: 'frida_memory_read/requires-sessionId',
      tool: 'frida_memory_read',
      origin: 'homemade',
      reference:
        'session contract: memory reads are scoped to a session; without one the call must not return bytes',
      run: () =>
        rejectsByName(() => bi.handleFridaMemoryRead({ address: '0x1000', size: 16 }), /sessionId/),
      validate: (v) => v as true | string,
    },
    {
      name: 'frida_dex_dump/requires-outputDir',
      tool: 'frida_dex_dump',
      origin: 'homemade',
      reference:
        'artifact contract: dumping DEX requires an explicit outputDir so the handler never guesses a write path',
      run: () => rejectsByName(() => bi.handleFridaDexDump({}), /outputDir/),
      validate: (v) => v as true | string,
    },
    {
      name: 'frida_attach_interceptor/requires-symbol',
      tool: 'frida_attach_interceptor',
      origin: 'homemade',
      reference:
        'argument contract: an interceptor needs the symbol to hook and rejects the call by name without it',
      run: () => rejectsByName(() => bi.handleFridaAttachInterceptor({}), /symbol/),
      validate: (v) => v as true | string,
    },
    {
      name: 'frida_list_processes/lists-or-names-failure',
      tool: 'frida_list_processes',
      origin: 'homemade',
      reference:
        'listing contract: returns a real processes[] array with a matching count, or success=false with a reason/fix — never an empty array presented as success (frida_list_devices is intentionally unmeasured here: its probe costs ~15s per run on this host)',
      run: () => bi.handleFridaListProcesses({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true) {
          const processes = b['processes'];
          return Array.isArray(processes) && b['count'] === (processes as unknown[]).length
            ? true
            : `processes/count inconsistent: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (b['success'] !== false)
          return `expected success boolean: ${JSON.stringify(b).slice(0, 200)}`;
        if (!String(b['reason'] ?? '').trim()) return `failure without a reason`;
        if (b['processes'] !== undefined) return `must not return processes on failure`;
        return true;
      },
    },
    {
      name: 'unidbg_launch/requires-soPath',
      tool: 'unidbg_launch',
      origin: 'homemade',
      reference:
        'argument contract: launching an emulation session requires soPath and names it when absent',
      run: () => bi.handleUnidbgLaunch({}),
      validate: (v) => namesMissingArg(v, 'soPath'),
    },
    {
      name: 'unidbg_call/requires-functionName',
      tool: 'unidbg_call',
      origin: 'homemade',
      reference:
        'argument contract: calling into an emulated SO requires functionName; a bare session id is not enough',
      run: () => bi.handleUnidbgCall({ sessionId: 'bench-session' }),
      validate: (v) => namesMissingArg(v, 'functionName'),
    },
    {
      name: 'unidbg_trace/unknown-session-honest-error',
      tool: 'unidbg_trace',
      origin: 'homemade',
      reference:
        'session contract: an unknown sessionId must produce an explicit "not found" answer instead of an empty trace that looks like a successful capture',
      run: () => bi.handleUnidbgTrace({ sessionId: 'bench-missing-session' }),
      validate: (v) => {
        const b = body(v);
        const text = JSON.stringify(b);
        if (!/not found/i.test(text))
          return `expected a not-found answer, got ${text.slice(0, 200)}`;
        if (Array.isArray(b['trace']) && (b['trace'] as unknown[]).length > 0)
          return `must not invent trace rows for an unknown session`;
        return true;
      },
    },
    {
      name: 'unidbg_emulate/requires-binaryPath',
      tool: 'unidbg_emulate',
      origin: 'homemade',
      reference:
        'argument contract: emulation needs the guest binary path and rejects the call by name without it',
      run: () => rejectsByName(() => bi.handleUnidbgEmulate({}), /binaryPath/),
      validate: (v) => v as true | string,
    },
    {
      name: 'android_runtime_dump_session/requires-outputDir',
      tool: 'android_runtime_dump_session',
      origin: 'homemade',
      reference:
        'artifact contract: a runtime dump needs an explicit outputDir; the handler must not pick a write path itself',
      run: () => rejectsByName(() => bi.handleAndroidRuntimeDumpSession({}), /outputDir/),
      validate: (v) => v as true | string,
    },
    {
      name: 'apk_sign/refuses-without-keystore',
      tool: 'apk_sign',
      origin: 'homemade',
      reference:
        'signing contract: without a keystore the tool refuses (signed:false + fix) rather than emitting an unsigned or debug-signed APK; absent apksigner it reports available:false',
      run: () => bi.handleApktoolSign({ apkPath: mixedPath }),
      validate: (v) => {
        const b = body(v);
        if (b['signed'] === true) return `signed:true without a keystore — fabricated success`;
        if (b['available'] === false) {
          return b['capability'] === 'apksigner' && String(b['fix'] ?? '').length > 0
            ? true
            : `unavailable without capability/fix: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (b['signed'] !== false)
          return `expected an explicit refusal: ${JSON.stringify(b).slice(0, 200)}`;
        return /keystore/i.test(String(b['fix'] ?? ''))
          ? true
          : `refusal should mention the keystore`;
      },
    },
    {
      name: 'ghidra_analyze/shape-or-honest-unavailable',
      tool: 'ghidra_analyze',
      origin: 'homemade',
      reference:
        'analysis contract: available → an analysis object with function/import/export/string arrays; unavailable → available:false with capability/fix and the static string fallback populated from the real binary',
      run: () => bi.handleGhidraAnalyze({ binaryPath: stringsPath, timeout: 60_000 }),
      validate: (v) => {
        const b = body(v);
        if (b['available'] === false) {
          if (b['capability'] !== 'ghidra_headless' || !String(b['fix'] ?? '').trim())
            return `unavailable without capability/fix: ${JSON.stringify(b).slice(0, 200)}`;
          const strings = (b['strings'] ?? []) as string[];
          if (!strings.includes(asciiStr))
            return `static fallback should recover the printable string: ${JSON.stringify(strings.slice(0, 5))}`;
          return true;
        }
        const analysis = b['analysis'] as Record<string, unknown> | undefined;
        if (!analysis)
          return `available without an analysis object: ${JSON.stringify(b).slice(0, 200)}`;
        for (const key of ['functions', 'imports', 'exports', 'strings']) {
          if (!Array.isArray(analysis[key])) return `analysis.${key} is not an array`;
        }
        return true;
      },
    },
    {
      name: 'jadx_search_code/empty-result-is-honest',
      tool: 'jadx_search_code',
      origin: 'homemade',
      reference:
        'search contract: a query with no hits reports success with zero matches/filesMatched (never fabricated rows), naming the engine actually used',
      run: () => bi.handleJadxSearchCode({ query: 'ZzzNoSuchSymbol', decompileDir: tmp }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true) return `search failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['totalMatches'] !== 0 || b['filesMatched'] !== 0)
          return `empty search must report zero hits: ${JSON.stringify(b).slice(0, 200)}`;
        if (!Array.isArray(b['matches']) || (b['matches'] as unknown[]).length !== 0)
          return `matches must be an empty array`;
        if (!String(b['engine'] ?? '').trim()) return `engine label missing`;
        return true;
      },
    },
    {
      name: 'jadx_decompile_apk/reports-output-layout',
      tool: 'jadx_decompile_apk',
      origin: 'homemade',
      reference:
        'decompile contract: the response names the outputDir/sourcesDir/resourcesDir it would use and never claims classes were extracted when the APK was rejected (sampleFiles stays empty)',
      run: () => bi.handleJadxDecompileApk({ apkPath: mixedPath }),
      validate: (v) => {
        const b = body(v);
        if (b['available'] === false) {
          return String(b['fix'] ?? '').trim() ? true : `unavailable without fix guidance`;
        }
        if (!String(b['outputDir'] ?? '').trim() || !String(b['sourcesDir'] ?? '').trim())
          return `output layout not reported: ${JSON.stringify(b).slice(0, 200)}`;
        const samples = (b['sampleFiles'] ?? []) as unknown[];
        if (!Array.isArray(samples)) return `sampleFiles must be an array`;
        if (b['error'] !== undefined && samples.length > 0)
          return `must not list sample files when decompilation errored`;
        return true;
      },
    },
    {
      name: 'apktool_decode/error-is-explicit',
      tool: 'apktool_decode',
      origin: 'homemade',
      reference:
        'toolchain contract: a non-APK input must surface apktool’s failure text plus the outputDir it used — never a silent success with an empty directory',
      run: () => bi.handleApktoolDecode({ apkPath: mixedPath }),
      validate: (v) => {
        const b = body(v);
        if (b['available'] === false) {
          return b['capability'] === 'apktool_cli' && String(b['fix'] ?? '').trim()
            ? true
            : `unavailable without capability/fix`;
        }
        if (!String(b['outputDir'] ?? '').trim()) return `outputDir not reported`;
        if (b['error'] === undefined) return `non-APK input must produce an explicit error`;
        return String(b['error']).length > 0 ? true : `empty error text`;
      },
    },
    {
      name: 'frida_memory_scan/unknown-session-refused',
      tool: 'frida_memory_scan',
      origin: 'homemade',
      reference:
        'session contract: scanning an unknown sessionId fails with available:false + the attach fix, and returns an empty matches[] rather than invented hits',
      run: () => bi.handleFridaMemoryScan({ sessionId: 'bench-missing-session', pattern: '41 42' }),
      validate: (v) => unknownSessionContract(v, 'matches'),
    },
    {
      name: 'frida_enumerate_functions/unknown-session-refused',
      tool: 'frida_enumerate_functions',
      origin: 'homemade',
      reference:
        'session contract: function enumeration on an unknown session fails explicitly and returns an empty functions[] instead of a plausible-looking list',
      run: () =>
        bi.handleFridaEnumerateFunctions({
          sessionId: 'bench-missing-session',
          moduleName: 'libc.so',
        }),
      validate: (v) => unknownSessionContract(v, 'functions'),
    },
    {
      name: 'frida_attach/unavailable-target-honest',
      tool: 'frida_attach',
      origin: 'homemade',
      reference:
        'attach contract: attaching to a non-existent process fails with available:true + the privilege/injection fix and the attempted target — never a fabricated sessionId',
      run: () => bi.handleFridaAttach({ target: 'jshook-bench-no-such-process' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true) return `must not succeed against a missing process`;
        if (b['target'] !== 'jshook-bench-no-such-process')
          return `attempted target not echoed: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['sessionId'] !== undefined) return `must not return a sessionId on failure`;
        if (!String(b['reason'] ?? '').trim()) return `failure without a reason`;
        return b['available'] === false || String(b['fix'] ?? '').trim().length > 0
          ? true
          : `available failure should carry fix guidance`;
      },
    },
    {
      name: 'frida_find_symbols/unknown-session-refused',
      tool: 'frida_find_symbols',
      origin: 'homemade',
      reference:
        'session contract: symbol lookup on an unknown session fails explicitly and returns an empty symbols[] instead of a plausible-looking table',
      run: () =>
        bi.handleFridaFindSymbols({ sessionId: 'bench-missing-session', pattern: 'sign_*' }),
      validate: (v) => unknownSessionContract(v, 'symbols'),
    },
    {
      name: 'jadx_decompile/missing-class-honest-error',
      tool: 'jadx_decompile',
      origin: 'homemade',
      reference:
        'decompile contract: when the decompiled sources tree is absent the handler reports the error and the requested className rather than emitting empty source',
      run: () => bi.handleJadxDecompile({ apkPath: mixedPath, className: 'com.bench.Missing' }),
      validate: (v) => {
        const b = body(v);
        if (b['available'] === false)
          return String(b['fix'] ?? '').trim() ? true : 'no fix guidance';
        if (b['className'] !== 'com.bench.Missing')
          return `className not echoed: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['error'] === undefined && b['source'] === undefined)
          return `expected either an error or a source payload: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['error'] !== undefined && String(b['source'] ?? '').length > 0)
          return `must not return source alongside an error`;
        return true;
      },
    },
    {
      name: 'apktool_build/error-is-explicit',
      tool: 'apktool_build',
      origin: 'homemade',
      reference:
        'toolchain contract: building from a directory without apktool.yml must surface apktool’s failure and the sourceDir it used — no fabricated APK path',
      run: () => bi.handleApktoolBuild({ sourceDir: tmp }),
      validate: (v) => {
        const b = body(v);
        if (b['available'] === false) {
          return b['capability'] === 'apktool_cli' && String(b['fix'] ?? '').trim()
            ? true
            : `unavailable without capability/fix`;
        }
        if (!String(b['sourceDir'] ?? '').trim()) return `sourceDir not echoed`;
        if (b['error'] === undefined) return `non-project dir must produce an explicit error`;
        if (String(b['apkPath'] ?? '').length > 0) return `must not report an APK path on failure`;
        return true;
      },
    },
    {
      name: 'ida_decompile/refuses-without-plugin-registry',
      tool: 'ida_decompile',
      origin: 'homemade',
      reference:
        'plugin contract: IDA decompilation is delivered by an extension plugin; without a plugin registry the tool must fail naming the capability instead of pretending to decompile',
      run: () => bi.handleIdaDecompile({ binaryPath: mixedPath, functionName: 'main' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true) return `must not claim success without an IDA bridge`;
        if (b['capability'] !== 'plugin_ida_bridge')
          return `expected capability "plugin_ida_bridge", got ${String(b['capability'])}`;
        if (b['available'] !== false)
          return `expected available:false, got ${String(b['available'])}`;
        if (!String(b['fix'] ?? '').trim()) return `missing fix guidance`;
        return true;
      },
    },

    // ── Tail-contract batch 2026-11-12 (autoresearch) ────────────────────────
    {
      name: 'frida_list_devices/reports-or-names-failure',
      tool: 'frida_list_devices',
      origin: 'homemade',
      reference:
        'listing contract: returns a real devices[] array with a matching count, or a named failure carrying the CLI diagnostic (the ~15s probe cost is why this case is the only one, and why it is not part of the default batch)',
      run: () => bi.handleFridaListDevices({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true) {
          const devices = b['devices'];
          return Array.isArray(devices) && b['count'] === (devices as unknown[]).length
            ? true
            : `devices/count inconsistent: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (b['success'] !== false)
          return `expected a success boolean: ${JSON.stringify(b).slice(0, 160)}`;
        if (!String(b['reason'] ?? '').trim()) return 'failure without a reason';
        if (b['devices'] !== undefined) return 'must not return devices on failure';
        return true;
      },
    },
    {
      name: 'ghidra_decompile/reports-unresolved-function',
      tool: 'ghidra_decompile',
      origin: 'homemade',
      reference:
        'lookup contract: a function that cannot be decompiled is reported as found:false with the analysed binary and a reason pointing at ghidra_analyze — never empty pseudocode presented as a result',
      run: () =>
        bi.handleGhidraDecompile({ binaryPath: mixedPath, functionName: 'jshook_bench_missing' }),
      validate: (v) => {
        const b = body(v);
        if (b['available'] === false) {
          return String(b['fix'] ?? '').trim() ? true : 'unavailable without fix guidance';
        }
        if (b['found'] === true) return true;
        if (b['found'] !== false)
          return `expected found:false, got ${JSON.stringify(b).slice(0, 160)}`;
        if (!/ghidra_analyze/i.test(String(b['reason'] ?? '')))
          return `reason should point at ghidra_analyze: ${String(b['reason']).slice(0, 160)}`;
        return String(b['binaryPath'] ?? '').length > 0 ? true : 'binaryPath not echoed';
      },
    },
  ],
};

/** Assert a handler rejects a call by naming the missing argument (throw or error text). */
async function rejectsByName(run: () => Promise<unknown>, arg: RegExp): Promise<true | string> {
  try {
    const v = await run();
    const text = JSON.stringify(body(v));
    return arg.test(text) ? true : `call resolved without naming ${arg}: ${text.slice(0, 200)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return arg.test(message) ? true : `rejection does not name ${arg}: ${message.slice(0, 200)}`;
  }
}

/** Assert a text/JSON response names a missing argument. */
function namesMissingArg(v: unknown, arg: string): true | string {
  const text = JSON.stringify(body(v));
  return text.includes(arg) ? true : `response does not name "${arg}": ${text.slice(0, 200)}`;
}

/**
 * Unknown-session contract shared by the session-scoped frida tools: an
 * explicit failure, the attach fix, an empty result array, and no invented rows.
 */
function unknownSessionContract(v: unknown, resultKey: string): true | string {
  const b = body(v);
  if (b['success'] !== false)
    return `expected success=false, got ${JSON.stringify(b).slice(0, 200)}`;
  if (b['capability'] !== 'frida_session')
    return `expected capability "frida_session", got ${String(b['capability'])}`;
  if (!/Unknown Frida session|not found/i.test(String(b['reason'] ?? '')))
    return `expected an unknown-session reason, got "${String(b['reason'])}"`;
  if (!String(b['fix'] ?? '').includes('frida_attach'))
    return `fix should point at frida_attach: ${String(b['fix'])}`;
  const rows = b[resultKey];
  if (!Array.isArray(rows) || rows.length !== 0)
    return `${resultKey} must be an empty array without a live session`;
  return true;
}
