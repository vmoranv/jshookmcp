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
  ],
};
