import { mkdtemp, rm, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAsarDeobfuscate } from '@server/domains/platform/handlers/asar-deobfuscate-handler';
import type { ObfuscationClassification } from '@server/domains/platform/handlers/asar-deobfuscate-handler';
import type { ToolResponse } from '@server/types';

function parseJson(res: ToolResponse): Record<string, unknown> {
  const text = res.content[0] as { text: string };
  return JSON.parse(text.text);
}

/** Build a minimal valid ASAR buffer with named JS files. */
function buildAsar(files: Record<string, string>): Buffer {
  return buildAsarFromBuffers(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, 'utf-8')])),
  );
}

/** Build an ASAR from raw byte buffers (for high-entropy / non-UTF-8 payloads). */
function buildAsarFromBuffers(files: Record<string, Buffer>): Buffer {
  const entries = Object.entries(files);
  const headerFiles: Record<string, unknown> = {};
  let offset = 0;
  const dataChunks: Buffer[] = [];

  for (const [name, buf] of entries) {
    headerFiles[name] = { size: buf.length, offset: String(offset) };
    dataChunks.push(buf);
    offset += buf.length;
  }

  const headerJson = JSON.stringify({ files: headerFiles });
  const headerBuf = Buffer.from(headerJson, 'utf-8');
  const headerLength = headerBuf.length;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(headerLength + 8, 0);
  prefix.writeUInt32LE(headerLength + 4, 4);
  prefix.writeUInt32LE(headerLength, 8);
  prefix.writeUInt32LE(0, 12);
  return Buffer.concat([prefix, headerBuf, ...dataChunks]);
}

const CLEAN_JS = `
function add(a, b) {
  return a + b;
}
module.exports = { add };
`;

const WEBPACK_JS = `
var __webpack_require__ = function (moduleId) { return modules[moduleId]; };
var __webpack_modules__ = { 1: function () {}, 2: function () {} };
__webpack_require__(1);
`;

const OBFUSCATED_JS = `
var _0x1a2b = ['hello', 'world', 'test', 'value', 'data', 'more', 'items', 'here'];
var _0x3c4d = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'];
var _0x5e6f = ['x', 'y', 'z', 'w', 'v', 'u', 't', 's'];
var _0x7g8h = _0x1a2b[0] + _0x3c4d[1];
var _0x9i0j = _0x5e6f[2] + _0x7g8h;
var _0x1k2l = _0x9i0j + _0x1a2b[3];
var _0x3m4n = _0x1k2l + _0x3c4d[5];
var _0x5o6p = _0x3m4n + _0x5e6f[7];
var _0x7q8r = _0x5o6p + _0x1a2b[1];
var _0x9s0t = _0x7q8r + _0x3c4d[2];
var _0x1u2v = _0x9s0t + _0x5e6f[0];
var _0x3w4x = _0x1u2v + _0x1a2b[2];
var _0x5y6z = _0x3w4x + _0x3c4d[7];
var _0x7a8b = _0x5y6z + _0x5e6f[5];
var _0x9c0d = _0x7a8b + _0x1a2b[6];
var _0x1e2f = _0x9c0d + _0x3c4d[3];
var _0x3g4h = _0x1e2f + _0x5e6f[3];
var _0x5i6j = _0x3g4h + _0x1a2b[7];
var _0x7k8l = _0x5i6j + _0x3c4d[6];
var _0x9m0n = _0x7k8l + _0x5e6f[1];
var _0x1o2p = _0x9m0n + _0x1a2b[5];
var _0x3q4r = _0x1o2p + _0x3c4d[0];
var _0x5s6t = _0x3q4r + _0x5e6f[4];
var _0x7u8v = _0x5s6t + _0x1a2b[4];
var _0x9w0x = _0x7u8v + _0x3c4d[4];
var _0x1y2z = _0x9w0x + _0x5e6f[6];
var _0x3a4b = _0x1y2z + _0x1a2b[0] + _0x1a2b[1] + _0x1a2b[2] + _0x1a2b[3] + _0x1a2b[4] + _0x1a2b[5] + _0x1a2b[6] + _0x1a2b[7];
`;

describe('handleAsarDeobfuscate', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs.length = 0;
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'asar-deobfuscate-'));
    tempDirs.push(dir);
    return dir;
  }

  it('classifies clean, webpack-bundle, and obfuscated files distinctly', async () => {
    const dir = await makeTempDir();
    const asar = buildAsar({
      'clean.js': CLEAN_JS,
      'webpack.js': WEBPACK_JS,
      'obfuscated.js': OBFUSCATED_JS,
    });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({ inputPath: asarPath, extract: false });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.filesScanned).toBe(3);
    const flagged = json.flaggedFiles as Array<Record<string, unknown>>;
    const paths = flagged.map((f) => f.path);
    expect(paths).toContain('obfuscated.js');
    expect(paths).toContain('webpack.js');

    const byPath = Object.fromEntries(flagged.map((f) => [f.path, f]));
    const obfuscated = byPath['obfuscated.js']!;
    expect(obfuscated.score).toBeGreaterThanOrEqual(30);
    expect(obfuscated.indicators.hexNameCount).toBeGreaterThan(20);

    const webpack = byPath['webpack.js']!;
    expect(webpack.classification).toBe('webpack-bundle');
    expect(webpack.indicators.webpackRequireCount).toBeGreaterThan(0);
  });

  it('extracts flagged files to an output directory', async () => {
    const dir = await makeTempDir();
    const outputDir = join(dir, 'out');
    const asar = buildAsar({
      'clean.js': CLEAN_JS,
      'obfuscated.js': OBFUSCATED_JS,
    });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({ inputPath: asarPath, outputDir });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.extractedCount).toBeGreaterThanOrEqual(1);
    const extractedContent = await fsReadFile(join(outputDir, 'obfuscated.js'), 'utf-8');
    expect(extractedContent).toContain('_0x1a2b');
  });

  it('reports a summary with per-classification counts', async () => {
    const dir = await makeTempDir();
    const asar = buildAsar({
      'clean.js': CLEAN_JS,
      'webpack.js': WEBPACK_JS,
    });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({ inputPath: asarPath, extract: false });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    const summary = json.summary as Record<ObfuscationClassification, number>;
    expect(summary.clean).toBeGreaterThanOrEqual(0);
    expect(summary['webpack-bundle']).toBeGreaterThanOrEqual(1);
    const totalClassified =
      (summary.obfuscated ?? 0) +
      (summary['heavy-obfuscation'] ?? 0) +
      (summary.clean ?? 0) +
      (summary.minified ?? 0) +
      (summary['webpack-bundle'] ?? 0) +
      (summary.packed ?? 0) +
      (summary.encrypted ?? 0);
    expect(totalClassified).toBe(json.filesScanned);
  });

  it('respects the fileGlob filter', async () => {
    const dir = await makeTempDir();
    const asar = buildAsar({
      'main.js': CLEAN_JS,
      'style.css': 'body { color: red; }',
    });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    // Glob *.css scans only the .css file (1 file); default *.js would scan main.js.
    const result = await handleAsarDeobfuscate({
      inputPath: asarPath,
      fileGlob: '*.css',
      extract: false,
    });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.filesScanned).toBe(1);
    expect(json.flaggedFiles).toEqual([]);
  });

  it('returns a failure when inputPath does not exist', async () => {
    const result = await handleAsarDeobfuscate({ inputPath: '/nonexistent/app.asar' });
    const json = parseJson(result);

    expect(json.success).toBe(false);
    expect(json.error).toContain('does not exist');
  });

  it('returns a failure when inputPath is missing', async () => {
    const result = await handleAsarDeobfuscate({});
    const json = parseJson(result);

    expect(json.success).toBe(false);
    expect(json.error).toContain('must be a non-empty string');
  });

  // ── Entropy / packer / encryption detection ─────────────────

  it('classifies a high-entropy random payload as encrypted', async () => {
    const dir = await makeTempDir();
    // 4 KiB of cryptographic random → byte Shannon entropy ≈ 8.0 (uniform).
    const encrypted = randomBytes(4096);
    const asar = buildAsarFromBuffers({
      'clean.js': Buffer.from(CLEAN_JS, 'utf-8'),
      'payload.bin': encrypted,
    });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({
      inputPath: asarPath,
      extract: false,
      fileGlob: '*',
    });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.filesScanned).toBe(2);
    const flagged = json.flaggedFiles as Array<Record<string, unknown>>;
    const byPath = Object.fromEntries(flagged.map((f) => [f.path, f]));
    const payload = byPath['payload.bin']!;
    expect(payload.classification).toBe('encrypted');
    expect(payload.indicators.entropy).toBeGreaterThan(7.5);
    const summary = json.summary as Record<string, number>;
    expect(summary.encrypted).toBeGreaterThanOrEqual(1);
  });

  it('classifies a high-entropy non-uniform blob as packed', async () => {
    const dir = await makeTempDir();
    // 4 KiB with the low bit cleared → 128 distinct byte values, uniformly spread.
    // Byte entropy ≈ log2(128) = 7.0 bits/byte: high (packed-class) but below the
    // 7.5 encrypted floor. Models packer / compressed-payload output.
    const raw = randomBytes(4096);
    const packed = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      packed[i] = raw[i]! & 0xfe;
    }
    const asar = buildAsarFromBuffers({
      'bundle.packed': packed,
    });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({
      inputPath: asarPath,
      extract: false,
      fileGlob: '*',
    });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    const flagged = json.flaggedFiles as Array<Record<string, unknown>>;
    const byPath = Object.fromEntries(flagged.map((f) => [f.path, f]));
    const bundle = byPath['bundle.packed']!;
    expect(['packed', 'encrypted']).toContain(bundle.classification);
    expect(bundle.indicators.entropy).toBeGreaterThan(6.5);
  });

  it('reports entropy on clean low-entropy files without reclassifying them', async () => {
    const dir = await makeTempDir();
    const asar = buildAsar({ 'clean.js': CLEAN_JS });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({ inputPath: asarPath, extract: false });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    // clean.js is not flagged (below MIN_FLAG_SCORE and not in flag classifications),
    // so we read it from the full report via summary: it stays clean, not packed/encrypted.
    const summary = json.summary as Record<string, number>;
    expect(summary.clean).toBe(1);
    expect(summary.packed ?? 0).toBe(0);
    expect(summary.encrypted ?? 0).toBe(0);
  });

  it('preserves code-shape classification for hex-flooded code regardless of entropy', async () => {
    const dir = await makeTempDir();
    // OBFUSCATED_JS triggers score >= 30 (obfuscated) via hex-name flood;
    // classify must keep it on the code-shape ladder instead of reclassifying
    // to packed/encrypted (ASCII code entropy stays below the 6.5 packed floor).
    const asar = buildAsar({ 'obf.js': OBFUSCATED_JS });
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const result = await handleAsarDeobfuscate({ inputPath: asarPath, extract: false });
    const json = parseJson(result);

    const flagged = json.flaggedFiles as Array<Record<string, unknown>>;
    const byPath = Object.fromEntries(flagged.map((f) => [f.path, f]));
    const obf = byPath['obf.js']!;
    expect(obf.classification).toBe('obfuscated');
    expect(['packed', 'encrypted']).not.toContain(obf.classification);
    // entropy indicator is always present and stays below the packed floor.
    expect(obf.indicators.entropy).toBeDefined();
    expect(obf.indicators.entropy).toBeLessThan(6.5);
  });
});
