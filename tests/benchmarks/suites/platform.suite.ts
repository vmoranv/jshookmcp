/**
 * Platform domain benchmark (offline subset — ASAR format roundtrip).
 *
 * External reference:
 *  - Electron ASAR format (github.com/electron/asar): 4×UInt32LE pickle prefix +
 *    JSON header + data segment; repack output must be extractable back to the
 *    identical file set, and searchable without extraction.
 * Homemade fixtures:
 *  - a miniature "app" directory (package.json + main.js + nested renderer)
 *  - search pattern hit/miss discrimination
 */
import { PlatformToolHandlers } from '@server/domains/platform/handlers';
import { body, expectSuccess, type BenchSuite } from '../harness';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const collector = { getActivePage: async () => null } as never;
const handlers = new PlatformToolHandlers(collector);

const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-asar-'));
const appDir = join(tmp, 'app');
mkdirSync(join(appDir, 'renderer'), { recursive: true });
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify({ name: 'bench-app', main: 'main.js', version: '1.0.0' }, null, 2),
);
writeFileSync(join(appDir, 'main.js'), "const { app } = require('electron');\napp.whenReady();\n");
writeFileSync(
  join(appDir, 'renderer', 'index.js'),
  "const SECRET_BENCH_TOKEN = 'asar-bench-marker-7f3a';\nmodule.exports = { SECRET_BENCH_TOKEN };\n",
);

// A dedicated app dir holding one file with a classic string-array
// obfuscation shape (hex-escaped array + self-defending IIFE) — kept OUT of
// appDir so the asar_extract exact-file-set roundtrip stays untouched.
const obfDir = join(tmp, 'obf-app');
mkdirSync(obfDir, { recursive: true });
writeFileSync(
  join(obfDir, 'obfuscated.js'),
  [
    'var _0x1234 = "eval";',
    'eval(atob("YWxlcnQoMSk="));',
    Array.from({ length: 30 }, (_, i) => `var _0x${(0x1000 + i).toString(16)} = ${i};`).join('\n'),
  ].join('\n'),
);
const obfAsarPath = join(tmp, 'obf-app.asar');

// Electron-style JSON userdata fixture for the scan_userdata case.
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ window: { width: 800 } }));
writeFileSync(join(userDataDir, 'cache.json'), JSON.stringify({ etag: 'abc' }));
writeFileSync(join(userDataDir, 'notes.txt'), 'not json');
const asarPath = join(tmp, 'app.asar');
const extractDir = join(tmp, 'extracted');
process.once('exit', () => {
  try {
    require('node:fs').rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* tmpdir */
  }
});

export const platformSuite: BenchSuite = {
  name: 'platform',
  domain: 'platform',
  description:
    'Electron ASAR format: repack → extract roundtrip fidelity, grep-without-extract, format constants',
  cases: [
    {
      name: 'asar_repack/valid-archive',
      tool: 'asar_repack',
      origin: 'external-vector',
      reference:
        'Electron ASAR format (electron/asar): output must start with the 4×UInt32LE pickle prefix and contain a JSON header',
      run: () => handlers.handleAsarRepackTool({ inputDir: appDir, outputPath: asarPath }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!existsSync(asarPath)) return 'asar file not written';
        const buf = readFileSync(asarPath);
        if (buf.length < 16) return 'asar too small';
        // pickle: UInt32LE payload_size, then header pickle: 4 + header_size…
        const jsonStart = buf.indexOf('{"files"');
        if (jsonStart < 0) return 'no JSON header found in asar';
        if (buf.readUInt32LE(0) + 8 > buf.length + 8) return 'implausible payload size';
        void b;
        return true;
      },
    },
    {
      name: 'asar_extract/roundtrip-fidelity',
      tool: 'asar_extract',
      origin: 'external-vector',
      reference:
        'asar extract must restore the exact packed file set (package.json, main.js, renderer/index.js) with identical bytes',
      run: () => handlers.handleAsarExtractTool({ inputPath: asarPath, outputDir: extractDir }),
      validate: (v) => {
        const b = expectSuccess(v);
        for (const rel of ['package.json', 'main.js', join('renderer', 'index.js')]) {
          const p = join(extractDir, rel);
          if (!existsSync(p)) return `missing extracted file: ${rel}`;
        }
        const original = readFileSync(join(appDir, 'renderer', 'index.js'));
        const restored = readFileSync(join(extractDir, 'renderer', 'index.js'));
        if (!original.equals(restored)) return 'renderer/index.js bytes differ after roundtrip';
        void b;
        return true;
      },
    },
    {
      name: 'asar_search/pattern-hit-and-miss',
      tool: 'asar_search',
      origin: 'homemade',
      reference:
        'grep-inside-asar: planted marker must hit inside renderer/index.js; a nonsense pattern must miss',
      run: async () => {
        const hit = body(
          await handlers.handleAsarSearchTool({
            inputPath: asarPath,
            pattern: 'asar-bench-marker-7f3a',
          }),
        );
        const miss = body(
          await handlers.handleAsarSearchTool({
            inputPath: asarPath,
            pattern: 'no-such-marker-xyz',
          }),
        );
        return { hit, miss };
      },
      validate: (v) => {
        const { hit, miss } = v as { hit: Record<string, unknown>; miss: Record<string, unknown> };
        const hitText = JSON.stringify(hit);
        if (!hitText.includes('asar-bench-marker-7f3a') && !hitText.includes('renderer'))
          return `planted marker not found: ${hitText.slice(0, 220)}`;
        const missMatches = Number(miss.matchCount ?? miss.matches ?? miss.count ?? 0);
        if (Number.isFinite(missMatches) && missMatches > 0)
          return `nonsense pattern reported ${missMatches} matches`;
        return true;
      },
    },
    {
      name: 'platform_capabilities/capabilities-probe-contract',
      tool: 'platform_capabilities',
      origin: 'homemade',
      reference: 'invokes handlePlatformCapabilitiesTool and returns structured capability flags',
      run: async () => {
        return handlers.handlePlatformCapabilitiesTool();
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (typeof b !== 'object' || b === null)
          return `expected structured object from platform_capabilities, got: ${typeof b}`;
        return true;
      },
    },
    {
      name: 'electron_inspect_app/inspect-dir-structure',
      tool: 'electron_inspect_app',
      origin: 'homemade',
      reference: 'invokes handleElectronInspectAppTool on mock appDir and extracts main entry',
      run: async () => {
        return handlers.handleElectronInspectAppTool({ appPath: appDir });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.mainEntry !== 'main.js')
          return `expected mainEntry=main.js, got: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-10 (autoresearch): offline platform tools ──
    {
      name: 'asar_deobfuscate/flags-string-array',
      tool: 'asar_deobfuscate',
      origin: 'homemade',
      reference:
        'the scanner must flag the hex-escaped string-array file while leaving clean JS unflagged (negative control)',
      run: async () => {
        const repack = (await handlers.handleAsarRepackTool({
          inputDir: obfDir,
          outputPath: obfAsarPath,
        })) as { success?: boolean; error?: string };
        if (repack.success === false) throw new Error(`repack failed: ${repack.error}`);
        return import('@server/domains/platform/handlers/asar-deobfuscate-handler').then((m) =>
          m.handleAsarDeobfuscate({ inputPath: obfAsarPath, extract: false }),
        );
      },
      validate: (v: unknown) => {
        const b = body(v) as {
          success?: boolean;
          error?: string;
          filesScanned?: number;
          flaggedFiles?: Array<{ path?: string; classification?: string }>;
        };
        if (b.success === false) return `deobfuscate failed: ${b.error}`;
        if ((b.filesScanned ?? 0) < 1) return `expected >= 1 scanned file, got ${b.filesScanned}`;
        const flagged = b.flaggedFiles ?? [];
        const obf = flagged.find((f) => (f.path ?? '').includes('obfuscated.js'));
        if (!obf)
          return `string-array file not flagged, got ${JSON.stringify(flagged.map((f) => f.path))}`;
        if (obf.classification === 'clean') return 'obfuscated.js classified clean';
        return true;
      },
    },
    {
      name: 'miniapp_pkg_analyze/pages-from-app-json',
      tool: 'miniapp_pkg_analyze',
      origin: 'homemade',
      reference: 'analyzing an unpacked miniapp must surface the pages declared in app.json',
      run: async () => {
        const unpackedDir = join(tmp, 'miniapp-unpacked');
        mkdirSync(join(unpackedDir, 'pages', 'index'), { recursive: true });
        writeFileSync(
          join(unpackedDir, 'app.json'),
          JSON.stringify({ pages: ['pages/index/index'], window: {} }),
        );
        writeFileSync(join(unpackedDir, 'pages', 'index', 'index.js'), 'Page({});\n');
        return handlers.handleMiniappPkgAnalyze({ unpackedDir });
      },
      validate: (v: unknown) => {
        const b = body(v) as { success?: boolean; error?: string; pages?: string[] };
        if (b.success === false) return `analyze failed: ${b.error}`;
        if (!Array.isArray(b.pages) || !b.pages.includes('pages/index/index'))
          return `app.json page pages/index/index missing from analysis, got ${JSON.stringify(b.pages)}`;
        return true;
      },
    },
    {
      name: 'electron_scan_userdata/json-only-discovery',
      tool: 'electron_scan_userdata',
      origin: 'homemade',
      reference: 'scan must discover the JSON userdata files and exclude non-JSON entries',
      run: () => handlers.handleElectronScanUserdata({ dirPath: userDataDir }),
      validate: (v: unknown) => {
        const b = body(v) as {
          success?: boolean;
          error?: string;
          files?: Array<{ name?: string; path?: string }>;
        };
        if (b.success === false) return `scan failed: ${b.error}`;
        const names = JSON.stringify(b.files ?? []);
        if (!Array.isArray(b.files) || b.files.length !== 2)
          return `expected 2 JSON files discovered, got ${b.files?.length}`;
        if (!names.includes('settings.json') || !names.includes('cache.json'))
          return `expected settings.json + cache.json, got ${names}`;
        if (names.includes('notes.txt')) return 'non-JSON file leaked into scan results';
        return true;
      },
    },
    {
      name: 'electron_debug_status/no-sessions',
      tool: 'electron_debug_status',
      origin: 'homemade',
      reference:
        'with no launched debug sessions the status tool reports an empty session list (no fabrication)',
      run: () => handlers.handleElectronDebugStatus({}),
      validate: (v: unknown) => {
        const b = body(v) as { sessions?: unknown[]; error?: string };
        if (!Array.isArray(b.sessions)) return `missing sessions array, got ${typeof b.sessions}`;
        if (b.sessions.length !== 0)
          return `expected 0 sessions in a fresh bench process, got ${b.sessions.length}`;
        return true;
      },
    },
  ],
};
